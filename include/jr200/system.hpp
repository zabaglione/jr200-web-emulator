// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 jr200-web contributors
#pragma once

#include "jr200/m6800.hpp"
#include "jr200/peripherals.hpp"

#include <stddef.h>
#include <stdint.h>

namespace jr200 {

enum class IoDevice : uint8_t {
    Mn1271,
    Crtc,
};

enum class IoOperation : uint8_t {
    Read,
    Write,
};

struct IoTraceEntry {
    uint64_t cycle{};
    uint16_t address{};
    uint16_t register_index{};
    uint8_t value{};
    IoDevice device{IoDevice::Mn1271};
    IoOperation operation{IoOperation::Read};
};

class IoTraceBuffer {
public:
    static constexpr size_t kCapacity = 256U;

    void clear() noexcept;
    void push(const IoTraceEntry& entry) noexcept;
    [[nodiscard]] size_t size() const noexcept;
    [[nodiscard]] uint64_t dropped() const noexcept;
    [[nodiscard]] IoTraceEntry at(size_t index) const noexcept;

private:
    IoTraceEntry entries_[kCapacity]{};
    size_t head_{};
    size_t size_{};
    uint64_t dropped_{};
};

struct MemoryConfig {
    bool ram_expansion_1{};
    bool ram_expansion_2{};
};

class JR200Machine final : public M6800Bus {
public:
    explicit JR200Machine(MemoryConfig config = {}) noexcept;

    void initialize_memory() noexcept;
    void reset_peripherals() noexcept;
    [[nodiscard]] bool load_rom(
        const uint8_t* data,
        size_t size) noexcept;
    [[nodiscard]] bool load_font(
        const uint8_t* data,
        size_t size) noexcept;

    [[nodiscard]] M6800Trace reset_cpu();
    [[nodiscard]] M6800Trace step();
    void advance_cycles(uint32_t cycles) noexcept;
    void pulse_nmi() noexcept;

    [[nodiscard]] M6800Read read(
        uint16_t address,
        M6800BusAccess access) override;
    [[nodiscard]] uint8_t write(
        uint16_t address,
        uint8_t value,
        M6800BusAccess access) override;

    [[nodiscard]] uint8_t read_byte(uint16_t address) noexcept;
    [[nodiscard]] uint8_t peek_byte(uint16_t address) const noexcept;
    void write_byte(uint16_t address, uint8_t value) noexcept;
    void poke(uint16_t address, uint8_t value) noexcept;

    void set_key_state(uint8_t code, bool pressed) noexcept;
    void set_joystick(uint8_t player, uint8_t active_low_state) noexcept;
    void set_cassette_input(bool high) noexcept;
    void render_frame() noexcept;

    [[nodiscard]] uint64_t cycle_count() const noexcept;
    [[nodiscard]] const uint8_t* memory() const noexcept;
    [[nodiscard]] uint8_t* memory() noexcept;
    [[nodiscard]] M6800& cpu() noexcept;
    [[nodiscard]] const M6800& cpu() const noexcept;
    [[nodiscard]] Mn1271& mn1271() noexcept;
    [[nodiscard]] const Mn1271& mn1271() const noexcept;
    [[nodiscard]] Mn1544& mn1544() noexcept;
    [[nodiscard]] const Mn1544& mn1544() const noexcept;
    [[nodiscard]] Crtc& crtc() noexcept;
    [[nodiscard]] const Crtc& crtc() const noexcept;
    [[nodiscard]] PcmQueue& pcm() noexcept;
    [[nodiscard]] const PcmQueue& pcm() const noexcept;
    [[nodiscard]] IoTraceBuffer& io_trace() noexcept;
    [[nodiscard]] const IoTraceBuffer& io_trace() const noexcept;

private:
    MemoryConfig config_{};
    alignas(16) uint8_t memory_[65536]{};
    Mn1271 mn1271_{};
    Mn1544 mn1544_{};
    Crtc crtc_{};
    PcmQueue pcm_{};
    IoTraceBuffer io_trace_{};
    uint64_t cycle_count_{};
    M6800 cpu_;

    [[nodiscard]] bool is_ram(uint16_t address) const noexcept;
    [[nodiscard]] bool is_rom(uint16_t address) const noexcept;
    [[nodiscard]] uint8_t read_mapped(uint16_t address) noexcept;
    void write_mapped(uint16_t address, uint8_t value) noexcept;
    void trace_io(
        uint16_t address,
        uint16_t register_index,
        uint8_t value,
        IoDevice device,
        IoOperation operation) noexcept;
    void sync_irq() noexcept;
};

}  // namespace jr200
