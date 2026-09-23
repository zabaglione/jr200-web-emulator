# Development rules for this repository

Read docs/STATUS.md, docs/SOW.md, docs/UPSTREAM.md and the next open plan item before editing.
The ordered plan is docs/issues/manifest.json (P00 through P13). These are plan IDs, not assumed GitHub issue numbers. Actual remote numbers and URLs are in docs/ISSUE_INDEX.md.
The canonical repository is zabaglione/jr200-web-emulator. It already exists: do not run the legacy bootstrap --execute to initialize it again.

1. Never claim repository creation, issue creation, CI execution, emulator boot or hardware success without a real result. A prepared script or local test is not a remote action.
2. Never commit manufacturer ROM/font files, commercial tapes, user recordings or tokens. Private visibility is not a rights exemption. Stage the explicit source inventory, not the entire working directory.
3. Retain per-file provenance, copyright and full license texts. Before importing m6800/6800ops/6800tbl or other upstream files, audit their own notices; FIND's license alone is insufficient for every dependency.
4. Keep CPU/device/tape code OS-independent and shared by native and WASM. Do not port Win32/DirectSound/Direct2D UI code by adding empty stubs that pretend to work.
5. Keep CJR raw data, logical blocks, serial framing, waveform timing and PCM encoding separate. Preserve sparse addresses and unknown header bytes. Do not overwrite baud without explicit conversion intent.
6. Memory injection is an optional shortcut, not evidence for LOAD/SAVE cassette operation. Synthetic self-roundtrip is not evidence for real-machine interchange.
7. Run make test, make sanitize, make wasm-smoke and the browser smoke test where available. Record unavailable test environments explicitly. The Emscripten build is a separate gate until actually run.
8. For every issue, include code, tests, commands and observed results. Close only when all acceptance criteria are met. Do not silently skip a blocked dependency.
9. No Pages/deployment/public visibility changes without a separate explicit user request. No automatic copying of local-assets into build outputs.
10. After changing source paths, regenerate source-manifest.json with scripts/update_manifest.py. Keep build outputs and recordings outside the manifest.
