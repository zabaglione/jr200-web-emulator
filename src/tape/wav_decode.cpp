// SPDX-License-Identifier: BSD-3-Clause
// Waveform decoding derives from FIND's AnalyzeWave at the pinned upstream commit.
// Copyright (c) 2017,2020 FIND
// Copyright (c) 2026 jr200-web contributors
#include "jr200/wav_decode.hpp"

#include <limits.h>

namespace jr200::wav {
namespace {

constexpr uint32_t kSignalRate = 4800U;
constexpr uint32_t kMinimumLeaderSpans = 32U;

uint16_t read_u16(const uint8_t* input) noexcept
{
    return static_cast<uint16_t>(
        static_cast<uint16_t>(input[0]) |
        static_cast<uint16_t>(static_cast<uint16_t>(input[1]) << 8U));
}

uint32_t read_u32(const uint8_t* input) noexcept
{
    return static_cast<uint32_t>(input[0]) |
        (static_cast<uint32_t>(input[1]) << 8U) |
        (static_cast<uint32_t>(input[2]) << 16U) |
        (static_cast<uint32_t>(input[3]) << 24U);
}

bool tag_is(const uint8_t* input, const char (&tag)[5]) noexcept
{
    for (size_t i = 0U; i < 4U; ++i) {
        if (input[i] != static_cast<uint8_t>(tag[i])) {
            return false;
        }
    }
    return true;
}

uint64_t integer_sqrt(uint64_t value) noexcept
{
    uint64_t result = 0U;
    uint64_t bit = uint64_t{1} << 62U;
    while (bit > value) {
        bit >>= 2U;
    }
    while (bit != 0U) {
        if (value >= result + bit) {
            value -= result + bit;
            result = (result >> 1U) + bit;
        } else {
            result >>= 1U;
        }
        bit >>= 2U;
    }
    return result;
}

DecodeResult failure(
    DecodeError error,
    uint64_t frame = 0U,
    size_t cjr_offset = 0U,
    uint32_t detail = 0U) noexcept
{
    return {error, frame, cjr_offset, detail};
}

struct PcmView {
    const uint8_t* data{};
    uint64_t frames{};
    uint64_t bytes{};
    uint32_t rate{};
    uint16_t channels{};
    uint16_t bits{};
    uint16_t block_align{};

