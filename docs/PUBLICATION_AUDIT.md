# 公開前検査記録

初回検査日: 2026-09-23。対象は既存の`zabaglione/jr200-web-emulator`をprivateからpublicへ変更する場合に公開される範囲である。可視性の変更は別途明示された許可のもとで行う。この初回記録はGitHub Pagesの公開や物理JR-200での互換性を認定しない。

## 検査時点の判定

以下はcommit前の観測であり、その後のGit状態を表さない。検査時点の`main`と`origin/main`はともに`81e4174c550e20e166b0431b4235ba3b7650da76`で、直近の機能と文書には未コミットの変更があった。公開切替の前に、それらを含む公開候補commitを確定し、そのSHAのremote CIを確認する必要がある。

## 調べた範囲と結果

| 範囲 | 観測結果 |
|---|---|
| GitHubの設定 | `gh repo view`でprivate、既定ブランチ`main`。Pagesなし、Releaseなし、Actions artifact 0件、deployment 0件、PR 0件、tag 0件 |
| Git履歴と現在のソース候補 | 7参照、29 commit、463個の一意なblobと作業ツリーを確認。ROM、フォント、録音、画像・archive、既知形式の認証情報、私的なホームパスの公開阻害候補は検出されなかった。全commitのauthor／committerと現在の設定はGitHub noreplyアドレス |
| Git対象外の利用者データ | `local-assets/`、`build/`、`.venv/`はGit ignore対象。`source-manifest.json`はソースの明示的な一覧として検査する |
| 第三者コード | FINDとMAMEのライセンス全文が記録済みの上流blobと一致。CPU、周辺、テープ、キーボードの由来表示を確認。WAVファイルの列挙とJR2Rescue調査記録を本検査で補正した |
| Issueとコメント | 全20 Issue（openはP12のみ）と21コメントを対象に、既知のcredential形式、個人の絶対パス、`local-assets`言及を確認。`local-assets`はGit対象外との説明のみ |
| Actions | 全27実行を列挙。26実行の取得可能なログで既知のcredential形式、個人のホームパス、`local-assets`への参照候補は検出されなかった。残る失敗run 1件はjob 0件でログがない。最新のremote `main`に対するrun `35686194708`はsuccess |
| 変更後のローカル検査 | `make test`と`make sanitize`はそれぞれ10/10、`make wasm-smoke`、Emscripten 6.0.9での`make wasm`、Chrome 153での`make browser-smoke`、`make check`はすべてpass。図解5点もレンダリングして表示を確認。公開候補commitのremote CIは未実施 |

ここでいう「検出されなかった」は上記の対象とパターンに限る。GitHubはprivateリポジトリをpublicにするとコードだけでなくActionsの履歴とログも一般閲覧可能にすると[説明している](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)。

## 公開候補を確定するための条件

1. 追加・変更したソースと文書だけを明示的にGitへ登録し、ROM、フォント、CJR、WAV、録音、ビルド出力を含めない。`source-manifest.json`と登録済みファイルの一致を確認する。
2. 候補SHAで`make test`、`make sanitize`、`make wasm-smoke`、正式Emscriptenの`make wasm`、`make browser-smoke`、`make check`を確認する。ローカルの成功をremote CIの成功と混同しない。
3. 候補をremote `main`へ反映した後、そのSHAのActions全ジョブと公開対象のsource/配布物を再確認する。公開前の対象SHAが変わった場合は差分を再監査する。
4. 最後に明示許可を確認してGitHubの可視性を変更する。これはGitHub Pagesの設定変更やROM・録音の配布を意味しない。

P12の物理JR-200とWAVの往復検証は未完了のまま明示し、CJR検査やブラウザ内でのMLOAD試験をその代用にしない。
