// SPDX-License-Identifier: BSD-3-Clause
// CJR layout derived from FIND's CjrFormat.cpp. See LICENSES/VJR200.txt.
// Copyright (c) 2017,2020 FIND
// Copyright (c) 2026 jr200-web contributors
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace jr200::cjr {
// The core deliberately needs no OS, allocator, exceptions or standard library.
struct Bytes { const uint8_t* data; size_t size; };
struct MutableBytes { uint8_t* data; size_t size; };
constexpr size_t kMaxInput = 1024 * 1024;

enum class Error : uint32_t {
    ok = 0, null_buffer, input_too_large, truncated, bad_magic,
    unsupported_header, header_required, bad_checksum, bad_footer,
    missing_footer, trailing_data, address_overflow, empty_payload,
    name_too_long, too_many_blocks, output_too_small, bad_argument
};
struct Result {
    Error error = Error::ok;
    size_t offset = 0;
    constexpr explicit operator bool() const { return error == Error::ok; }
};
enum Warning : uint32_t {
    headerless = 1, nonsequential_blocks = 2, noncontiguous_addresses = 4,
    footer_address_differs = 8, unknown_file_type = 16,
    noncanonical_header_address = 32, no_data_blocks = 64
};
struct Summary {
    bool has_header = false;
    uint8_t file_type = 0;  // 0 BASIC, 1 machine code; other values preserved.
    uint8_t baud_flag = 0;  // Original byte; upstream interprets 0 as 2400, nonzero as 600.
    uint8_t name[16] = {};
    uint32_t data_blocks = 0;
    uint32_t payload_bytes = 0;
    uint16_t first_address = 0;
    uint16_t footer_address = 0;
    uint32_t last_end_exclusive = 0;  // Can be 65536, not silently wrapped.
    uint32_t warnings = 0;
};
struct Options { bool allow_headerless = false; };
enum class Kind { header, data, footer };
struct Block {
    Kind kind;
    uint8_t number;
    uint16_t address;
    size_t offset;
    Bytes encoded;  // Complete original bytes, including checksum if present.
    Bytes payload;
};
using Visitor = void (*)(const Block&, void*);

// On failure, `out` is unchanged. Input is always read-only.
Result inspect(Bytes input, Summary& out, Options options = {});
// Fully validates before issuing the first callback. Visitor must not modify input.
Result visit(Bytes input, Visitor visitor, void* context, Options options = {});
// Lossless serialized copy; does not rewrite header/baud/reserved bytes/checksum.
// Input and output must not overlap, except that identical pointers are permitted.
Result copy_verified(Bytes input, MutableBytes output, size_t& written, Options options = {});
// Creates a standard single-region CJR. BASIC is placed at $0801, per upstream.
// A null/zero output is a size query and returns output_too_small with `written` set.
// A failed call never writes a partial file. Buffers must not overlap.
Result encode_binary(Bytes name, Bytes payload, uint16_t address, bool basic,
                     uint8_t baud_flag, MutableBytes output, size_t& written);
const char* error_message(Error error);
} // namespace jr200::cjr
