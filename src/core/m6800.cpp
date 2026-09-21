// SPDX-License-Identifier: BSD-3-Clause
// Based on MAME's MC6800 core by Aaron Giles and VJR-200 adaptations by FIND.
// See THIRD_PARTY_NOTICES.md and LICENSES/MAME_BSD-3-Clause.txt.
#include "jr200/m6800.hpp"

namespace jr200 {

namespace {

constexpr uint8_t high_byte(uint16_t value) noexcept
{
    return static_cast<uint8_t>(value >> 8U);
}

}  // namespace

#define pPC m_pc
#define pX m_x

#define PC m_pc
#define PCD m_pc
#define S m_s
#define SD m_s
#define X m_x
#define D m_d
#define A m_d.high
#define B m_d.low
#define CC m_cc
#define EAD m_ea
#define EA m_ea

#define RM(Addr) read_byte(static_cast<uint16_t>(Addr), M6800BusAccess::Data)
#define WM(Addr, Value) write_byte(static_cast<uint16_t>(Addr), static_cast<uint8_t>(Value), M6800BusAccess::Data)
#define RM16(Addr) read_word(static_cast<uint16_t>(Addr), M6800BusAccess::Data)
#define WM16(Addr, ValuePtr) write_word(static_cast<uint16_t>(Addr), static_cast<uint16_t>(*(ValuePtr)), M6800BusAccess::Data)
#define M_RDOP(Addr) read_byte(static_cast<uint16_t>(Addr), M6800BusAccess::Opcode)
#define M_RDOP_ARG(Addr) read_byte(static_cast<uint16_t>(Addr), M6800BusAccess::Operand)

#define IMMBYTE(Value) do { (Value) = fetch_operand(); } while (false)
#define IMMWORD(Value) do { (Value) = fetch_operand_word(); } while (false)
#define PUSHBYTE(Value) push_byte(static_cast<uint8_t>(Value))
#define PUSHWORD(Value) push_word(static_cast<uint16_t>(Value))
#define PULLBYTE(Value) do { (Value) = pull_byte(); } while (false)
#define PULLWORD(Value) do { (Value) = pull_word(); } while (false)

#define CLR_HNZVC CC &= 0xd0U
#define CLR_NZV CC &= 0xf1U
#define CLR_HNZC CC &= 0xd2U
#define CLR_NZVC CC &= 0xf0U
#define CLR_Z CC &= 0xfbU
#define CLR_NZC CC &= 0xf2U
#define CLR_ZC CC &= 0xfaU
#define CLR_C CC &= 0xfeU

#define SET_Z(Value) do { if (!(Value)) { SEZ; } } while (false)
#define SET_Z8(Value) SET_Z(static_cast<uint8_t>(Value))
#define SET_Z16(Value) SET_Z(static_cast<uint16_t>(Value))
#define SET_N8(Value) CC |= static_cast<uint8_t>((static_cast<uint32_t>(Value) & 0x80U) >> 4U)
#define SET_N16(Value) CC |= static_cast<uint8_t>((static_cast<uint32_t>(Value) & 0x8000U) >> 12U)
#define SET_H(Left, Right, Result) CC |= static_cast<uint8_t>((((Left) ^ (Right) ^ (Result)) & 0x10U) << 1U)
#define SET_C8(Value) CC |= static_cast<uint8_t>((static_cast<uint32_t>(Value) & 0x100U) >> 8U)
#define SET_C16(Value) CC |= static_cast<uint8_t>((static_cast<uint32_t>(Value) & 0x10000U) >> 16U)
#define SET_V8(Left, Right, Result) CC |= static_cast<uint8_t>((((Left) ^ (Right) ^ (Result) ^ ((Result) >> 1U)) & 0x80U) >> 6U)
#define SET_V16(Left, Right, Result) CC |= static_cast<uint8_t>((((Left) ^ (Right) ^ (Result) ^ ((Result) >> 1U)) & 0x8000U) >> 14U)
#define SET_FLAGS8I(Value) do { CC |= flags8i[static_cast<uint8_t>(Value)]; } while (false)
#define SET_FLAGS8D(Value) do { CC |= flags8d[static_cast<uint8_t>(Value)]; } while (false)
#define SET_NZ8(Value) do { SET_N8(Value); SET_Z8(Value); } while (false)
#define SET_NZ16(Value) do { SET_N16(Value); SET_Z16(Value); } while (false)
#define SET_FLAGS8(Left, Right, Result) do { SET_N8(Result); SET_Z8(Result); SET_V8(Left, Right, Result); SET_C8(Result); } while (false)
#define SET_FLAGS16(Left, Right, Result) do { SET_N16(Result); SET_Z16(Result); SET_V16(Left, Right, Result); SET_C16(Result); } while (false)

#define SIGNED(Value) static_cast<int16_t>(((Value) & 0x80U) ? ((Value) | 0xff00U) : (Value))
#define DIRECT do { EA = fetch_operand(); } while (false)
#define IMM8 EA = PC++
#define IMM16 do { EA = PC; PC = static_cast<uint16_t>(PC + 2U); } while (false)
#define EXTENDED do { EA = fetch_operand_word(); } while (false)
#define INDEXED do { EA = static_cast<uint16_t>(X + fetch_operand()); } while (false)

#if defined(SEC)
#undef SEC
#endif
#define SEC CC |= 0x01U
#define CLC CC &= 0xfeU
#define SEZ CC |= 0x04U
#define CLZ CC &= 0xfbU
#define SEN CC |= 0x08U
#define CLN CC &= 0xf7U
#define SEV CC |= 0x02U
#define CLV CC &= 0xfdU
#define SEH CC |= 0x20U
#define CLH CC &= 0xdfU
#define SEI CC |= 0x10U
#define CLI CC &= 0xefU

#define DIRBYTE(Value) do { DIRECT; (Value) = RM(EAD); } while (false)
#define DIRWORD(Value) do { DIRECT; (Value) = RM16(EAD); } while (false)
#define EXTBYTE(Value) do { EXTENDED; (Value) = RM(EAD); } while (false)
#define EXTWORD(Value) do { EXTENDED; (Value) = RM16(EAD); } while (false)
#define IDXBYTE(Value) do { INDEXED; (Value) = RM(EAD); } while (false)
#define IDXWORD(Value) do { INDEXED; (Value) = RM16(EAD); } while (false)

#define BRANCH(Condition) do { IMMBYTE(t); if (Condition) { PC = static_cast<uint16_t>(PC + SIGNED(t)); note_control_flow(PC); } } while (false)
#define NXORV ((CC & 0x08U) ^ ((CC & 0x02U) << 2U))
#define M6800_WAI 0x08U
#define XX 5

const uint8_t M6800::flags8i[256]=     /* increment */
        {
                0x04,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x0a,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
                0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
                0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
                0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
                0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
                0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
                0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
                0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08
        };

const uint8_t M6800::flags8d[256]= /* decrement */
        {
                0x04,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
                0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x02,
                0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
                0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
                0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
                0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
                0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
                0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
                0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,
                0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08,0x08
        };

const uint8_t M6800::cycles_6800[256] =
        {
                    /* 0  1  2  3  4  5  6  7  8  9  A  B  C  D  E  F */
                /*0*/ XX, 2,XX,XX,XX,XX, 2, 2, 4, 4, 2, 2, 2, 2, 2, 2,
                /*1*/  2, 2,XX,XX, 2,XX, 2, 2, 2, 2, 2, 2,XX,XX,XX,XX,
                /*2*/  4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
                /*3*/  4, 4, 4, 4, 4, 4, 4, 4,XX, 5,10,10,XX,XX, 9,12,
                /*4*/  2,XX, 2, 2, 2,XX, 2, 2, 2, 2, 2, 2, 2, 2,XX, 2,
                /*5*/  2,XX, 2, 2, 2,XX, 2, 2, 2, 2, 2, 2, 2, 2,XX, 2,
                /*6*/  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 4, 7,
                /*7*/  6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 3, 6,
                /*8*/  2, 2, 2, 2, 2, 2, 2, 4, 2, 2, 2, 2, 3, 8, 3, 5,
                /*9*/  3, 3, 3, 3, 3, 3, 3, 4, 3, 3, 3, 3, 4, 6, 4, 5,
                /*A*/  5, 5, 5, 5, 5, 5, 5, 6, 5, 5, 5, 5, 6, 8, 6, 7,
                /*B*/  4, 4, 4, 4, 4, 4, 4, 5, 4, 4, 4, 4, 5, 9, 5, 6,
                /*C*/  2, 2, 2, 2, 2, 2, 2, 4, 2, 2, 2, 2,XX,XX, 3, 5,
                /*D*/  3, 3, 3, 3, 3, 3, 3, 4, 3, 3, 3, 3,XX,XX, 4, 5,
                /*E*/  5, 5, 5, 5, 5, 5, 5, 6, 5, 5, 5, 5,XX, 8, 6, 7,
                /*F*/  4, 4, 4, 4, 4, 4, 4, 5, 4, 4, 4, 4,XX, 9, 5, 6
        };

#undef XX

M6800::M6800(M6800Bus& bus) noexcept
    : bus_(bus)
{
}

uint8_t M6800::read_byte(
    uint16_t address,
    M6800BusAccess access)
{
    const M6800Read result = bus_.read(address, access);
    step_wait_cycles_ = static_cast<uint16_t>(
        step_wait_cycles_ + result.wait_states);
    return result.value;
}

void M6800::write_byte(
    uint16_t address,
    uint8_t value,
    M6800BusAccess access)
{
    step_wait_cycles_ = static_cast<uint16_t>(
        step_wait_cycles_ + bus_.write(address, value, access));
}

uint16_t M6800::read_word(
    uint16_t address,
    M6800BusAccess access)
{
    const uint16_t high = read_byte(address, access);
    const uint16_t low = read_byte(
        static_cast<uint16_t>(address + 1U),
        access);
    return static_cast<uint16_t>((high << 8U) | low);
}

void M6800::write_word(
    uint16_t address,
    uint16_t value,
    M6800BusAccess access)
{
    write_byte(address, high_byte(value), access);
    write_byte(
        static_cast<uint16_t>(address + 1U),
        static_cast<uint8_t>(value & 0xffU),
        access);
}

uint8_t M6800::fetch_opcode()
{
    const uint8_t value =
        read_byte(m_pc, M6800BusAccess::Opcode);
    ++m_pc;
    return value;
}

uint8_t M6800::fetch_operand()
{
    const uint8_t value =
        read_byte(m_pc, M6800BusAccess::Operand);
    ++m_pc;
    return value;
}

uint16_t M6800::fetch_operand_word()
{
    const uint16_t high = fetch_operand();
    const uint16_t low = fetch_operand();
    return static_cast<uint16_t>((high << 8U) | low);
}

void M6800::push_byte(uint8_t value)
{
    write_byte(m_s, value, M6800BusAccess::Stack);
    --m_s;
}

void M6800::push_word(uint16_t value)
{
    push_byte(static_cast<uint8_t>(value & 0xffU));
    push_byte(high_byte(value));
}

uint8_t M6800::pull_byte()
{
    ++m_s;
    return read_byte(m_s, M6800BusAccess::Stack);
}

uint16_t M6800::pull_word()
{
    const uint16_t high = pull_byte();
    const uint16_t low = pull_byte();
    return static_cast<uint16_t>((high << 8U) | low);
}

M6800Registers M6800::registers() const noexcept
{
    return M6800Registers{
        m_pc,
        m_s,
        m_x,
        m_d.high,
        m_d.low,
        m_cc,
    };
}

void M6800::set_registers(const M6800Registers& registers) noexcept
{
    m_pc = registers.pc;
    m_s = registers.sp;
    m_x = registers.x;
    m_d.high = registers.a;
    m_d.low = registers.b;
    m_cc = registers.cc;
}

bool M6800::waiting() const noexcept
{
    return (m_wai_state & M6800_WAI) != 0U;
}

uint64_t M6800::total_cycles() const noexcept
{
    return total_cycles_;
}

void M6800::set_irq_line(bool asserted) noexcept
{
    irq_line_ = asserted;
}

void M6800::pulse_nmi() noexcept
{
    nmi_pending_ = true;
}

void M6800::note_control_flow(uint16_t address) noexcept
{
    (void)address;
}

void M6800::defer_irq_check() noexcept
{
    irq_defer_ = 1U;
}

M6800Trace M6800::reset()
{
    const M6800Registers before = registers();
    total_cycles_ = 0U;
    step_wait_cycles_ = 0U;
    m_cc = 0xd0U;
    m_wai_state = 0U;
    nmi_pending_ = false;
    irq_defer_ = 0U;
    m_pc = read_word(0xfffeU, M6800BusAccess::Vector);

    M6800Trace trace{};
    trace.before = before;
    trace.after = registers();
    trace.event = M6800Event::Reset;
    trace.wait_cycles = step_wait_cycles_;
    trace.total_cycles = step_wait_cycles_;
    total_cycles_ += trace.total_cycles;
    return trace;
}

M6800Trace M6800::service_interrupt(
    M6800Event event,
    uint16_t vector)
{
    M6800Trace trace{};
    trace.before = registers();
    trace.event = event;
    step_wait_cycles_ = 0U;

    if (waiting()) {
        m_wai_state = static_cast<uint8_t>(
            m_wai_state & static_cast<uint8_t>(~M6800_WAI));
        trace.base_cycles = 4U;
    } else {
        push_word(m_pc);
        push_word(m_x);
        push_byte(m_d.high);
        push_byte(m_d.low);
        push_byte(m_cc);
        trace.base_cycles = 12U;
    }

    m_cc = static_cast<uint8_t>(m_cc | kFlagInterruptMask);
    m_pc = read_word(vector, M6800BusAccess::Vector);
    trace.after = registers();
    trace.wait_cycles = step_wait_cycles_;
    trace.total_cycles = static_cast<uint32_t>(
        trace.base_cycles + trace.wait_cycles);
    total_cycles_ += trace.total_cycles;
    return trace;
}

M6800Trace M6800::step()
{
    if (nmi_pending_) {
        nmi_pending_ = false;
        return service_interrupt(M6800Event::Nmi, 0xfffcU);
    }

    if (irq_defer_ == 0U &&
        irq_line_ &&
        (m_cc & kFlagInterruptMask) == 0U) {
        return service_interrupt(M6800Event::Irq, 0xfff8U);
    }

    if (waiting()) {
        M6800Trace trace{};
        trace.before = registers();
        trace.after = trace.before;
        trace.event = M6800Event::Waiting;
        return trace;
    }

    if (irq_defer_ != 0U) {
        --irq_defer_;
    }

    M6800Trace trace{};
    trace.before = registers();
    trace.event = M6800Event::Instruction;
    step_wait_cycles_ = 0U;
    trace.opcode = fetch_opcode();
    (this->*m6800_insn[trace.opcode])();
    trace.base_cycles = cycles_6800[trace.opcode];
    trace.after = registers();
    trace.wait_cycles = step_wait_cycles_;
    trace.total_cycles = static_cast<uint32_t>(
        trace.base_cycles + trace.wait_cycles);
    total_cycles_ += trace.total_cycles;
    return trace;
}

#include "6800tbl.hxx"

// The audited opcode ALU uses assignment to fixed-width registers to model
// hardware truncation. Keep conversion warnings enabled for the surrounding
// port while isolating only those intentional upstream operations.
#if defined(__clang__)
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wconversion"
#pragma clang diagnostic ignored "-Wsign-conversion"
#elif defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wconversion"
#pragma GCC diagnostic ignored "-Wsign-conversion"
#endif
#include "6800ops.hxx"
#if defined(__clang__)
#pragma clang diagnostic pop
#elif defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

#undef OP_HANDLER
#undef M6800_WAI
#undef NXORV
#undef BRANCH
#undef IDXWORD
#undef IDXBYTE
#undef EXTWORD
#undef EXTBYTE
#undef DIRWORD
#undef DIRBYTE
#undef CLI
#undef SEI
#undef CLH
#undef SEH
#undef CLV
#undef SEV
#undef CLN
#undef SEN
#undef CLZ
#undef SEZ
#undef CLC
#undef SEC
#undef INDEXED
#undef EXTENDED
#undef IMM16
#undef IMM8
#undef DIRECT
#undef SIGNED
#undef SET_FLAGS16
#undef SET_FLAGS8
#undef SET_NZ16
#undef SET_NZ8
#undef SET_FLAGS8D
#undef SET_FLAGS8I
#undef SET_V16
#undef SET_V8
#undef SET_C16
#undef SET_C8
#undef SET_H
#undef SET_N16
#undef SET_N8
#undef SET_Z16
#undef SET_Z8
#undef SET_Z
#undef CLR_C
#undef CLR_ZC
#undef CLR_NZC
#undef CLR_Z
#undef CLR_NZVC
#undef CLR_HNZC
#undef CLR_NZV
#undef CLR_HNZVC
#undef PULLWORD
#undef PULLBYTE
#undef PUSHWORD
#undef PUSHBYTE
#undef IMMWORD
#undef IMMBYTE
#undef M_RDOP_ARG
#undef M_RDOP
#undef WM16
#undef RM16
#undef WM
#undef RM
#undef EA
#undef EAD
#undef CC
#undef B
#undef A
#undef D
#undef X
#undef SD
#undef S
#undef PCD
#undef PC
#undef pX
#undef pPC

}  // namespace jr200
