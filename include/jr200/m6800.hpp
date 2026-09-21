// SPDX-License-Identifier: BSD-3-Clause
// Based on MAME's MC6800 core by Aaron Giles and VJR-200 adaptations by FIND.
// See THIRD_PARTY_NOTICES.md and LICENSES/MAME_BSD-3-Clause.txt.
#pragma once

#include <stdint.h>

namespace jr200 {

enum class M6800BusAccess : uint8_t {
    Opcode,
    Operand,
    Data,
    Stack,
    Vector,
};

struct M6800Read {
    uint8_t value{};
    uint8_t wait_states{};
};

class M6800Bus {
public:
    virtual M6800Read read(uint16_t address, M6800BusAccess access) = 0;
    virtual uint8_t write(
        uint16_t address,
        uint8_t value,
        M6800BusAccess access) = 0;

protected:
    ~M6800Bus() = default;
};

struct M6800Registers {
    uint16_t pc{};
    uint16_t sp{};
    uint16_t x{};
    uint8_t a{};
    uint8_t b{};
    uint8_t cc{};
};

enum class M6800Event : uint8_t {
    Reset,
    Instruction,
    Irq,
    Nmi,
    Waiting,
};

struct M6800Trace {
    M6800Registers before{};
    M6800Registers after{};
    M6800Event event{M6800Event::Instruction};
    uint8_t opcode{};
    uint16_t base_cycles{};
    uint16_t wait_cycles{};
    uint32_t total_cycles{};
};

class M6800 {
public:
    static constexpr uint8_t kFlagCarry = 0x01;
    static constexpr uint8_t kFlagOverflow = 0x02;
    static constexpr uint8_t kFlagZero = 0x04;
    static constexpr uint8_t kFlagNegative = 0x08;
    static constexpr uint8_t kFlagInterruptMask = 0x10;
    static constexpr uint8_t kFlagHalfCarry = 0x20;

    explicit M6800(M6800Bus& bus) noexcept;

    M6800Trace reset();
    M6800Trace step();

    void set_irq_line(bool asserted) noexcept;
    void pulse_nmi() noexcept;
    void set_registers(const M6800Registers& registers) noexcept;

    [[nodiscard]] M6800Registers registers() const noexcept;
    [[nodiscard]] bool waiting() const noexcept;
    [[nodiscard]] uint64_t total_cycles() const noexcept;

private:
    struct DRegister {
        uint8_t high{};
        uint8_t low{};

        [[nodiscard]] constexpr uint16_t value() const noexcept
        {
            return static_cast<uint16_t>(
                (static_cast<uint16_t>(high) << 8U) |
                static_cast<uint16_t>(low));
        }

        [[nodiscard]] constexpr operator uint16_t() const noexcept
        {
            return value();
        }

        constexpr void set(uint32_t value) noexcept
        {
            high = static_cast<uint8_t>((value >> 8U) & 0xffU);
            low = static_cast<uint8_t>(value & 0xffU);
        }

        constexpr DRegister& operator=(uint32_t value) noexcept
        {
            set(value);
            return *this;
        }
    };

    using Op = void (M6800::*)();

    M6800Bus& bus_;
    uint16_t m_pc{};
    uint16_t m_s{};
    uint16_t m_x{};
    DRegister m_d{};
    uint16_t m_ea{};
    uint8_t m_cc{};
    uint8_t m_wai_state{};
    bool irq_line_{};
    bool nmi_pending_{};
    uint8_t irq_defer_{};
    uint16_t step_wait_cycles_{};
    uint64_t total_cycles_{};

    static const uint8_t flags8i[256];
    static const uint8_t flags8d[256];
    static const uint8_t cycles_6800[256];
    static const Op m6800_insn[256];

    [[nodiscard]] uint8_t read_byte(
        uint16_t address,
        M6800BusAccess access);
    void write_byte(
        uint16_t address,
        uint8_t value,
        M6800BusAccess access);
    [[nodiscard]] uint16_t read_word(
        uint16_t address,
        M6800BusAccess access);
    void write_word(
        uint16_t address,
        uint16_t value,
        M6800BusAccess access);

    [[nodiscard]] uint8_t fetch_opcode();
    [[nodiscard]] uint8_t fetch_operand();
    [[nodiscard]] uint16_t fetch_operand_word();
    void push_byte(uint8_t value);
    void push_word(uint16_t value);
    [[nodiscard]] uint8_t pull_byte();
    [[nodiscard]] uint16_t pull_word();
    [[nodiscard]] M6800Trace service_interrupt(
        M6800Event event,
        uint16_t vector);
    void note_control_flow(uint16_t address) noexcept;
    void defer_irq_check() noexcept;

