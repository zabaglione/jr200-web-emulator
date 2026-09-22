// SPDX-License-Identifier: BSD-3-Clause
// All cassette data are synthetic. No manufacturer ROM, font or recording.
#include "jr200/wav.hpp"
#include "jr200/wav_decode.hpp"

#include <algorithm>
#include <array>
#include <cstring>
#include <iostream>
#include <sstream>
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
    if (!condition) throw std::runtime_error(message);
}

uint16_t read_u16(const uint8_t* input)
{
    return static_cast<uint16_t>(input[0] | static_cast<uint16_t>(input[1] << 8U));
}

uint32_t read_u32(const uint8_t* input)
{
    return static_cast<uint32_t>(input[0]) |
        (static_cast<uint32_t>(input[1]) << 8U) |
        (static_cast<uint32_t>(input[2]) << 16U) |
        (static_cast<uint32_t>(input[3]) << 24U);
}

void put_u16(uint8_t* output, size_t offset, uint16_t value)
{
    output[offset] = static_cast<uint8_t>(value);
    output[offset + 1U] = static_cast<uint8_t>(value >> 8U);
}

void put_u32(uint8_t* output, size_t offset, uint32_t value)
{
    output[offset] = static_cast<uint8_t>(value);
    output[offset + 1U] = static_cast<uint8_t>(value >> 8U);
    output[offset + 2U] = static_cast<uint8_t>(value >> 16U);
    output[offset + 3U] = static_cast<uint8_t>(value >> 24U);
}

int16_t pcm16(const uint8_t* input)
{
    const uint16_t raw = read_u16(input);
    return raw <= 32767U
        ? static_cast<int16_t>(raw)
        : static_cast<int16_t>(static_cast<int32_t>(raw) - 65536);
}

void store_pcm16(uint8_t* output, int32_t value)
{
    value = std::max(-32768, std::min(32767, value));
    const uint16_t raw = static_cast<uint16_t>(static_cast<int16_t>(value));
    output[0] = static_cast<uint8_t>(raw);
    output[1] = static_cast<uint8_t>(raw >> 8U);
}

std::vector<uint8_t> render(
    const Golden& input,
    uint32_t rate,
    jr200::CassetteDataBaud baud)
{
    jr200::wav::Encoder encoder;
    check(static_cast<bool>(encoder.begin(
              {input.data(), input.size()},
              {rate, baud, jr200::wav::kDefaultAmplitude})),
          "synthetic CJR starts WAV rendering");
    std::vector<uint8_t> output(static_cast<size_t>(encoder.info().total_bytes));
    check(static_cast<bool>(encoder.write_header({output.data(), 44U})),
          "WAV header is rendered");
    std::array<int16_t, 257U> pcm{};
    size_t offset = 44U;
    while (!encoder.finished()) {
        const size_t count = encoder.drain(pcm.data(), pcm.size());
        check(count > 0U, "WAV rendering advances");
        for (size_t i = 0U; i < count; ++i) {
            store_pcm16(output.data() + offset, pcm[i]);
            offset += 2U;
        }
    }
    check(offset == output.size(), "WAV rendering fills the measured size");
    return output;
}

jr200::wav::DecodeResult decode(
    const std::vector<uint8_t>& wav,
    std::vector<uint8_t>& candidate,
    size_t& written,
    jr200::wav::DecodeInfo& info,
    jr200::wav::DecodeOptions options = {})
{
    candidate.assign(jr200::cjr::kMaxInput, 0U);
    jr200::wav::Decoder decoder;
    const auto result = decoder.decode(
        {wav.data(), wav.size()},
        {candidate.data(), candidate.size()},
        written,
        options);
    info = decoder.info();
    candidate.resize(written);
    return result;
}

void check_matches(
    const std::vector<uint8_t>& wav,
    const Golden& source,
    const char* profile,
    jr200::wav::DecodeOptions options = {})
{
    std::vector<uint8_t> candidate;
    size_t written = 0U;
    jr200::wav::DecodeInfo info{};
    const auto result = decode(wav, candidate, written, info, options);
    if (!result || !info.verified) {
        std::ostringstream message;
        message << profile
                << ": WAV decodes only after complete CJR validation: error="
                << static_cast<uint32_t>(result.error)
                << " frame=" << result.frame
                << " cjr_offset=" << result.cjr_offset
                << " rate=" << info.sample_rate
                << " bits=" << info.bits_per_sample
                << " channels=" << info.channels;
        throw std::runtime_error(message.str());
    }
    check(written == source.size() &&
              std::equal(candidate.begin(), candidate.end(), source.begin()),
          "decoded CJR matches every source byte");
}