    [[nodiscard]] int32_t sample(uint64_t frame, uint16_t channel) const noexcept
    {
        const size_t bytes_per_sample = bits / 8U;
        const uint64_t offset = frame * block_align +
            static_cast<uint64_t>(channel) * bytes_per_sample;
        if (bits == 8U) {
            return (static_cast<int32_t>(data[offset]) - 128) * 256;
        }
        const uint16_t raw = read_u16(data + offset);
        return raw <= 32767U
            ? static_cast<int32_t>(raw)
            : static_cast<int32_t>(raw) - 65536;
    }
};

struct ChannelStats {
    int32_t minimum{INT32_MAX};
    int32_t maximum{INT32_MIN};
    int32_t dc{};
    int32_t rms{};
};

DecodeResult parse_riff(cjr::Bytes input, PcmView& pcm) noexcept
{
    if (input.size < 12U || !tag_is(input.data, "RIFF") ||
        !tag_is(input.data + 8U, "WAVE")) {
        return failure(DecodeError::InvalidRiff);
    }
    const uint32_t riff_size = read_u32(input.data + 4U);
    if (static_cast<uint64_t>(riff_size) + 8U != input.size) {
        return failure(DecodeError::RiffSizeMismatch, 0U, 0U, riff_size);
    }

    const uint8_t* format = nullptr;
    uint32_t format_size = 0U;
    const uint8_t* data = nullptr;
    uint32_t data_size = 0U;
    size_t position = 12U;
    while (position < input.size) {
        if (input.size - position < 8U) {
            return failure(DecodeError::TruncatedChunk, 0U, position);
        }
        const uint8_t* chunk = input.data + position;
        const uint32_t size = read_u32(chunk + 4U);
        const size_t payload = position + 8U;
        const uint64_t padded = static_cast<uint64_t>(size) + (size & 1U);
        const uint64_t remaining = input.size - payload;
        const bool missing_final_pad =
            (size & 1U) != 0U && static_cast<uint64_t>(size) == remaining;
        if (static_cast<uint64_t>(size) > remaining ||
            (padded > remaining && !missing_final_pad)) {
            return failure(DecodeError::TruncatedChunk, 0U, position, size);
        }
        if (tag_is(chunk, "fmt ")) {
            if (format != nullptr) {
                return failure(DecodeError::DuplicateFormat, 0U, position);
            }
            format = input.data + payload;
            format_size = size;
        } else if (tag_is(chunk, "data")) {
            if (data != nullptr) {
                return failure(DecodeError::DuplicateData, 0U, position);
            }
            data = input.data + payload;
            data_size = size;
        }
        position = missing_final_pad
            ? input.size
            : payload + static_cast<size_t>(padded);
    }

    if (format == nullptr) {
        return failure(DecodeError::MissingFormat);
    }
    if (format_size < 16U) {
        return failure(DecodeError::TruncatedChunk);
    }
    if (read_u16(format) != 1U) {
        return failure(DecodeError::UnsupportedPcm, 0U, 0U, read_u16(format));
    }
    const uint16_t channels = read_u16(format + 2U);
    if (channels != 1U && channels != 2U) {
        return failure(DecodeError::UnsupportedChannels, 0U, 0U, channels);
    }
    const uint32_t rate = read_u32(format + 4U);
    if (rate != 22050U && rate != 44100U && rate != 48000U) {
        return failure(DecodeError::UnsupportedSampleRate, 0U, 0U, rate);
    }
    const uint16_t bits = read_u16(format + 14U);
    if (bits != 8U && bits != 16U) {
        return failure(DecodeError::UnsupportedBits, 0U, 0U, bits);
    }
    const uint16_t block_align = read_u16(format + 12U);
    const uint16_t expected_align = static_cast<uint16_t>(channels * (bits / 8U));
    const uint32_t expected_byte_rate = rate * expected_align;
    if (block_align != expected_align || read_u32(format + 8U) != expected_byte_rate) {
        return failure(DecodeError::InvalidPcmLayout, 0U, 0U, block_align);
    }
    if (data == nullptr) {
        return failure(DecodeError::MissingData);
    }
    if (data_size == 0U) {
        return failure(DecodeError::EmptyData);
    }
    if (data_size % block_align != 0U) {
        return failure(DecodeError::InvalidPcmLayout, 0U, 0U, data_size);
    }

    pcm = {
        data,
        data_size / block_align,
        data_size,
        rate,
        channels,
        bits,
        block_align,
    };
    return {};
}

ChannelStats analyze_channel(const PcmView& pcm, uint16_t channel) noexcept
{
    ChannelStats stats{};
    int64_t sum = 0;
    for (uint64_t frame = 0U; frame < pcm.frames; ++frame) {
        const int32_t sample = pcm.sample(frame, channel);
        if (sample < stats.minimum) stats.minimum = sample;
        if (sample > stats.maximum) stats.maximum = sample;
        sum += sample;
    }
    stats.dc = static_cast<int32_t>(sum / static_cast<int64_t>(pcm.frames));
    uint64_t squares = 0U;
    for (uint64_t frame = 0U; frame < pcm.frames; ++frame) {
        const int64_t centered = static_cast<int64_t>(pcm.sample(frame, channel)) - stats.dc;
        squares += static_cast<uint64_t>(centered * centered);
    }
    stats.rms = static_cast<int32_t>(integer_sqrt(squares / pcm.frames));
    return stats;
}

enum class SpanKind : uint8_t {
    Short,
    Long,
    Invalid,
};

struct Span {
    SpanKind kind{SpanKind::Invalid};
    uint64_t start{};
    uint64_t end{};
};

class SignalReader {
public:
    SignalReader(
        const PcmView& pcm,
        uint16_t channel,
        int32_t dc,
        int32_t threshold,
        DecodeInfo& info) noexcept
        : pcm_(pcm),
          channel_(channel),
          dc_(dc),
          threshold_(threshold),
          info_(info)
    {
    }

