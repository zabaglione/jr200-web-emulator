// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 jr200-web contributors
#include "jr200/wav_decode.hpp"

namespace {

constexpr size_t kWavInputCapacity = 8U * 1024U * 1024U;
alignas(16) uint8_t wav_decode_input[kWavInputCapacity]{};
alignas(16) uint8_t wav_decode_output[jr200::cjr::kMaxInput]{};
jr200::wav::Decoder wav_decoder{};
jr200::wav::DecodeResult wav_decode_result{};
size_t wav_decode_written{};

uint32_t low_u32(uint64_t value) noexcept
{
    return static_cast<uint32_t>(value);
}

uint32_t high_u32(uint64_t value) noexcept
{
    return static_cast<uint32_t>(value >> 32U);
}

}  // namespace

extern "C" {

uint32_t jr200_wav_decode_api_version()
{
    return 1U;
}

uint8_t* jr200_wav_decode_input_ptr()
{
    return wav_decode_input;
}

uint32_t jr200_wav_decode_input_capacity()
{
    return static_cast<uint32_t>(kWavInputCapacity);
}

const uint8_t* jr200_wav_decode_output_ptr()
{
    return wav_decode_output;
}

uint32_t jr200_wav_decode_output_size()
{
    return wav_decoder.info().verified
        ? static_cast<uint32_t>(wav_decode_written)
        : 0U;
}

uint32_t jr200_wav_decode_run(uint32_t size, uint32_t channel)
{
    wav_decoder = {};
    wav_decode_result = {};
    wav_decode_written = 0U;
    if (size > kWavInputCapacity) {
        wav_decode_result = {
            jr200::wav::DecodeError::InputTooLarge,
            0U,
            0U,
            size,
        };
        return static_cast<uint32_t>(wav_decode_result.error);
    }
    if (channel > static_cast<uint32_t>(jr200::wav::DecodeChannel::Second)) {
        wav_decode_result = {
            jr200::wav::DecodeError::InvalidChannel,
            0U,
            0U,
            channel,
        };
        return static_cast<uint32_t>(wav_decode_result.error);
    }
    wav_decode_result = wav_decoder.decode(
        {wav_decode_input, size},
        {wav_decode_output, jr200::cjr::kMaxInput},
        wav_decode_written,
        {static_cast<jr200::wav::DecodeChannel>(channel)});
    return static_cast<uint32_t>(wav_decode_result.error);
}

uint32_t jr200_wav_decode_field(uint32_t field)
{
    const jr200::wav::DecodeInfo& info = wav_decoder.info();
    switch (field) {
    case 0: return info.sample_rate;
    case 1: return info.channels;
    case 2: return info.bits_per_sample;
    case 3: return info.selected_channel;
    case 4: return low_u32(info.total_frames);
    case 5: return high_u32(info.total_frames);
    case 6: return low_u32(info.data_bytes);
    case 7: return high_u32(info.data_bytes);
    case 8: return static_cast<uint32_t>(info.channel_dc[0]);
    case 9: return static_cast<uint32_t>(info.channel_rms[0]);
    case 10: return static_cast<uint32_t>(info.channel_dc[1]);
    case 11: return static_cast<uint32_t>(info.channel_rms[1]);
    case 12: return static_cast<uint32_t>(info.minimum);
    case 13: return static_cast<uint32_t>(info.maximum);
    case 14: return static_cast<uint32_t>(info.dc_offset);
    case 15: return static_cast<uint32_t>(info.rms);
    case 16: return static_cast<uint32_t>(info.threshold);
    case 17: return low_u32(info.transition_count);
    case 18: return high_u32(info.transition_count);
    case 19: return low_u32(info.invalid_spans);
    case 20: return high_u32(info.invalid_spans);
    case 21: return low_u32(info.phase_merges);
    case 22: return high_u32(info.phase_merges);
    case 23: return low_u32(info.short_span_sum);
    case 24: return high_u32(info.short_span_sum);
    case 25: return low_u32(info.long_span_sum);
    case 26: return high_u32(info.long_span_sum);
    case 27: return info.short_span_count;
    case 28: return info.long_span_count;
    case 29: return low_u32(info.first_signal_frame);
    case 30: return high_u32(info.first_signal_frame);
    case 31: return low_u32(info.first_block_frame);
    case 32: return high_u32(info.first_block_frame);
    case 33: return low_u32(info.last_signal_frame);
    case 34: return high_u32(info.last_signal_frame);
    case 35: return info.blocks;
    case 36: return info.data_baud;
    case 37: return static_cast<uint32_t>(info.candidate_bytes);
    case 38: return info.first_signal_positive ? 1U : 0U;
    case 39: return info.verified ? 1U : 0U;
    default: return 0U;
    }
}

uint32_t jr200_wav_decode_error_frame_low()
{
    return low_u32(wav_decode_result.frame);
}

uint32_t jr200_wav_decode_error_frame_high()
{
    return high_u32(wav_decode_result.frame);
}

uint32_t jr200_wav_decode_error_offset()
{
    return static_cast<uint32_t>(wav_decode_result.cjr_offset);
}

uint32_t jr200_wav_decode_error_detail()
{
    return wav_decode_result.detail;
}

const char* jr200_wav_decode_error_message()
{
    return jr200::wav::decode_error_message(wav_decode_result.error);
}

}  // extern "C"