std::vector<uint8_t> add_odd_junk(const std::vector<uint8_t>& input)
{
    std::vector<uint8_t> output;
    output.insert(output.end(), input.begin(), input.begin() + 36);
    const uint8_t chunk[] = {'J','U','N','K',3,0,0,0,0xaa,0xbb,0xcc,0};
    output.insert(output.end(), std::begin(chunk), std::end(chunk));
    output.insert(output.end(), input.begin() + 36, input.end());
    put_u32(output.data(), 4U, static_cast<uint32_t>(output.size() - 8U));
    return output;
}

std::vector<uint8_t> stereo_left(const std::vector<uint8_t>& input)
{
    const uint32_t frames = read_u32(input.data() + 40U) / 2U;
    std::vector<uint8_t> output(44U + static_cast<size_t>(frames) * 4U);
    std::copy(input.begin(), input.begin() + 44, output.begin());
    put_u16(output.data(), 22U, 2U);
    put_u32(output.data(), 28U, read_u32(input.data() + 24U) * 4U);
    put_u16(output.data(), 32U, 4U);
    put_u32(output.data(), 40U, frames * 4U);
    put_u32(output.data(), 4U, static_cast<uint32_t>(output.size() - 8U));
    for (uint32_t frame = 0U; frame < frames; ++frame) {
        output[44U + frame * 4U] = input[44U + frame * 2U];
        output[45U + frame * 4U] = input[45U + frame * 2U];
        output[46U + frame * 4U] = 0U;
        output[47U + frame * 4U] = 0U;
    }
    return output;
}

std::vector<uint8_t> pcm8(const std::vector<uint8_t>& input)
{
    const uint32_t frames = read_u32(input.data() + 40U) / 2U;
    std::vector<uint8_t> output(44U + frames + (frames & 1U));
    std::copy(input.begin(), input.begin() + 44, output.begin());
    put_u32(output.data(), 28U, read_u32(input.data() + 24U));
    put_u16(output.data(), 32U, 1U);
    put_u16(output.data(), 34U, 8U);
    put_u32(output.data(), 40U, frames);
    put_u32(output.data(), 4U, static_cast<uint32_t>(output.size() - 8U));
    for (uint32_t frame = 0U; frame < frames; ++frame) {
        const int32_t sample = pcm16(input.data() + 44U + frame * 2U);
        output[44U + frame] = static_cast<uint8_t>((sample >> 8) + 128);
    }
    return output;
}

std::vector<uint8_t> half_rate(const std::vector<uint8_t>& input)
{
    const uint32_t source_frames = read_u32(input.data() + 40U) / 2U;
    const uint32_t frames = source_frames / 2U;
    std::vector<uint8_t> output(44U + static_cast<size_t>(frames) * 2U);
    std::copy(input.begin(), input.begin() + 44, output.begin());
    put_u32(output.data(), 24U, 22050U);
    put_u32(output.data(), 28U, 44100U);
    put_u32(output.data(), 40U, frames * 2U);
    put_u32(output.data(), 4U, static_cast<uint32_t>(output.size() - 8U));
    for (uint32_t frame = 0U; frame < frames; ++frame) {
        output[44U + frame * 2U] = input[44U + frame * 4U];
        output[45U + frame * 2U] = input[45U + frame * 4U];
    }
    return output;
}

std::vector<uint8_t> stretch(const std::vector<uint8_t>& input)
{
    const uint32_t source_frames = read_u32(input.data() + 40U) / 2U;
    const uint32_t frames = source_frames * 102U / 100U;
    std::vector<uint8_t> output(44U + static_cast<size_t>(frames) * 2U);
    std::copy(input.begin(), input.begin() + 44, output.begin());
    put_u32(output.data(), 40U, frames * 2U);
    put_u32(output.data(), 4U, static_cast<uint32_t>(output.size() - 8U));
    for (uint32_t frame = 0U; frame < frames; ++frame) {
        const uint32_t source = static_cast<uint32_t>(
            static_cast<uint64_t>(frame) * 100U / 102U);
        output[44U + frame * 2U] = input[44U + source * 2U];
        output[45U + frame * 2U] = input[45U + source * 2U];
    }
    return output;
}

