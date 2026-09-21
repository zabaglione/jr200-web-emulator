// SPDX-License-Identifier: BSD-3-Clause
// All cassette data are synthetic. No manufacturer ROM, font or recording.
#include "jr200/cassette.hpp"
#include "jr200/system.hpp"

#include <array>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

constexpr size_t kCapacity = 1024U * 1024U;
using Golden = std::array<uint8_t, 47U>;

Golden golden()
{
    return {
        0x02, 0x2a, 0x00, 0x1a, 0xff, 0xff,
        0x58, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0x01, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x95,
        0x02, 0x2a, 0x01, 0x01, 0x70, 0x00, 0xab, 0x49,
        0x02, 0x2a, 0xff, 0xff, 0x70, 0x01,
    };
}

void check(bool condition, const char* message)
{
    if (!condition) {
        throw std::runtime_error(message);
    }
}

void fix_header_checksum(Golden& bytes)
{
    uint8_t sum = 0U;
    for (size_t i = 0U; i < 32U; ++i) {
        sum = static_cast<uint8_t>(sum + bytes[i]);
    }
    bytes[32] = sum;
}

size_t render_raw(
    const Golden& input,
    uint8_t* raw,
    size_t capacity,
    uint64_t& samples)
{
    jr200::CassetteDeck source;
    check(source.mount(input.data(), input.size()) == jr200::CassetteError::None,
          "synthetic CJR mounts for waveform rendering");
    samples = source.total_samples();
    check(samples % 8U == 0U && samples / 8U <= capacity,
          "rendered waveform fits packed capture");
    source.set_remote(true);
    size_t written = 0U;
    while (source.sample_position() < source.total_samples()) {
        uint8_t packed = 0U;
        for (uint8_t bit = 0U; bit < 8U; ++bit) {
            if (source.read_level()) {
                packed = static_cast<uint8_t>(packed | (1U << bit));
            }
            source.tick(jr200::CassetteDeck::kCyclesPerSample);
        }
        raw[written++] = packed;
    }
    check(source.state() == jr200::CassetteState::Finished,
          "playback reaches explicit finished state");
    return written;
}

void check_roundtrip(const Golden& input, bool omit_final_gap = false)
{
    static uint8_t raw[kCapacity]{};
    static uint8_t capture[kCapacity]{};
    static uint8_t output[kCapacity]{};
    uint64_t samples = 0U;
    const size_t raw_size = render_raw(input, raw, sizeof(raw), samples);
    const size_t recorded_size = omit_final_gap ? raw_size - 96U : raw_size;

    jr200::CassetteDeck recorder;
    recorder.configure_recording_storage(
        capture, sizeof(capture), output, sizeof(output));
    check(recorder.arm_record() == jr200::CassetteError::None,
          "recording can be armed with fixed storage");
    recorder.set_remote(true);
    for (size_t i = 0U; i < recorded_size; ++i) {
        recorder.write_signal_byte(raw[i]);
    }
    recorder.set_remote(false);
    check(recorder.state() == jr200::CassetteState::OutputReady,
          "REMOTE off decodes captured waveform");
    check(recorder.output_size() == input.size(),
          "decoded CJR size matches source");
    for (size_t i = 0U; i < input.size(); ++i) {
        check(recorder.output_data()[i] == input[i],
              "decoded CJR preserves every source byte");
    }
    check(recorder.summary().payload_bytes == 1U &&
              recorder.summary().first_address == 0x7000U,
          "decoded logical region is validated");
    check(recorder.capture_size() == recorded_size && samples == raw_size * 8U,
          "packed waveform accounting is exact");
}

void test_transport()
{
    const Golden input = golden();
    jr200::CassetteDeck deck;
    check(deck.mount(input.data(), input.size()) == jr200::CassetteError::None,
          "standard machine-code CJR mounts");
    check(deck.mode() == jr200::CassetteMode::Playback &&
              deck.state() == jr200::CassetteState::Stopped,
          "mount enters stopped playback mode");
    deck.set_remote(true);
    check(deck.state() == jr200::CassetteState::Stopped,
          "REMOTE alone does not advance before the first read");
    check(!deck.read_level() && deck.state() == jr200::CassetteState::Playing,
          "first read exposes initial leader level and starts playback");
    deck.tick(279U);
    check(deck.sample_position() == 0U, "279 cycles do not advance a sample");
    deck.tick(1U);
    check(deck.sample_position() == 1U, "280 cycles advance one sample");
    check(deck.rewind() && deck.remote() && deck.sample_position() == 0U &&
              deck.state() == jr200::CassetteState::Stopped,
          "rewind preserves an already asserted REMOTE line");
    check(!deck.read_level(),
          "playback restarts from the first sample without a REMOTE edge");
    deck.set_remote(false);
    deck.tick(1000U);
    check(deck.sample_position() == 0U &&
              deck.state() == jr200::CassetteState::Stopped,
          "REMOTE off stops playback without losing position");
    check(deck.rewind() && deck.sample_position() == 0U,
          "rewind restores the first signal sample");
    deck.eject();
    check(deck.state() == jr200::CassetteState::Ejected && !deck.rewind(),
          "eject removes media and disables rewind");
}

