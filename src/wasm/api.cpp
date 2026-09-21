// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 jr200-web contributors
#include "jr200/cjr.hpp"
using namespace jr200::cjr;
namespace {
alignas(16) uint8_t input[kMaxInput];
alignas(16) uint8_t output[kMaxInput];
Summary last_summary{};
Result last_result{};
size_t last_written = 0;
}
extern "C" {
uint32_t jr200_codec_api_version() { return 1; }
uint8_t* jr200_input_ptr() { return input; }
uint8_t* jr200_output_ptr() { return output; }
uint32_t jr200_capacity() { return uint32_t(kMaxInput); }
uint32_t jr200_output_size() { return uint32_t(last_written); }
uint32_t jr200_error_offset() { return uint32_t(last_result.offset); }
const char* jr200_error_message() { return error_message(last_result.error); }
uint32_t jr200_inspect(uint32_t size, uint32_t allow_headerless) {
    last_summary = {}; last_written = 0;
    last_result = inspect({input, size}, last_summary, {allow_headerless != 0});
    return uint32_t(last_result.error);
}
// Stable numeric fields; avoid exposing compiler struct layout to JavaScript.
uint32_t jr200_summary_field(uint32_t field) {
    switch (field) {
    case 0: return last_summary.has_header;
    case 1: return last_summary.file_type;
    case 2: return last_summary.baud_flag;
    case 3: return last_summary.data_blocks;
    case 4: return last_summary.payload_bytes;
    case 5: return last_summary.first_address;
    case 6: return last_summary.footer_address;
    case 7: return last_summary.last_end_exclusive;
    case 8: return last_summary.warnings;
    default: return 0;
    }
}
const uint8_t* jr200_name_ptr() { return last_summary.name; }
// input[0..15] is the filename and input[16..16+size) is the payload.
uint32_t jr200_encode(uint32_t size, uint32_t name_size, uint32_t address,
                      uint32_t basic, uint32_t baud_flag) {
    last_written = 0; last_summary = {};
    if (size > kMaxInput - 16 || name_size > 16 || address > 65535 || basic > 1 || baud_flag > 255) {
        last_result = {Error::bad_argument, 0};
        return uint32_t(last_result.error);
    }
    last_result = encode_binary({input, name_size}, {input + 16, size}, uint16_t(address),
                                basic != 0, uint8_t(baud_flag), {output, kMaxInput}, last_written);
    return uint32_t(last_result.error);
}
}
