// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 jr200-web contributors
#include "jr200/system.hpp"

#include <stdint.h>

namespace {

jr200::JR200Machine machine;
jr200::PcmFrame last_pcm{};
jr200::M6800Trace last_system_trace{};
alignas(16) uint8_t rom_buffer[16384]{};
alignas(16) uint8_t font_buffer[jr200::Mn1544::kFontSize]{};
alignas(16) uint8_t tape_input_buffer[jr200::cjr::kMaxInput]{};
alignas(16) uint8_t tape_capture_buffer[jr200::cjr::kMaxInput]{};
alignas(16) uint8_t tape_output_buffer[jr200::cjr::kMaxInput]{};
alignas(16) int16_t pcm_output_buffer[jr200::PcmQueue::kCapacity]{};
bool assets_loaded{};

void configure_tape_storage()
{
    machine.cassette().configure_recording_storage(
        tape_capture_buffer,
        sizeof(tape_capture_buffer),
        tape_output_buffer,
        sizeof(tape_output_buffer));
}

bool reset_loaded_machine()
{
    if (!assets_loaded) {
        return false;
    }
    machine.initialize_memory();
    machine.reset_peripherals();
    if (!machine.load_rom(rom_buffer, sizeof(rom_buffer)) ||
        !machine.load_font(font_buffer, sizeof(font_buffer))) {
        assets_loaded = false;
        return false;
    }
    last_pcm = {};
    last_system_trace = machine.reset_cpu();
    return true;
}

}  // namespace