    [[nodiscard]] bool next(Span& span) noexcept
    {
        if (pending_) {
            pending_ = false;
            span = {SpanKind::Long, pending_start_, pending_end_};
            record(span);
            return true;
        }
        if (!initialized_ && !initialize()) {
            return false;
        }
        while (frame_ < pcm_.frames) {
            const int32_t centered = pcm_.sample(frame_, channel_) - dc_;
            const bool turnover =
                (state_ < 0 && centered > threshold_) ||
                (state_ > 0 && centered < -threshold_);
            if (!turnover) {
                ++frame_;
                continue;
            }
            const uint64_t transition = frame_++;
            const uint64_t start = last_transition_;
            last_transition_ = transition;
            state_ = static_cast<int8_t>(-static_cast<int32_t>(state_));
            ++info_.transition_count;
            info_.last_signal_frame = transition;
            const uint64_t length = transition - start;
            const uint64_t scaled = length * kSignalRate * 100U;
            const uint64_t rate = pcm_.rate;
            if (scaled >= rate * 55U && scaled < rate * 145U) {
                span = {SpanKind::Short, start, transition};
                record(span);
                return true;
            }
            if (scaled >= rate * 145U && scaled <= rate * 275U) {
                span = {SpanKind::Long, start, transition};
                record(span);
                return true;
            }
            if (scaled > rate * 275U && scaled <= rate * 480U) {
                const uint64_t middle = start + length / 2U;
                span = {SpanKind::Long, start, middle};
                pending_ = true;
                pending_start_ = middle;
                pending_end_ = transition;
                ++info_.phase_merges;
                record(span);
                return true;
            }
            span = {SpanKind::Invalid, start, transition};
            ++info_.invalid_spans;
            return true;
        }
        return false;
    }

private:
    const PcmView& pcm_;
    uint16_t channel_{};
    int32_t dc_{};
    int32_t threshold_{};
    DecodeInfo& info_;
    uint64_t frame_{};
    uint64_t last_transition_{};
    int8_t state_{};
    bool initialized_{};
    bool pending_{};
    uint64_t pending_start_{};
    uint64_t pending_end_{};

    [[nodiscard]] bool initialize() noexcept
    {
        while (frame_ < pcm_.frames) {
            const int32_t centered = pcm_.sample(frame_, channel_) - dc_;
            if (centered > threshold_ || centered < -threshold_) {
                state_ = centered > 0 ? int8_t{1} : int8_t{-1};
                last_transition_ = frame_;
                info_.first_signal_frame = frame_;
                info_.first_signal_positive = state_ > 0;
                initialized_ = true;
                ++frame_;
                return true;
            }
            ++frame_;
        }
        return false;
    }

