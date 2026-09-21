// SPDX-License-Identifier: BSD-3-Clause
// All cassette data are synthetic. No manufacturer ROM, font or recording.
#include "jr200/wav.hpp"

#include <array>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <vector>

namespace {

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

uint16_t read_u16(const uint8_t* input)
{
    return static_cast<uint16_t>(
        static_cast<uint16_t>(input[0]) |
        static_cast<uint16_t>(static_cast<uint16_t>(input[1]) << 8U));
}

uint32_t read_u32(const uint8_t* input)
{
    return static_cast<uint32_t>(input[0]) |
        (static_cast<uint32_t>(input[1]) << 8U) |
        (static_cast<uint32_t>(input[2]) << 16U) |
        (static_cast<uint32_t>(input[3]) << 24U);
}

std::vector<int16_t> render_signal(
    const Golden& input,
    jr200::CassetteDataBaud baud)
{
    jr200::CassetteDeck deck;
    check(deck.mount(input.data(), input.size(), baud) ==
              jr200::CassetteError::None,
          "synthetic CJR mounts with explicit WAV baud");
    std::vector<int16_t> signal;
    signal.reserve(static_cast<size_t>(deck.total_samples()));
    deck.set_remote(true);
    while (deck.sample_position() < deck.total_samples()) {
        signal.push_back(deck.read_level()
            ? jr200::wav::kDefaultAmplitude
            : static_cast<int16_t>(-jr200::wav::kDefaultAmplitude));
        deck.tick(jr200::CassetteDeck::kCyclesPerSample);
    }
    return signal;
}

void check_encoding(
    uint32_t rate,
    jr200::CassetteDataBaud baud)
{
    const Golden input = golden();
    const std::vector<int16_t> signal = render_signal(input, baud);
    jr200::wav::Encoder encoder;
    const jr200::wav::Result started = encoder.begin(
        {input.data(), input.size()},
        {rate, baud, jr200::wav::kDefaultAmplitude});
    check(static_cast<bool>(started), "WAV encoder accepts a synthetic CJR");

    const jr200::wav::Info& info = encoder.info();
    const uint64_t expected_samples =
        (static_cast<uint64_t>(signal.size()) * rate + 4799U) / 4800U;
    check(info.signal_samples == signal.size() &&
              info.pcm_samples == expected_samples &&
              info.data_bytes == expected_samples * 2U &&
              info.total_bytes == expected_samples * 2U + 44U,
          "WAV size uses one cumulative rational timeline");
    check(info.sample_rate == rate &&
              info.data_baud == static_cast<uint32_t>(baud) &&
              info.amplitude == jr200::wav::kDefaultAmplitude,
          "WAV metadata preserves explicit output options");

    std::array<uint8_t, jr200::wav::kHeaderSize> header{};
    check(static_cast<bool>(encoder.write_header(
              {header.data(), header.size()})),
          "RIFF header fits the fixed header buffer");
    check(std::memcmp(header.data(), "RIFF", 4U) == 0 &&
              std::memcmp(header.data() + 8U, "WAVEfmt ", 8U) == 0 &&
              std::memcmp(header.data() + 36U, "data", 4U) == 0,
          "RIFF/WAVE/fmt/data tags are canonical");
    check(read_u32(header.data() + 4U) == 36U + info.data_bytes &&
              read_u32(header.data() + 16U) == 16U &&
              read_u16(header.data() + 20U) == 1U &&
              read_u16(header.data() + 22U) == 1U &&
              read_u32(header.data() + 24U) == rate &&
              read_u32(header.data() + 28U) == rate * 2U &&
              read_u16(header.data() + 32U) == 2U &&
              read_u16(header.data() + 34U) == 16U &&
              read_u32(header.data() + 40U) == info.data_bytes,
          "RIFF PCM is mono 16-bit with exact sizes and byte rate");

    std::vector<int16_t> pcm(static_cast<size_t>(info.pcm_samples));
    size_t written = 0U;
    while (!encoder.finished()) {
        const size_t count = encoder.drain(
            pcm.data() + written,
            pcm.size() - written > 257U ? 257U : pcm.size() - written);
        check(count > 0U, "streaming WAV encoder makes bounded progress");
        written += count;
    }
    check(written == pcm.size() && encoder.samples_emitted() == pcm.size(),
          "streaming WAV encoder emits the measured sample count");
    for (size_t i = 0U; i < pcm.size(); ++i) {
        const uint64_t signal_index =
            (static_cast<uint64_t>(i) * 4800U) / rate;
        check(pcm[i] == signal[static_cast<size_t>(signal_index)],
              "PCM sample follows the shared cassette phase without drift");
    }
}

void test_rational_resampling()
{
    check_encoding(48000U, jr200::CassetteDataBaud::Baud2400);
    check_encoding(44100U, jr200::CassetteDataBaud::Baud2400);
    check_encoding(48000U, jr200::CassetteDataBaud::Baud600);
    check_encoding(44100U, jr200::CassetteDataBaud::Baud600);
}

void test_errors()
{
    const Golden input = golden();
    jr200::wav::Encoder encoder;
    std::array<uint8_t, jr200::wav::kHeaderSize> header{};
    check(encoder.write_header({header.data(), header.size()}).error ==
              jr200::wav::Error::NotStarted,
          "RIFF header cannot claim an encoder that did not start");
    check(encoder.begin(
              {input.data(), input.size()},
              {32000U, jr200::CassetteDataBaud::Baud2400,
                  jr200::wav::kDefaultAmplitude}).error ==
              jr200::wav::Error::InvalidSampleRate,
          "unsupported WAV sample rates are rejected");
    check(encoder.begin(
              {input.data(), input.size()},
              {48000U, static_cast<jr200::CassetteDataBaud>(1200U),
                  jr200::wav::kDefaultAmplitude}).error ==
              jr200::wav::Error::InvalidBaud,
          "WAV output rejects an unknown baud choice");

    Golden slow = input;
    slow[23] = jr200::cjr::kBaudFlag600;
    uint8_t slow_sum = 0U;
    for (size_t i = 0U; i < 32U; ++i) {
        slow_sum = static_cast<uint8_t>(slow_sum + slow[i]);
    }
    slow[32] = slow_sum;
    check(static_cast<bool>(encoder.begin(
              {slow.data(), slow.size()},
              {48000U, jr200::CassetteDataBaud::FromHeader,
                  jr200::wav::kDefaultAmplitude})) &&
              encoder.info().data_baud == 600U,
          "unspecified WAV baud follows the preserved CJR header");
    check(encoder.begin(
              {input.data(), input.size()},
              {48000U, jr200::CassetteDataBaud::Baud2400, 0}).error ==
              jr200::wav::Error::InvalidAmplitude,
          "silent or negative PCM amplitude is rejected");

    Golden broken = input;
    broken[40] = static_cast<uint8_t>(broken[40] ^ 1U);
    check(encoder.begin(
              {broken.data(), broken.size()},
              {48000U, jr200::CassetteDataBaud::Baud2400,
                  jr200::wav::kDefaultAmplitude}).error ==
              jr200::wav::Error::InvalidCjr,
          "checksum-broken CJR is rejected before WAV output");

    Golden unsupported = input;
    unsupported[22] = 2U;
    uint8_t sum = 0U;
    for (size_t i = 0U; i < 32U; ++i) {
        sum = static_cast<uint8_t>(sum + unsupported[i]);
    }
    unsupported[32] = sum;
    check(encoder.begin(
              {unsupported.data(), unsupported.size()},
              {48000U, jr200::CassetteDataBaud::Baud2400,
                  jr200::wav::kDefaultAmplitude}).error ==
              jr200::wav::Error::UnsupportedCjr,
          "unknown CJR types are not silently rendered");
}

}  // namespace

int main()
{
    try {
        test_rational_resampling();
        std::cout << "PASS WAV: shared phase at 44.1/48 kHz and 600/2400 baud\n";
        test_errors();
        std::cout << "PASS WAV: canonical RIFF PCM and explicit input errors\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "FAIL " << error.what() << '\n';
        return 1;
    }
}
