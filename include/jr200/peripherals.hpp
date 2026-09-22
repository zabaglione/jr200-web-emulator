// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2017,2020 FIND
// Copyright (c) 2026 jr200-web contributors
// Based on VJR-200 peripheral behavior by FIND.
// See THIRD_PARTY_NOTICES.md and LICENSES/VJR200.txt.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace jr200 {

inline constexpr uint32_t kCpuClockHz = 1339285U;
inline constexpr uint32_t kPcmSampleRate = 44100U;
inline constexpr size_t kFramebufferWidth = 320U;
inline constexpr size_t kFramebufferHeight = 224U;
inline constexpr size_t kFramebufferPixels =
    kFramebufferWidth * kFramebufferHeight;

struct PcmFrame {
    int16_t channel[3]{};
};

[[nodiscard]] int16_t mix_pcm_mono(const PcmFrame& frame) noexcept;

class PcmQueue {
public:
    static constexpr size_t kCapacity = 4096U;

    void clear() noexcept;
    void push(const PcmFrame& frame) noexcept;
    [[nodiscard]] bool pop(PcmFrame& frame) noexcept;
    [[nodiscard]] size_t discard_pending() noexcept;
    [[nodiscard]] size_t size() const noexcept;
    [[nodiscard]] uint64_t dropped() const noexcept;

private:
    PcmFrame frames_[kCapacity]{};
    size_t head_{};
    size_t size_{};
    uint64_t dropped_{};
};

enum class Mn1271Irq : uint8_t {
    KeyOn,
    System,
    User,
    Serial,
    TimerA,
    TimerB,
    TimerC,
    TimerD,
    TimerE,
    TimerF,
};

class Mn1271 {
public:
    void reset() noexcept;

    [[nodiscard]] uint8_t read(uint8_t reg) noexcept;
    [[nodiscard]] uint8_t peek(uint8_t reg) const noexcept;
    void write(uint8_t reg, uint8_t value) noexcept;

    [[nodiscard]] uint8_t io_read(uint8_t reg) const noexcept;
    void io_write(uint8_t reg, uint8_t value) noexcept;
    void assert_irq(Mn1271Irq source) noexcept;
    void tick(uint32_t cycles, PcmQueue& pcm) noexcept;

    void set_cassette_input(bool high) noexcept;
    [[nodiscard]] bool cassette_remote() const noexcept;
    [[nodiscard]] bool take_cassette_output(uint8_t& value) noexcept;
    [[nodiscard]] uint64_t cassette_output_dropped() const noexcept;
    [[nodiscard]] bool take_read_activity() noexcept;
    [[nodiscard]] bool take_write_activity() noexcept;
    [[nodiscard]] bool irq_asserted() const noexcept;

private:
    static constexpr size_t kCassetteQueueCapacity = 256U;

    uint8_t reg_[32]{};
    uint8_t reg17_write_buffer_{};
    uint8_t reg1a_write_buffer_{};
    uint32_t timer_set_[6]{};
    uint64_t timer_cycle_[6]{};
    bool timer_enabled_[6]{};
    bool playing_[3]{};
    uint32_t frequency_[3]{};
    uint32_t phase_[3]{};
    uint64_t audio_numerator_{};
    bool cassette_input_{};
    bool cassette_remote_{};
    bool read_activity_{};
    bool write_activity_{};
    uint8_t cassette_output_[kCassetteQueueCapacity]{};
    size_t cassette_head_{};
    size_t cassette_size_{};
    uint64_t cassette_dropped_{};

    [[nodiscard]] static uint32_t prescale(uint8_t selector) noexcept;
    void refresh_irq_flag() noexcept;
    void set_irq_mask_1(uint8_t bit, bool enabled) noexcept;
    void set_irq_mask_2(uint8_t bit, bool enabled) noexcept;
    void write_irq_mask_1(uint8_t value) noexcept;
    void write_irq_mask_2(uint8_t value) noexcept;
    void update_sound_frequency(uint8_t channel) noexcept;
    void update_sound_control(uint8_t channel) noexcept;
    void tick_timer(
        uint8_t timer,
        uint8_t control_reg,
        uint8_t value_reg,
        uint8_t prescale_mask,
        uint8_t status_mask,
        Mn1271Irq irq,
        uint32_t cycles) noexcept;
    void push_cassette_output(uint8_t value) noexcept;
    [[nodiscard]] PcmFrame next_pcm_frame() noexcept;
};

class Mn1544 {
public:
    static constexpr size_t kFontSize = 2048U;
    static constexpr uint32_t kIrqDelayCycles = 100U;

    void reset() noexcept;
    [[nodiscard]] bool load_font(
        const uint8_t* data,
        size_t size) noexcept;
    void on_control_write(uint8_t value) noexcept;
    void set_key_state(uint8_t code, bool pressed) noexcept;
    void set_joystick(uint8_t player, uint8_t active_low_state) noexcept;
    void tick(uint32_t cycles, Mn1271& io) noexcept;

    [[nodiscard]] bool initialized() const noexcept;
    [[nodiscard]] bool font_loaded() const noexcept;
    [[nodiscard]] uint8_t font_row(uint8_t code, uint8_t row) const noexcept;
    [[nodiscard]] uint32_t font_generation() const noexcept;
    [[nodiscard]] uint16_t bootstrap_pointer() const noexcept;
    [[nodiscard]] uint8_t current_key() const noexcept;

private:
    uint8_t font_[kFontSize + 1U]{};
    uint32_t font_generation_{};
    uint8_t scan_[3]{};
    uint16_t pointer_{};
    bool initialized_{};
    bool font_loaded_{};
    bool scanning_{};
    bool key_tested_{};
    uint8_t previous_key_test_{};
    uint8_t previous_previous_key_test_{};
    uint8_t previous_key_ack_{};
    uint8_t previous_previous_key_ack_{};
    uint8_t current_key_{};
    uint8_t joystick_[2]{0xffU, 0xffU};
    uint32_t irq_countdown_{};
    uint8_t pending_code_{};

    void schedule_keycode(uint8_t code) noexcept;
    void begin_scan() noexcept;
};

class Crtc {
public:
    void reset() noexcept;
    [[nodiscard]] uint8_t read(uint16_t reg) const noexcept;
    [[nodiscard]] uint8_t peek(uint16_t reg) const noexcept;
    void write(uint16_t reg, uint8_t value) noexcept;
    void tick(uint32_t cycles, const uint8_t* memory) noexcept;
    void render(const uint8_t* memory) noexcept;

    [[nodiscard]] const uint32_t* framebuffer() const noexcept;
    [[nodiscard]] uint32_t* framebuffer() noexcept;
    [[nodiscard]] uint64_t frame_generation() const noexcept;
    [[nodiscard]] uint8_t border_color() const noexcept;

private:
    uint8_t border_color_{};
    uint8_t scan_value_{};
    uint16_t scan_cycle_{};
    uint64_t frame_generation_{};
    uint32_t framebuffer_[kFramebufferPixels]{};
};

}  // namespace jr200
