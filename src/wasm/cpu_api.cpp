// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 jr200-web contributors
#include "jr200/m6800.hpp"

#include <stdint.h>

namespace {

class WasmBus final : public jr200::M6800Bus {
public:
    alignas(16) uint8_t memory[65536]{};
    uint8_t waits[5]{};

    jr200::M6800Read read(
        uint16_t address,
        jr200::M6800BusAccess access) override
    {
        return {memory[address], waits[static_cast<uint8_t>(access)]};
    }

    uint8_t write(
        uint16_t address,
        uint8_t value,
        jr200::M6800BusAccess access) override
    {
        memory[address] = value;
        return waits[static_cast<uint8_t>(access)];
    }
};

WasmBus cpu_bus;
jr200::M6800 cpu(cpu_bus);
jr200::M6800Trace last_trace{};

}  // namespace

extern "C" {

uint32_t jr200_cpu_api_version()
{
    return 1U;
}

uint8_t* jr200_cpu_memory_ptr()
{
    return cpu_bus.memory;
}

void jr200_cpu_clear_memory()
{
    for (uint32_t i = 0U; i < 65536U; ++i) {
        cpu_bus.memory[i] = 0U;
    }
    for (uint32_t i = 0U; i < 5U; ++i) {
        cpu_bus.waits[i] = 0U;
    }
    cpu.set_irq_line(false);
    last_trace = {};
}

void jr200_cpu_set_wait(uint32_t access, uint32_t wait_states)
{
    if (access < 5U && wait_states <= 255U) {
        cpu_bus.waits[access] = static_cast<uint8_t>(wait_states);
    }
}

uint32_t jr200_cpu_reset()
{
    last_trace = cpu.reset();
    return last_trace.total_cycles;
}

void jr200_cpu_set_registers(
    uint32_t pc,
    uint32_t sp,
    uint32_t x,
    uint32_t a,
    uint32_t b,
    uint32_t cc)
{
    cpu.set_registers({
        static_cast<uint16_t>(pc),
        static_cast<uint16_t>(sp),
        static_cast<uint16_t>(x),
        static_cast<uint8_t>(a),
        static_cast<uint8_t>(b),
        static_cast<uint8_t>(cc),
    });
}

void jr200_cpu_set_irq(uint32_t asserted)
{
    cpu.set_irq_line(asserted != 0U);
}

void jr200_cpu_pulse_nmi()
{
    cpu.pulse_nmi();
}

uint32_t jr200_cpu_step()
{
    last_trace = cpu.step();
    return last_trace.total_cycles;
}

uint32_t jr200_cpu_register(uint32_t field)
{
    const jr200::M6800Registers registers = cpu.registers();
    switch (field) {
    case 0U: return registers.pc;
    case 1U: return registers.sp;
    case 2U: return registers.x;
    case 3U: return registers.a;
    case 4U: return registers.b;
    case 5U: return registers.cc;
    case 6U: return cpu.waiting() ? 1U : 0U;
    case 7U: return static_cast<uint32_t>(cpu.total_cycles());
    default: return 0U;
    }
}

uint32_t jr200_cpu_trace_field(uint32_t field)
{
    switch (field) {
    case 0U: return static_cast<uint32_t>(last_trace.event);
    case 1U: return last_trace.opcode;
    case 2U: return last_trace.base_cycles;
    case 3U: return last_trace.wait_cycles;
    case 4U: return last_trace.total_cycles;
    case 5U: return last_trace.before.pc;
    case 6U: return last_trace.after.pc;
    case 7U: return last_trace.after.sp;
    case 8U: return last_trace.after.x;
    case 9U: return last_trace.after.a;
    case 10U: return last_trace.after.b;
    case 11U: return last_trace.after.cc;
    case 12U: return last_trace.before.sp;
    default: return 0U;
    }
}

}  // extern "C"
