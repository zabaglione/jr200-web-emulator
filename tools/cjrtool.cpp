// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 jr200-web contributors
#include "jr200/cjr.hpp"
#include "jr200/wav.hpp"
#include <array>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
using namespace jr200::cjr;
namespace {
std::vector<uint8_t> read_file(const std::string& path) {
    std::ifstream stream(path, std::ios::binary | std::ios::ate);
    if (!stream) throw std::runtime_error("cannot open input: " + path);
    const auto size = stream.tellg();
    if (size < 0 || static_cast<unsigned long long>(size) > kMaxInput)
        throw std::runtime_error("input is unreadable or exceeds 1 MiB");
    std::vector<uint8_t> bytes(static_cast<size_t>(size));
    stream.seekg(0);
    if (!bytes.empty() && !stream.read(reinterpret_cast<char*>(bytes.data()), size))
        throw std::runtime_error("failed to read complete input");
    return bytes;
}
void write_file(const std::string& path, const std::vector<uint8_t>& bytes) {
    if (std::filesystem::exists(path)) throw std::runtime_error("refusing to overwrite: " + path);
    std::ofstream stream(path, std::ios::binary);
    if (!stream || !stream.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size())))
        throw std::runtime_error("failed to write output: " + path);
}
void write_wave_file(const std::string& path, jr200::wav::Encoder& encoder) {
    if (std::filesystem::exists(path)) throw std::runtime_error("refusing to overwrite: " + path);
    std::array<uint8_t, jr200::wav::kHeaderSize> header{};
    const jr200::wav::Result header_result = encoder.write_header({header.data(), header.size()});
    if (!header_result) throw std::runtime_error(jr200::wav::error_message(header_result.error));
    std::ofstream stream(path, std::ios::binary);
    if (!stream || !stream.write(reinterpret_cast<const char*>(header.data()),
                                  static_cast<std::streamsize>(header.size())))
        throw std::runtime_error("failed to write WAV header: " + path);
    std::array<int16_t, 4096U> samples{};
    std::array<uint8_t, 8192U> bytes{};
    while (!encoder.finished()) {
        const size_t count = encoder.drain(samples.data(), samples.size());
        if (count == 0U) throw std::runtime_error("WAV encoder stopped before completion");
        for (size_t i = 0U; i < count; ++i) {
            const uint16_t sample = static_cast<uint16_t>(samples[i]);
            bytes[i * 2U] = static_cast<uint8_t>(sample);
            bytes[i * 2U + 1U] = static_cast<uint8_t>(sample >> 8U);
        }
        if (!stream.write(reinterpret_cast<const char*>(bytes.data()),
                          static_cast<std::streamsize>(count * 2U)))
            throw std::runtime_error("failed to write complete WAV: " + path);
    }
}
void require(Result result) {
    if (!result) throw std::runtime_error(std::string(error_message(result.error)) + " at byte " + std::to_string(result.offset));
}
Bytes view(const std::vector<uint8_t>& v) { return {v.data(), v.size()}; }
void append_data(const Block& b, void* context) {
    if (b.kind == Kind::data) {
        auto& out = *static_cast<std::vector<uint8_t>*>(context);
        out.insert(out.end(), b.payload.data, b.payload.data + b.payload.size);
    }
}
}
int main(int argc, char** argv) {
    try {
        if (argc < 3) {
            std::cerr << "Usage:\n  cjrtool inspect file.cjr [--allow-headerless]\n"
                      << "  cjrtool copy in.cjr out.cjr [--allow-headerless]\n"
                      << "  cjrtool extract in.cjr out.bin [--allow-headerless]\n"
                      << "  cjrtool pack in.bin out.cjr NAME address_hex [--basic] [--600]\n"
                      << "  cjrtool wav in.cjr out.wav [--rate 44100|48000] [--600|--2400]\n";
            return 2;
        }
        const std::string command = argv[1];
        auto input = read_file(argv[2]);
        if (command == "pack") {
            if (argc < 6) throw std::runtime_error("pack requires input, output, name, address_hex");
            bool basic = false; uint8_t baud = kBaudFlag2400;
            for (int i = 6; i < argc; ++i) {
                const std::string flag = argv[i];
                if (flag == "--basic") basic = true;
                else if (flag == "--600") baud = kBaudFlag600;
                else throw std::runtime_error("unknown pack option: " + flag);
            }
            size_t consumed = 0;
            const std::string address_text = argv[5];
            const unsigned long address = std::stoul(address_text, &consumed, 16);
            if (address_text.empty() || address_text[0] == '-' || consumed != address_text.size() || address > 65535)
                throw std::runtime_error("address must be a 16-bit hexadecimal value");
            const std::string name = argv[4];
            Bytes filename{reinterpret_cast<const uint8_t*>(name.data()), name.size()};
            size_t size = 0;
            auto result = encode_binary(filename, view(input), uint16_t(address), basic, baud, {nullptr, 0}, size);
            if (result.error != Error::output_too_small) require(result);
            std::vector<uint8_t> output(size);
            require(encode_binary(filename, view(input), uint16_t(address), basic, baud, {output.data(), output.size()}, size));
            write_file(argv[3], output);
            std::cout << "Wrote " << size << " bytes. Hardware compatibility is not yet verified.\n";
            return 0;
        }
        if (command == "wav") {
            if (argc < 4) throw std::runtime_error("wav requires input and output paths");
            jr200::wav::Options options{};
            bool baud_selected = false;
            for (int i = 4; i < argc; ++i) {
                const std::string flag = argv[i];
                if (flag == "--600") {
                    if (baud_selected) throw std::runtime_error("choose only one data baud");
                    options.data_baud = jr200::CassetteDataBaud::Baud600;
                    baud_selected = true;
                } else if (flag == "--2400") {
                    if (baud_selected) throw std::runtime_error("choose only one data baud");
                    options.data_baud = jr200::CassetteDataBaud::Baud2400;
                    baud_selected = true;
                } else if (flag == "--rate") {
                    if (++i >= argc) throw std::runtime_error("--rate requires 44100 or 48000");
                    const std::string value = argv[i];
                    if (value == "44100") options.sample_rate = 44100U;
                    else if (value == "48000") options.sample_rate = 48000U;
                    else throw std::runtime_error("--rate requires 44100 or 48000");
                } else {
                    throw std::runtime_error("unknown wav option: " + flag);
                }
            }
            jr200::wav::Encoder encoder;
            const jr200::wav::Result result = encoder.begin(view(input), options);
            if (!result) throw std::runtime_error(jr200::wav::error_message(result.error));
            const jr200::wav::Info info = encoder.info();
            write_wave_file(argv[3], encoder);
            std::cout << "Wrote " << info.total_bytes << " bytes, "
                      << info.pcm_samples << " samples, " << info.sample_rate
                      << " Hz, mono 16-bit, " << info.data_baud
                      << " baud. Hardware compatibility is not yet verified.\n";
            return 0;
        }
        if (command != "inspect" && command != "copy" && command != "extract")
            throw std::runtime_error("unknown command: " + command);
        const int required = command == "inspect" ? 3 : 4;
        if (argc < required || argc > required + 1) throw std::runtime_error("invalid number of arguments");
        Options options{};
        if (argc == required + 1) {
            if (std::string(argv[required]) != "--allow-headerless") throw std::runtime_error("unknown option");
            options.allow_headerless = true;
        }
        Summary summary{};
        require(inspect(view(input), summary, options));
        if (command == "inspect") {
            std::cout << "header=" << summary.has_header << " type=" << unsigned(summary.file_type)
                      << " baud_flag=" << unsigned(summary.baud_flag) << " blocks=" << summary.data_blocks
                      << " payload_bytes=" << summary.payload_bytes << " first=0x" << std::hex
                      << summary.first_address << " footer=0x" << summary.footer_address
                      << " warnings=0x" << summary.warnings << '\n';
        } else if (command == "copy") {
            std::vector<uint8_t> output(input.size()); size_t size = 0;
            require(copy_verified(view(input), {output.data(), output.size()}, size, options));
            write_file(argv[3], output);
        } else {
            if (!summary.data_blocks) throw std::runtime_error("no data to extract");
            if (summary.warnings & Warning::noncontiguous_addresses)
                throw std::runtime_error("sparse or overlapping CJR: refusing to flatten addresses into a BIN");
            std::vector<uint8_t> output; output.reserve(summary.payload_bytes);
            require(visit(view(input), append_data, &output, options));
            write_file(argv[3], output);
        }
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "error: " << e.what() << '\n';
        return 1;
    }
}
