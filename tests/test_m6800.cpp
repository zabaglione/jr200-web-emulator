// SPDX-License-Identifier: BSD-3-Clause
#include "jr200/m6800.hpp"

#include <array>
#include <cstddef>
#include <stdint.h>
#include <iostream>

namespace {

using jr200::M6800;
using jr200::M6800Bus;
using jr200::M6800BusAccess;
using jr200::M6800Event;
using jr200::M6800Read;
using jr200::M6800Registers;
using jr200::M6800Trace;

class TestBus final : public M6800Bus {
public:
    std::array<uint8_t, 65536> memory{};
    std::array<uint8_t, 5> waits{};
    std::array<uint32_t, 5> reads{};
    std::array<uint32_t, 5> writes{};

    M6800Read read(
        uint16_t address,
        M6800BusAccess access) override
    {
        const auto index = static_cast<std::size_t>(access);
        ++reads[index];
        return {memory[address], waits[index]};
    }

    uint8_t write(
        uint16_t address,
        uint8_t value,
        M6800BusAccess access) override
    {
        const auto index = static_cast<std::size_t>(access);
        ++writes[index];
        memory[address] = value;
        return waits[index];
    }

    void vector(uint16_t address, uint16_t target)
    {
        memory[address] = static_cast<uint8_t>(target >> 8U);
        memory[static_cast<uint16_t>(address + 1U)] =
            static_cast<uint8_t>(target & 0xffU);
    }
};

int failures = 0;

void check(bool condition, const char* message)
{
    if (!condition) {
        ++failures;
        std::cerr << "FAIL: " << message << '\n';
    }
}

void check_registers(
    const M6800Registers& actual,
    const M6800Registers& expected,
    const char* message)
{
    check(actual.pc == expected.pc &&
              actual.sp == expected.sp &&
              actual.x == expected.x &&
              actual.a == expected.a &&
              actual.b == expected.b &&
              actual.cc == expected.cc,
          message);
}

void test_reset_and_wait_states()
{
    TestBus bus;
    bus.vector(0xfffeU, 0x2000U);
    bus.waits[static_cast<std::size_t>(M6800BusAccess::Vector)] = 5U;
    M6800 cpu(bus);
    const M6800Trace reset = cpu.reset();
    check(reset.event == M6800Event::Reset, "reset event");
    check(reset.after.pc == 0x2000U, "reset vector is big-endian");
    check(reset.after.cc == 0xd0U, "reset sets I and reserved bits");
    check(reset.wait_cycles == 10U && reset.total_cycles == 10U,
          "reset accounts vector wait states");
    check(bus.reads[static_cast<std::size_t>(M6800BusAccess::Vector)] == 2U,
          "reset uses two vector reads");

    bus.waits = {1U, 2U, 3U, 4U, 5U};
    bus.memory[0x2000U] = 0x96U;
    bus.memory[0x2001U] = 0x10U;
    bus.memory[0x0010U] = 0x80U;
    const M6800Trace lda = cpu.step();
    check(lda.opcode == 0x96U && lda.base_cycles == 3U,
          "direct LDA base cycles");
    check(lda.wait_cycles == 6U && lda.total_cycles == 9U,
          "opcode operand and data waits are separate");
    check(lda.after.a == 0x80U &&
              (lda.after.cc & M6800::kFlagNegative) != 0U,
          "direct LDA value and negative flag");
}

void test_alu_flags_and_branches()
{
    TestBus bus;
    M6800 cpu(bus);
    cpu.set_registers({0x1000U, 0x01ffU, 0U, 0U, 0U, 0xc0U});
    const std::array<uint8_t, 13> program{
        0x86U, 0x7fU,       // LDAA #$7f
        0x8bU, 0x01U,       // ADDA #$01
        0x81U, 0x80U,       // CMPA #$80
        0x27U, 0x02U,       // BEQ +2
        0x86U, 0x00U,       // skipped
        0x80U, 0x81U,       // SUBA #$81
        0x01U,              // NOP
    };
    for (std::size_t i = 0; i < program.size(); ++i) {
        bus.memory[0x1000U + i] = program[i];
    }

    M6800Trace trace = cpu.step();
    check(trace.after.a == 0x7fU && trace.base_cycles == 2U,
          "LDAA immediate");
    trace = cpu.step();
    check(trace.after.a == 0x80U, "ADDA result");
    check((trace.after.cc & (M6800::kFlagHalfCarry |
                             M6800::kFlagNegative |
                             M6800::kFlagOverflow)) ==
              (M6800::kFlagHalfCarry |
               M6800::kFlagNegative |
               M6800::kFlagOverflow),
          "ADDA HNV flags");
    check((trace.after.cc & (M6800::kFlagZero | M6800::kFlagCarry)) == 0U,
          "ADDA clears ZC for 0x7f plus one");

    trace = cpu.step();
    check(trace.after.a == 0x80U &&
              (trace.after.cc & M6800::kFlagZero) != 0U,
          "CMPA preserves A and sets Z");
    trace = cpu.step();
    check(trace.after.pc == 0x100aU, "BEQ signed branch target");
    trace = cpu.step();
    check(trace.after.a == 0xffU &&
              (trace.after.cc & M6800::kFlagCarry) != 0U &&
              (trace.after.cc & M6800::kFlagNegative) != 0U,
          "SUBA borrow and negative flags");
}

void test_stack_swi_and_rti()
{
    TestBus bus;
    bus.vector(0xfffaU, 0x3000U);
    bus.memory[0x2000U] = 0x3fU;
    bus.memory[0x3000U] = 0x3bU;
    M6800 cpu(bus);
    const M6800Registers initial{
        0x2000U, 0x01ffU, 0x1234U, 0x56U, 0x78U, 0xc1U};
    cpu.set_registers(initial);

    M6800Trace trace = cpu.step();
    check(trace.opcode == 0x3fU && trace.base_cycles == 12U,
          "SWI cycle count");
    check(trace.after.pc == 0x3000U && trace.after.sp == 0x01f8U,
          "SWI vector and stack depth");
    check(bus.memory[0x01ffU] == 0x01U &&
              bus.memory[0x01feU] == 0x20U &&
              bus.memory[0x01fdU] == 0x34U &&
              bus.memory[0x01fcU] == 0x12U &&
              bus.memory[0x01fbU] == 0x56U &&
              bus.memory[0x01faU] == 0x78U &&
              bus.memory[0x01f9U] == 0xc1U,
          "SWI stack byte order");

    trace = cpu.step();
    check(trace.opcode == 0x3bU && trace.base_cycles == 10U,
          "RTI cycle count");
    check_registers(trace.after,
                    {0x2001U, 0x01ffU, 0x1234U, 0x56U, 0x78U, 0xc1U},
                    "RTI restores the complete frame");
}

void test_jsr_rts_and_stack_wrap()
{
    TestBus bus;
    bus.memory[0x1000U] = 0xbdU;
    bus.memory[0x1001U] = 0x12U;
    bus.memory[0x1002U] = 0x34U;
    bus.memory[0x1234U] = 0x39U;
    M6800 cpu(bus);
    cpu.set_registers({0x1000U, 0x0000U, 0U, 0U, 0U, 0xc0U});

    M6800Trace trace = cpu.step();
    check(trace.after.pc == 0x1234U && trace.after.sp == 0xfffeU,
          "JSR wraps the stack pointer");
    check(bus.memory[0x0000U] == 0x03U && bus.memory[0xffffU] == 0x10U,
          "JSR stack write wraps at zero");
    trace = cpu.step();
    check(trace.after.pc == 0x1003U && trace.after.sp == 0x0000U,
          "RTS restores wrapped return address");
    check(trace.base_cycles == 5U, "RTS cycle count");
}

void test_irq_nmi_and_cli_delay()
{
    TestBus bus;
    bus.vector(0xfff8U, 0x2200U);
    bus.vector(0xfffcU, 0x2300U);
    bus.memory[0x1000U] = 0x0eU;
    bus.memory[0x1001U] = 0x01U;
    bus.memory[0x1002U] = 0x01U;
    M6800 cpu(bus);
    cpu.set_registers({0x1000U, 0x01ffU, 0x1122U, 0x33U, 0x44U, 0xd0U});
    cpu.set_irq_line(true);

    M6800Trace trace = cpu.step();
    check(trace.opcode == 0x0eU &&
              (trace.after.cc & M6800::kFlagInterruptMask) == 0U,
          "CLI clears I while masked IRQ is pending");
    trace = cpu.step();
    check(trace.event == M6800Event::Instruction && trace.after.pc == 0x1002U,
          "CLI defers IRQ through one following instruction");
    trace = cpu.step();
    check(trace.event == M6800Event::Irq && trace.base_cycles == 12U &&
              trace.after.pc == 0x2200U && trace.after.sp == 0x01f8U,
          "IRQ entry and cycle count");
    cpu.set_irq_line(false);

    cpu.set_registers({0x1100U, 0x0200U, 0U, 0U, 0U, 0xd0U});
    cpu.pulse_nmi();
    trace = cpu.step();
    check(trace.event == M6800Event::Nmi && trace.after.pc == 0x2300U,
          "NMI is accepted while IRQ is masked");
}

void test_wai_wakeup()
{
    TestBus bus;
    bus.memory[0x1000U] = 0x3eU;
    bus.vector(0xfffcU, 0x3000U);
    bus.memory[0x3000U] = 0x3bU;
    M6800 cpu(bus);
    const M6800Registers initial{
        0x1000U, 0x01ffU, 0xabcdU, 0x12U, 0x34U, 0xc0U};
    cpu.set_registers(initial);

    M6800Trace trace = cpu.step();
    check(trace.opcode == 0x3eU && trace.base_cycles == 9U && cpu.waiting(),
          "WAI stacks state and waits");
    check(trace.after.sp == 0x01f8U, "WAI stack depth");
    trace = cpu.step();
    check(trace.event == M6800Event::Waiting && trace.total_cycles == 0U,
          "waiting step is explicit and consumes no guessed cycles");

    cpu.pulse_nmi();
    trace = cpu.step();
    check(trace.event == M6800Event::Nmi && trace.base_cycles == 4U &&
              trace.after.sp == 0x01f8U && trace.after.pc == 0x3000U &&
              !cpu.waiting(),
          "NMI wakes WAI without stacking twice");
    trace = cpu.step();
    check_registers(trace.after,
                    {0x1001U, 0x01ffU, 0xabcdU, 0x12U, 0x34U, 0xc0U},
                    "RTI restores WAI frame");
}

void test_address_wrap_and_all_opcodes()
{
    TestBus bus;
    bus.memory[0x2000U] = 0xfeU;
    bus.memory[0x2001U] = 0xffU;
    bus.memory[0x2002U] = 0xffU;
    bus.memory[0xffffU] = 0x12U;
    bus.memory[0x0000U] = 0x34U;
    M6800 cpu(bus);
    cpu.set_registers({0x2000U, 0x01ffU, 0U, 0U, 0U, 0xc0U});
    M6800Trace trace = cpu.step();
    check(trace.after.x == 0x1234U, "16-bit data read wraps at 0xffff");

    for (unsigned opcode = 0U; opcode <= 0xffU; ++opcode) {
        TestBus opcode_bus;
        opcode_bus.memory[0x4000U] = static_cast<uint8_t>(opcode);
        opcode_bus.memory[0x4001U] = 0U;
        opcode_bus.memory[0x4002U] = 0U;
        opcode_bus.vector(0xfffaU, 0x5000U);
        M6800 opcode_cpu(opcode_bus);
        opcode_cpu.set_registers(
            {0x4000U, 0x0200U, 0x1000U, 0x11U, 0x22U, 0xc0U});
        trace = opcode_cpu.step();
        check(trace.event == M6800Event::Instruction &&
                  trace.opcode == opcode && trace.base_cycles != 0U,
              "all opcode table entries make bounded progress");
    }
}

void test_portable_trace_fixture()
{
    TestBus bus;
    const std::array<uint8_t, 20> program{
        0x8eU, 0x01U, 0xffU, 0xceU, 0x12U, 0x34U,
        0x86U, 0x7fU, 0x8bU, 0x01U, 0x97U, 0x10U,
        0x26U, 0x02U, 0x86U, 0x00U, 0xbdU, 0x21U,
        0x00U, 0x3eU,
    };
    for (std::size_t i = 0; i < program.size(); ++i) {
        bus.memory[0x2000U + i] = program[i];
    }
    bus.memory[0x2100U] = 0x7cU;
    bus.memory[0x2101U] = 0x00U;
    bus.memory[0x2102U] = 0x10U;
    bus.memory[0x2103U] = 0x39U;
    bus.memory[0x2200U] = 0x3bU;
    bus.vector(0xfffeU, 0x2000U);
    bus.vector(0xfffcU, 0x2200U);
    M6800 cpu(bus);
    cpu.reset();

    struct ExpectedTrace {
        uint8_t opcode;
        M6800Registers registers;
        uint16_t cycles;
    };
    const std::array<ExpectedTrace, 10> expected{
        ExpectedTrace{0x8eU, {0x2003U, 0x01ffU, 0x0000U, 0x00U, 0x00U, 0xd0U}, 3U},
        ExpectedTrace{0xceU, {0x2006U, 0x01ffU, 0x1234U, 0x00U, 0x00U, 0xd0U}, 3U},
        ExpectedTrace{0x86U, {0x2008U, 0x01ffU, 0x1234U, 0x7fU, 0x00U, 0xd0U}, 2U},
        ExpectedTrace{0x8bU, {0x200aU, 0x01ffU, 0x1234U, 0x80U, 0x00U, 0xfaU}, 2U},
        ExpectedTrace{0x97U, {0x200cU, 0x01ffU, 0x1234U, 0x80U, 0x00U, 0xf8U}, 4U},
        ExpectedTrace{0x26U, {0x2010U, 0x01ffU, 0x1234U, 0x80U, 0x00U, 0xf8U}, 4U},
        ExpectedTrace{0xbdU, {0x2100U, 0x01fdU, 0x1234U, 0x80U, 0x00U, 0xf8U}, 9U},
        ExpectedTrace{0x7cU, {0x2103U, 0x01fdU, 0x1234U, 0x80U, 0x00U, 0xf8U}, 6U},
        ExpectedTrace{0x39U, {0x2013U, 0x01ffU, 0x1234U, 0x80U, 0x00U, 0xf8U}, 5U},
        ExpectedTrace{0x3eU, {0x2014U, 0x01f8U, 0x1234U, 0x80U, 0x00U, 0xf8U}, 9U},
    };
    for (const ExpectedTrace& expected_trace : expected) {
        const M6800Trace trace = cpu.step();
        check(trace.opcode == expected_trace.opcode &&
                  trace.after.pc == expected_trace.registers.pc &&
                  trace.after.sp == expected_trace.registers.sp &&
                  trace.after.x == expected_trace.registers.x &&
                  trace.after.a == expected_trace.registers.a &&
                  trace.after.b == expected_trace.registers.b &&
                  trace.after.cc == expected_trace.registers.cc &&
                  trace.base_cycles == expected_trace.cycles,
              "portable native trace fixture");
    }
    check(bus.memory[0x0010U] == 0x81U && cpu.waiting(),
          "portable trace memory result and WAI state");
    cpu.pulse_nmi();
    M6800Trace trace = cpu.step();
    check(trace.event == M6800Event::Nmi && trace.base_cycles == 4U &&
              trace.after.pc == 0x2200U,
          "portable trace NMI wake");
    trace = cpu.step();
    check(trace.opcode == 0x3bU && trace.after.pc == 0x2014U,
          "portable trace RTI");
}

}  // namespace

int main()
{
    test_reset_and_wait_states();
    test_alu_flags_and_branches();
    test_stack_swi_and_rti();
    test_jsr_rts_and_stack_wrap();
    test_irq_nmi_and_cli_delay();
    test_wai_wakeup();
    test_address_wrap_and_all_opcodes();
    test_portable_trace_fixture();
    if (failures != 0) {
        std::cerr << failures << " CPU test(s) failed\n";
        return 1;
    }
    std::cout << "PASS M6800: ALU, flags, stack, reset, IRQ, NMI, WAI, waits, wrap, opcode table, trace\n";
    return 0;
}
