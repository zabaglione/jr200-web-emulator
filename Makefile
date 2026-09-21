.PHONY: test sanitize wasm wasm-smoke serve check
# `make` remains the entry point; CMake builds the same native/WASM C++ core.
test:
	cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Debug
	cmake --build build/native --parallel
	ctest --test-dir build/native --output-on-failure
sanitize:
	cmake -S . -B build/sanitize -DCMAKE_CXX_COMPILER=clang++ -DCMAKE_BUILD_TYPE=Debug -DJR200_SANITIZE=ON
	cmake --build build/sanitize --parallel
	ctest --test-dir build/sanitize --output-on-failure
wasm:
	python3 scripts/check_emscripten_version.py
	EM_CACHE=$(CURDIR)/build/emcache emcmake cmake -S . -B build/emscripten -DCMAKE_BUILD_TYPE=Release
	EM_CACHE=$(CURDIR)/build/emcache cmake --build build/emscripten --parallel
	node tests/emscripten_smoke.mjs build/emscripten/web/jr200_codec.mjs
	python3 scripts/stage_web.py --backend emscripten
wasm-smoke:
	bash scripts/build_wasm_smoke.sh
serve:
	python3 -m http.server --bind 127.0.0.1 --directory build/site 8000
check:
	python3 scripts/check_distribution.py
