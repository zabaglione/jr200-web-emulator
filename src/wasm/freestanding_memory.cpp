// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 jr200-web contributors
#include <stddef.h>
#include <stdint.h>

extern "C" {

void* memset(void* destination, int value, size_t size)
{
    auto* output = static_cast<volatile unsigned char*>(destination);
    const auto byte = static_cast<unsigned char>(value);
    for (size_t i = 0U; i < size; ++i) {
        output[i] = byte;
    }
    return destination;
}

void* memcpy(void* destination, const void* source, size_t size)
{
    auto* output = static_cast<volatile unsigned char*>(destination);
    const auto* input = static_cast<const volatile unsigned char*>(source);
    for (size_t i = 0U; i < size; ++i) {
        output[i] = input[i];
    }
    return destination;
}

void* memmove(void* destination, const void* source, size_t size)
{
    auto* output = static_cast<volatile unsigned char*>(destination);
    const auto* input = static_cast<const volatile unsigned char*>(source);
    const uintptr_t output_address = reinterpret_cast<uintptr_t>(destination);
    const uintptr_t input_address = reinterpret_cast<uintptr_t>(source);
    if (output_address < input_address) {
        for (size_t i = 0U; i < size; ++i) {
            output[i] = input[i];
        }
    } else if (output_address > input_address) {
        for (size_t i = size; i != 0U; --i) {
            output[i - 1U] = input[i - 1U];
        }
    }
    return destination;
}

}  // extern "C"
