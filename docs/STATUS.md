# 実装・検証状況
基準日: 2026-09-21 / 初期パッケージ0.0.1

## リポジトリ初期設定：完了

対象: `zabaglione/jr200-web-emulator`（private）、既定ブランチ `main`。
初期ソース・開発文書・ライセンス・CI設定の57ファイルをcommit `072e977343c8aa7655367f926bc29b2b220e93e1` に登録した。Git tree `854042e76159dd80bebd9210387d567e2e1a37c8` が、ローカルで独立計算した全ファイルのtreeと一致した。

P00〜P13は実際のIssue #1〜#14として登録済み。対応と依存関係は [ISSUE_INDEX.md](ISSUE_INDEX.md)。受入レビュー前のため自動closeしていない。旧bootstrapによる新規作成は不要である。

## GitHub Actions：初回4ジョブ成功

対象commit: `072e977343c8aa7655367f926bc29b2b220e93e1`
実行: [source-and-codec / run 35616519996](https://github.com/zabaglione/jr200-web-emulator/actions/runs/35616519996)
トリガー: mainへのpush。GitHubから取得したstatusはcompleted、conclusionはsuccess。

| ジョブ | 実行内容 | 結果 |
|---|---|---|
| native (ubuntu-latest) | make test | success |
| native (macos-latest) | make test | success |
| sanitized | make sanitize | success |
| wasm-codec | make wasm-smoke | success |

ローカルでもmake testとmake sanitize各3/3、WASMとJSラッパー、make checkが成功。FINDライセンスの原文blob一致、配布表記、ソース限定inventoryも検査した。初期のローカル試験詳細は [TEST_RESULTS.md](TEST_RESULTS.md)。古い計画表のremote CI未実行という記述は、この実測結果で更新する。

## 実装済みの範囲

P00: 2026-09-22受入完了。上流commit・CJR由来・FINDライセンス原文を固定し、Emscripten配布物から全文へHTTP到達できることを確認。未取込のCPU等は監査対象外であり、監査済みではない。
P01: 2026-09-22受入完了。C++20共通ライブラリ、容量付きC ABI、native/Clang直接WASM、正式Emscripten、CMake/Make、sanitizer、4ジョブCIを確認。
P02: 2026-09-22受入完了。CJR構造/チェックサム検査、元バイト保持、BIN包装、CLI、WASM検査画面を合成データで確認。独立既存実装との互換はP03に残す。
P03: 2026-09-22受入完了。JR2Rescue 0.6.2の固定Windows向けバイナリをMono上で実行し、自作データの標準MSAVE/BASIC、境界長、600/2400、マルチ領域、headerlessを対照した。標準出力は全バイト一致し、600 baudの新規writer値を実測の100へ合わせた。

## 未実装・未検証

CPU・周辺回路、BASIC起動、デバッガ、通常カセット経路、音声、自前のCJR↔WAV、実機往復は未実装/未実施。P03の参照実装内WAV往復は、自前WAV実装や実機互換の証拠ではない。現在のWebページはCJR検査ツールであり、JR-200エミュレータ本体ではない。

Emscripten 6.0.9による正式ビルドと生成モジュールのNode起動は2026-09-22にローカル成功した。ブラウザ画面の自動操作試験は現在のPython環境にPlaywrightがなく未完了。Node起動、macOSのnative CI成功、HTTP取得をSafari等のブラウザ操作試験やBASIC起動成功には読み替えない。メーカーROM/フォント・商用ソフト・録音は未同梱。

## 次の作業

#1 (P00)〜#4 (P03) は受入完了。次に #5 (P04) のCPUコア・メモリバス移植へ進む。取込前に対象ファイル自身のライセンスを監査し、参照実装の一致を実機互換へ読み替えない。

privateは維持。Pages/外部公開デプロイ、アクセス権・branch protection・課金設定の変更は行っていない。