    void aba();
    void abx();
    void adca_di();
    void adca_ex();
    void adca_im();
    void adca_ix();
    void adcb_di();
    void adcb_ex();
    void adcb_im();
    void adcb_ix();
    void adcx_im();
    void adda_di();
    void adda_ex();
    void adda_im();
    void adda_ix();
    void addb_di();
    void addb_ex();
    void addb_im();
    void addb_ix();
    void addd_di();
    void addd_ex();
    void addx_ex();
    void addd_im();
    void addd_ix();
    void aim_di();
    void aim_ix();
    void anda_di();
    void anda_ex();
    void anda_im();
    void anda_ix();
    void andb_di();
    void andb_ex();
    void andb_im();
    void andb_ix();
    void asl_ex();
    void asl_ix();
    void asla();
    void aslb();
    void asld();
    void asr_ex();
    void asr_ix();
    void asra();
    void asrb();
    void bcc();
    void bcs();
    void beq();
    void bge();
    void bgt();
    void bhi();
    void bita_di();
    void bita_ex();
    void bita_im();
    void bita_ix();
    void bitb_di();
    void bitb_ex();
    void bitb_im();
    void bitb_ix();
    void ble();
    void bls();
    void blt();
    void bmi();
    void bne();
    void bpl();
    void bra();
    void brn();
    void bsr();
    void bvc();
    void bvs();
    void cba();
    void clc();
    void cli();
    void clr_ex();
    void clr_ix();
    void clra();
    void clrb();
    void clv();
    void cmpa_di();
    void cmpa_ex();
    void cmpa_im();
    void cmpa_ix();
    void cmpb_di();
    void cmpb_ex();
    void cmpb_im();
    void cmpb_ix();
    void cmpx_di();
    void cmpx_ex();
    void cmpx_im();
    void cmpx_ix();
    void com_ex();
    void com_ix();
    void coma();
    void comb();
    void daa();
    void dec_ex();
    void dec_ix();
    void deca();
    void decb();
    void des();
    void dex();
    void eim_di();
    void eim_ix();
    void eora_di();
    void eora_ex();
    void eora_im();
    void eora_ix();
    void eorb_di();
    void eorb_ex();
    void eorb_im();
    void eorb_ix();
    void illegal();
    void inc_ex();
    void inc_ix();
    void inca();
    void incb();
    void ins();
    void inx();
    void jmp_ex();
    void jmp_ix();
    void jsr_di();
    void jsr_ex();
    void jsr_ix();
    void lda_di();
    void lda_ex();
    void lda_im();
    void lda_ix();
    void ldb_di();
    void ldb_ex();
    void ldb_im();
    void ldb_ix();
    void ldd_di();
    void ldd_ex();
    void ldd_im();
    void ldd_ix();
    void lds_di();
    void lds_ex();
    void lds_im();
    void lds_ix();
    void ldx_di();
    void ldx_ex();
    void ldx_im();
    void ldx_ix();
    void lsr_ex();
    void lsr_ix();
    void lsra();
    void lsrb();
    void lsrd();
    void mul();
    void nba();
    void neg_ex();
    void neg_ix();
    void nega();
    void negb();
    void nop();
    void oim_di();
    void oim_ix();
    void ora_di();
    void ora_ex();
    void ora_im();
    void ora_ix();
    void orb_di();
    void orb_ex();
    void orb_im();
    void orb_ix();
    void psha();
    void pshb();
    void pshx();
    void pula();
    void pulb();
    void pulx();
    void rol_ex();
    void rol_ix();
    void rola();
    void rolb();
    void ror_ex();
    void ror_ix();
    void rora();
    void rorb();
    void rti();
    void rts();
    void sba();
    void sbca_di();
    void sbca_ex();
    void sbca_im();
    void sbca_ix();
    void sbcb_di();
    void sbcb_ex();
    void sbcb_im();
    void sbcb_ix();
    void sec();
    void sei();
    void sev();
    void slp();
    void sta_di();
    void sta_ex();
    void sta_im();
    void sta_ix();
    void stb_di();
    void stb_ex();
    void stb_im();
    void stb_ix();
    void std_di();
    void std_ex();
    void std_im();
    void std_ix();
    void sts_di();
    void sts_ex();
    void sts_im();
    void sts_ix();
    void stx_di();
    void stx_ex();
    void stx_im();
    void stx_ix();
    void suba_di();
    void suba_ex();
    void suba_im();
    void suba_ix();
    void subb_di();
    void subb_ex();
    void subb_im();
    void subb_ix();
    void subd_di();
    void subd_ex();
    void subd_im();
    void subd_ix();
    void swi();
    void tab();
    void tap();
    void tba();
    void tim_di();
    void tim_ix();
    void tpa();
    void tst_ex();
    void tst_ix();
    void tsta();
    void tstb();
    void tsx();
    void txs();
    void undoc1();
    void undoc2();
    void wai();
    void xgdx();
    void cpx_di();
    void cpx_ex();
    void cpx_im();
    void cpx_ix();
    void trap();
    void btst_ix();
    void stx_nsc();

};

}  // namespace jr200
