# JR-200 Web Emulator

JR-200の日本向けモデルを、手元のROMとフォントを使ってブラウザ上で動かす非公式エミュレータです。画面表示、物理キーボードと画面上の仮想キーボード、音声、CJRカセットの読み書き、WAV変換を1つのローカルWeb画面から利用できます。

選択したファイルは外部へ送信しません。ROM、メーカー由来フォント、ソフトウェア、録音データは、このリポジトリにもWeb配布物にも含まれていません。

> **現在の状態**
>
> - 非公開の開発版（バージョン0.0.1）です。公開サイトやインストーラーはなく、利用するにはローカルビルドが必要です。
> - 権利確認済みの実ROM／フォントを使い、Chrome、Firefox、SafariでBASICの起動と入力を確認しています。
> - CJRとWAVの変換機能は実装済みですが、このエミュレータで生成したWAVを物理JR-200で読み込む往復試験はまだ行っていません。実機互換を確認済みとは扱わないでください。

## できること

| 用途 | 内容 |
|---|---|
| JR-200を動かす | JR BASIC 5.0の起動、320×224画面、物理キーボード操作、ROMの字形を使う仮想キーボード |
| 音を出す | ブラウザ操作後にWeb Audioを開始し、音量調整とミュートが可能 |
| CJRを読み書きする | 標準BASIC形式CJRのLOAD/SAVE、標準マシン語形式CJRのMLOAD/MSAVE |
| CJRとWAVを変換する | 検証済みのCJRからWAVを作成し、対応形式の録音WAVから検証済みのCJRを復元 |
| BINをCJRにする | 連続した1領域のBINデータを標準CJRへ格納 |
| 状態を調べる | レジスタ、メモリ、ブレークポイント、ウォッチポイント、固定長履歴を表示 |

## 利用前の準備

### JR-200を起動する場合

利用者自身が権利を確認した、次のファイルが必要です。

| ファイル | サイズ | 条件 |
|---|---:|---|
| 結合ROM | 16,384バイト | ROM1（`$A000–$BFFF`）の後にROM2（`$E000–$FFFF`）を連結 |
| ROM1 / ROM2 | 各8,192バイト | 結合ROMの代わりに2ファイルを個別選択可能 |
| フォント | 2,048バイト | JR-200の文字フォント |

#### 実機からROMとフォントを吸い出す

