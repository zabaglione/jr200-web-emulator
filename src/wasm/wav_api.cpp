// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 jr200-web contributors
#include "jr200/wav.hpp"

namespace {

constexpr size_t kPcmCapacity = 4096U;
alignas(16) uint8_t wav_input[jr200::cjr::kMaxInput]{};
alignas(16) uint8_t wav_header[jr200::wav::kHeaderSize]{};
alignas(16) int16_t wav_pcm[kPcmCapacity]{};
jr200::wav::Encoder wav_encoder{};
jr200::wav::Result wav_result{};

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

uint32_t jr200_wav_api_version()
{
    return 1U;
}

uint8_t* jr200_wav_input_ptr()
{
    return wav_input;
}

uint32_t jr200_wav_input_capacity()
{
    return static_cast<uint32_t>(jr200::cjr::kMaxInput);
}

uint32_t jr200_wav_begin(
    uint32_t size,
    uint32_t sample_rate,
    uint32_t data_baud)
{
    if (size > jr200::cjr::kMaxInput) {
        wav_result = {jr200::wav::Error::InputTooLarge, size};
        return static_cast<uint32_t>(wav_result.error);
    }
    if (data_baud != 0U && data_baud != 600U && data_baud != 2400U) {
        wav_result = {jr200::wav::Error::InvalidBaud, data_baud};
        return static_cast<uint32_t>(wav_result.error);
    }
    const auto baud = static_cast<jr200::CassetteDataBaud>(data_baud);
    wav_result = wav_encoder.begin(
        {wav_input, size},
        {sample_rate, baud, jr200::wav::kDefaultAmplitude});
    if (!wav_result) {
        return static_cast<uint32_t>(wav_result.error);
    }
    wav_result = wav_encoder.write_header(
        {wav_header, jr200::wav::kHeaderSize});
    return static_cast<uint32_t>(wav_result.error);
}

const uint8_t* jr200_wav_header_ptr()
{
    return wav_header;
}

uint32_t jr200_wav_header_size()
{
    return static_cast<uint32_t>(jr200::wav::kHeaderSize);
}

const int16_t* jr200_wav_pcm_ptr()
{
    return wav_pcm;
}

uint32_t jr200_wav_pcm_capacity()
{
    return static_cast<uint32_t>(kPcmCapacity);
}

uint32_t jr200_wav_drain(uint32_t maximum_samples)
{
    size_t limit = maximum_samples;
    if (limit > kPcmCapacity) {
        limit = kPcmCapacity;
    }
    return static_cast<uint32_t>(wav_encoder.drain(wav_pcm, limit));
}

uint32_t jr200_wav_field(uint32_t field)
{
    const jr200::wav::Info& info = wav_encoder.info();
    switch (field) {
    case 0: return info.sample_rate;
    case 1: return info.data_baud;
    case 2: return static_cast<uint32_t>(info.amplitude);
    case 3: return low_u32(info.signal_samples);
    case 4: return high_u32(info.signal_samples);
    case 5: return low_u32(info.pcm_samples);
    case 6: return high_u32(info.pcm_samples);
    case 7: return low_u32(info.data_bytes);
    case 8: return high_u32(info.data_bytes);
    case 9: return low_u32(info.total_bytes);
    case 10: return high_u32(info.total_bytes);
    case 11: return low_u32(wav_encoder.samples_emitted());
    case 12: return high_u32(wav_encoder.samples_emitted());
    case 13: return wav_encoder.finished() ? 1U : 0U;
    default: return 0U;
    }
}

uint32_t jr200_wav_error_offset()
{
    return static_cast<uint32_t>(wav_result.offset);
}

const char* jr200_wav_error_message()
{
    return jr200::wav::error_message(wav_result.error);
}

}  // extern "C"
