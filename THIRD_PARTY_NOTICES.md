# Third-party notices

The CJR codec and cassette signal path in `include/jr200/cjr.hpp`,
`include/jr200/cassette.hpp`, `src/tape/cjr.cpp`, and
`src/tape/cassette.cpp` are derived from the published format, waveform, and
MN1271 integration code in `find-jr200/VJR200forWindows`, commit
`dd748995bede57da5baebc1225c7a33433aa6934`: `VJR200/CjrFormat.cpp`,
`VJR200/AnalyzeWave.cpp`, and the relevant `VJR200/Mn1271.cpp` behavior.

Copyright (c) 2017,2020 FIND. The complete applicable terms are preserved in
[LICENSES/VJR200.txt](LICENSES/VJR200.txt). The file is shipped with source and
with the staged WASM site, and is linked from the website footer.

The implementation was reorganized into allocation-free, bounds-checked C++
with caller-provided fixed storage. Windows file/UI code, direct memory-loading
shortcuts, cereal serialization, and unbounded intermediate vectors were not
ported. Standard BASIC and machine-code CJR use the normal emulated signal
path; special PRINT#/INPUT#, headerless, unknown-type, and concatenated streams
are rejected rather than represented as successful standard CJR operations.

The MC6800 CPU core in `include/jr200/m6800.hpp` and `src/core/` is adapted
from the BSD-3-Clause MAME MC6800 implementation by Aaron Giles and FIND's
VJR-200 adaptations at the commit above. The imported files retain their
SPDX identifier and copyright-holder comments. MAME commit
`9940645188b6749e170b62c0ea86af0f440148da` was used to confirm the current
file-level notice and license text. The complete BSD-3-Clause text from MAME
is preserved in [LICENSES/MAME_BSD-3-Clause.txt](LICENSES/MAME_BSD-3-Clause.txt).

The port replaces MAME device-framework dependencies and VJR-200's JRSystem,
Win32 debugger globals, UI callbacks, cereal state, peripheral ticking, and
endian-sensitive register union with a fixed-width CPU and explicit bus,
interrupt, and wait-state interfaces. No MAME disassembler or M6801-only
device implementation was imported.

The peripheral behavior in `include/jr200/peripherals.hpp`,
`src/core/peripherals.cpp`, and the address-map portion of
`src/core/system.cpp` is adapted from FIND's `Address`, `Mn1271`, `Mn1544`,
`Crtc`, and `JRSystem` files at the pinned VJR-200 commit above. The complete
applicable terms remain in [LICENSES/VJR200.txt](LICENSES/VJR200.txt).

The port removes DirectSound, Direct2D, Win32 input and file APIs, OpenSL ES,
cereal, global host timing, printer, and FDD coupling. It exposes an explicit
cycle clock, fixed PCM queue, ARGB framebuffer, translated key-state input,
and side-effect-free debug peek. These interfaces do not establish physical
MN1271/MN1544/CRTC accuracy.

No X88000 code, cereal, TinyXML-2, manufacturer ROM, manufacturer font data,
commercial tape image, user recording, JR2Rescue binary, or JR2WAV Editor
binary is included. Any later import requires an updated per-file license
inventory and all relevant notices; FIND's license alone is not a substitute
for those third-party notices.

Playwright for Python 1.63.0 and its pinned Python dependency closure are
CI-only test dependencies. They and the browser download are not copied into
the staged Web distribution. Package versions, licenses, relationships, and
pinned source references are recorded in [SBOM.spdx.json](SBOM.spdx.json).

This independent derivative is not endorsed by the VJR-200 author,
contributors, or the JR-200 manufacturer. Provenance attribution is not an
endorsement claim.