void test_roundtrips()
{
    const Golden fast = golden();
    check_roundtrip(fast, true);
    Golden slow = golden();
    slow[23] = jr200::cjr::kBaudFlag600;
    fix_header_checksum(slow);
    check_roundtrip(slow);
}

void test_rejections_and_overflow()
{
    Golden unsupported = golden();
    unsupported[22] = 2U;
    fix_header_checksum(unsupported);
    jr200::CassetteDeck deck;
    check(deck.mount(unsupported.data(), unsupported.size()) ==
              jr200::CassetteError::UnsupportedType,
          "unknown/special CJR type is rejected explicitly");
    const Golden input = golden();
    check(deck.mount(input.data() + 33U, input.size() - 33U) ==
              jr200::CassetteError::InvalidCjr,
          "headerless CJR is not silently accepted by transport");

    uint8_t capture[1]{};
    uint8_t output[64]{};
    deck.configure_recording_storage(capture, sizeof(capture), output, sizeof(output));
    check(deck.arm_record() == jr200::CassetteError::None,
          "small test recording buffer arms");
    deck.set_remote(true);
    deck.write_signal_byte(0U);
    deck.write_signal_byte(0U);
    check(deck.state() == jr200::CassetteState::Error &&
              deck.error() == jr200::CassetteError::CaptureOverflow,
          "capture overflow is explicit and bounded");
}

void test_machine_path()
{
    static uint8_t raw[kCapacity]{};
    static uint8_t capture[kCapacity]{};
    static uint8_t output[kCapacity]{};
    const Golden input = golden();
    uint64_t samples = 0U;
    const size_t raw_size = render_raw(input, raw, sizeof(raw), samples);

    jr200::JR200Machine machine;
    machine.cassette().configure_recording_storage(
        capture, sizeof(capture), output, sizeof(output));
    check(machine.cassette().mount(input.data(), input.size()) ==
              jr200::CassetteError::None,
          "machine mounts CJR in normal cassette device");
    machine.write_byte(0xc806U, 0x40U);
    machine.write_byte(0xc807U, 0x40U);
    check(machine.read_byte(0xc807U) == 0x40U,
          "MN1271 reads the first low cassette signal level");
    machine.advance_cycles(jr200::CassetteDeck::kCyclesPerSample);
    check(machine.cassette().sample_position() == 1U,
          "CPU cycle clock advances mounted tape after read");
    machine.write_byte(0xc807U, 0U);
    check(machine.cassette().state() == jr200::CassetteState::Stopped,
          "MN1271 REMOTE off stops mounted tape");

    check(machine.cassette().arm_record() == jr200::CassetteError::None,
          "machine record path arms");
    machine.write_byte(0xc807U, 0x40U);
    for (size_t i = 0U; i < raw_size; ++i) {
        machine.write_byte(0xc80dU, raw[i]);
    }
    machine.write_byte(0xc807U, 0U);
    check(machine.cassette().state() == jr200::CassetteState::OutputReady &&
              machine.cassette().output_size() == input.size(),
          "MN1271 output waveform is decoded on REMOTE off");
}

}  // namespace

int main()
{
    try {
        test_transport();
        std::cout << "PASS cassette mount/eject/rewind/REMOTE timing\n";
        test_roundtrips();
        std::cout << "PASS cassette 2400/600 waveform roundtrips\n";
        test_rejections_and_overflow();
        std::cout << "PASS cassette unsupported formats and fixed limits\n";
        test_machine_path();
        std::cout << "PASS cassette MN1271 normal read/write path\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "FAIL " << error.what() << '\n';
        return 1;
    }
}
