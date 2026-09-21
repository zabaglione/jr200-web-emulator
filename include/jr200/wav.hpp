// SPDX-License-Identifier: BSD-3-Clause
// Tape framing and phase derive from FIND's CjrFormat WaveGetter/GetLoadData.
// Copyright (c) 2017,2020 FIND
// Copyright (c) 2026 jr200-web contributors
#pragma once

#include "jr200/cassette.hpp"

#include <stddef.h>
#include <stdint.h>

namespace jr200::wav {

inline constexpr size_t kHeaderSize = 44U;
inline constexpr uint16_t kChannels = 1U;
inline constexpr uint16_t kBitsPerSample = 16U;
inline constexpr int16_t kDefaultAmplitude = 16384;

enum class Error : uint32_t {
    Ok = 0,
    NullBuffer = 1,
    InputTooLarge = 2,
    InvalidCjr = 3,
    UnsupportedCjr = 4,
    InvalidSampleRate = 5,
    InvalidBaud = 6,
    InvalidAmplitude = 7,
    RiffTooLarge = 8,
    OutputTooSmall = 9,
    NotStarted = 10,
};

struct Result {
    Error error{Error::Ok};
    size_t offset{};
    constexpr explicit operator bool() const noexcept
    {
        return error == Error::Ok;
    }
};

struct Options {
    uint32_t sample_rate{48000U};
    CassetteDataBaud data_baud{CassetteDataBaud::FromHeader};
    int16_t amplitude{kDefaultAmplitude};
};

struct Info {
    uint32_t sample_rate{};
    uint32_t data_baud{};
    int16_t amplitude{};
    uint64_t signal_samples{};
    uint64_t pcm_samples{};
    uint64_t data_bytes{};
    uint64_t total_bytes{};
};

// Allocation-free encoder. The caller must keep the CJR input alive until
// finished() becomes true. The abstract cassette signal is exactly 4800 Hz;
// output sample positions use cumulative rational time, never per-bit rounding.
class Encoder {
public:
    [[nodiscard]] Result begin(cjr::Bytes input, Options options = {}) noexcept;
    [[nodiscard]] Result write_header(cjr::MutableBytes output) const noexcept;
    [[nodiscard]] size_t drain(int16_t* output, size_t capacity) noexcept;
    [[nodiscard]] bool finished() const noexcept;
    [[nodiscard]] uint64_t samples_emitted() const noexcept;
    [[nodiscard]] const Info& info() const noexcept;

private:
    CassetteDeck deck_{};
    Info info_{};
    uint64_t sample_index_{};
    uint64_t signal_position_{};
    bool started_{};
};

const char* error_message(Error error) noexcept;

}  // namespace jr200::wav
