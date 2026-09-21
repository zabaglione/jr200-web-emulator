# 実装・検証状況
基準日: 2026-09-21 / 初期パッケージ0.0.1

## リポジトリ初期設定

対象: `zabaglione/jr200-web-emulator`（private）、既定ブランチ `main`。
利用者が作成した空リポジトリに、ソース・開発文書・ライセンス・CI設定を登録する。P00〜P13は実際のIssue #1〜#14として登録済み。対応と依存関係は [ISSUE_INDEX.md](ISSUE_INDEX.md) を参照する。

CI設定とCI成功は別である。remote実行結果は [Actions](https://github.com/zabaglione/jr200-web-emulator/actions) で確認する。初期設定時のローカル再試験では `make test` (3/3)、`make sanitize` (3/3)、`make wasm-smoke` (WASM+JSラッパー) が成功した。旧bootstrapスクリプトによる新規作成は実行していない。

GitHubの可視性・アクセス権・branch protection・課金設定の変更は行わない。Pagesや外部サイトへのデプロイは含まない。全Issueは受入レビューが終わるまでopenを維持する。

## ローカルで実装した範囲

P00: 基準commit、CJR由来、FINDライセンス原文を固定。元licenseのGit blob SHA一致をチェック。CPU等の未取込部分を監査完了と表示しない。

P01: C++20共通ライブラリ、容量付きC ABI、ネイティブ/Clang直接WASM、CMake/Make、sanitizer、CI設定。正式なEmscripten実行ゲートはP06。remote CIの受入はP13。

P02: CJRヘッダー/データ/フッター/チェックサム検査、元バイト保持コピー、BIN包装、CLI、WASMのローカル検査画面。標準形式の合成goldenと境界・破損入力を検査する。BASICソースのトークナイズ機能ではない。

実行したテストと結果は[TEST_RESULTS.md](TEST_RESULTS.md)に記録する。Issueの受入レビューや独立対照の代わりにはしない。

## 未実装・未検証

P03のWindows基準実装との独立比較は未実施。P04以降のCPU・MN1271/MN1544/CRTC、BASIC起動、デバッガ、カセット統合、音声、CJR↔WAV、実機往復は未実装/未実施。

ROMとメーカー由来フォントは未提供・未同梱。実機所有と録再生環境も未確認。いまのWebページはCJR検査ツールであり、JR-200をエミュレートしていない。

Emscripten用の設定はあるが、この環境にはemcc/emcmakeがないため実行していない。Clang直接WASMの成功をEmscripten成功に読み替えない。macOS/Windows/Safari/Firefoxでの実行は今回未確認。ChromiumのHTTPページ操作試験も環境のアクセス制限で開始できず、Web画面は動作確認未完了である。

## 次に進む条件

リポジトリは作成済みのため旧bootstrapの再実行は不要。P00〜P02の証拠をレビュー後、P03の既存Windows実装による対照fixture・期待結果を用意する。その合格を経てCPU移植へ進む。自己往復一致だけでCJR既存互換や実機互換を宣言しない。