    void record(const Span& span) noexcept
    {
        const uint64_t length = span.end - span.start;
        if (span.kind == SpanKind::Short) {
            info_.short_span_sum += length;
            ++info_.short_span_count;
        } else if (span.kind == SpanKind::Long) {
            info_.long_span_sum += length;
            ++info_.long_span_count;
        }
    }
};

DecodeResult decode_signal(
    const PcmView& pcm,
    uint16_t channel,
    cjr::MutableBytes output,
    size_t& written,
    DecodeInfo& info,
    uint32_t forced_data_baud = 0U) noexcept
{
    SignalReader reader(pcm, channel, info.dc_offset, info.threshold, info);
    DecodeResult error{};
    uint32_t high_cycle = 8U;
    uint32_t low_cycle = 4U;

    auto next_span = [&](Span& span, DecodeError exhausted) noexcept -> bool {
        if (reader.next(span)) {
            return true;
        }
        error = failure(exhausted, pcm.frames, written);
        return false;
    };

    auto seek_start = [&](bool first, uint64_t& frame) noexcept -> bool {
        uint32_t long_count = 0U;
        Span span{};
        while (next_span(span, first ? DecodeError::LeaderNotFound : DecodeError::TruncatedSignal)) {
            if (span.kind == SpanKind::Long) {
                ++long_count;
                continue;
            }
            if (span.kind == SpanKind::Short && long_count >= kMinimumLeaderSpans) {
                frame = span.start;
                for (uint32_t i = 1U; i < high_cycle; ++i) {
                    if (!next_span(span, DecodeError::TruncatedSignal)) return false;
                    if (span.kind != SpanKind::Short) {
                        error = failure(DecodeError::InvalidStartBit, span.start, written);
                        return false;
                    }
                }
                return true;
            }
            long_count = 0U;
        }
        return false;
    };

    uint64_t frame_start = 0U;
    if (!seek_start(true, frame_start)) {
        return error;
    }
    info.first_block_frame = frame_start;

    size_t block_count = 0U;
    bool footer_seen = false;
    while (!footer_seen) {
        const size_t block_start = written;
        size_t block_bytes = 0U;
        size_t expected_bytes = 0U;
        uint8_t head[4]{};
        uint64_t last_byte_frame = frame_start;
        bool block_end = false;
        while (!block_end) {
            const uint64_t byte_frame = frame_start;
            last_byte_frame = byte_frame;
            uint8_t value = 0U;
            for (uint8_t bit = 0U; bit < 8U; ++bit) {
                Span span{};
                SpanKind kind = SpanKind::Invalid;
                for (uint32_t i = 0U; i < low_cycle; ++i) {
                    if (!next_span(span, DecodeError::TruncatedSignal)) return error;
                    if (span.kind == SpanKind::Invalid ||
                        (i != 0U && span.kind != kind)) {
                        return failure(DecodeError::InvalidDataBit, span.start, written, bit);
                    }
                    kind = span.kind;
                }
                if (kind == SpanKind::Short) {
                    for (uint32_t i = 0U; i < low_cycle; ++i) {
                        if (!next_span(span, DecodeError::TruncatedSignal)) return error;
                        if (span.kind != SpanKind::Short) {
                            return failure(DecodeError::InvalidDataBit, span.start, written, bit);
                        }
                    }
                } else {
                    value = static_cast<uint8_t>(value | static_cast<uint8_t>(1U << bit));
                }
            }

            if (written >= output.size) {
                info.candidate_bytes = written;
                return failure(DecodeError::OutputTooSmall, byte_frame, written);
            }
            output.data[written++] = value;
            info.candidate_bytes = written;
            if (block_bytes < 4U) {
                head[block_bytes] = value;
            }
            ++block_bytes;
            if (block_bytes == 4U) {
                if (head[0] != 0x02U || head[1] != 0x2aU) {
                    return failure(DecodeError::BadBlockMagic, byte_frame, block_start);
                }
                expected_bytes = head[2] == 0xffU
                    ? 6U
                    : static_cast<size_t>(head[3] == 0U ? 256U : head[3]) + 7U;
                if (expected_bytes > output.size - block_start) {
                    return failure(DecodeError::OutputTooSmall, byte_frame, block_start);
                }
            }

            const bool terminal_footer = expected_bytes == 6U &&
                head[2] == 0xffU && block_bytes == expected_bytes;
            if (terminal_footer) {
                block_end = true;
                break;
            }

            Span span{};
            for (uint32_t i = 0U; i < low_cycle * 3U; ++i) {
                if (!next_span(span, DecodeError::TruncatedSignal)) return error;
                if (span.kind != SpanKind::Long) {
                    return failure(DecodeError::InvalidStopBit, span.start, written - 1U);
                }
            }

            SpanKind probe = SpanKind::Invalid;
            uint64_t probe_frame = 0U;
            for (uint32_t i = 0U; i < high_cycle; ++i) {
                if (!next_span(span, DecodeError::TruncatedSignal)) return error;
                if (span.kind == SpanKind::Invalid ||
                    (i != 0U && span.kind != probe)) {
                    return failure(DecodeError::InvalidBlockBoundary, span.start, written);
                }
                if (i == 0U) probe_frame = span.start;
                probe = span.kind;
            }
            if (probe == SpanKind::Short) {
                if (expected_bytes != 0U && block_bytes >= expected_bytes) {
                    return failure(DecodeError::InvalidBlockBoundary, probe_frame, written);
                }
                frame_start = probe_frame;
            } else {
                if (expected_bytes == 0U || block_bytes != expected_bytes) {
                    return failure(DecodeError::InvalidBlockBoundary, probe_frame, written);
                }
                block_end = true;
            }
        }

        if (head[2] != 0xffU) {
            uint8_t checksum = 0U;
            for (size_t i = block_start; i + 1U < written; ++i) {
                checksum = static_cast<uint8_t>(checksum + output.data[i]);
            }
            if (checksum != output.data[written - 1U]) {
                const uint32_t detail =
                    (static_cast<uint32_t>(checksum) << 8U) |
                    output.data[written - 1U];
                return failure(
                    DecodeError::ChecksumMismatch,
                    last_byte_frame,
                    written - 1U,
                    detail);
            }
        }

        ++block_count;
        info.blocks = static_cast<uint32_t>(block_count);
        if (block_count == 1U) {
            if (written <= 23U) {
                return failure(DecodeError::InvalidCjr, last_byte_frame, written);
            }
            const uint32_t data_baud = forced_data_baud == 0U
                ? (output.data[23] == 0U ? 2400U : 600U)
                : forced_data_baud;
            if (data_baud == 2400U) {
                high_cycle = 2U;
                low_cycle = 1U;
            }
            info.data_baud = data_baud;
        }
        footer_seen = head[2] == 0xffU;
        if (!footer_seen && !seek_start(false, frame_start)) {
            return error;
        }
    }

    cjr::Summary summary{};
    const cjr::Result checked = cjr::inspect({output.data, written}, summary);
    if (!checked) {
        return failure(
            DecodeError::InvalidCjr,
            info.last_signal_frame,
            checked.offset,
            static_cast<uint32_t>(checked.error));
    }
    if (!summary.has_header || summary.file_type > 1U) {
        return failure(
            DecodeError::UnsupportedCjr,
            info.last_signal_frame,
            22U,
            summary.file_type);
    }
    info.candidate_bytes = written;
    info.verified = true;
    return {};
}

}  // namespace

DecodeResult Decoder::decode(
    cjr::Bytes wav,
    cjr::MutableBytes output,
    size_t& written,
    DecodeOptions options) noexcept
{
    info_ = {};
    written = 0U;
    if ((wav.data == nullptr && wav.size != 0U) ||
        (output.data == nullptr && output.size != 0U)) {
        return failure(DecodeError::NullBuffer);
    }
    if (wav.size > kMaxDecodeInput) {
        return failure(DecodeError::InputTooLarge, 0U, 0U, static_cast<uint32_t>(wav.size));
    }

    PcmView pcm{};
    const DecodeResult parsed = parse_riff(wav, pcm);
    if (!parsed) {
        return parsed;
    }
    info_.sample_rate = pcm.rate;
    info_.channels = pcm.channels;
    info_.bits_per_sample = pcm.bits;
    info_.total_frames = pcm.frames;
    info_.data_bytes = pcm.bytes;

    ChannelStats stats[2]{};
    for (uint16_t channel = 0U; channel < pcm.channels; ++channel) {
        stats[channel] = analyze_channel(pcm, channel);
        info_.channel_dc[channel] = stats[channel].dc;
        info_.channel_rms[channel] = stats[channel].rms;
    }

    uint16_t selected = 0U;
    switch (options.channel) {
    case DecodeChannel::Auto:
        if (pcm.channels == 2U && stats[1].rms > stats[0].rms) selected = 1U;
        break;
    case DecodeChannel::First:
        selected = 0U;
        break;
    case DecodeChannel::Second:
        if (pcm.channels < 2U) {
            return failure(DecodeError::InvalidChannel, 0U, 0U, 2U);
        }
        selected = 1U;
        break;
    default:
        return failure(
            DecodeError::InvalidChannel,
            0U,
            0U,
            static_cast<uint32_t>(options.channel));
    }
    info_.selected_channel = selected;
    info_.minimum = stats[selected].minimum;
    info_.maximum = stats[selected].maximum;
    info_.dc_offset = stats[selected].dc;
    info_.rms = stats[selected].rms;
    const int32_t range = info_.maximum - info_.minimum;
    if (range < 512 || info_.rms < 64) {
        return failure(DecodeError::Silent);
    }
    info_.threshold = info_.rms * 15 / 100;
    if (info_.threshold < 32) info_.threshold = 32;

    const DecodeInfo base_info = info_;
    const DecodeResult first = decode_signal(pcm, selected, output, written, info_);
    info_.candidate_bytes = written;
    if (first || info_.blocks == 0U || written <= 23U ||
        first.error == DecodeError::OutputTooSmall ||
        first.error == DecodeError::InvalidCjr ||
        first.error == DecodeError::UnsupportedCjr) {
        return first;
    }

    const uint32_t preferred_baud = output.data[23] == 0U ? 2400U : 600U;
    const uint32_t alternate_baud = preferred_baud == 2400U ? 600U : 2400U;
    const DecodeInfo first_info = info_;
    const size_t first_written = written;

    info_ = base_info;
    written = 0U;
    const DecodeResult alternate = decode_signal(
        pcm,
        selected,
        output,
        written,
        info_,
        alternate_baud);
    info_.candidate_bytes = written;
    if (alternate) {
        return alternate;
    }

    const bool first_advanced_farther =
        first_written > written ||
        (first_written == written && first_info.blocks > info_.blocks) ||
        (first_written == written && first_info.blocks == info_.blocks &&
            first.frame >= alternate.frame);
    if (!first_advanced_farther) {
        return alternate;
    }

    info_ = base_info;
    written = 0U;
    const DecodeResult restored = decode_signal(
        pcm,
        selected,
        output,
        written,
        info_,
        preferred_baud);
    info_.candidate_bytes = written;
    return restored;
}

const DecodeInfo& Decoder::info() const noexcept
{
    return info_;
}

const char* decode_error_message(DecodeError error) noexcept
{
    switch (error) {
    case DecodeError::Ok: return "ok";
    case DecodeError::NullBuffer: return "null WAV or CJR output buffer";
    case DecodeError::InputTooLarge: return "WAV input exceeds 128 MiB";
    case DecodeError::InvalidRiff: return "expected RIFF/WAVE input";
    case DecodeError::RiffSizeMismatch: return "RIFF length does not match the file length";
    case DecodeError::TruncatedChunk: return "RIFF chunk or padding is truncated";
    case DecodeError::DuplicateFormat: return "RIFF contains multiple fmt chunks";
    case DecodeError::MissingFormat: return "RIFF fmt chunk is missing";
    case DecodeError::UnsupportedPcm: return "only integer PCM WAV is supported";
    case DecodeError::UnsupportedChannels: return "only mono or stereo WAV is supported";
    case DecodeError::UnsupportedSampleRate: return "sample rate must be 22050, 44100 or 48000 Hz";
    case DecodeError::UnsupportedBits: return "PCM sample width must be 8 or 16 bits";
    case DecodeError::InvalidPcmLayout: return "PCM byte rate, block alignment or data length is invalid";
    case DecodeError::DuplicateData: return "RIFF contains multiple data chunks";
    case DecodeError::MissingData: return "RIFF data chunk is missing";
    case DecodeError::EmptyData: return "RIFF data chunk is empty";
    case DecodeError::InvalidChannel: return "selected WAV channel is unavailable";
    case DecodeError::Silent: return "selected WAV channel is silent or below the signal floor";
    case DecodeError::LeaderNotFound: return "cassette leader and first start bit were not found";
    case DecodeError::TruncatedSignal: return "cassette signal ended before a complete CJR";
    case DecodeError::InvalidStartBit: return "invalid cassette start bit timing";
    case DecodeError::InvalidDataBit: return "invalid or mixed cassette data bit timing";
    case DecodeError::InvalidStopBit: return "invalid cassette stop bit timing";
    case DecodeError::InvalidBlockBoundary: return "cassette block ended at an unexpected byte boundary";
    case DecodeError::BadBlockMagic: return "decoded block does not start with CJR magic 02 2A";
    case DecodeError::ChecksumMismatch: return "decoded CJR block checksum mismatch";
    case DecodeError::OutputTooSmall: return "decoded CJR exceeds the output buffer";
    case DecodeError::InvalidCjr: return "decoded candidate is not a valid complete CJR";
    case DecodeError::UnsupportedCjr: return "decoded CJR is not standard BASIC or machine code";
    }
    return "unknown WAV decode error";
}

}  // namespace jr200::wav