void test_profiles_and_diagnostics()
{
    Golden fast = golden();
    Golden slow = fast;
    slow[23] = jr200::cjr::kBaudFlag600;
    uint8_t sum = 0U;
    for (size_t i = 0U; i < 32U; ++i) sum = static_cast<uint8_t>(sum + slow[i]);
    slow[32] = sum;

    const auto fast48 = render(fast, 48000U, jr200::CassetteDataBaud::Baud2400);
    const auto fast44 = render(fast, 44100U, jr200::CassetteDataBaud::Baud2400);
    const auto slow48 = render(slow, 48000U, jr200::CassetteDataBaud::Baud600);
    const auto slow44 = render(slow, 44100U, jr200::CassetteDataBaud::Baud600);
    check_matches(fast48, fast, "48 kHz / 2400 baud");
    check_matches(fast44, fast, "44.1 kHz / 2400 baud");
    check_matches(slow48, slow, "48 kHz / 600 baud");
    check_matches(slow44, slow, "44.1 kHz / 600 baud");
    check_matches(
        render(slow, 48000U, jr200::CassetteDataBaud::Baud2400),
        slow,
        "600 header flag with explicit 2400 baud waveform");
    check_matches(
        render(fast, 48000U, jr200::CassetteDataBaud::Baud600),
        fast,
        "2400 header flag with explicit 600 baud waveform");
    check_matches(add_odd_junk(fast48), fast, "odd-sized RIFF chunk");
    check_matches(pcm8(fast44), fast, "8-bit PCM");
    check_matches(half_rate(fast44), fast, "22.05 kHz PCM");
    check_matches(stretch(fast44), fast, "2 percent slow transport");

    auto inverted = fast48;
    for (size_t offset = 44U; offset < inverted.size(); offset += 2U) {
        store_pcm16(inverted.data() + offset, -pcm16(inverted.data() + offset));
    }
    check_matches(inverted, fast, "inverted polarity");

    const auto stereo = stereo_left(fast48);
    std::vector<uint8_t> candidate;
    size_t written = 0U;
    jr200::wav::DecodeInfo info{};
    const auto stereo_result = decode(stereo, candidate, written, info);
    check(static_cast<bool>(stereo_result) && info.channels == 2U &&
              info.selected_channel == 0U && info.channel_rms[0] > info.channel_rms[1],
          "stereo diagnostics select the stronger channel without downmix cancellation");
}

void test_rejections_and_candidate_boundary()
{
    const Golden source = golden();
    const auto valid = render(source, 48000U, jr200::CassetteDataBaud::Baud2400);
    std::vector<uint8_t> candidate;
    size_t written = 0U;
    jr200::wav::DecodeInfo info{};

    std::vector<uint8_t> silence(valid.size(), 0U);
    std::copy(valid.begin(), valid.begin() + 44, silence.begin());
    const auto silent = decode(silence, candidate, written, info);
    check(silent.error == jr200::wav::DecodeError::Silent && !info.verified,
          "silence never produces a verified CJR");

    auto cut = valid;
    cut.resize(44U + (valid.size() - 44U) / 2U);
    put_u32(cut.data(), 40U, static_cast<uint32_t>(cut.size() - 44U));
    put_u32(cut.data(), 4U, static_cast<uint32_t>(cut.size() - 8U));
    const auto truncated = decode(cut, candidate, written, info);
    check(!truncated && !info.verified,
          "structurally valid but cut cassette PCM does not report success");

    auto noise = valid;
    uint32_t random = 1U;
    for (size_t offset = 44U; offset < noise.size(); offset += 2U) {
        random = random * 1664525U + 1013904223U;
        store_pcm16(noise.data() + offset, static_cast<int32_t>((random >> 16U) & 0x1fffU) - 4096);
    }
    const auto noisy = decode(noise, candidate, written, info);
    check(!noisy && !info.verified, "noise never produces a verified CJR");

    auto bad_riff = valid;
    put_u32(bad_riff.data(), 4U, read_u32(bad_riff.data() + 4U) - 1U);
    check(decode(bad_riff, candidate, written, info).error ==
              jr200::wav::DecodeError::RiffSizeMismatch,
          "RIFF length mismatch is rejected before signal analysis");

    auto floating = valid;
    put_u16(floating.data(), 20U, 3U);
    check(decode(floating, candidate, written, info).error ==
              jr200::wav::DecodeError::UnsupportedPcm,
          "floating-point PCM is rejected explicitly");

    auto checksum = valid;
    constexpr size_t corrupt_frame = 15091U * 10U;
    for (size_t frame = corrupt_frame;
         44U + frame * 2U + 1U < checksum.size(); ++frame) {
        const size_t offset = 44U + frame * 2U;
        store_pcm16(checksum.data() + offset, -pcm16(checksum.data() + offset));
    }
    const auto mismatch = decode(checksum, candidate, written, info);
    check(mismatch.error == jr200::wav::DecodeError::ChecksumMismatch &&
              mismatch.cjr_offset == 40U && written == 41U && !info.verified,
          "checksum failure reports its candidate offset and never verifies output");
}

}  // namespace

int main()
{
    try {
        test_profiles_and_diagnostics();
        std::cout << "PASS WAV decode: RIFF chunks, 8/16-bit, mono/stereo, 22.05/44.1/48 kHz, polarity and speed\n";
        test_rejections_and_candidate_boundary();
        std::cout << "PASS WAV decode: silence, cut, noise, invalid RIFF/PCM and checksum candidate rejection\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "FAIL " << error.what() << '\n';
        return 1;
    }
}
