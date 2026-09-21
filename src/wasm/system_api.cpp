// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 jr200-web contributors
#include "jr200/system.hpp"

#include <stdint.h>

namespace {

jr200::JR200Machine machine;
jr200::PcmFrame last_pcm{};
jr200::M6800Trace last_system_trace{};

}  // namespace

extern "C" {

uint32_t jr200_system_api_version()
{
    return 1U;
}

void jr200_system_clear()
{
    machine.initialize_memory();
    machine.reset_peripherals();
    last_pcm = {};
    last_system_trace = {};
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

uint32_t jr200_system_cassette_pop()
{
    uint8_t value = 0U;
    return machine.mn1271().take_cassette_output(value)
        ? static_cast<uint32_t>(value) | 0x100U
        : 0U;
}

}  // extern "C"
