// SPDX-License-Identifier: BSD-3-Clause
// Signal timing and decoding are adapted from FIND's CjrFormat/AnalyzeWave.
// Copyright (c) 2017,2020 FIND
// Copyright (c) 2026 jr200-web contributors
#include "jr200/cassette.hpp"

namespace jr200 {
namespace {

constexpr uint32_t kLeaderSamples = 136U * 8U * 8U;
constexpr uint32_t kFirstGapSamples = 12U * 8U * 8U;
constexpr uint32_t kInterBlockSamples = 36U * 8U * 8U;
constexpr uint32_t kFinalGapSamples = 12U * 8U * 8U;

size_t encoded_block_size(const uint8_t* block) noexcept
{
    if (block[2] == 0xffU) {
        return 6U;
    }
    const size_t payload = block[3] == 0U ? 256U : block[3];
    return payload + 7U;
}

class WaveDecoder {
public:
    WaveDecoder(const uint8_t* data, size_t size) noexcept
        : data_(data), sample_count_(size * 8U)
    {
    }

    [[nodiscard]] bool half_span(int& value) noexcept
    {
        size_t count = 0U;
        bool turnover = false;
        while (!turnover) {
            if (sample_ >= sample_count_) {
                return false;
            }
            const uint8_t byte = data_[sample_ / 8U];
            const int8_t sign = ((byte >> (sample_ % 8U)) & 1U) != 0U
                ? int8_t{1}
                : int8_t{-1};
            ++sample_;
            ++count;
            turnover = last_sign_ != 0 && sign != last_sign_;
            last_sign_ = sign;
        }
        value = count == 1U ? 0 : count == 2U ? 1 : -1;
        return true;
    }

private:
    const uint8_t* data_{};
    size_t sample_count_{};
    size_t sample_{};
    int8_t last_sign_{};
};

bool next_valid_half_span(WaveDecoder& decoder, int& value) noexcept
{
    if (!decoder.half_span(value)) {
        return false;
    }
    if (value == -1 && !decoder.half_span(value)) {
        return false;
    }
    return value == 0 || value == 1;
}

bool consume_half_spans(WaveDecoder& decoder, uint32_t count) noexcept
{
    int value = 0;
    for (uint32_t i = 0U; i < count; ++i) {
        if (!decoder.half_span(value) || value == -1) {
            return false;
        }
    }
    return true;
}

bool decode_byte(
    WaveDecoder& decoder,
    uint32_t low_cycle,
    uint32_t high_cycle,
    bool finish_framing,
    bool probe_after,
    uint8_t& byte,
    bool& next_is_start) noexcept
{
    byte = 0U;
    for (uint8_t bit = 0U; bit < 8U; ++bit) {
        uint32_t ones = 0U;
        for (uint32_t i = 0U; i < low_cycle; ++i) {
            int value = 0;
            if (!next_valid_half_span(decoder, value)) {
                return false;
            }
            ones += static_cast<uint32_t>(value);
        }
        const uint8_t logical = ones * 2U >= low_cycle ? 1U : 0U;
        if (logical == 0U && !consume_half_spans(decoder, low_cycle)) {
            return false;
        }
        byte = static_cast<uint8_t>(byte | static_cast<uint8_t>(logical << bit));
    }
    if (!finish_framing) {
        next_is_start = false;
        return true;
    }
    if (!consume_half_spans(decoder, low_cycle * 3U)) {
        return false;
    }
    if (!probe_after) {
        next_is_start = false;
        return true;
    }
    uint32_t ones = 0U;
    for (uint32_t i = 0U; i < high_cycle; ++i) {
        int value = 0;
        if (!decoder.half_span(value) || value == -1) {
            return false;
        }
        ones += static_cast<uint32_t>(value);
    }
    next_is_start = ones * 2U < high_cycle;
    return true;
}

}  // namespace

void CassetteDeck::configure_recording_storage(
    uint8_t* capture,
    size_t capture_capacity,
    uint8_t* output,
    size_t output_capacity) noexcept
{
    capture_ = capture;
    capture_capacity_ = capture_capacity;
    output_ = output;
    output_capacity_ = output_capacity;
}

CassetteError CassetteDeck::mount(
    const uint8_t* input,
    size_t size) noexcept
{
    eject();
    if (input == nullptr && size != 0U) {
        set_error(CassetteError::NullBuffer);
        return error_;
    }
    if (size > cjr::kMaxInput) {
        set_error(CassetteError::InputTooLarge);
        return error_;
    }
    cjr::Summary next{};
    const cjr::Result result = cjr::inspect({input, size}, next);
    if (!result) {
        set_error(
            CassetteError::InvalidCjr,
            static_cast<uint32_t>(result.error));
        return error_;
    }
    if (!next.has_header || next.file_type > 1U) {
        set_error(CassetteError::UnsupportedType, next.file_type);
        return error_;
    }
    input_ = input;
    input_size_ = size;
    summary_ = next;
    mode_ = CassetteMode::Playback;
    state_ = CassetteState::Stopped;
    error_ = CassetteError::None;
    error_detail_ = 0U;
    if (!calculate_total_samples()) {
        set_error(CassetteError::InvalidCjr);
        return error_;
    }
    reset_generator();
    return CassetteError::None;
}

void CassetteDeck::eject() noexcept
{
    input_ = nullptr;
    input_size_ = 0U;
    capture_size_ = 0U;
    output_size_ = 0U;
    summary_ = {};
    mode_ = CassetteMode::Empty;
    state_ = CassetteState::Ejected;
    error_ = CassetteError::None;
    error_detail_ = 0U;
    remote_ = false;
    read_started_ = false;
    cycle_remainder_ = 0U;
    sample_position_ = 0U;
    total_samples_ = 0U;
    phase_ = Phase::Done;
}

bool CassetteDeck::rewind() noexcept
{
    if (mode_ != CassetteMode::Playback || input_ == nullptr) {
        return false;
    }
    state_ = CassetteState::Stopped;
    error_ = CassetteError::None;
    error_detail_ = 0U;
    reset_generator();
    return true;
}

CassetteError CassetteDeck::arm_record() noexcept
{
    if (capture_ == nullptr || output_ == nullptr ||
        capture_capacity_ == 0U || output_capacity_ == 0U) {
        set_error(CassetteError::StorageUnavailable);
        return error_;
    }
    input_ = nullptr;
    input_size_ = 0U;
    capture_size_ = 0U;
    output_size_ = 0U;
    summary_ = {};
    mode_ = CassetteMode::Record;
    state_ = CassetteState::RecordArmed;
    error_ = CassetteError::None;
    error_detail_ = 0U;
    remote_ = false;
    read_started_ = false;
    cycle_remainder_ = 0U;
    sample_position_ = 0U;
    total_samples_ = 0U;
    phase_ = Phase::Done;
    return CassetteError::None;
}

void CassetteDeck::set_remote(bool enabled) noexcept
{
    if (enabled == remote_) {
        return;
    }
    remote_ = enabled;
    cycle_remainder_ = 0U;
    if (mode_ == CassetteMode::Playback) {
        read_started_ = false;
        state_ = phase_ == Phase::Done
            ? CassetteState::Finished
            : CassetteState::Stopped;
        return;
    }
    if (mode_ != CassetteMode::Record) {
        return;
    }
    if (enabled) {
        if (state_ == CassetteState::RecordArmed) {
            state_ = CassetteState::Recording;
        }
        return;
    }
    if (state_ != CassetteState::Recording) {
        return;
    }
    if (capture_size_ == 0U) {
        set_error(CassetteError::EmptyCapture);
        return;
    }
    const CassetteError decoded = decode_recording();
    if (decoded == CassetteError::None) {
        state_ = CassetteState::OutputReady;
    }
}

void CassetteDeck::reset_remote() noexcept
{
    if (mode_ == CassetteMode::Record && state_ == CassetteState::Recording) {
        remote_ = false;
        set_error(CassetteError::RecordingInterrupted);
        return;
    }
    remote_ = false;
    read_started_ = false;
    cycle_remainder_ = 0U;
    if (mode_ == CassetteMode::Playback) {
        state_ = phase_ == Phase::Done
            ? CassetteState::Finished
            : CassetteState::Stopped;
    }
}

bool CassetteDeck::read_level() noexcept
{
    if (mode_ != CassetteMode::Playback || !remote_) {
        return true;
    }
    if (phase_ == Phase::Done) {
        state_ = CassetteState::Finished;
        return true;
    }
    read_started_ = true;
    state_ = CassetteState::Playing;
    return current_level();
}

void CassetteDeck::write_signal_byte(uint8_t value) noexcept
{
    if (mode_ != CassetteMode::Record || !remote_ ||
        state_ != CassetteState::Recording) {
        return;
    }
    if (capture_size_ >= capture_capacity_) {
        set_error(CassetteError::CaptureOverflow);
        return;
    }
    capture_[capture_size_++] = value;
}

void CassetteDeck::tick(uint32_t cycles) noexcept
{
    if (mode_ != CassetteMode::Playback || !remote_ || !read_started_ ||
        phase_ == Phase::Done) {
        return;
    }
    uint64_t accumulated = static_cast<uint64_t>(cycle_remainder_) + cycles;
    while (accumulated >= kCyclesPerSample && phase_ != Phase::Done) {
        accumulated -= kCyclesPerSample;
        advance_sample();
    }
    cycle_remainder_ = static_cast<uint32_t>(accumulated);
}

CassetteMode CassetteDeck::mode() const noexcept { return mode_; }
CassetteState CassetteDeck::state() const noexcept { return state_; }
CassetteError CassetteDeck::error() const noexcept { return error_; }
uint32_t CassetteDeck::error_detail() const noexcept { return error_detail_; }
bool CassetteDeck::remote() const noexcept { return remote_; }
bool CassetteDeck::read_started() const noexcept { return read_started_; }
uint64_t CassetteDeck::sample_position() const noexcept { return sample_position_; }
uint64_t CassetteDeck::total_samples() const noexcept { return total_samples_; }
size_t CassetteDeck::capture_size() const noexcept { return capture_size_; }
const uint8_t* CassetteDeck::output_data() const noexcept { return output_; }
size_t CassetteDeck::output_size() const noexcept { return output_size_; }
const cjr::Summary& CassetteDeck::summary() const noexcept { return summary_; }

void CassetteDeck::set_error(CassetteError error, uint32_t detail) noexcept
{
    error_ = error;
    error_detail_ = detail;
    state_ = CassetteState::Error;
}

bool CassetteDeck::calculate_total_samples() noexcept
{
    size_t offset = 0U;
    size_t blocks = 0U;
    uint64_t data_samples = 0U;
    while (offset < input_size_) {
        const size_t length = encoded_block_size(input_ + offset);
        if (length > input_size_ - offset) {
            return false;
        }
        const uint32_t samples_per_bit = blocks == 0U || summary_.baud_flag != 0U
            ? 8U
            : 2U;
        data_samples += static_cast<uint64_t>(length) * 12U * samples_per_bit;
        ++blocks;
        offset += length;
    }
    if (blocks < 2U) {
        return false;
    }
    total_samples_ = kLeaderSamples + kFirstGapSamples + data_samples +
        static_cast<uint64_t>(blocks - 1U) * kInterBlockSamples +
        kFinalGapSamples;
    return true;
}

void CassetteDeck::reset_generator() noexcept
{
    cycle_remainder_ = 0U;
    sample_position_ = 0U;
    phase_ = Phase::Leader;
    phase_sample_ = 0U;
    block_offset_ = 0U;
    block_length_ = 0U;
    block_byte_ = 0U;
    frame_bit_ = 0U;
    bit_sample_ = 0U;
    block_samples_per_bit_ = 8U;
    sign_ = 1;
    read_started_ = false;
}

void CassetteDeck::start_block() noexcept
{
    block_length_ = encoded_block_size(input_ + block_offset_);
    block_byte_ = 0U;
    frame_bit_ = 0U;
    bit_sample_ = 0U;
    block_samples_per_bit_ = block_offset_ == 0U || summary_.baud_flag != 0U
        ? 8U
        : 2U;
    phase_ = Phase::Block;
    phase_sample_ = 0U;
}

uint8_t CassetteDeck::current_frame_bit() const noexcept
{
    if (frame_bit_ == 0U) {
        return 0U;
    }
    if (frame_bit_ < 9U) {
        return static_cast<uint8_t>(
            (input_[block_offset_ + block_byte_] >> (frame_bit_ - 1U)) & 1U);
    }
    return 1U;
}

bool CassetteDeck::current_level() const noexcept
{
    uint8_t logical = 1U;
    uint8_t sample = static_cast<uint8_t>(phase_sample_ % 8U);
    uint8_t samples_per_bit = 8U;
    if (phase_ == Phase::Block) {
        logical = current_frame_bit();
        sample = bit_sample_;
        samples_per_bit = block_samples_per_bit_;
    }
    bool positive = false;
    if (samples_per_bit == 8U) {
        if (logical == 0U) {
            positive = (sample & 1U) != 0U;
        } else {
            positive = sample == 2U || sample == 3U ||
                sample == 6U || sample == 7U;
        }
    } else if (logical == 0U) {
        positive = sample == 1U;
    }
    if (sign_ < 0) {
        positive = !positive;
    }
    return positive;
}

void CassetteDeck::advance_sample() noexcept
{
    ++sample_position_;
    if (phase_ == Phase::Leader) {
        if (++phase_sample_ == kLeaderSamples) {
            phase_ = Phase::FirstGap;
            phase_sample_ = 0U;
        }
        return;
    }
    if (phase_ == Phase::FirstGap) {
        if (++phase_sample_ == kFirstGapSamples) {
            start_block();
        }
        return;
    }
    if (phase_ == Phase::InterBlockGap) {
        if (++phase_sample_ == kInterBlockSamples) {
            start_block();
        }
        return;
    }
    if (phase_ == Phase::FinalGap) {
        if (++phase_sample_ == kFinalGapSamples) {
            phase_ = Phase::Done;
            state_ = CassetteState::Finished;
            read_started_ = false;
        }
        return;
    }
    if (phase_ != Phase::Block) {
        return;
    }

    const uint8_t logical = current_frame_bit();
    ++bit_sample_;
    if (bit_sample_ < block_samples_per_bit_) {
        return;
    }
    if (block_samples_per_bit_ == 2U && logical == 1U) {
        sign_ = static_cast<int8_t>(-sign_);
    }
    bit_sample_ = 0U;
    if (++frame_bit_ < 12U) {
        return;
    }
    frame_bit_ = 0U;
    if (++block_byte_ < block_length_) {
        return;
    }

    const bool footer = input_[block_offset_ + 2U] == 0xffU;
    block_offset_ += block_length_;
    phase_sample_ = 0U;
    phase_ = footer ? Phase::FinalGap : Phase::InterBlockGap;
}

CassetteError CassetteDeck::decode_recording() noexcept
{
    output_size_ = 0U;
    WaveDecoder decoder(capture_, capture_size_);
    int value = -1;
    do {
        if (!decoder.half_span(value)) {
            set_error(CassetteError::DecodeFailed);
            return error_;
        }
    } while (value != 0);
    for (uint32_t i = 0U; i < 7U; ++i) {
        if (!next_valid_half_span(decoder, value)) {
            set_error(CassetteError::DecodeFailed);
            return error_;
        }
    }

    uint32_t high_cycle = 8U;
    uint32_t low_cycle = 4U;
    size_t block_count = 0U;
    while (true) {
        uint8_t block_head[3]{};
        size_t block_bytes = 0U;
        size_t expected_bytes = 0U;
        while (expected_bytes == 0U || block_bytes < expected_bytes) {
            uint8_t byte = 0U;
            bool next_is_start = false;
            const bool probe_after = expected_bytes == 0U ||
                block_bytes + 1U < expected_bytes;
            const bool terminal_footer_byte = expected_bytes == 6U &&
                block_head[2] == 0xffU && block_bytes + 1U == expected_bytes;
            if (!decode_byte(
                    decoder,
                    low_cycle,
                    high_cycle,
                    !terminal_footer_byte,
                    probe_after,
                    byte,
                    next_is_start)) {
                set_error(CassetteError::DecodeFailed);
                return error_;
            }
            if (output_size_ >= output_capacity_) {
                set_error(CassetteError::OutputTooSmall);
                return error_;
            }
            output_[output_size_++] = byte;
            if (block_bytes < 3U) {
                block_head[block_bytes] = byte;
            }
            ++block_bytes;
            if (block_bytes == 4U) {
                if (block_head[0] != 0x02U || block_head[1] != 0x2aU) {
                    set_error(CassetteError::DecodeFailed);
                    return error_;
                }
                expected_bytes = block_head[2] == 0xffU
                    ? 6U
                    : static_cast<size_t>(byte == 0U ? 256U : byte) + 7U;
                if (expected_bytes > output_capacity_ -
                        (output_size_ - block_bytes)) {
                    set_error(CassetteError::OutputTooSmall);
                    return error_;
                }
            }
            if (probe_after && !next_is_start) {
                set_error(CassetteError::DecodeFailed);
                return error_;
            }
        }

        if (block_count == 0U) {
            if (output_size_ <= 23U) {
                set_error(CassetteError::DecodeFailed);
                return error_;
            }
            if (output_[23] == 0U) {
                high_cycle = 2U;
                low_cycle = 1U;
            }
        }
        if (block_head[0] == 0x02U && block_head[1] == 0x2aU &&
            block_head[2] == 0xffU) {
            break;
        }

        do {
            if (!decoder.half_span(value)) {
                set_error(CassetteError::DecodeFailed);
                return error_;
            }
        } while (value == 1);
        if (value != 0) {
            set_error(CassetteError::DecodeFailed);
            return error_;
        }
        for (uint32_t i = 1U; i < high_cycle; ++i) {
            if (!decoder.half_span(value) || value == -1) {
                set_error(CassetteError::DecodeFailed);
                return error_;
            }
        }
        ++block_count;
    }

    cjr::Summary decoded{};
    const cjr::Result checked = cjr::inspect({output_, output_size_}, decoded);
    if (!checked) {
        set_error(
            CassetteError::DecodeFailed,
            static_cast<uint32_t>(checked.error));
        return error_;
    }
    if (!decoded.has_header || decoded.file_type > 1U) {
        set_error(CassetteError::UnsupportedType, decoded.file_type);
        return error_;
    }
    summary_ = decoded;
    error_ = CassetteError::None;
    error_detail_ = 0U;
    return CassetteError::None;
}

const char* cassette_error_message(CassetteError error) noexcept
{
    switch (error) {
    case CassetteError::None: return "ok";
    case CassetteError::NullBuffer: return "null cassette buffer";
    case CassetteError::InputTooLarge: return "cassette input exceeds 1 MiB";
    case CassetteError::InvalidCjr: return "invalid or unsupported CJR stream";
    case CassetteError::UnsupportedType: return "only standard BASIC and machine-code CJR are supported";
    case CassetteError::StorageUnavailable: return "cassette recording storage is unavailable";
    case CassetteError::CaptureOverflow: return "cassette waveform capture exceeded its fixed capacity";
    case CassetteError::OutputTooSmall: return "decoded CJR exceeded its fixed output capacity";
    case CassetteError::DecodeFailed: return "cassette waveform could not be decoded as CJR";
    case CassetteError::EmptyCapture: return "cassette recording stopped without waveform data";
    case CassetteError::RecordingInterrupted: return "cassette recording was interrupted by reset";
    }
    return "unknown cassette error";
}

}  // namespace jr200
