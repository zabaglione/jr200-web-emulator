// SPDX-License-Identifier: BSD-3-Clause
// Tape framing and phase derive from FIND's CjrFormat WaveGetter/GetLoadData.
// Copyright (c) 2017,2020 FIND
// Copyright (c) 2026 jr200-web contributors
#include "jr200/wav.hpp"

namespace jr200::wav {
namespace {

void put_u16(uint8_t* output, size_t offset, uint16_t value) noexcept
{
    output[offset] = static_cast<uint8_t>(value);
    output[offset + 1U] = static_cast<uint8_t>(value >> 8U);
}

void put_u32(uint8_t* output, size_t offset, uint32_t value) noexcept
{
    output[offset] = static_cast<uint8_t>(value);
    output[offset + 1U] = static_cast<uint8_t>(value >> 8U);
    output[offset + 2U] = static_cast<uint8_t>(value >> 16U);
    output[offset + 3U] = static_cast<uint8_t>(value >> 24U);
}

void put_tag(uint8_t* output, size_t offset, const char (&tag)[5]) noexcept
{
    for (size_t i = 0U; i < 4U; ++i) {
        output[offset + i] = static_cast<uint8_t>(tag[i]);
    }
}

Result map_cassette_error(CassetteError error, uint32_t detail) noexcept
{
    switch (error) {
    case CassetteError::None:
        return {};
    case CassetteError::NullBuffer:
        return {Error::NullBuffer, detail};
    case CassetteError::InputTooLarge:
        return {Error::InputTooLarge, detail};
    case CassetteError::UnsupportedType:
        return {Error::UnsupportedCjr, detail};
    case CassetteError::InvalidBaud:
        return {Error::InvalidBaud, detail};
    default:
        return {Error::InvalidCjr, detail};
    }
}

}  // namespace

Result Encoder::begin(cjr::Bytes input, Options options) noexcept
{
    deck_.eject();
    info_ = {};
    sample_index_ = 0U;
    signal_position_ = 0U;
    started_ = false;

    if (options.sample_rate != 44100U && options.sample_rate != 48000U) {
        return {Error::InvalidSampleRate, options.sample_rate};
    }
    if (options.data_baud != CassetteDataBaud::FromHeader &&
        options.data_baud != CassetteDataBaud::Baud600 &&
        options.data_baud != CassetteDataBaud::Baud2400) {
        return {
            Error::InvalidBaud,
            static_cast<size_t>(options.data_baud),
        };
    }
    if (options.amplitude <= 0) {
        return {
            Error::InvalidAmplitude,
            static_cast<size_t>(options.amplitude < 0 ? 0 : options.amplitude),
        };
    }

    const CassetteError mounted = deck_.mount(
        input.data,
        input.size,
        options.data_baud);
    if (mounted != CassetteError::None) {
        return map_cassette_error(mounted, deck_.error_detail());
    }

    const uint64_t signal_samples = deck_.total_samples();
    if (signal_samples >
        (UINT64_MAX - (CassetteDeck::kSignalSampleRate - 1U)) /
            options.sample_rate) {
        deck_.eject();
        return {Error::RiffTooLarge, 0U};
    }
    const uint64_t pcm_samples =
        (signal_samples * options.sample_rate +
            (CassetteDeck::kSignalSampleRate - 1U)) /
        CassetteDeck::kSignalSampleRate;
    if (pcm_samples > (static_cast<uint64_t>(UINT32_MAX) - 36U) / 2U) {
        deck_.eject();
        return {Error::RiffTooLarge, 0U};
    }

    info_.sample_rate = options.sample_rate;
    info_.data_baud = options.data_baud == CassetteDataBaud::FromHeader
        ? (deck_.summary().baud_flag == 0U ? 2400U : 600U)
        : static_cast<uint32_t>(options.data_baud);
    info_.amplitude = options.amplitude;
    info_.signal_samples = signal_samples;
    info_.pcm_samples = pcm_samples;
    info_.data_bytes = pcm_samples * 2U;
    info_.total_bytes = info_.data_bytes + kHeaderSize;
    deck_.set_remote(true);
    static_cast<void>(deck_.read_level());
    started_ = true;
    return {};
}

Result Encoder::write_header(cjr::MutableBytes output) const noexcept
{
    if (!started_) {
        return {Error::NotStarted, 0U};
    }
    if (output.data == nullptr) {
        return {Error::NullBuffer, 0U};
    }
    if (output.size < kHeaderSize) {
        return {Error::OutputTooSmall, kHeaderSize};
    }

    put_tag(output.data, 0U, "RIFF");
    put_u32(
        output.data,
        4U,
        static_cast<uint32_t>(36U + info_.data_bytes));
    put_tag(output.data, 8U, "WAVE");
    put_tag(output.data, 12U, "fmt ");
    put_u32(output.data, 16U, 16U);
    put_u16(output.data, 20U, 1U);
    put_u16(output.data, 22U, kChannels);
    put_u32(output.data, 24U, info_.sample_rate);
    put_u32(output.data, 28U, info_.sample_rate * 2U);
    put_u16(output.data, 32U, 2U);
    put_u16(output.data, 34U, kBitsPerSample);
    put_tag(output.data, 36U, "data");
    put_u32(output.data, 40U, static_cast<uint32_t>(info_.data_bytes));
    return {};
}

size_t Encoder::drain(int16_t* output, size_t capacity) noexcept
{
    if (!started_ || output == nullptr || capacity == 0U || finished()) {
        return 0U;
    }
    uint64_t remaining = info_.pcm_samples - sample_index_;
    size_t count = capacity;
    if (remaining < count) {
        count = static_cast<size_t>(remaining);
    }
    for (size_t i = 0U; i < count; ++i) {
        const uint64_t target =
            (sample_index_ * CassetteDeck::kSignalSampleRate) /
            info_.sample_rate;
        while (signal_position_ < target) {
            deck_.tick(CassetteDeck::kCyclesPerSample);
            ++signal_position_;
        }
        output[i] = deck_.read_level()
            ? info_.amplitude
            : static_cast<int16_t>(-info_.amplitude);
        ++sample_index_;
    }
    return count;
}

bool Encoder::finished() const noexcept
{
    return started_ && sample_index_ >= info_.pcm_samples;
}

uint64_t Encoder::samples_emitted() const noexcept
{
    return sample_index_;
}

const Info& Encoder::info() const noexcept
{
    return info_;
}

const char* error_message(Error error) noexcept
{
    switch (error) {
    case Error::Ok: return "ok";
    case Error::NullBuffer: return "null WAV buffer";
    case Error::InputTooLarge: return "CJR input exceeds 1 MiB";
    case Error::InvalidCjr: return "invalid CJR for WAV conversion";
    case Error::UnsupportedCjr: return "only standard BASIC and machine-code CJR can be converted";
    case Error::InvalidSampleRate: return "sample rate must be 44100 or 48000 Hz";
    case Error::InvalidBaud: return "data baud must be 600 or 2400";
    case Error::InvalidAmplitude: return "PCM amplitude must be 1 through 32767";
    case Error::RiffTooLarge: return "WAV exceeds the RIFF PCM size limit";
    case Error::OutputTooSmall: return "WAV header output is too small";
    case Error::NotStarted: return "WAV encoder is not started";
    }
    return "unknown WAV error";
}

}  // namespace jr200::wav
