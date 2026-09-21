# JR-200 Web Emulator

**状態: P06まで受入完了。ローカルROM/フォントによるJR BASIC 5.0の起動、Canvas表示、キーボード入力を確認済みです。**

VJR200forWindowsを基に、C++20→WebAssembly＋JavaScriptのJR-200 Webエミュレータを開発する計画です。CJR互換と、実機と往復するWAVを段階的に実装します。計画と現状を混同しないでください。

## 今回入っているもの

CJRの安全な検査、原バイト列を保持するコピー、連続領域のBIN→CJR包装、CLI、OS非依存のMC6800、MN1271/MN1544/CRTC、明示的メモリバスとcycle clock、PCMキュー、ARGBフレームバッファ、ローカルROM/フォント選択、Canvas表示、キーボード入力、ポーズ/リセット、native/WASM/ブラウザ試験、14件のIssue本文です。

**入っていないもの:** Web Audio接続、通常カセットLOAD/SAVE、WAVエンコーダ/デコーダ、ROM/メーカー由来フォント本体、実機互換の確認結果。ROM、フォント、録音は利用者のローカルファイルとしてのみ扱います。

リポジトリ: [zabaglione/jr200-web-emulator](https://github.com/zabaglione/jr200-web-emulator)（private）。開発順と実際のIssue番号は [Issue一覧](docs/ISSUE_INDEX.md) を参照してください。CIの結果は [Actions](https://github.com/zabaglione/jr200-web-emulator/actions) で確認できます。

## まず読む文書

| 文書 | 内容 |
|---|---|
| [SOW](docs/SOW.md) | 目的・範囲・成果物・受入条件 |
| [開発順序](docs/DEVELOPMENT_PLAN.md) | P00〜P13、依存関係、各Issue本文 |
| [現状](docs/STATUS.md) | 実装済みと未検証の境界 |
| [テスト記録](docs/TEST_RESULTS.md) | 実行環境・コマンド・実測結果 |
| [由来とライセンス](docs/UPSTREAM.md) | 固定commitと一次情報、第三者コード台帳 |
| [CJR形式](docs/CJR_FORMAT.md) | 公開コードに基づく形式と制限 |
| [実機試験計画](docs/HARDWARE_TEST_PLAN.md) | WAV往復の独立した検証方法 |
| [GitHub作成手順](docs/GITHUB_SETUP.md) | private確認・Issue登録・安全なpush |

## ローカルのネイティブ版

Python 3.10以降、CMake 3.20以降、C++20コンパイラ、makeが必要です。

```sh
make test
make sanitize    # clang++ と sanitizer が必要
./build/native/cjrtool
```

CLIは `inspect` / `copy` / `extract` / `pack` を持ちます。引数は引数なしのヘルプで確認できます。既存出力への上書きは拒否します。離れたアドレスのCJRを単純に連結してBINへ変換することも拒否します。

## WASM版Webエミュレータ

依存なしのCJRコーデック、MC6800、周辺回路コアはClangのWASMターゲットでも動作します。

```sh
make wasm-smoke   # clang++、wasm-ld、Node.jsが必要
make serve
# ブラウザで http://127.0.0.1:8000 を開く
```

結合ROMまたは分割ROMとフォントを選択してJR-200を起動でき、CJR検査とBIN→標準CJR包装も同じ画面から利用できます。通常は選択データを保持せず、チェックボックスで明示許可した場合だけIndexedDBへ保存します。入力ファイルはブラウザ内部のみで処理し、ローカルHTTPサーバーは静的ファイルの配信だけを行います。

Emscriptenは `.emscripten-version` の6.0.9へ固定し、CJR/CPU/周辺回路を含むmoduleの生成、Node.js起動、Chrome・Firefox・Safariでの実ROM起動を確認しています。詳細と未検証範囲は [P06ブラウザ受入記録](docs/P06_BROWSER_ACCEPTANCE.md) を参照してください。

```sh
# emsdk を導入・有効化済みの環境で
make wasm
make serve
```

任意のブラウザsmoke test:

```sh
# Playwrightを導入済み、使用するChromium実行ファイルを指定
CHROMIUM_EXECUTABLE=/path/to/chromium python3 tests/browser_smoke.py
```

権利確認済みのROM/フォントを使う任意試験には `tests/webdriver_real_rom_smoke.py` を利用できます。引数のファイルパスはWebDriver側から見える読み取り専用パスを指定し、検体自体はGitへ追加しないでください。

## 開発の開始

このリポジトリは初期設定済みです。旧パッケージの新規作成用 `bootstrap_github.py --execute` は実行しないでください。通常のcloneから開始します。

```sh
git clone https://github.com/zabaglione/jr200-web-emulator.git
cd jr200-web-emulator
make test
make wasm-smoke
make serve
```

認証は通常のGitHub認証を使用し、トークンをソースやチャットへ記載しないでください。`AGENTS.md`、[現状](docs/STATUS.md)、[Issue一覧](docs/ISSUE_INDEX.md) の順に確認します。完了済みIssueと次の作業はSTATUS.mdを正とします。計画IDと実Issue番号は別です。

ソースを追加・削除した後は `python3 scripts/update_manifest.py` と `make check` を実行し、`source-manifest.json` を確認してください。ROMや録音のある作業ディレクトリで `git add .` を実行しないでください。初期CIはnative Linux/macOS、sanitizer、Clang WASMを対象にします。Pages公開やROMを含むartifact uploadはありません。

## ライセンス

本プロジェクトの新規部分は[BSD-3-Clause](LICENSE)。FINDのCJR処理に基づく部分では著作権と[上流ライセンス全文](LICENSES/VJR200.txt)を、MAME由来のMC6800部分ではファイル内表示と[BSD-3-Clause全文](LICENSES/MAME_BSD-3-Clause.txt)を保持します。[第三者表記](THIRD_PARTY_NOTICES.md)と[取込台帳](docs/UPSTREAM.md)も参照してください。

VJR-200作者・貢献者・メーカーによる公認や推薦を意味しません。元エミュレータのライセンスはROM、メーカー由来フォント、市販ソフトの再配布許可ではありません。privateであっても無条件に同梱しません。
