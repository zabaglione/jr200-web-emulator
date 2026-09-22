// SPDX-License-Identifier: BSD-3-Clause
// Waveform decoding derives from FIND's AnalyzeWave at the pinned upstream commit.
// Copyright (c) 2017,2020 FIND
// Copyright (c) 2026 jr200-web contributors
#pragma once

#include "jr200/cjr.hpp"

#include <stddef.h>
#include <stdint.h>

namespace jr200::wav {

inline constexpr size_t kMaxDecodeInput = 128U * 1024U * 1024U;

enum class DecodeChannel : uint8_t {
    Auto = 0,
    First = 1,
    Second = 2,
};

enum class DecodeError : uint32_t {
    Ok = 0,
    NullBuffer = 1,
    InputTooLarge = 2,
    InvalidRiff = 3,
    RiffSizeMismatch = 4,
    TruncatedChunk = 5,
    DuplicateFormat = 6,
    MissingFormat = 7,
    UnsupportedPcm = 8,
    UnsupportedChannels = 9,
    UnsupportedSampleRate = 10,
    UnsupportedBits = 11,
    InvalidPcmLayout = 12,
    DuplicateData = 13,
    MissingData = 14,
    EmptyData = 15,
    InvalidChannel = 16,
    Silent = 17,
    LeaderNotFound = 18,
    TruncatedSignal = 19,
    InvalidStartBit = 20,
    InvalidDataBit = 21,
    InvalidStopBit = 22,
    InvalidBlockBoundary = 23,
    BadBlockMagic = 24,
    ChecksumMismatch = 25,
    OutputTooSmall = 26,
    InvalidCjr = 27,
    UnsupportedCjr = 28,
};

struct DecodeResult {
    DecodeError error{DecodeError::Ok};
    uint64_t frame{};
    size_t cjr_offset{};
    uint32_t detail{};
    constexpr explicit operator bool() const noexcept
    {
        return error == DecodeError::Ok;
    }
};

struct DecodeOptions {
    DecodeChannel channel{DecodeChannel::Auto};
};

struct DecodeInfo {
    uint32_t sample_rate{};
    uint16_t channels{};
    uint16_t bits_per_sample{};
    uint16_t selected_channel{};
    uint16_t reserved{};
    uint64_t total_frames{};
    uint64_t data_bytes{};
    int32_t channel_dc[2]{};
    int32_t channel_rms[2]{};
    int32_t minimum{};
    int32_t maximum{};
    int32_t dc_offset{};
    int32_t rms{};
    int32_t threshold{};
    uint64_t transition_count{};
    uint64_t invalid_spans{};
    uint64_t phase_merges{};
    uint64_t short_span_sum{};
    uint64_t long_span_sum{};
    uint32_t short_span_count{};
    uint32_t long_span_count{};
    uint64_t first_signal_frame{};
    uint64_t first_block_frame{};
    uint64_t last_signal_frame{};
    uint32_t blocks{};
    uint32_t data_baud{};
    size_t candidate_bytes{};
    bool first_signal_positive{};
    bool verified{};
};

// Input is read-only. On failure, `written` and candidate_bytes describe only
// diagnostic candidate data. It must not be published as a verified CJR.
class Decoder {
public:
    [[nodiscard]] DecodeResult decode(
        cjr::Bytes wav,
        cjr::MutableBytes output,
        size_t& written,
        DecodeOptions options = {}) noexcept;
    [[nodiscard]] const DecodeInfo& info() const noexcept;

private:
    DecodeInfo info_{};
};

const char* decode_error_message(DecodeError error) noexcept;

}  // namespace jr200::wav
