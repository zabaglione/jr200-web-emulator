# GitHub初期設定と開発手順

対象: https://github.com/zabaglione/jr200-web-emulator （作成時はprivate）

利用者が作成した空リポジトリを2026-09-21に初期化する。実際のIssue番号と開発順は [ISSUE_INDEX.md](ISSUE_INDEX.md)、実装状況は [STATUS.md](STATUS.md) を参照する。

## cloneから開始

```sh
git clone https://github.com/zabaglione/jr200-web-emulator.git
cd jr200-web-emulator
make test
make sanitize
make wasm-smoke
make serve
```

`make sanitize` にはClang、`make wasm-smoke` にはClang/wasm-ld/Node.jsが必要。正式EmscriptenはSDKを有効化して `make wasm`。現段階ではEmscriptenの実行確認は別ゲートである。

## 作業ルール

まずAGENTS.mdとSTATUS.mdを読み、P00〜P13の依存順に着手する。初期実装の存在だけでIssueをcloseしない。受入条件に対応するテスト・commit・観測結果を記録する。必要な変更は作業ブランチからPull Requestにまとめる。

ソース追加・削除時は `python3 scripts/update_manifest.py` と `make check`。ROM、メーカー由来フォント、録音、商用テープ、秘密情報はコミットしない。リポジトリの可視性は利用者が別途管理し、Pagesや公開サイトへの自動デプロイは行わない。

## 旧bootstrapスクリプト

`scripts/bootstrap_github.py` は新規privateリポジトリを作成する旧パッケージ用ユーティリティとして保持する。既存の本リポジトリの更新には使用しない。既存リポジトリの採用・上書きを拒否する安全ガードを解除しない。普段の更新は通常のgitとPull Requestを使用する。

## CIと管理設定

`.github/workflows/ci.yml` はnative Linux/macOS、ASan/UBSan、Clang直接WASMの検査を行う。GitHub Actionsの実結果はActionsページで確認する。リポジトリの可視性、アクセス権、branch protection、課金設定は別の管理設定であり、初期ファイルの登録だけでそれらを変更したとは扱わない。
