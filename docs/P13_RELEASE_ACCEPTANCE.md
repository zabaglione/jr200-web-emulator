# P13 配布監査・再現可能ビルド・private初版受入

確認日: 2026-09-22。対象versionは0.0.1、repositoryは
`zabaglione/jr200-web-emulator`、visibilityはprivateである。一般公開、GitHub Pages、
GitHub Release、ROM/メーカー由来フォント/商用テープ/利用者録音の配布は対象外である。

## 受入境界の変更

P12の物理JR-200 WAV往復試験は初版後へ延期した。P13はP11へ直接依存し、P00〜P11で
合格した機能をprivate初版として監査する。生成WAVの実機読込、物理出力level/cable、
BASIC LIST/RUN、machine-code RAM比較、独立2回録音は未検証のままであり、P12（Issue #13）を
openで残す。P13の完了は実機互換の合格を意味しない。

## 配布物・由来・SBOM

- `source-manifest.json`をGit tracked sourceの完全なallow-listとして扱い、Git管理対象との
  集合一致、重複、symlink、path traversal、ROM/tape/binary拡張子を自動検査する。
- `SBOM.spdx.json`はSPDX 2.3のpackage-level SBOMで、project 0.0.1、固定VJR-200 commit、
  固定MAME commit、CI専用Playwright 1.63.0とそのPython依存closureを記録する。
  `make sbom`で決定的に生成し、`make check`でstale状態を拒否する。
- FINDとMAMEのlicense原文blob、取込source内notice、Web footerからの全文・第三者表記・SBOM
  導線を検査する。Playwrightとbrowser downloadはCI専用で、配信siteへ含めない。
- `scripts/stage_web.py`は既存の`build/site`を作り直し、明示したWeb source、WASM backend、
  license、第三者表記、SBOMだけを配置する。`local-assets`を参照・複製しない。

## 固定依存と実行要件

| 対象 | 条件・固定値 | 配布への含有 |
|---|---|---|
| C++ | C++20 | sourceのみ |
| CMake | 3.20以上 | build tool、非同梱 |
| Python | 3.10以上 | test/staging tool、非同梱 |
| Node.js | WASM smokeで使用 | test tool、非同梱 |
| Emscripten | `.emscripten-version`の6.0.9 | build tool、非同梱 |
| Playwright Python | 1.63.0。pyee 13.0.1、greenlet 3.5.6、typing-extensions 4.16.0も固定 | CI test専用、非同梱 |
| Chromium | Playwright 1.63.0に対応するrevision | CI test専用、非同梱 |
| GitHub checkout action | commit `3d3c42e5aac5ba805825da76410c181273ba90b1` | CI action、非同梱 |

ここでの「再現可能」はfresh cloneから同じ手順でbuild/testできることを指し、生成binaryの
bit単位一致やhermetic buildを意味しない。Emscriptenとbrowser test依存は固定しているが、
GitHub hosted runnerのOS、system Clang、CMake、Node.jsは更新され得る。

## Issue証拠対応

| 計画 | 状態 | 主な証拠 |
|---|---|---|
| P00 | 受入済み | `UPSTREAM.md`、`THIRD_PARTY_NOTICES.md`、license blob guard |
| P01 | 受入済み | `TEST_RESULTS.md`、native/sanitizer/WASM CI |
| P02 | 受入済み | `CJR_FORMAT.md`、CJR native/WASM/CLI tests |
| P03 | 受入済み | `P03_REFERENCE_RESULTS.md` |
| P04 | 受入済み | `P04_CPU_AUDIT.md` |
| P05 | 受入済み | `P05_PERIPHERAL_AUDIT.md` |
| P06 | 受入済み | `P06_BROWSER_ACCEPTANCE.md` |
| P07 | 受入済み | `P07_DEBUGGER_ACCEPTANCE.md` |
| P08 | 受入済み | `P08_CASSETTE_ACCEPTANCE.md` |
| P09 | 受入済み | `P09_AUDIO_ACCEPTANCE.md` |
| P10 | 受入済み | `P10_WAV_ACCEPTANCE.md` |
| P11 | 受入済み | `P11_WAV_DECODE_ACCEPTANCE.md` |
| P12 | 初版後へ延期・open | `HARDWARE_TEST_PLAN.md`。物理往復は未実施 |
| P13 | 受入済み | 本文書、実装head `dff63ed`、Actions run `35675108809` |

