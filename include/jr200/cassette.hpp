// SPDX-License-Identifier: BSD-3-Clause
// Signal timing and decoding are adapted from FIND's CjrFormat/AnalyzeWave.
// Copyright (c) 2017,2020 FIND
// Copyright (c) 2026 jr200-web contributors
#pragma once

#include "jr200/cjr.hpp"

#include <stddef.h>
#include <stdint.h>

namespace jr200 {

enum class CassetteMode : uint8_t {
    Empty = 0,
    Playback = 1,
    Record = 2,
};

enum class CassetteState : uint8_t {
    Ejected = 0,
    Stopped = 1,
    Playing = 2,
    RecordArmed = 3,
    Recording = 4,
    OutputReady = 5,
    Finished = 6,
    Error = 7,
};

enum class CassetteDataBaud : uint16_t {
    FromHeader = 0,
    Baud600 = 600,
    Baud2400 = 2400,
};

enum class CassetteError : uint32_t {
    None = 0,
    NullBuffer = 1,
    InputTooLarge = 2,
    InvalidCjr = 3,
    UnsupportedType = 4,
    StorageUnavailable = 5,
    CaptureOverflow = 6,
    OutputTooSmall = 7,
    DecodeFailed = 8,
    EmptyCapture = 9,
    RecordingInterrupted = 10,
    InvalidBaud = 11,
};

class CassetteDeck {
public:
    static constexpr uint32_t kCyclesPerSample = 280U;
    static constexpr uint32_t kSignalSampleRate = 4800U;

    void configure_recording_storage(
        uint8_t* capture,
        size_t capture_capacity,
        uint8_t* output,
        size_t output_capacity) noexcept;

    [[nodiscard]] CassetteError mount(
        const uint8_t* input,
        size_t size) noexcept;
    [[nodiscard]] CassetteError mount(
        const uint8_t* input,
        size_t size,
        CassetteDataBaud data_baud) noexcept;
    void eject() noexcept;
    [[nodiscard]] bool rewind() noexcept;
    [[nodiscard]] CassetteError arm_record() noexcept;

    void set_remote(bool enabled) noexcept;
    void reset_remote() noexcept;
    [[nodiscard]] bool read_level() noexcept;
    void write_signal_byte(uint8_t value) noexcept;
    void tick(uint32_t cycles) noexcept;

    [[nodiscard]] CassetteMode mode() const noexcept;
    [[nodiscard]] CassetteState state() const noexcept;
    [[nodiscard]] CassetteError error() const noexcept;
    [[nodiscard]] uint32_t error_detail() const noexcept;
    [[nodiscard]] bool remote() const noexcept;
    [[nodiscard]] bool read_started() const noexcept;
    [[nodiscard]] uint64_t sample_position() const noexcept;
    [[nodiscard]] uint64_t total_samples() const noexcept;
    [[nodiscard]] size_t capture_size() const noexcept;
    [[nodiscard]] const uint8_t* output_data() const noexcept;
    [[nodiscard]] size_t output_size() const noexcept;
    [[nodiscard]] const cjr::Summary& summary() const noexcept;

private:
    enum class Phase : uint8_t {
        Leader,
        FirstGap,
        Block,
        InterBlockGap,
        FinalGap,
        Done,
    };

    const uint8_t* input_{};
    size_t input_size_{};
    uint8_t* capture_{};
    size_t capture_capacity_{};
    size_t capture_size_{};
    uint8_t* output_{};
    size_t output_capacity_{};
    size_t output_size_{};
    cjr::Summary summary_{};
    CassetteMode mode_{CassetteMode::Empty};
    CassetteState state_{CassetteState::Ejected};
    CassetteError error_{CassetteError::None};
    uint32_t error_detail_{};
    bool remote_{};
    bool read_started_{};
    uint32_t cycle_remainder_{};
    uint64_t sample_position_{};
    uint64_t total_samples_{};
    Phase phase_{Phase::Done};
    uint32_t phase_sample_{};
    size_t block_offset_{};
    size_t block_length_{};
    size_t block_byte_{};
    uint8_t frame_bit_{};
    uint8_t bit_sample_{};
    uint8_t block_samples_per_bit_{8U};
    uint8_t data_samples_per_bit_{8U};
    int8_t sign_{1};

    void set_error(CassetteError error, uint32_t detail = 0U) noexcept;
    [[nodiscard]] bool calculate_total_samples() noexcept;
    void reset_generator() noexcept;
    void start_block() noexcept;
    [[nodiscard]] uint8_t current_frame_bit() const noexcept;
    [[nodiscard]] bool current_level() const noexcept;
    void advance_sample() noexcept;
    [[nodiscard]] CassetteError decode_recording() noexcept;
};

const char* cassette_error_message(CassetteError error) noexcept;

}  // namespace jr200