extern "C" {

uint32_t jr200_system_api_version()
{
    return 9U;
}

uint32_t jr200_system_configure_memory(
    uint32_t ram_expansion_1,
    uint32_t ram_expansion_2,
    uint32_t ram_init_pattern)
{
    if (ram_expansion_1 > 1U || ram_expansion_2 > 1U ||
        ram_init_pattern > 1U) {
        return 0U;
    }
    return machine.set_memory_config({
        ram_expansion_1 != 0U,
        ram_expansion_2 != 0U,
        static_cast<uint8_t>(ram_init_pattern),
    }) ? 1U : 0U;
}

uint32_t jr200_system_memory_config(uint32_t field)
{
    const jr200::MemoryConfig config = machine.memory_config();
    switch (field) {
    case 0U: return config.ram_expansion_1 ? 1U : 0U;
    case 1U: return config.ram_expansion_2 ? 1U : 0U;
    case 2U: return config.ram_init_pattern;
    default: return 0U;
    }
}

void jr200_system_clear()
{
    machine.initialize_memory();
    machine.reset_peripherals();
    machine.cassette().eject();
    configure_tape_storage();
    machine.debugger().clear_all();
    last_pcm = {};
    last_system_trace = {};
    assets_loaded = false;
    for (size_t i = 0U; i < sizeof(rom_buffer); ++i) {
        rom_buffer[i] = 0U;
    }
    for (size_t i = 0U; i < sizeof(font_buffer); ++i) {
        font_buffer[i] = 0U;
    }
    for (size_t i = 0U; i < sizeof(tape_input_buffer); ++i) {
        tape_input_buffer[i] = 0U;
        tape_capture_buffer[i] = 0U;
        tape_output_buffer[i] = 0U;
    }
    for (size_t i = 0U; i < jr200::PcmQueue::kCapacity; ++i) {
        pcm_output_buffer[i] = 0;
    }
}

uint8_t* jr200_system_rom_ptr()
{
    return rom_buffer;
}

uint32_t jr200_system_rom_capacity()
{
    return static_cast<uint32_t>(sizeof(rom_buffer));
}

uint8_t* jr200_system_font_ptr()
{
    return font_buffer;
}

uint32_t jr200_system_font_capacity()
{
    return static_cast<uint32_t>(sizeof(font_buffer));
}

uint32_t jr200_system_boot(uint32_t rom_size, uint32_t font_size)
{
    assets_loaded = rom_size == sizeof(rom_buffer) &&
        font_size == sizeof(font_buffer);
    return reset_loaded_machine() ? 1U : 0U;
}

uint32_t jr200_system_reset()
{
    return reset_loaded_machine() ? 1U : 0U;
}

uint32_t jr200_system_run(uint32_t cycle_budget)
{
    return machine.run_cycles(cycle_budget);
}

void jr200_system_pulse_nmi()
{
    machine.pulse_nmi();
}

uint32_t jr200_system_cpu_reset()
{
    last_system_trace = machine.reset_cpu();
    return last_system_trace.total_cycles;
}

uint32_t jr200_system_cpu_step()
{
    last_system_trace = machine.step();
    return last_system_trace.total_cycles;
}

uint32_t jr200_system_cpu_register(uint32_t field)
{
    const jr200::M6800Registers registers = machine.cpu().registers();
    switch (field) {
    case 0U: return registers.pc;
    case 1U: return registers.sp;
    case 2U: return registers.x;
    case 3U: return registers.a;
    case 4U: return registers.b;
    case 5U: return registers.cc;
    case 6U: return machine.cpu().waiting() ? 1U : 0U;
    default: return 0U;
    }
}

uint32_t jr200_system_cpu_trace_field(uint32_t field)
{
    switch (field) {
    case 0U: return static_cast<uint32_t>(last_system_trace.event);
    case 1U: return last_system_trace.opcode;
    case 2U: return last_system_trace.base_cycles;
    case 3U: return last_system_trace.wait_cycles;
    case 4U: return last_system_trace.total_cycles;
    case 5U: return last_system_trace.before.pc;
    case 6U: return last_system_trace.after.pc;
    default: return 0U;
    }
}

void jr200_system_debug_set_history(uint32_t enabled)
{
    machine.debugger().set_history_enabled(enabled != 0U);
}

void jr200_system_debug_clear_history()
{
    machine.debugger().clear_history();
}

uint32_t jr200_system_debug_add_breakpoint(uint32_t address)
{
    return address <= 0xffffU && machine.debugger().add_breakpoint(
        static_cast<uint16_t>(address)) ? 1U : 0U;
}

uint32_t jr200_system_debug_remove_breakpoint(uint32_t address)
{
    return address <= 0xffffU && machine.debugger().remove_breakpoint(
        static_cast<uint16_t>(address)) ? 1U : 0U;
}

void jr200_system_debug_clear_breakpoints()
{
    machine.debugger().clear_breakpoints();
}

uint32_t jr200_system_debug_breakpoint(uint32_t index)
{
    return index < machine.debugger().breakpoint_count()
        ? machine.debugger().breakpoint_at(index)
        : 0U;
}

uint32_t jr200_system_debug_add_watchpoint(
    uint32_t address,
    uint32_t flags)
{
    return address <= 0xffffU && flags <= 0xffU &&
        machine.debugger().add_watchpoint(
            static_cast<uint16_t>(address),
            static_cast<uint8_t>(flags)) ? 1U : 0U;
}

uint32_t jr200_system_debug_remove_watchpoint(uint32_t address)
{
    return address <= 0xffffU && machine.debugger().remove_watchpoint(
        static_cast<uint16_t>(address)) ? 1U : 0U;
}

void jr200_system_debug_clear_watchpoints()
{
    machine.debugger().clear_watchpoints();
}

uint32_t jr200_system_debug_watchpoint_field(
    uint32_t index,
    uint32_t field)
{
    if (index >= machine.debugger().watchpoint_count()) {
        return 0U;
    }
    const jr200::DebugWatchpoint watchpoint =
        machine.debugger().watchpoint_at(index);
    switch (field) {
    case 0U: return watchpoint.address;
    case 1U: return watchpoint.flags;
    default: return 0U;
    }
}

void jr200_system_debug_resume()
{
    machine.debugger().resume();
}

uint32_t jr200_system_debug_step()
{
    last_system_trace = machine.debug_step();
    return last_system_trace.total_cycles;
}

uint32_t jr200_system_debug_field(uint32_t field)
{
    const jr200::MachineDebugger& debugger = machine.debugger();
    const jr200::DebugStop stop = debugger.stop();
    switch (field) {
    case 0U: return debugger.history_enabled() ? 1U : 0U;
    case 1U: return static_cast<uint32_t>(stop.reason);
    case 2U: return stop.address;
    case 3U: return stop.value;
    case 4U: return static_cast<uint32_t>(stop.access);
    case 5U: return static_cast<uint32_t>(stop.operation);
    case 6U: return static_cast<uint32_t>(stop.cycle);
    case 7U: return static_cast<uint32_t>(stop.cycle >> 32U);
    case 8U: return static_cast<uint32_t>(debugger.breakpoint_count());
    case 9U: return static_cast<uint32_t>(debugger.watchpoint_count());
    case 10U: return static_cast<uint32_t>(debugger.instructions().size());
    case 11U: return static_cast<uint32_t>(debugger.instructions().dropped());
    case 12U:
        return static_cast<uint32_t>(debugger.instructions().dropped() >> 32U);
    case 13U: return static_cast<uint32_t>(debugger.memory_accesses().size());
    case 14U: return static_cast<uint32_t>(debugger.memory_accesses().dropped());
    case 15U:
        return static_cast<uint32_t>(debugger.memory_accesses().dropped() >> 32U);
    case 16U:
        return static_cast<uint32_t>(jr200::DebugInstructionBuffer::kCapacity);
    case 17U:
        return static_cast<uint32_t>(jr200::DebugMemoryBuffer::kCapacity);
    default: return 0U;
    }
}

uint32_t jr200_system_debug_instruction_field(
    uint32_t index,
    uint32_t field)
{
    const jr200::DebugInstructionBuffer& history =
        machine.debugger().instructions();
    if (index >= history.size()) {
        return 0U;
    }
    const jr200::DebugInstructionEntry entry = history.at(index);
    switch (field) {
    case 0U: return static_cast<uint32_t>(entry.sequence);
    case 1U: return static_cast<uint32_t>(entry.sequence >> 32U);
    case 2U: return static_cast<uint32_t>(entry.cycle);
    case 3U: return static_cast<uint32_t>(entry.cycle >> 32U);
    case 4U: return static_cast<uint32_t>(entry.trace.event);
    case 5U: return entry.trace.opcode;
    case 6U: return entry.trace.base_cycles;
    case 7U: return entry.trace.wait_cycles;
    case 8U: return entry.trace.total_cycles;
    case 9U: return entry.trace.before.pc;
    case 10U: return entry.trace.after.pc;
    case 11U: return entry.trace.before.sp;
    case 12U: return entry.trace.after.sp;
    case 13U: return entry.trace.before.x;
    case 14U: return entry.trace.after.x;
    case 15U: return entry.trace.before.a;
    case 16U: return entry.trace.after.a;
    case 17U: return entry.trace.before.b;
    case 18U: return entry.trace.after.b;
    case 19U: return entry.trace.before.cc;
    case 20U: return entry.trace.after.cc;
    default: return 0U;
    }
}

uint32_t jr200_system_debug_access_field(
    uint32_t index,
    uint32_t field)
{
    const jr200::DebugMemoryBuffer& accesses =
        machine.debugger().memory_accesses();
    if (index >= accesses.size()) {
        return 0U;
    }
    const jr200::DebugMemoryEntry entry = accesses.at(index);
    switch (field) {
    case 0U: return static_cast<uint32_t>(entry.sequence);
    case 1U: return static_cast<uint32_t>(entry.sequence >> 32U);
    case 2U: return static_cast<uint32_t>(entry.cycle);
    case 3U: return static_cast<uint32_t>(entry.cycle >> 32U);
    case 4U: return entry.address;
    case 5U: return entry.value;
    case 6U: return static_cast<uint32_t>(entry.access);
    case 7U: return static_cast<uint32_t>(entry.operation);
    default: return 0U;
    }
}

uint32_t jr200_system_read(uint32_t address)
{
    return address <= 0xffffU
        ? machine.read_byte(static_cast<uint16_t>(address))
        : 0U;
}

uint32_t jr200_system_peek(uint32_t address)
{
    return address <= 0xffffU
        ? machine.peek_byte(static_cast<uint16_t>(address))
        : 0U;
}

uint32_t jr200_system_glyph_ready(uint32_t bank)
{
    if (bank > static_cast<uint32_t>(jr200::GlyphBank::UserDefined)) {
        return 0U;
    }
    return machine.glyph_ready(static_cast<jr200::GlyphBank>(bank)) ? 1U : 0U;
}

uint32_t jr200_system_glyph_row(
    uint32_t bank,
    uint32_t code,
    uint32_t row)
{
    if (bank > static_cast<uint32_t>(jr200::GlyphBank::UserDefined) ||
        code > 0xffU || row >= 8U) {
        return 0U;
    }
    return machine.glyph_row(
        static_cast<jr200::GlyphBank>(bank),
        static_cast<uint8_t>(code),
        static_cast<uint8_t>(row));
}

uint32_t jr200_system_glyph_generation(uint32_t bank)
{
    if (bank > static_cast<uint32_t>(jr200::GlyphBank::UserDefined)) {
        return 0U;
    }
    return machine.glyph_generation(static_cast<jr200::GlyphBank>(bank));
}

void jr200_system_write(uint32_t address, uint32_t value)
{
    if (address <= 0xffffU && value <= 0xffU) {
        machine.write_byte(
            static_cast<uint16_t>(address),
            static_cast<uint8_t>(value));
    }
}

void jr200_system_poke(uint32_t address, uint32_t value)
{
    if (address <= 0xffffU && value <= 0xffU) {
        machine.poke(
            static_cast<uint16_t>(address),
            static_cast<uint8_t>(value));
    }
}

void jr200_system_tick(uint32_t cycles)
{
    machine.advance_cycles(cycles);
}

void jr200_system_set_key(uint32_t code, uint32_t pressed)
{
    if (code <= 0xffU) {
        machine.set_key_state(
            static_cast<uint8_t>(code),
            pressed != 0U);
    }
}

uint32_t jr200_system_set_joystick(uint32_t player, uint32_t active_low_state)
{
    if (player >= 2U || active_low_state > 0xffU) {
        return 0U;
    }
    machine.set_joystick(
        static_cast<uint8_t>(player),
        static_cast<uint8_t>(active_low_state));
    return 1U;
}

void jr200_system_set_cassette_input(uint32_t high)
{
    machine.set_cassette_input(high != 0U);
}

uint32_t jr200_system_field(uint32_t field)
{
    switch (field) {
    case 0U: return machine.mn1271().irq_asserted() ? 1U : 0U;
    case 1U: return machine.mn1271().cassette_remote() ? 1U : 0U;
    case 2U: return static_cast<uint32_t>(machine.cycle_count());
    case 3U: return static_cast<uint32_t>(machine.io_trace().size());
    case 4U: return static_cast<uint32_t>(machine.pcm().size());
    case 5U: return machine.mn1544().initialized() ? 1U : 0U;
    case 6U: return machine.crtc().border_color();
    case 7U: return static_cast<uint32_t>(machine.crtc().frame_generation());
    default: return 0U;
    }
}

uint32_t jr200_system_trace_field(uint32_t index, uint32_t field)
{
    if (index >= machine.io_trace().size()) {
        return 0U;
    }
    const jr200::IoTraceEntry entry = machine.io_trace().at(index);
    switch (field) {
    case 0U: return static_cast<uint32_t>(entry.cycle);
    case 1U: return entry.address;
    case 2U: return entry.register_index;
    case 3U: return entry.value;
    case 4U: return static_cast<uint32_t>(entry.device);
    case 5U: return static_cast<uint32_t>(entry.operation);
    default: return 0U;
    }
}

void jr200_system_render()
{
    machine.render_frame();
}

uint32_t* jr200_system_framebuffer_ptr()
{
    return machine.crtc().framebuffer();
}

uint32_t jr200_system_pcm_pop()
{
    return machine.pcm().pop(last_pcm) ? 1U : 0U;
}

int32_t jr200_system_pcm_sample(uint32_t channel)
{
    return channel < 3U ? last_pcm.channel[channel] : 0;
}

uint32_t jr200_system_pcm_sample_rate()
{
    return jr200::kPcmSampleRate;
}

uint32_t jr200_system_pcm_capacity()
{
    return static_cast<uint32_t>(jr200::PcmQueue::kCapacity);
}

const int16_t* jr200_system_pcm_buffer_ptr()
{
    return pcm_output_buffer;
}

uint32_t jr200_system_pcm_drain(uint32_t maximum_frames)
{
    size_t limit = maximum_frames;
    if (limit > jr200::PcmQueue::kCapacity) {
        limit = jr200::PcmQueue::kCapacity;
    }
    size_t count = 0U;
    jr200::PcmFrame frame{};
    while (count < limit && machine.pcm().pop(frame)) {
        pcm_output_buffer[count] = jr200::mix_pcm_mono(frame);
        ++count;
    }
    return static_cast<uint32_t>(count);
}

uint32_t jr200_system_pcm_discard()
{
    return static_cast<uint32_t>(machine.pcm().discard_pending());
}

uint32_t jr200_system_pcm_dropped(uint32_t high)
{
    const uint64_t dropped = machine.pcm().dropped();
    return high == 0U
        ? static_cast<uint32_t>(dropped)
        : static_cast<uint32_t>(dropped >> 32U);
}

uint32_t jr200_system_cassette_pop()
{
    uint8_t value = 0U;
    return machine.mn1271().take_cassette_output(value)
        ? static_cast<uint32_t>(value) | 0x100U
        : 0U;
}

uint8_t* jr200_system_tape_input_ptr()
{
    return tape_input_buffer;
}

uint32_t jr200_system_tape_capacity()
{
    return static_cast<uint32_t>(sizeof(tape_input_buffer));
}

uint32_t jr200_system_tape_mount(uint32_t size)
{
    configure_tape_storage();
    const jr200::CassetteError result = machine.cassette().mount(
        tape_input_buffer,
        size);
    if (result == jr200::CassetteError::None) {
        machine.cassette().set_remote(machine.mn1271().cassette_remote());
    }
    return static_cast<uint32_t>(result);
}

void jr200_system_tape_eject()
{
    machine.cassette().eject();
    configure_tape_storage();
}

uint32_t jr200_system_tape_rewind()
{
    return machine.cassette().rewind() ? 1U : 0U;
}

uint32_t jr200_system_tape_arm_record()
{
    configure_tape_storage();
    const jr200::CassetteError result = machine.cassette().arm_record();
    if (result == jr200::CassetteError::None) {
        machine.cassette().set_remote(machine.mn1271().cassette_remote());
    }
    return static_cast<uint32_t>(result);
}

uint32_t jr200_system_tape_set_monitor(
    uint32_t enabled,
    uint32_t volume_percent)
{
    if (enabled > 1U || volume_percent > 100U) {
        return 0U;
    }
    machine.cassette().set_monitor(
        enabled != 0U,
        static_cast<uint8_t>(volume_percent));
    return 1U;
}

const uint8_t* jr200_system_tape_output_ptr()
{
    return tape_output_buffer;
}

uint32_t jr200_system_tape_output_size()
{
    return static_cast<uint32_t>(machine.cassette().output_size());
}

const char* jr200_system_tape_error_message()
{
    return jr200::cassette_error_message(machine.cassette().error());
}

uint32_t jr200_system_tape_field(uint32_t field)
{
    const jr200::CassetteDeck& tape = machine.cassette();
    switch (field) {
    case 0U: return static_cast<uint32_t>(tape.state());
    case 1U: return static_cast<uint32_t>(tape.mode());
    case 2U: return tape.remote() ? 1U : 0U;
    case 3U: return static_cast<uint32_t>(tape.sample_position());
    case 4U: return static_cast<uint32_t>(tape.sample_position() >> 32U);
    case 5U: return static_cast<uint32_t>(tape.total_samples());
    case 6U: return static_cast<uint32_t>(tape.total_samples() >> 32U);
    case 7U: return static_cast<uint32_t>(tape.capture_size());
    case 8U: return static_cast<uint32_t>(tape.output_size());
    case 9U: return static_cast<uint32_t>(tape.error());
    case 10U: return tape.summary().file_type;
    case 11U: return tape.summary().baud_flag;
    case 12U: return tape.read_started() ? 1U : 0U;
    case 13U: return tape.error_detail();
    case 14U: return tape.summary().payload_bytes;
    case 15U: return tape.summary().first_address;
    case 16U: return tape.summary().footer_address;
    case 17U: return tape.monitor_enabled() ? 1U : 0U;
    case 18U: return tape.monitor_volume();
    case 19U: return tape.monitor_active() ? 1U : 0U;
    default: return 0U;
    }
}

}  // extern "C"