## 検証記録

2026-09-22、P13候補treeに対して次を実行した。

```sh
make check
make test
make sanitize
make wasm-smoke
make wasm
CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  /private/tmp/jr200-p13-playwright/bin/python tests/browser_smoke.py
python3 -m py_compile scripts/*.py tests/*.py
node --check web/app.mjs
node --check web/audio.mjs
node --check web/codec.mjs
```

- source inventoryはGit indexの109ファイルと完全一致し、P12準備物と`local-assets`を含まない。
- nativeとASan/UBSanは各CTest 9/9成功。直接WASMは7系統すべて成功。
- Emscripten 6.0.9の正式moduleを生成し、Node smokeと13ファイルのstaged site生成に成功。
  siteは216 KiBで、許可したWeb/notice/SBOM/WASM以外を含まず、ROM/tape/recording拡張子は0件。
- Playwright 1.63.0とChrome 153.0.8010.53でbrowser smokeに成功。合成ROM起動、Web Audio、
  debugger、cassette、CJR/WAV encode/decode、downloadを操作し、外部requestは0件だった。
- ローカル環境はCMake 4.4.3、Apple Clang 21.0.0、Python 3.14.7、Node.js 26.8.2、
  Emscripten 6.0.9、Git 2.55.0。これはCI runnerのversion固定を意味しない。
- GitHub APIでrepositoryはprivate、Actions artifactは0件、release listは空、Pages APIは
  HTTP 404だった。Pages作成、visibility変更、release作成は行っていない。

実装はcommit `723454ac4a7b6214b8152a4b0a5fe81120968330`へまとめ、workflowのYAMLで
引用されていない末尾コロンをcommit `dff63edd501b8f4598718283ec93fe4338c73c60`で修正した。
最初のActions run `35674971686`はworkflow構文エラーでjob 0件のfailureであり、受入証拠に
使っていない。

remote `main`の`dff63ed`を`/private/tmp`配下へ新規cloneし、既存project buildを使わずに
次を実行した。

```sh
make test
make wasm-smoke
make wasm
make check
```

fresh cloneのnativeはCTest 9/9、直接WASMは7系統、Emscripten 6.0.9正式moduleとNode
smoke、配布監査はすべて成功し、試験後もtracked sourceはcleanだった。

同じheadに対するGitHub Actions run
[`35675108809`](https://github.com/zabaglione/jr200-web-emulator/actions/runs/35675108809)は
次の5ジョブすべてsuccessだった。

| ジョブ | 結果 |
|---|---|
| native (ubuntu-latest) | `make test` success |
| native (macos-latest) | `make test` success |
| sanitized | `make sanitize` success |
| wasm-codec | `make wasm-smoke` success |
| browser-smoke | pinned Python依存、Playwright Chromium、WASM build、UI smoke success |

browser jobではPlaywright 1.63.0とChromium 152.0.7977.0を実行し、合成ROM、Web Audio、
cassette、debugger、CJR/WAV tools、download、外部request 0件を確認した。

以上によりP13は受入完了とする。P12の物理実機試験はこの判定に含めず、Issue #13を
openのまま残す。

## 残る未対応・未検証

- 生成WAVのJR-200実機互換と実機SAVE/MSAVEの独立2録音はP12で未検証。
- Web Audioの物理出力音圧・pan、実機register/timingは未計測。
- FDD、printer、RS-232C、JR-200U/JR-300完全互換、JR2、特殊loader、PRINT#/INPUT#は
  初版対象外または未対応。
- private初版であり、一般利用者向け公開、Pages、公開releaseの監査は実施していない。
