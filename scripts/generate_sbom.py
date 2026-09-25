#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Generate the deterministic SPDX 2.3 package SBOM for release 0.0.1."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from game_assets import validate_assets


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "SBOM.spdx.json"
VERSION = "0.0.1"
VJR_COMMIT = "dd748995bede57da5baebc1225c7a33433aa6934"
MAME_COMMIT = "9940645188b6749e170b62c0ea86af0f440148da"
EMSCRIPTEN_VERSION = "6.0.9"
PLAYWRIGHT_VERSION = "1.63.0"
PYEE_VERSION = "13.0.1"
GREENLET_VERSION = "3.5.6"
TYPING_EXTENSIONS_VERSION = "4.16.0"


def document() -> dict[str, object]:
    find_license = (ROOT / "LICENSES/VJR200.txt").read_text()
    result = {
        "spdxVersion": "SPDX-2.3",
        "dataLicense": "CC0-1.0",
        "SPDXID": "SPDXRef-DOCUMENT",
        "name": f"jr200-web-emulator-{VERSION}",
        "documentNamespace": (
            "https://github.com/zabaglione/jr200-web-emulator/"
            f"sbom/{VERSION}"
        ),
        "creationInfo": {
            "created": "2026-09-22T00:00:00Z",
            "creators": ["Tool: scripts/generate_sbom.py"],
        },
        "documentDescribes": ["SPDXRef-Package-jr200-web-emulator"],
        "packages": [
            {
                "name": "jr200-web-emulator",
                "SPDXID": "SPDXRef-Package-jr200-web-emulator",
                "versionInfo": VERSION,
                "downloadLocation": "NOASSERTION",
                "filesAnalyzed": False,
                "licenseConcluded": "BSD-3-Clause",
                "licenseDeclared": "BSD-3-Clause",
                "copyrightText": "Copyright (c) 2026 jr200-web contributors",
                "homepage": "https://github.com/zabaglione/jr200-web-emulator",
                "supplier": "Organization: jr200-web contributors",
            },
            {
                "name": "VJR200forWindows-derived portions",
                "SPDXID": "SPDXRef-Package-VJR200forWindows",
                "versionInfo": f"1.8.2 commit {VJR_COMMIT}",
                "downloadLocation": (
                    "git+https://github.com/find-jr200/"
                    f"VJR200forWindows.git@{VJR_COMMIT}"
                ),
                "filesAnalyzed": False,
                "licenseConcluded": "LicenseRef-FIND-VJR200",
                "licenseDeclared": "LicenseRef-FIND-VJR200",
                "copyrightText": "Copyright (c) 2017,2020 FIND",
                "supplier": "Person: FIND",
            },
            {
                "name": "MAME MC6800-derived portions",
                "SPDXID": "SPDXRef-Package-MAME-MC6800",
                "versionInfo": f"commit {MAME_COMMIT}",
                "downloadLocation": (
                    f"git+https://github.com/mamedev/mame.git@{MAME_COMMIT}"
                ),
                "filesAnalyzed": False,
                "licenseConcluded": "BSD-3-Clause",
                "licenseDeclared": "BSD-3-Clause",
                "copyrightText": "Copyright Aaron Giles and MAME contributors",
                "supplier": "Organization: MAME",
            },
            {
                "name": "Emscripten JavaScript runtime",
                "SPDXID": "SPDXRef-Package-Emscripten-Runtime",
                "versionInfo": EMSCRIPTEN_VERSION,
                "downloadLocation": (
                    "https://github.com/emscripten-core/emscripten/"
                    f"tree/{EMSCRIPTEN_VERSION}"
                ),
                "filesAnalyzed": False,
                "licenseConcluded": "MIT",
                "licenseDeclared": "MIT",
                "copyrightText": "Copyright 2010 The Emscripten Authors",
                "supplier": "Organization: Emscripten Authors",
                "primaryPackagePurpose": "LIBRARY",
            },
            {
                "name": "LLVM libc++abi linked runtime",
                "SPDXID": "SPDXRef-Package-LLVM-libcxxabi",
                "versionInfo": "Emscripten 6.0.9 bundled revision",
                "downloadLocation": (
                    "https://github.com/emscripten-core/emscripten/"
                    "tree/6.0.9/system/lib/libcxxabi"
                ),
                "filesAnalyzed": False,
                "licenseConcluded": "Apache-2.0 WITH LLVM-exception",
                "licenseDeclared": "Apache-2.0 WITH LLVM-exception",
                "copyrightText": "Copyright (c) 2009-2019 libc++abi contributors",
                "supplier": "Organization: LLVM Project",
                "primaryPackagePurpose": "LIBRARY",
            },
            {
                "name": "playwright",
                "SPDXID": "SPDXRef-Package-Playwright-Python",
                "versionInfo": PLAYWRIGHT_VERSION,
                "downloadLocation": (
                    "https://pypi.org/project/"
                    f"playwright/{PLAYWRIGHT_VERSION}/"
                ),
                "filesAnalyzed": False,
                "licenseConcluded": "Apache-2.0",
                "licenseDeclared": "Apache-2.0",
                "copyrightText": "Copyright (c) Microsoft Corporation",
                "supplier": "Organization: Microsoft Corporation",
                "primaryPackagePurpose": "TEST",
            },
            {
                "name": "pyee",
                "SPDXID": "SPDXRef-Package-Pyee",
                "versionInfo": PYEE_VERSION,
                "downloadLocation": (
                    f"https://pypi.org/project/pyee/{PYEE_VERSION}/"
                ),
                "filesAnalyzed": False,
                "licenseConcluded": "MIT",
                "licenseDeclared": "MIT",
                "copyrightText": "NOASSERTION",
                "primaryPackagePurpose": "TEST",
            },
            {
                "name": "greenlet",
                "SPDXID": "SPDXRef-Package-Greenlet",
                "versionInfo": GREENLET_VERSION,
                "downloadLocation": (
                    f"https://pypi.org/project/greenlet/{GREENLET_VERSION}/"
                ),
                "filesAnalyzed": False,
                "licenseConcluded": "MIT AND PSF-2.0",
                "licenseDeclared": "MIT AND PSF-2.0",
                "copyrightText": "NOASSERTION",
                "primaryPackagePurpose": "TEST",
            },
            {
                "name": "typing-extensions",
                "SPDXID": "SPDXRef-Package-Typing-Extensions",
                "versionInfo": TYPING_EXTENSIONS_VERSION,
                "downloadLocation": (
                    "https://pypi.org/project/typing-extensions/"
                    f"{TYPING_EXTENSIONS_VERSION}/"
                ),
                "filesAnalyzed": False,
                "licenseConcluded": "PSF-2.0",
                "licenseDeclared": "PSF-2.0",
                "copyrightText": "NOASSERTION",
                "primaryPackagePurpose": "TEST",
            },
        ],
        "relationships": [
            {
                "spdxElementId": "SPDXRef-Package-jr200-web-emulator",
                "relationshipType": "VARIANT_OF",
                "relatedSpdxElement": "SPDXRef-Package-VJR200forWindows",
                "comment": "Only the audited portions listed in THIRD_PARTY_NOTICES.md are adapted.",
            },
            {
                "spdxElementId": "SPDXRef-Package-jr200-web-emulator",
                "relationshipType": "CONTAINS",
                "relatedSpdxElement": "SPDXRef-Package-MAME-MC6800",
                "comment": "Only the adapted MC6800 portions listed in THIRD_PARTY_NOTICES.md are included.",
            },
            {
                "spdxElementId": "SPDXRef-Package-jr200-web-emulator",
                "relationshipType": "CONTAINS",
                "relatedSpdxElement": "SPDXRef-Package-Emscripten-Runtime",
                "comment": "Generated JavaScript runtime in jr200_codec.mjs is distributed; the compiler toolchain is not.",
            },
            {
                "spdxElementId": "SPDXRef-Package-jr200-web-emulator",
                "relationshipType": "CONTAINS",
                "relatedSpdxElement": "SPDXRef-Package-LLVM-libcxxabi",
                "comment": "Linked libc++abi type information is included in jr200_codec.wasm.",
            },
            {
                "spdxElementId": "SPDXRef-Package-Playwright-Python",
                "relationshipType": "TEST_DEPENDENCY_OF",
                "relatedSpdxElement": "SPDXRef-Package-jr200-web-emulator",
                "comment": "CI-only browser test dependency; it is not shipped in the staged site.",
            },
            {
                "spdxElementId": "SPDXRef-Package-Pyee",
                "relationshipType": "DEPENDENCY_OF",
                "relatedSpdxElement": "SPDXRef-Package-Playwright-Python",
            },
            {
                "spdxElementId": "SPDXRef-Package-Greenlet",
                "relationshipType": "DEPENDENCY_OF",
                "relatedSpdxElement": "SPDXRef-Package-Playwright-Python",
            },
            {
                "spdxElementId": "SPDXRef-Package-Typing-Extensions",
                "relationshipType": "DEPENDENCY_OF",
                "relatedSpdxElement": "SPDXRef-Package-Pyee",
            },
        ],
        "hasExtractedLicensingInfos": [
            {
                "licenseId": "LicenseRef-FIND-VJR200",
                "name": "FIND VJR-200 license",
                "extractedText": find_license,
                "seeAlsos": [
                    "https://github.com/find-jr200/VJR200forWindows/"
                    f"blob/{VJR_COMMIT}/license_vjr200.txt"
                ],
            }
        ],
        "annotations": [
            {
                "annotationDate": "2026-09-22T00:00:00Z",
                "annotationType": "OTHER",
                "annotator": "Tool: scripts/generate_sbom.py",
                "comment": (
                    "Package-level SBOM for source and staged Web distribution. "
                    "Approved game CJR files are distributed with their license "
                    "and notices. Manufacturer ROM/font files, commercial tapes, "
                    "private recordings, JR2Rescue, and build toolchains are "
                    "not distributed components. "
                    "Emscripten-generated JavaScript and linked libc++abi "
                    "runtime are distributed."
                ),
            }
        ],
    }
    assets = validate_assets(ROOT / 'web')
    for name in sorted(assets):
        if not name.endswith('/EXPORT.json'):
            continue
        notice = json.loads(assets[name])
        ident = notice['id']
        version = notice['web_version']
        package_id = f'SPDXRef-Package-Game-{ident}-{version.replace(".", "-")}'
        result['packages'].append({
            'name': ident, 'SPDXID': package_id, 'versionInfo': version,
            'downloadLocation': 'NOASSERTION', 'filesAnalyzed': False,
            'licenseConcluded': (
                'MIT AND BSD-3-Clause' if notice['license'] == 'MIT'
                else notice['license']),
            'licenseDeclared': notice['license'],
            'copyrightText': 'See game LICENSE.txt',
            'primaryPackagePurpose': 'APPLICATION',
            'checksums': [{'algorithm': 'SHA256', 'checksumValue': notice['cjr_sha256']}],
        })
        result['relationships'].append({
            'spdxElementId': 'SPDXRef-Package-jr200-web-emulator',
            'relationshipType': 'CONTAINS', 'relatedSpdxElement': package_id,
            'comment': f'Approved immutable Web game {ident}/{version}.',
        })
    return result


def rendered() -> str:
    return json.dumps(document(), ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check", action="store_true", help="fail if SBOM.spdx.json is stale"
    )
    args = parser.parse_args()
    expected = rendered()
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_text() != expected:
            raise SystemExit("SBOM.spdx.json is stale; run make sbom")
        print("PASS SPDX SBOM is current")
        return 0
    OUTPUT.write_text(expected)
    print(f"Updated {OUTPUT.name} for {len(document()['packages'])} packages")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
