// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2017,2020 FIND
// Copyright (c) 2026 jr200-web contributors
// Address-map behavior is adapted from VJR-200; see THIRD_PARTY_NOTICES.md.
#include "jr200/system.hpp"

namespace jr200 {

void IoTraceBuffer::clear() noexcept
{
    head_ = 0U;
    size_ = 0U;
    dropped_ = 0U;
}

void IoTraceBuffer::push(const IoTraceEntry& entry) noexcept
{
    if (size_ == kCapacity) {
        head_ = (head_ + 1U) % kCapacity;
        --size_;
        ++dropped_;
    }
    const size_t tail = (head_ + size_) % kCapacity;
    entries_[tail] = entry;
    ++size_;
}

size_t IoTraceBuffer::size() const noexcept
{
    return size_;
}

uint64_t IoTraceBuffer::dropped() const noexcept
{
    return dropped_;
}

IoTraceEntry IoTraceBuffer::at(size_t index) const noexcept
{
    if (index >= size_) {
        return {};
    }
    return entries_[(head_ + index) % kCapacity];
}

JR200Machine::JR200Machine(MemoryConfig config) noexcept
    : config_(config), cpu_(*this)
{
    initialize_memory();
    reset_peripherals();
}

bool JR200Machine::set_memory_config(MemoryConfig config) noexcept
{
    if (config.ram_init_pattern > 1U) {
        return false;
    }
    config_ = config;
    return true;
}

MemoryConfig JR200Machine::memory_config() const noexcept
{
    return config_;
}

void JR200Machine::initialize_memory() noexcept
{
    for (uint32_t i = 0U; i < 65536U; ++i) {
        memory_[i] = 0U;
    }
    if (config_.ram_init_pattern == 0U) {
        for (uint32_t i = 0U; i < 0x8000U; i += 4U) {
            if ((i & 0x100U) == 0U) {
                memory_[i] = 0xffU;
                memory_[i + 1U] = 0xffU;
            } else {
                memory_[i + 2U] = 0xffU;
                memory_[i + 3U] = 0xffU;
            }
        }
    } else {
        for (uint32_t i = 0U; i < 0x8000U; i += 2U) {
            if ((i & 0x80U) == 0U) {
                memory_[i + 1U] = 0xffU;
            } else {
                memory_[i] = 0xffU;
            }
        }
    }
    for (uint32_t i = 0xc001U; i < 0xc100U; i += 2U) {
        memory_[i] = 0xffU;
    }
    for (uint32_t i = 0xc401U; i < 0xc500U; i += 2U) {
        memory_[i] = 0xffU;
    }
    ++standard_glyph_generation_;
    ++user_glyph_generation_;
}

void JR200Machine::reset_peripherals() noexcept
{
    mn1271_.reset();
    cassette_.reset_remote();
    mn1544_.reset();
    crtc_.reset();
    pcm_.clear();
    io_trace_.clear();
    debugger_.reset_runtime();
    cycle_count_ = 0U;
    sync_irq();
}

bool JR200Machine::load_rom(const uint8_t* data, size_t size) noexcept
{
    if (data == nullptr || size != 16384U) {
        return false;
    }
    if (!config_.ram_expansion_2) {
        for (size_t i = 0U; i < 8192U; ++i) {
            memory_[0xa000U + i] = data[i];
        }
    }
    for (size_t i = 0U; i < 8192U; ++i) {
        memory_[0xe000U + i] = data[8192U + i];
    }
    return true;
}

bool JR200Machine::load_font(const uint8_t* data, size_t size) noexcept
{
    return mn1544_.load_font(data, size);
}

M6800Trace JR200Machine::reset_cpu()
{
    debugger_.reset_runtime();
    sync_irq();
    return cpu_.reset();
}

M6800Trace JR200Machine::step()
{
    sync_irq();
    const uint64_t start_cycle = cycle_count_;
    cpu_access_active_ = true;
    const M6800Trace trace = cpu_.step();
    cpu_access_active_ = false;
    if (trace.total_cycles != 0U) {
        advance_cycles(trace.total_cycles);
    }
    debugger_.record_instruction(start_cycle, trace);
    return trace;
}

M6800Trace JR200Machine::debug_step()
{
    debugger_.prepare_step();
    const M6800Trace trace = step();
    debugger_.stop_after_step(cpu_.registers().pc, cycle_count_);
    return trace;
}

uint32_t JR200Machine::run_cycles(uint32_t cycle_budget)
{
    uint32_t elapsed = 0U;
    if (debugger_.stopped()) {
        return elapsed;
    }
    while (elapsed < cycle_budget) {
        if (debugger_.check_breakpoint(
                cpu_.registers().pc,
                cycle_count_)) {
            break;
        }
        const M6800Trace trace = step();
        if (trace.total_cycles != 0U) {
            elapsed += trace.total_cycles;
            if (debugger_.stopped()) {
                break;
            }
            continue;
        }
        if (!cpu_.waiting()) {
            break;
        }

        const uint32_t remaining = cycle_budget - elapsed;
        const uint32_t idle_cycles = remaining < 10U ? remaining : 10U;
        advance_cycles(idle_cycles);
        elapsed += idle_cycles;
    }
    return elapsed;
}

void JR200Machine::advance_cycles(uint32_t cycles) noexcept
{
    if (cycles == 0U) {
        return;
    }
    mn1271_.tick(cycles, pcm_, cassette_.monitor_sample());
    cassette_.tick(cycles);
    crtc_.tick(cycles, memory_);
    mn1544_.tick(cycles, mn1271_);
    cycle_count_ += cycles;
    sync_irq();
}

void JR200Machine::pulse_nmi() noexcept
{
    cpu_.pulse_nmi();
}

M6800Read JR200Machine::read(
    uint16_t address,
    M6800BusAccess access)
{
    const uint8_t value = read_mapped(address);
    if (cpu_access_active_) {
        debugger_.observe_memory(
            cycle_count_,
            address,
            value,
            access,
            DebugMemoryOperation::Read);
    }
    const uint8_t wait = is_ram(address) && address <= 0xbfffU ? 1U : 0U;
    return {value, wait};
}

uint8_t JR200Machine::write(
    uint16_t address,
    uint8_t value,
    M6800BusAccess access)
{
    write_mapped(address, value);
    if (cpu_access_active_) {
        debugger_.observe_memory(
            cycle_count_,
            address,
            value,
            access,
            DebugMemoryOperation::Write);
    }
    return is_ram(address) && address <= 0xbfffU ? 1U : 0U;
}

uint8_t JR200Machine::read_byte(uint16_t address) noexcept
{
    return read_mapped(address);
}

uint8_t JR200Machine::peek_byte(uint16_t address) const noexcept
{
    if (is_ram(address) || is_rom(address)) {
        return memory_[address];
    }
    if (address >= 0xc800U && address < 0xca00U) {
        const uint8_t reg = static_cast<uint8_t>((address - 0xc800U) & 0x1fU);
        return mn1271_.peek(reg);
    }
    if (address >= 0xca00U && address < 0xcc00U) {
        return crtc_.peek(static_cast<uint16_t>(address - 0xca00U));
    }
    return 0U;
}

bool JR200Machine::glyph_ready(GlyphBank bank) const noexcept
{
    switch (bank) {
    case GlyphBank::FontAsset: return mn1544_.font_loaded();
    case GlyphBank::Standard: return mn1544_.initialized();
    case GlyphBank::UserDefined: return true;
    }
    return false;
}

uint8_t JR200Machine::glyph_row(
    GlyphBank bank,
    uint8_t code,
    uint8_t row) const noexcept
{
    if (row >= 8U) {
        return 0U;
    }
    if (bank == GlyphBank::FontAsset) {
        return mn1544_.font_row(code, row);
    }
    if (bank != GlyphBank::Standard && bank != GlyphBank::UserDefined) {
        return 0U;
    }
    const uint16_t base = bank == GlyphBank::Standard ? 0xd000U : 0xc000U;
    return memory_[base + static_cast<uint16_t>(code) * 8U + row];
}

uint32_t JR200Machine::glyph_generation(GlyphBank bank) const noexcept
{
    switch (bank) {
    case GlyphBank::FontAsset: return mn1544_.font_generation();
    case GlyphBank::Standard: return standard_glyph_generation_;
    case GlyphBank::UserDefined: return user_glyph_generation_;
    }
    return 0U;
}

void JR200Machine::write_byte(uint16_t address, uint8_t value) noexcept
{
    write_mapped(address, value);
    sync_irq();
}

void JR200Machine::poke(uint16_t address, uint8_t value) noexcept
{
    note_glyph_write(address, value);
    memory_[address] = value;
}

void JR200Machine::set_key_state(uint8_t code, bool pressed) noexcept
{
    mn1544_.set_key_state(code, pressed);
    mn1271_.set_key_detection(mn1544_.current_key());
}

void JR200Machine::set_joystick(
    uint8_t player,
    uint8_t active_low_state) noexcept
{
    mn1544_.set_joystick(player, active_low_state);
}

void JR200Machine::set_cassette_input(bool high) noexcept
{
    mn1271_.set_cassette_input(high);
}

void JR200Machine::render_frame() noexcept
{
    crtc_.render(memory_);
}

uint64_t JR200Machine::cycle_count() const noexcept
{
    return cycle_count_;
}

const uint8_t* JR200Machine::memory() const noexcept
{
    return memory_;
}

uint8_t* JR200Machine::memory() noexcept
{
    return memory_;
}

M6800& JR200Machine::cpu() noexcept
{
    return cpu_;
}

const M6800& JR200Machine::cpu() const noexcept
{
    return cpu_;
}

Mn1271& JR200Machine::mn1271() noexcept
{
    return mn1271_;
}

const Mn1271& JR200Machine::mn1271() const noexcept
{
    return mn1271_;
}

Mn1544& JR200Machine::mn1544() noexcept
{
    return mn1544_;
}

const Mn1544& JR200Machine::mn1544() const noexcept
{
    return mn1544_;
}

Crtc& JR200Machine::crtc() noexcept
{
    return crtc_;
}

const Crtc& JR200Machine::crtc() const noexcept
{
    return crtc_;
}

PcmQueue& JR200Machine::pcm() noexcept
{
    return pcm_;
}

const PcmQueue& JR200Machine::pcm() const noexcept
{
    return pcm_;
}

IoTraceBuffer& JR200Machine::io_trace() noexcept
{
    return io_trace_;
}

const IoTraceBuffer& JR200Machine::io_trace() const noexcept
{
    return io_trace_;
}

MachineDebugger& JR200Machine::debugger() noexcept
{
    return debugger_;
}

const MachineDebugger& JR200Machine::debugger() const noexcept
{
    return debugger_;
}

CassetteDeck& JR200Machine::cassette() noexcept
{
    return cassette_;
}

const CassetteDeck& JR200Machine::cassette() const noexcept
{
    return cassette_;
}

bool JR200Machine::is_ram(uint16_t address) const noexcept
{
    if (address < 0x8000U) {
        return true;
    }
    if (address < 0xa000U) {
        return config_.ram_expansion_1;
    }
    if (address < 0xc000U) {
        return config_.ram_expansion_2;
    }
    return (address >= 0xc000U && address < 0xc800U) ||
           (address >= 0xd000U && address < 0xd800U);
}

bool JR200Machine::is_rom(uint16_t address) const noexcept
{
    return (address >= 0xa000U && address < 0xc000U &&
            !config_.ram_expansion_2) ||
           address >= 0xe000U;
}

uint8_t JR200Machine::read_mapped(uint16_t address) noexcept
{
    if (is_ram(address) || is_rom(address)) {
        return memory_[address];
    }
    if (address >= 0xc800U && address < 0xca00U) {
        const uint8_t reg = static_cast<uint8_t>((address - 0xc800U) & 0x1fU);
        if (reg == 0x07U && cassette_.mode() == CassetteMode::Playback) {
            mn1271_.set_cassette_input(cassette_.read_level());
        }
        const uint8_t value = mn1271_.read(reg);
        trace_io(address, reg, value, IoDevice::Mn1271, IoOperation::Read);
        sync_irq();
        return value;
    }
    if (address >= 0xca00U && address < 0xcc00U) {
        const uint16_t reg = static_cast<uint16_t>(address - 0xca00U);
        const uint8_t value = crtc_.read(reg);
        trace_io(address, reg, value, IoDevice::Crtc, IoOperation::Read);
        return value;
    }
    return 0U;
}

void JR200Machine::write_mapped(uint16_t address, uint8_t value) noexcept
{
    if (is_ram(address)) {
        note_glyph_write(address, value);
        memory_[address] = value;
        return;
    }
    if (is_rom(address)) {
        return;
    }
    if (address >= 0xc800U && address < 0xca00U) {
        const uint8_t reg = static_cast<uint8_t>((address - 0xc800U) & 0x1fU);
        mn1271_.write(reg, value);
        if (reg == 0x07U) {
            cassette_.set_remote(mn1271_.cassette_remote());
        } else if (reg == 0x0dU) {
            cassette_.write_signal_byte(value);
        }
        if (reg == 0x03U) {
            mn1544_.on_control_write(value);
        }
        trace_io(address, reg, value, IoDevice::Mn1271, IoOperation::Write);
        return;
    }
    if (address >= 0xca00U && address < 0xcc00U) {
        const uint16_t reg = static_cast<uint16_t>(address - 0xca00U);
        crtc_.write(reg, value);
        trace_io(address, reg, value, IoDevice::Crtc, IoOperation::Write);
    }
}

void JR200Machine::note_glyph_write(uint16_t address, uint8_t value) noexcept
{
    if (memory_[address] == value) {
        return;
    }
    if (address >= 0xd000U && address < 0xd800U) {
        ++standard_glyph_generation_;
    } else if (address >= 0xc000U && address < 0xc800U) {
        ++user_glyph_generation_;
    }
}

void JR200Machine::trace_io(
    uint16_t address,
    uint16_t register_index,
    uint8_t value,
    IoDevice device,
    IoOperation operation) noexcept
{
    io_trace_.push({
        cycle_count_,
        address,
        register_index,
        value,
        device,
        operation,
    });
}

void JR200Machine::sync_irq() noexcept
{
    cpu_.set_irq_line(mn1271_.irq_asserted());
}

}  // namespace jr200