実機から用意する場合は、移植元の[VJR-200公式ページ「準備編」](https://find-jr200.github.io/vjr200.html)を参照してください。自身が所有し、利用権を確認できる実機のデータだけを扱います。

JR BASICで次の3本を個別に`MSAVE`し、それぞれのカセット出力を別のWAVファイルとして録音します。

```text
MSAVE "ROM1",$A000,$BFFF
MSAVE "ROM2",$E000,$FFFF
MSAVE "FONT",$D000,$D7FF
```

録音後は[JR2Rescue](https://find-jr200.github.io/jr2rescue.html)で各WAVを読み込み、出力形式に`BIN`を選びます。`CJR`のままではROM／フォント入力として使えません。変換後にROM1とROM2が各8,192バイト、フォントが2,048バイトであることを確認してください。

このリポジトリの[コマンドラインツール](#コマンドラインツール)を使う場合は、WAVを検証済みCJRへ復元してから、生のBINデータを取り出します。

```sh
./build/native/cjrtool wav-decode input.wav output.cjr
./build/native/cjrtool extract output.cjr output.bin
```

ROM1とROM2はWeb画面で別々に選べます。1つの結合ROMにする場合は、必ずROM1→ROM2の順にバイナリ連結し、結果が16,384バイトであることを確認します。

ROMとフォントは起動時にサイズ、内容、RESETベクタを検査します。ファイルの入手や再配布は、このプロジェクトの対象外です。

ROMとフォントが必要なのはJR-200を起動する場合です。CJRの検査やCJR／WAV変換だけなら必要ありません。

### ローカルビルド

ローカルビルドには、次のツールが必要です。

- Git
- Python 3.10以降
- CMake 3.20以降
- make
- Node.js
- 有効化済みのEmscripten 6.0.9（`emcc`と`emcmake`）

`make wasm`はEmscriptenのバージョンを検査し、6.0.9以外では停止します。

## ブラウザで起動する

```sh
git clone https://github.com/zabaglione/jr200-web-emulator.git
cd jr200-web-emulator
emcc --version
make wasm
make serve
```

ブラウザで [http://127.0.0.1:8000](http://127.0.0.1:8000) を開きます。`make serve`はビルドを行わないため、初回またはソース更新後は先に`make wasm`を実行してください。サーバーを止めるときは、実行中のターミナルで`Ctrl+C`を押します。

### JR-200を起動する

1. 画面右側の「ROM・フォント」を開き、結合ROM、またはROM1とROM2を選びます。
2. 2,048バイトのフォントを選びます。
3. ファイルの検査結果を確認し、上部の「起動」を押します。
4. JR-200画面をクリックしてから、物理キーボードまたは画面上の仮想キーボードで操作します。
5. 音が必要な場合だけ「音声ON」を押します。初期音量は20%、上限は50%です。

仮想キーボードは、読み込んだフォントと文字RAMの字形を表示します。英数、カナ、GRAPH、SHIFT、CTRLに対応しています。ブラウザがフォーカスを失うと、押下中のキーを解放し、CPUと音声を自動で一時停止します。

## カセットとファイル変換

### CJRをJR-200で読み込む

1. 「カセット」で標準CJRを選び、「マウント」を押します。
2. BASIC形式ならJR BASICで`LOAD`、マシン語形式なら`MLOAD`を実行します。
3. 必要に応じて「巻戻し」または「取出し」を使います。

### JR-200からCJRへ保存する

1. 「新規録音を待機」を押します。
2. JR BASICで`SAVE`または`MSAVE`を実行します。
3. 録音の検証後、「録音CJRを保存」を押します。

### CJRとWAVを相互変換する

- **CJRからWAVへ:** 「CJR・WAV」でCJRを選び、検査に合格した後、サンプリングレートとデータ速度を選んで保存します。
- **WAVからCJRへ:** 録音WAVを選んで「WAVを解析」を押します。ブロックとチェックサムを含む全検証に合格した場合だけ、CJRを保存できます。

生成WAVは44.1 kHzまたは48 kHz、モノラル16-bit、600または2,400 baudです。WAV入力はリニアPCM（integer PCM）のモノラル／ステレオ、8/16-bit、22.05/44.1/48 kHzに対応します。ブラウザで読み込めるWAVは最大8 MiBです。圧縮WAV、float PCM、24/32-bit PCM、JR2、特殊ローダーには対応していません。

「標準CJRを作成」は既存のBINデータを格納する機能であり、BASICのテキストをトークナイズする機能ではありません。

## ファイルとプライバシー

- ROM、フォント、CJR、WAVはブラウザ内で処理し、外部サービスへ送信しません。
- ローカルサーバーは`127.0.0.1`にだけ接続し、`build/site`の静的ファイルを配信します。
- 選択したROMとフォントは、通常はページを閉じると残りません。
- 「このブラウザにROMとフォントを保存することを許可」を選んだ場合だけ、ブラウザのIndexedDBへ保存します。「保存済みファイルを削除」で消去できます。
- ROMや録音をリポジトリ内に置く必要はありません。作業上必要な場合はGit対象外の`local-assets/`を使い、コミット対象へ追加しないでください。

## 困ったとき

| 症状 | 確認すること |
|---|---|
| ページを開いてもWASMが起動しない | `file://`で直接開かず、`make wasm`の後に`make serve`を実行したか確認 |
| 「起動」が押せない | WASMの読込み完了、ROM形式、全ROM／フォントの選択状態を確認 |
| ROMが拒否される | ファイルサイズ、ROM1→ROM2の順序、RESETベクタ、空データでないことを確認 |
| 物理キーボードが反応しない | JR-200画面または仮想キーをクリックしてフォーカスを戻す |
| 音が出ない | 起動後に利用者操作で「音声ON」を押し、ミュートと音量を確認 |
| `make wasm`がバージョンエラーになる | Emscripten 6.0.9のSDK環境を有効化し、`emcc --version`を確認 |

## 対応範囲と未検証事項

標準のBASIC／マシン語CJR、通常のLOAD/MLOAD/SAVE/MSAVE、CJR検査、BIN包装、WAV生成・解析に対応しています。

次の項目は未対応、または未検証です。

- 生成WAVの物理JR-200でのLOAD/MLOADと、実機SAVE/MSAVEからの独立2回録音による往復確認
- PRINT#、INPUT#、特殊・連結CJR、JR2
- FDD、D20/D88、プリンタ、RS-232C
- JR-200U／JR-300の完全互換
- Web Audioのpanと、ブラウザから再生した物理音声出力の音圧測定
- 一般公開サイト、クラウド同期

実機WAV往復は[P12の試験計画](docs/HARDWARE_TEST_PLAN.md)に分離しており、合成データやエミュレータ内の自己往復を実機互換の証拠にはしていません。

## 確認済みの環境

2026年9月22日時点で、権利確認済みの実ROM／フォントによるJR BASIC 5.0の起動と入力を、Chrome 153、Firefox 156、Safari 26.6.2で確認しています。ChromeとSafariはmacOS、Firefoxは隔離コンテナ内のLinux版です。

これは各ブラウザでの動作確認であり、物理JR-200の映像、キーマトリクス、カセットWAV互換を保証するものではありません。詳しい条件は[ブラウザ受入記録](docs/P06_BROWSER_ACCEPTANCE.md)と[UI受入記録](docs/UI_ACCEPTANCE.md)を参照してください。

## コマンドラインツール

Web画面を使わずに、CJRの検査、コピー、抽出、作成、WAV変換を行える`cjrtool`も利用できます。

```sh
cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native --parallel
./build/native/cjrtool
```

引数なしでヘルプを表示します。WAV入力の上限は128 MiBです。既存出力は上書きせず、離れた複数アドレスを単純連結してBINへ変換する操作も拒否します。

## 開発者向け

```sh
make test
make sanitize
make wasm-smoke
make check
```

`make sanitize`にはClang、`make wasm-smoke`にはWASM対応Clang、`wasm-ld`、Node.jsが必要です。ブラウザ自動試験には[requirements-ci.txt](requirements-ci.txt)のPlaywright環境を使います。

現状と検証結果は、次の文書を正とします。

| 文書 | 内容 |
|---|---|
| [実装・検証状況](docs/STATUS.md) | 完了した機能と次の作業 |
| [テスト記録](docs/TEST_RESULTS.md) | 実行環境、コマンド、観測結果 |
| [CJR形式](docs/CJR_FORMAT.md) | 対応形式と制限 |
| [Issue対応表](docs/ISSUE_INDEX.md) | 計画IDとGitHub Issue番号 |
| [SOW](docs/SOW.md) | 目的、範囲、受入条件 |
| [由来とライセンス](docs/UPSTREAM.md) | 固定した上流、根拠、第三者コード台帳 |

ソースを追加・削除した場合は`python3 scripts/update_manifest.py`と`make check`を実行してください。ROM、フォント、録音、トークンがある作業ディレクトリで`git add .`を実行しないでください。Pages、公開デプロイ、ROMを含むartifact uploadは構成していません。

## ライセンスと謝辞

本プロジェクトで新しく作成した部分のライセンスは[BSD-3-Clause](LICENSE)です。VJR-200由来部分とMAME MC6800由来部分の著作権表示・ライセンスは、[第三者表記](THIRD_PARTY_NOTICES.md)、[VJR-200ライセンス](LICENSES/VJR200.txt)、[MAME BSD-3-Clause](LICENSES/MAME_BSD-3-Clause.txt)、[SPDX 2.3 SBOM](SBOM.spdx.json)に記録しています。

本プロジェクトは非公式の独立プロジェクトであり、VJR-200作者・貢献者・メーカーによる公認や推薦を意味しません。元エミュレータのライセンスは、ROM、メーカー由来フォント、市販ソフトの再配布許可ではありません。
