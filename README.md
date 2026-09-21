# JR-200 Web Emulator

**状態: 開発計画とCJRコーデックの初期実装。JR-200エミュレータ本体はまだ動きません。**

VJR200forWindowsを基に、C++20→WebAssembly＋JavaScriptのJR-200 Webエミュレータを開発する計画です。CJR互換と、実機と往復するWAVを段階的に実装します。計画と現状を混同しないでください。

## 今回入っているもの

CJRの安全な検査、原バイト列を保持するコピー、連続領域のBIN→CJR包装、CLI、C++を実行するWASM版検査ページ、合成テスト、14件のIssue本文、private GitHub作成スクリプトです。

**入っていないもの:** CPU/周辺回路エミュレーション、BASIC起動、画面・音声、通常カセットLOAD/SAVE、WAVエンコーダ/デコーダ、ROM/メーカー由来フォント、実機互換の確認結果。

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

## WASM版CJR検査ページ

依存なしの初期コーデックはClangのWASMターゲットでも動作します。

```sh
make wasm-smoke   # clang++、wasm-ld、Node.jsが必要
make serve
# ブラウザで http://127.0.0.1:8000 を開く
```

CJR検査とBIN→標準CJR包装の画面を用意しています。WASM本体とJSラッパーはNode.jsで検証しましたが、ブラウザ試験はこの環境のHTTPアクセス制限で未完了です。入力ファイルはブラウザ内部のみで処理し、サーバーにはアップロードしません。ローカルHTTPサーバーは静的ファイルの配信だけを行います。

正式なエミュレータ移植はEmscriptenを使う計画です。Emscripten用設定も同梱していますが、**今回このルートは未実行**です。

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

## 開発の開始

このリポジトリは初期設定済みです。旧パッケージの新規作成用 `bootstrap_github.py --execute` は実行しないでください。通常のcloneから開始します。

```sh
git clone https://github.com/zabaglione/jr200-web-emulator.git
cd jr200-web-emulator
make test
make wasm-smoke
make serve
```

認証は通常のGitHub認証を使用し、トークンをソースやチャットへ記載しないでください。`AGENTS.md`、[現状](docs/STATUS.md)、[Issue一覧](docs/ISSUE_INDEX.md) の順に確認します。P00〜P02の初期実装を受入レビューし、P03の独立対照試験から後続開発へ進みます。計画IDと実Issue番号は別です。

ソースを追加・削除した後は `python3 scripts/update_manifest.py` と `make check` を実行し、`source-manifest.json` を確認してください。ROMや録音のある作業ディレクトリで `git add .` を実行しないでください。初期CIはnative Linux/macOS、sanitizer、Clang WASMを対象にします。Pages公開やROMを含むartifact uploadはありません。

## ライセンス

本プロジェクトの新規部分は[BSD-3-Clause](LICENSE)。FINDのCJR処理に基づく部分では著作権と[上流ライセンス全文](LICENSES/VJR200.txt)を保持します。[第三者表記](THIRD_PARTY_NOTICES.md)と[取込台帳](docs/UPSTREAM.md)も参照してください。

VJR-200作者・貢献者・メーカーによる公認や推薦を意味しません。元エミュレータのライセンスはROM、メーカー由来フォント、市販ソフトの再配布許可ではありません。privateであっても無条件に同梱しません。
