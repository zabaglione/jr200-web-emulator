# Third-party notices

The CJR codec in `include/jr200/cjr.hpp` and `src/tape/cjr.cpp` is derived from
the published format-handling code in `find-jr200/VJR200forWindows`,
commit `dd748995bede57da5baebc1225c7a33433aa6934`, `VJR200/CjrFormat.cpp`.

Copyright (c) 2017,2020 FIND. The complete applicable terms are preserved in
[LICENSES/VJR200.txt](LICENSES/VJR200.txt). The file is shipped with source and
with the staged WASM site, and is linked from the website footer.

The implementation was reorganized into an allocation-free, bounds-checked
C++ codec. Windows UI, direct memory-loading shortcuts, cereal serialization,
and waveform synthesis were not copied into this initial build.

No MAME CPU implementation, X88000 code, cereal, TinyXML-2, manufacturer ROM,
manufacturer font data, commercial tape image, JR2Rescue binary, or JR2WAV
Editor binary is included. Any later import requires an updated per-file
license inventory and all relevant notices; FIND's license alone is not a
substitute for those third-party notices.

This independent derivative is not endorsed by the VJR-200 author,
contributors, or the JR-200 manufacturer. Provenance attribution is not an
endorsement claim.
