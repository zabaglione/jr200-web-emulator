// SPDX-License-Identifier: BSD-3-Clause
#include "jr200/system.hpp"

#include <array>
#include <cstddef>
#include <stdint.h>
#include <iostream>

namespace {

using jr200::IoDevice;
using jr200::IoOperation;
using jr200::JR200Machine;
using jr200::M6800BusAccess;
using jr200::M6800Event;
using jr200::MemoryConfig;
using jr200::PcmFrame;

int failures = 0;

void check(bool condition, const char* message)
{
    if (!condition) {
        ++failures;
        std::cerr << "FAIL: " << message << '\n';
    }
}

void pulse_control(JR200Machine& machine, uint8_t bit)
{
    machine.write_byte(0xc803U, bit);
    machine.write_byte(0xc803U, 0U);
    machine.write_byte(0xc803U, bit);
    machine.advance_cycles(jr200::Mn1544::kIrqDelayCycles);
}

void clear_key_irq(JR200Machine& machine)
{
    (void)machine.read_byte(0xc81cU);
}

void test_memory_map_waits_and_trace()
{
    JR200Machine machine;
    machine.poke(0x1234U, 0x5aU);
    const auto ram = machine.read(0x1234U, M6800BusAccess::Data);
    check(ram.value == 0x5aU && ram.wait_states == 1U,
          "base RAM has one explicit wait state");

    machine.poke(0xa000U, 0x33U);
    machine.write_byte(0xa000U, 0x44U);
    check(machine.peek_byte(0xa000U) == 0x33U,
          "base ROM rejects writes");
    check(machine.read(0xa000U, M6800BusAccess::Data).wait_states == 0U,
          "ROM does not add the DRAM wait");

    machine.poke(0x8000U, 0x77U);
    machine.write_byte(0x8000U, 0x88U);
    check(machine.read_byte(0x8000U) == 0U,
          "disabled expansion is open bus zero");

    machine.io_trace().clear();
    machine.write_byte(0xc83fU, 0x15U);
    const uint8_t mirror = machine.read_byte(0xc91fU);
    check(mirror == 0x15U, "MN1271 mirrors every 32 bytes");
    check(machine.io_trace().size() == 2U, "I/O trace records read and write");
    const auto first = machine.io_trace().at(0U);
    const auto second = machine.io_trace().at(1U);
    check(first.address == 0xc83fU && first.register_index == 0x1fU &&
              first.value == 0x15U && first.device == IoDevice::Mn1271 &&
              first.operation == IoOperation::Write,
          "I/O trace preserves mirrored write address and bus value");
    check(second.address == 0xc91fU && second.register_index == 0x1fU &&
              second.value == 0x15U && second.operation == IoOperation::Read,
          "I/O trace preserves mirrored read address and result");

    JR200Machine expanded({true, true});
    expanded.write_byte(0x8000U, 0xa1U);
    expanded.write_byte(0xa000U, 0xa2U);
    check(expanded.read(0x8000U, M6800BusAccess::Data).value == 0xa1U &&
              expanded.read(0xa000U, M6800BusAccess::Data).value == 0xa2U,
          "configured expansion regions are RAM");
    check(expanded.read(0x8000U, M6800BusAccess::Data).wait_states == 1U &&
              expanded.read(0xa000U, M6800BusAccess::Data).wait_states == 1U,
          "expansion RAM has the upstream DRAM wait");

    std::array<uint8_t, 16384> rom{};
    rom[0] = 0x12U;
    rom[8191] = 0x34U;
    rom[8192] = 0x56U;
    rom[16383] = 0x78U;
    check(machine.load_rom(rom.data(), rom.size()), "combined ROM size accepted");
    check(machine.peek_byte(0xa000U) == 0x12U &&
              machine.peek_byte(0xbfffU) == 0x34U &&
              machine.peek_byte(0xe000U) == 0x56U &&
              machine.peek_byte(0xffffU) == 0x78U,
          "combined ROM maps ROM1 then ROM2 without embedding data");
    check(!machine.load_rom(rom.data(), rom.size() - 1U),
          "wrong ROM size rejected");
}

void test_debug_peek_and_timer_irq()
{
    JR200Machine machine;
    machine.write_byte(0xc80aU, 0x87U);
    const size_t trace_size = machine.io_trace().size();
    check(machine.peek_byte(0xc80aU) == 0x87U &&
              machine.peek_byte(0xc80aU) == 0x87U,
          "debug peek does not clear read-sensitive register 0A");
    check(machine.io_trace().size() == trace_size,
          "debug peek does not mutate the I/O trace");
    check(machine.read_byte(0xc80aU) == 0x87U &&
              machine.read_byte(0xc80aU) == 0U,
          "normal read clears register 0A as upstream");

    machine.write_byte(0xc80fU, 0x02U);
    machine.write_byte(0xc82eU, 0x41U);
    machine.advance_cycles(1U);
    check(!machine.mn1271().irq_asserted(), "timer A does not fire early");
    machine.advance_cycles(1U);
    check(machine.mn1271().irq_asserted(), "timer A asserts masked IRQ");
    check(machine.peek_byte(0xc81dU) == 0x81U,
          "timer A status and aggregate status are latched");
    const uint8_t before = machine.peek_byte(0xc80eU);
    check((before & 0x60U) == 0x60U,
          "timer control exposes borrow and IRQ-enable bits");
    check(machine.peek_byte(0xc80eU) == before &&
              machine.mn1271().irq_asserted(),
          "debug peek preserves timer borrow and IRQ");
    check(machine.read_byte(0xc80eU) == before,
          "normal timer read returns the pre-clear value");
    check(!machine.mn1271().irq_asserted() &&
              (machine.peek_byte(0xc80eU) & 0x20U) == 0U,
          "normal timer read acknowledges borrow and IRQ");
}

void test_keyboard_handshake()
{
    JR200Machine machine;
    std::array<uint8_t, jr200::Mn1544::kFontSize> font{};
    for (size_t i = 0U; i < font.size(); ++i) {
        font[i] = static_cast<uint8_t>(i & 0xffU);
    }
    check(machine.load_font(font.data(), font.size()), "2048-byte font accepted");
    machine.write_byte(0xc81eU, 0x01U);

    pulse_control(machine, 0x02U);
    check(machine.peek_byte(0xc801U) == font[0],
          "KTEST handshake returns first font byte after 100 cycles");
    check(machine.mn1271().irq_asserted(), "KTEST completion asserts KON IRQ");
    clear_key_irq(machine);

    for (size_t i = 1U; i <= jr200::Mn1544::kFontSize; ++i) {
        pulse_control(machine, 0x01U);
        if (i == 1U || i == jr200::Mn1544::kFontSize - 1U) {
            check(machine.peek_byte(0xc801U) == font[i],
                  "KACK handshake advances font stream");
        }
        clear_key_irq(machine);
    }
    check(machine.mn1544().initialized(),
          "2048 font bytes and trailing baud byte complete bootstrap");
    check(machine.peek_byte(0xc801U) == 0U,
          "bootstrap trailing baud byte matches upstream zero");

    machine.set_key_state(0x41U, true);
    machine.advance_cycles(99U);
    check(!machine.mn1271().irq_asserted(), "host key IRQ keeps 100-cycle delay");
    machine.advance_cycles(1U);
    check(machine.peek_byte(0xc801U) == 0x41U &&
              machine.mn1271().irq_asserted(),
          "host key state reaches MN1271 and asserts KON IRQ");
    clear_key_irq(machine);

    machine.set_joystick(0U, 0xfeU);
    machine.set_joystick(1U, 0xfdU);
    pulse_control(machine, 0x02U);
    check(machine.peek_byte(0xc801U) == 0x41U,
          "normal KTEST scan returns current key");
    clear_key_irq(machine);
    pulse_control(machine, 0x01U);
    check(machine.peek_byte(0xc801U) == 0xfeU,
          "first KACK returns joystick one state");
    clear_key_irq(machine);
    pulse_control(machine, 0x01U);
    check(machine.peek_byte(0xc801U) == 0xfdU,
          "second KACK returns joystick two state");
    clear_key_irq(machine);
    machine.set_key_state(0x41U, false);
    check(machine.mn1544().current_key() == 0U, "key release clears scan state");
}

void test_cassette_audio_and_framebuffer()
{
    JR200Machine machine;
    machine.write_byte(0xc806U, 0x40U);
    machine.write_byte(0xc807U, 0x40U);
    check(machine.mn1271().cassette_remote(), "cassette REMOTE turns on");
    machine.set_cassette_input(true);
    check(machine.read_byte(0xc807U) == 0xc0U,
          "cassette input level appears on port bit seven");
    check(machine.mn1271().take_read_activity() &&
              !machine.mn1271().take_read_activity(),
          "cassette read activity is edge-consumed by the host");
    machine.write_byte(0xc80dU, 0x55U);
    uint8_t cassette = 0U;
    check(machine.mn1271().take_cassette_output(cassette) && cassette == 0x55U,
          "cassette output byte is queued while REMOTE is on");
    check(machine.mn1271().take_write_activity() &&
              !machine.mn1271().take_write_activity(),
          "cassette write activity is edge-consumed by the host");
    machine.write_byte(0xc807U, 0U);
    check(!machine.mn1271().cassette_remote(), "cassette REMOTE turns off");

    machine.write_byte(0xc813U, 0x80U);
    machine.write_byte(0xc812U, 0x06U);
    machine.advance_cycles(304U);
    check(machine.pcm().size() == 10U,
          "cycle clock produces 44.1 kHz PCM without host time");
    PcmFrame frame{};
    check(machine.pcm().pop(frame) && frame.channel[0] == 7000 &&
              frame.channel[1] == 0 && frame.channel[2] == 0,
          "PCM queue preserves three independent sound channels");

    JR200Machine audio16;
    audio16.write_byte(0xc81aU, 0x00U);
    audio16.write_byte(0xc81bU, 0x80U);
    audio16.write_byte(0xc819U, 0x16U);
    audio16.advance_cycles(304U);
    PcmFrame audio16_frame{};
    for (uint8_t i = 0U; i < 6U; ++i) {
        check(audio16.pcm().pop(audio16_frame),
              "16-bit sound channel produces queued samples");
    }
    check(audio16_frame.channel[2] == -7000,
          "16-bit pulse bit does not alter the upstream prescale selector");

    JR200Machine display;
    display.poke(0xc502U, 0xabU);
    display.advance_cycles(3U);
    check(display.read_byte(0xca00U) == 0xabU,
          "CRTC scan value advances from CPU cycles");

    display.write_byte(0xca7fU, 0x02U);
    display.poke(0xc100U, 0x00U);
    display.poke(0xc500U, 0x07U);
    display.poke(0xd000U, 0x80U);
    display.render_frame();
    const uint32_t* pixels = display.crtc().framebuffer();
    check(pixels[0] == 0xffff0000U, "framebuffer uses the CRTC border color");
    const size_t first = 32U + 16U * jr200::kFramebufferWidth;
    check(pixels[first] == 0xffffffffU &&
              pixels[first + 1U] == 0xff000000U,
          "framebuffer renders font foreground and background pixels");
    check(display.crtc().frame_generation() == 1U,
          "framebuffer generation is explicit and host-owned");

    display.poke(0xc500U, 0x47U);
    display.poke(0xc000U, 0x40U);
    display.render_frame();
    check(pixels[first] == 0xff000000U &&
              pixels[first + 1U] == 0xffffffffU,
          "framebuffer renders user-defined PCG characters");

    display.poke(0xc100U, 0x11U);
    display.poke(0xc500U, 0xa3U);
    display.render_frame();
    check(pixels[first] == 0xff0000ffU &&
              pixels[first + 4U] == 0xffff0000U &&
              pixels[first + 4U * jr200::kFramebufferWidth] == 0xffff00ffU &&
              pixels[first + 4U * jr200::kFramebufferWidth + 4U] == 0xff00ff00U,
          "framebuffer renders four-color semigraphics quadrants");
}

void test_cpu_scheduler_boundary()
{
    JR200Machine machine;
    machine.poke(0xfffeU, 0x10U);
    machine.poke(0xffffU, 0x00U);
    machine.poke(0x1000U, 0x01U);
    const auto reset = machine.reset_cpu();
    check(reset.event == M6800Event::Reset && reset.after.pc == 0x1000U,
          "machine CPU reset reads mapped vector");
    const auto trace = machine.step();
    check(trace.opcode == 0x01U && trace.base_cycles == 2U &&
              trace.wait_cycles == 1U && trace.total_cycles == 3U,
          "machine step combines CPU base cycle and RAM wait");
    check(machine.cycle_count() == 3U,
          "peripherals advance from returned CPU cycles only");
}

}  // namespace

int main()
{
    test_memory_map_waits_and_trace();
    test_debug_peek_and_timer_irq();
    test_keyboard_handshake();
    test_cassette_audio_and_framebuffer();
    test_cpu_scheduler_boundary();
    if (failures != 0) {
        std::cerr << failures << " system test(s) failed\n";
        return 1;
    }
    std::cout << "PASS system: map, mirrors, trace, timers, keyboard, cassette, PCM, framebuffer, cycle clock\n";
    return 0;
}
