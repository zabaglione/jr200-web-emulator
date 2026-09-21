// SPDX-License-Identifier: BSD-3-Clause
// Format/layout derived from VJR200/CjrFormat.cpp by FIND, pinned in docs/UPSTREAM.md.
// Copyright (c) 2017,2020 FIND
// Copyright (c) 2026 jr200-web contributors
#include "jr200/cjr.hpp"
namespace jr200::cjr {
namespace {
uint16_t be16(const uint8_t* p) { return uint16_t((uint16_t(p[0]) << 8) | p[1]); }
uint8_t checksum(const uint8_t* p, size_t n) {
    uint8_t value = 0;
    for (size_t i = 0; i < n; ++i) value = uint8_t(value + p[i]);
    return value;
}
Result fail(Error e, size_t p) { return {e, p}; }
void copy(uint8_t* dst, const uint8_t* src, size_t n) {
    for (size_t i = 0; i < n; ++i) dst[i] = src[i];
}
}
Result inspect(Bytes input, Summary& out, Options options) {
    if (!input.data && input.size) return fail(Error::null_buffer, 0);
    if (input.size > kMaxInput) return fail(Error::input_too_large, 0);
    if (input.size < 6) return fail(Error::truncated, input.size);
    Summary next{};
    size_t pos = 0;
    uint32_t expected_number = 1;
    while (pos < input.size) {
        if (input.size - pos < 6) return fail(Error::truncated, pos);
        const uint8_t* p = input.data + pos;
        if (p[0] != 0x02 || p[1] != 0x2a) return fail(Error::bad_magic, pos);
        const uint8_t number = p[2];
        if (number == 0xff) {
            if (p[3] != 0xff) return fail(Error::bad_footer, pos + 3);
            if (pos == 0 && !options.allow_headerless) return fail(Error::header_required, pos);
            if (!next.has_header) next.warnings |= Warning::headerless;
            if (input.size - pos != 6) return fail(Error::trailing_data, pos + 6);
            next.footer_address = be16(p + 4);
            if (!next.data_blocks) next.warnings |= Warning::no_data_blocks;
            if (next.data_blocks && next.footer_address != uint16_t(next.last_end_exclusive))
                next.warnings |= Warning::footer_address_differs;
            out = next;
            return {};
        }
        const bool header = number == 0;
        if (header && (pos != 0 || p[3] != 0x1a)) return fail(Error::unsupported_header, pos);
        if (!header && pos == 0) {
            if (!options.allow_headerless) return fail(Error::header_required, pos);
            next.warnings |= Warning::headerless;
        }
        const size_t size = p[3] ? p[3] : 256;
        const size_t encoded_size = size + 7;
        if (input.size - pos < encoded_size) return fail(Error::truncated, pos);
        if (checksum(p, encoded_size - 1) != p[encoded_size - 1])
            return fail(Error::bad_checksum, pos + encoded_size - 1);
        const uint16_t address = be16(p + 4);
        if (header) {
            next.has_header = true;
            copy(next.name, p + 6, 16);
            next.file_type = p[22];
            next.baud_flag = p[23];
            if (address != 0xffff) next.warnings |= Warning::noncanonical_header_address;
            if (next.file_type > 1) next.warnings |= Warning::unknown_file_type;
        } else {
            if (uint32_t(address) + size > 65536u) return fail(Error::address_overflow, pos + 4);
            if (uint32_t(number) != expected_number) next.warnings |= Warning::nonsequential_blocks;
            expected_number = uint32_t(number) + 1;
            if (!next.data_blocks) next.first_address = address;
            else if (next.last_end_exclusive != address) next.warnings |= Warning::noncontiguous_addresses;
            next.last_end_exclusive = uint32_t(address) + uint32_t(size);
            ++next.data_blocks;
            next.payload_bytes += uint32_t(size);
        }
        pos += encoded_size;
    }
    return fail(Error::missing_footer, pos);
}
Result visit(Bytes input, Visitor visitor, void* context, Options options) {
    if (!visitor) return fail(Error::bad_argument, 0);
    Summary summary{};
    const Result checked = inspect(input, summary, options);
    if (!checked) return checked;
    size_t pos = 0;
    while (pos < input.size) {
        const uint8_t* p = input.data + pos;
        const bool footer = p[2] == 0xff;
        const size_t n = footer ? 0 : (p[3] ? p[3] : 256);
        const size_t encoded_size = footer ? 6 : n + 7;
        Block block{footer ? Kind::footer : (p[2] == 0 ? Kind::header : Kind::data),
                    p[2], be16(p + 4), pos, {p, encoded_size}, {p + 6, n}};
        visitor(block, context);
        pos += encoded_size;
    }
    return {};
}
Result copy_verified(Bytes input, MutableBytes output, size_t& written, Options options) {
    written = 0;
    Summary summary{};
    const Result result = inspect(input, summary, options);
    if (!result) return result;
    written = input.size;
    if (output.size < input.size) return fail(Error::output_too_small, 0);
    if (!output.data) return fail(Error::null_buffer, 0);
    copy(output.data, input.data, input.size);
    return {};
}
Result encode_binary(Bytes name, Bytes payload, uint16_t address, bool basic,
                     uint8_t baud_flag, MutableBytes output, size_t& written) {
    written = 0;
    if ((!name.data && name.size) || (!payload.data && payload.size)) return fail(Error::null_buffer, 0);
    if (name.size > 16) return fail(Error::name_too_long, 0);
    if (!payload.size) return fail(Error::empty_payload, 0);
    if (basic) address = 0x0801;
    if (payload.size > 65536u - uint32_t(address)) return fail(Error::address_overflow, 0);
    const size_t blocks = (payload.size + 255) / 256;
    if (blocks > 254) return fail(Error::too_many_blocks, 0);
    written = 33 + payload.size + 7 * blocks + 6;
    if (output.size < written) return fail(Error::output_too_small, 0);
    if (!output.data) return fail(Error::null_buffer, 0);
    uint8_t* out = output.data;
    out[0] = 2; out[1] = 0x2a; out[2] = 0; out[3] = 0x1a;
    out[4] = 0xff; out[5] = 0xff;
    for (size_t i = 0; i < 16; ++i) out[6 + i] = i < name.size ? name.data[i] : 0;
    out[22] = basic ? 0 : 1; out[23] = baud_flag;
    for (size_t i = 24; i < 32; ++i) out[i] = 0xff;
    out[32] = checksum(out, 32);
    size_t pos = 33, consumed = 0;
    for (size_t i = 0; i < blocks; ++i) {
        const size_t remaining = payload.size - consumed;
        const size_t n = remaining < 256 ? remaining : 256;
        const uint32_t start = uint32_t(address) + uint32_t(consumed);
        uint8_t* block = out + pos;
        block[0] = 2; block[1] = 0x2a; block[2] = uint8_t(i + 1);
        block[3] = uint8_t(n == 256 ? 0 : n);
        block[4] = uint8_t(start >> 8); block[5] = uint8_t(start);
        copy(block + 6, payload.data + consumed, n);
        block[6 + n] = checksum(block, 6 + n);
        consumed += n; pos += n + 7;
    }
    const uint32_t end = uint32_t(address) + uint32_t(payload.size);
    out[pos] = 2; out[pos + 1] = 0x2a; out[pos + 2] = 0xff; out[pos + 3] = 0xff;
    out[pos + 4] = uint8_t(end >> 8); out[pos + 5] = uint8_t(end);
    return {};
}
const char* error_message(Error error) {
    switch (error) {
    case Error::ok: return "ok";
    case Error::null_buffer: return "null buffer";
    case Error::input_too_large: return "input exceeds 1 MiB limit";
    case Error::truncated: return "truncated block";
    case Error::bad_magic: return "expected CJR magic 02 2A";
    case Error::unsupported_header: return "unsupported header layout or block 00 position";
    case Error::header_required: return "headerless CJR requires explicit opt-in";
    case Error::bad_checksum: return "block additive checksum mismatch";
    case Error::bad_footer: return "expected footer 02 2A FF FF addr_hi addr_lo";
    case Error::missing_footer: return "missing footer";
    case Error::trailing_data: return "trailing bytes or concatenated files are unsupported";
    case Error::address_overflow: return "data region exceeds 16-bit address space";
    case Error::empty_payload: return "empty BIN cannot be encoded";
    case Error::name_too_long: return "JR filename exceeds 16 raw bytes";
    case Error::too_many_blocks: return "standard writer allows at most 254 data blocks";
    case Error::output_too_small: return "output buffer is too small; required size returned";
    case Error::bad_argument: return "invalid argument";
    }
    return "unknown error";
}
} // namespace jr200::cjr
