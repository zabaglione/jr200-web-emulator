# P03 JR2Rescue 0.6.2 独立対照結果

実施日: 2026-09-22。検体はすべて自作の合成データであり、メーカーROM、フォント、商用テープ、ユーザー録音を含まない。生成CJR/WAV/JR2と参照実行ファイルは一時領域だけに置き、Gitには登録していない。

## 基準実装と実行環境

- 基準実装: JR2Rescue 0.6.2、assembly version `0.6.2.0`
- 上流commit: `8f14894706443288bb9838a28f4e828b7ee551b8`
- 上流: <https://github.com/find-jr200/JR2Rescue/tree/8f14894706443288bb9838a28f4e828b7ee551b8>
- ZIP: <https://raw.githubusercontent.com/find-jr200/JR2Rescue/8f14894706443288bb9838a28f4e828b7ee551b8/JR2Rescue0_6_2.zip>
- 上流Git blob SHA-1: `f4d30bc17808181ff27b8e6eafc4142042540b8b`
- ZIP SHA-256: `8de2bc6b3ff40cf032bec6f0d26f11ef0edcdafb9fffdc4de9d8c4056e10f483`
- `JR2Rescue.exe` SHA-256: `aadbf4f219faec9f7568d227fc324b62362cb1d80251885f0498d64e64be85a4`
- 実行環境: Ubuntu 24.04 arm64の使い捨てコンテナ、Mono 6.8.0.105、Xvfb

ZIPは上流commitを固定したraw URLから取得し、SHA-256を照合した。公式説明に従って`ja`ディレクトリを外し、英語UIで操作した。これはWindows向け基準バイナリそのものによる結果だが、ネイティブWindows上の実行ではない。

## 標準MSAVEとBASIC

JR2Rescueの`etc`画面で、開始アドレス`7000`、全バイト`00`のBINをCJR化した。本コーデックでも同じ名前・開始アドレス・ペイロードから作成し、`cmp`で全バイト一致を確認した。

| ペイロード長 | CJR長 | JR2Rescue出力 SHA-256 | 本コーデック出力 |
|---:|---:|---|---|
| 1 | 47 | `d641acbfc7b4ca25c14e6e15fe4feaac7c94d903283f54e1fb545e912fcf127c` | 全バイト一致 |
| 255 | 301 | `0cf06caf41534fa48d439ea8507e16db304c73fa3284bafc46147d92eecca041` | 全バイト一致 |
| 256 | 302 | `1f67c184a1445b5bf3eee7f8a1bb8d4ec8bc8ff311387cf3a0d4ad982ade7741` | 全バイト一致 |
| 257 | 310 | `cd3a43f09c4e651b584d3825bf1e9c4506f996bdbf7b3d5b96874a251f36acca` | 全バイト一致 |
| 512 | 565 | `6b5acdfce73cec42432c2f25d73b0d2d5c778a503335626c58e8f3a286257c68` | 全バイト一致 |

BASICは、64 KiBの自作メモリイメージの`0801`から`08 07 00 0A 80 00 00 00 00`を置いてJR2Rescueで変換した。55バイトのCJRはSHA-256 `8787f7033a2cd929e885251c176d1d7f31ac7fae2786bd4e2718535a5d5fc188`で、本コーデックが抽出した9バイトを`--basic`で再包装した結果と全バイト一致した。

## 相互読込と600 baud差分

本コーデックが作った257バイトMSAVE CJRをJR2RescueでWAV化し、そのWAVをJR2RescueでCJRへ戻した。WAVは22,050 Hz、8-bit、mono PCMである。

| 指定 | WAV長 | WAV SHA-256 | 復元CJR |
|---|---:|---|---|
| 2400 baud | 72,345 bytes / 3.278957 s | `8010f6cfc18812fdab6bab37a9bf326dba5fbe02c012abe073c3881dca9f91b0` | 入力CJRと全バイト一致 |
| 600 baud | 162,084 bytes / 7.348753 s | `4284ddd292126045647fec1013ed1526650c67081b4a49a2a818f35cc2d62b3a` | ペイロード・領域一致、ヘッダー2バイトだけ相違 |

2400 baud復元CJRのSHA-256は入力と同じ`cd3a43f...`である。600 baud復元CJRのSHA-256は`710141f1679956971caeb0de05ba3ffbe3a821b78d8bd89385b1cb55e67530a6`だった。相違はゼロ起算オフセット23のbaud生値`00`→`64`（10進100）と、それに伴うオフセット32のヘッダーチェックサムだけである。

上流readerは従来どおり`0`を2400、非0を600として扱う。本コーデックは任意の生値を読み込み・無変更保存する。一方、新規writerの600 baud規約はJR2Rescueの実出力に合わせて`100`へ変更した。既存の値`1`を拒否・正規化はしない。

## マルチ領域とヘッダーなし

- マルチ領域: 本コーデックが作った`7000`の1バイトと`C000`の16バイトをJR2Rescueの`MultiCJR`で結合した。70バイト、SHA-256 `97da60bfaae1956fc84e45f4a39761f1c73a8c2805ca61fd23d5ae569d4c13dd`。本コーデックは2領域・合計17バイトとして解析し、`noncontiguous_addresses`を報告して無変更コピーした。
- ヘッダーなし: 257バイトMSAVEから先頭33バイトを除いた277バイト、SHA-256 `e876040b59b226fb255435004793bfaaf78f464ab1ea9b06c77f22e3835f9a01`を使用した。本コーデックは既定で拒否し、`--allow-headerless`時だけ2データブロックとして受理した。JR2Rescueの`CJRtoJR2`で`Overwrite BaudRate Byte`を外すと2,567バイトのJR2（SHA-256 `989c12ddd8d4da9b307301fe054b161fe435edc375411d7ef6d216322fa8cec6`）を生成でき、基準実装側でも読めることを確認した。

## 実行した確認

- `cjrtool inspect`でヘッダー、形式、baud生値、ブロック数、ペイロード長、先頭/末尾アドレス、警告を確認
- `cjrtool copy`と`cmp`でJR2Rescue出力の無変更保存を確認
- `cjrtool extract`と`pack`で標準MSAVE/BASICを再構成し、`cmp`で比較
- `shasum -a 256`で各一時検体を固定
- `file`と`ffprobe`でWAV形式、サンプルレート、量子化、チャンネル数、長さを確認

## 証明していないこと

ネイティブWindowsでの同一結果、VJR-200による読込、JR-200実機でのLOAD/MLOAD/SAVE/MSAVE、実機録音の復号、JR2形式の自前実装は未確認または未実装である。JR2Rescue内のCJR→WAV→CJR往復だけを実機互換の証拠にはしない。特殊ローダーや未知ヘッダー値の網羅も主張しない。
