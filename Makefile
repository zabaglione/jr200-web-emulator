.PHONY: test sanitize wasm wasm-smoke browser-setup browser-smoke serve sbom check

BROWSER_VENV ?= .venv
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
$(BROWSER_VENV)/.playwright-ready: requirements-ci.txt
	python3 -m venv $(BROWSER_VENV)
	$(BROWSER_VENV)/bin/python -m pip install --disable-pip-version-check -r requirements-ci.txt
	touch $(BROWSER_VENV)/.playwright-ready
browser-setup: $(BROWSER_VENV)/.playwright-ready
browser-smoke: browser-setup
	$(BROWSER_VENV)/bin/python tests/browser_smoke.py
serve:
	python3 -m http.server --bind 127.0.0.1 --directory build/site 8000
sbom:
	python3 scripts/generate_sbom.py
check:
	python3 scripts/generate_sbom.py --check
	python3 scripts/check_distribution.py
	python3 -m unittest tests.test_game_export_contract
	python3 -m unittest tests.test_ci_change_scope
