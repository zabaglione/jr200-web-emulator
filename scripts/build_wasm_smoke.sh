#!/usr/bin/env bash
# SPDX-License-Identifier: BSD-3-Clause
# Compile the allocation-free codec with Clang, without downloading an SDK.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -n "${WASM_CXX:-}" ]]; then
  CXX="$WASM_CXX"
elif [[ -x /opt/homebrew/opt/emscripten/libexec/llvm/bin/clang++ ]]; then
  CXX=/opt/homebrew/opt/emscripten/libexec/llvm/bin/clang++
else
  CXX=clang++
fi
command -v "$CXX" >/dev/null || { echo 'clang++ is required' >&2; exit 1; }
mkdir -p "$ROOT/build/wasm-smoke"
exports=(jr200_codec_api_version jr200_input_ptr jr200_output_ptr jr200_capacity
         jr200_output_size jr200_error_offset jr200_error_message jr200_inspect
         jr200_summary_field jr200_name_ptr jr200_encode jr200_cpu_api_version
         jr200_cpu_memory_ptr jr200_cpu_clear_memory jr200_cpu_set_wait
         jr200_cpu_reset jr200_cpu_set_registers jr200_cpu_set_irq
         jr200_cpu_pulse_nmi jr200_cpu_step jr200_cpu_register
         jr200_cpu_trace_field jr200_system_api_version jr200_system_clear
         jr200_system_rom_ptr jr200_system_rom_capacity
         jr200_system_font_ptr jr200_system_font_capacity
         jr200_system_boot jr200_system_reset jr200_system_run
         jr200_system_pulse_nmi
         jr200_system_cpu_reset jr200_system_cpu_step
         jr200_system_cpu_register jr200_system_cpu_trace_field
         jr200_system_debug_set_history jr200_system_debug_clear_history
         jr200_system_debug_add_breakpoint jr200_system_debug_remove_breakpoint
         jr200_system_debug_clear_breakpoints jr200_system_debug_breakpoint
         jr200_system_debug_add_watchpoint jr200_system_debug_remove_watchpoint
         jr200_system_debug_clear_watchpoints jr200_system_debug_watchpoint_field
         jr200_system_debug_resume jr200_system_debug_step
         jr200_system_debug_field jr200_system_debug_instruction_field
         jr200_system_debug_access_field
         jr200_system_read jr200_system_peek jr200_system_write
         jr200_system_poke jr200_system_tick jr200_system_set_key
         jr200_system_set_cassette_input jr200_system_field
         jr200_system_trace_field jr200_system_render
         jr200_system_framebuffer_ptr jr200_system_pcm_pop
         jr200_system_pcm_sample jr200_system_pcm_sample_rate
         jr200_system_pcm_capacity jr200_system_pcm_buffer_ptr
         jr200_system_pcm_drain jr200_system_pcm_discard
         jr200_system_pcm_dropped jr200_system_cassette_pop
         jr200_system_tape_input_ptr jr200_system_tape_capacity
         jr200_system_tape_mount jr200_system_tape_eject
         jr200_system_tape_rewind jr200_system_tape_arm_record
         jr200_system_tape_output_ptr jr200_system_tape_output_size
         jr200_system_tape_error_message jr200_system_tape_field
         jr200_wav_api_version jr200_wav_input_ptr
         jr200_wav_input_capacity jr200_wav_begin
         jr200_wav_header_ptr jr200_wav_header_size
         jr200_wav_pcm_ptr jr200_wav_pcm_capacity jr200_wav_drain
         jr200_wav_field jr200_wav_error_offset jr200_wav_error_message
         jr200_wav_decode_api_version jr200_wav_decode_input_ptr
         jr200_wav_decode_input_capacity jr200_wav_decode_output_ptr
         jr200_wav_decode_output_size jr200_wav_decode_run
         jr200_wav_decode_field jr200_wav_decode_error_frame_low
         jr200_wav_decode_error_frame_high jr200_wav_decode_error_offset
         jr200_wav_decode_error_detail jr200_wav_decode_error_message
         __wasm_call_ctors)
args=()
for symbol in "${exports[@]}"; do args+=("-Wl,--export=$symbol"); done
"$CXX" --target=wasm32 -std=c++20 -O2 -ffreestanding -fno-exceptions -fno-rtti \
  -fno-builtin -nostdlib -I"$ROOT/include" "$ROOT/src/tape/cjr.cpp" \
  "$ROOT/src/core/m6800.cpp" "$ROOT/src/core/debugger.cpp" \
  "$ROOT/src/core/peripherals.cpp" "$ROOT/src/tape/cassette.cpp" \
  "$ROOT/src/tape/wav.cpp" "$ROOT/src/tape/wav_decode.cpp" \
  "$ROOT/src/core/system.cpp" "$ROOT/src/wasm/api.cpp" \
  "$ROOT/src/wasm/cpu_api.cpp" "$ROOT/src/wasm/system_api.cpp" \
  "$ROOT/src/wasm/wav_api.cpp" "$ROOT/src/wasm/wav_decode_api.cpp" \
  "$ROOT/src/wasm/freestanding_memory.cpp" \
  -Wl,--no-entry -Wl,--export-memory -Wl,--initial-memory=33554432 \
  -Wl,--max-memory=33554432 "${args[@]}" -o "$ROOT/build/wasm-smoke/jr200_codec.wasm"
python3 "$ROOT/scripts/stage_web.py" --backend clang
node "$ROOT/tests/wasm_smoke.mjs" "$ROOT/build/wasm-smoke/jr200_codec.wasm"
node "$ROOT/tests/cpu_wasm_smoke.mjs" "$ROOT/build/wasm-smoke/jr200_codec.wasm"
node "$ROOT/tests/system_wasm_smoke.mjs" "$ROOT/build/wasm-smoke/jr200_codec.wasm"
node "$ROOT/tests/wrapper_smoke.mjs" "$ROOT/build/wasm-smoke/jr200_codec.wasm"
node "$ROOT/tests/audio_output_smoke.mjs"
node "$ROOT/tests/wav_wasm_smoke.mjs" "$ROOT/build/wasm-smoke/jr200_codec.wasm"
node "$ROOT/tests/wav_decode_wasm_smoke.mjs" "$ROOT/build/wasm-smoke/jr200_codec.wasm"
