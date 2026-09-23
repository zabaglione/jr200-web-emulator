# GitHub Pagesでの公開

公開サイトの本体は、固定したEmscripten 6.0.9で`make wasm`を実行して得る`build/site`です。ソースの`web/`だけ、またはリポジトリのルートをPagesに指定しても動作しません。ROM、メーカー由来フォント、CJR、WAV、録音はサイトに含めません。

`.github/workflows/pages.yml`は、`main`の同じcommitに対する`source-and-codec` CIが全ジョブ成功した後だけ起動します。現在の`main`とcommitが一致しない古い成功結果は配信しません。private中はビルドと検査だけを行い、artifactのアップロードと配信はしません。publicではビルド後に`make check`を通し、`scripts/stage_web.py`が決めた静的ファイルだけをPages artifactとしてアップロードします。Pagesへの配信以外のActions artifactにはアプリや利用者ファイルを保存しません。

初回はリポジトリをpublicにした後、GitHubの「Settings → Pages → Build and deployment → Source」で「GitHub Actions」を選び、`source-and-codec` CIを`main`に対して手動実行します。以降は`main`へのpushでCIが成功した後に更新されます。想定URLは`https://zabaglione.github.io/jr200-web-emulator/`です。実際に使えるかどうかは、配信ジョブとURLへのアクセスで確認してください。

公開サイトでもROMとフォントは利用者が自分の端末から選びます。ブラウザへの保存を許可した場合だけ、そのサイトのIndexedDBに保存されます。ローカル版とPages版はURLのoriginが異なるため、保存済みROM・フォントやマクロは共有されません。初めてPages版を開くときは、権利を確認したファイルを改めて選んでください。

## 公開後の確認

1. `pages`のbuildとdeployが対象commitで両方successになっていることを確認する。
2. 公開URLで`index.html`、`backend.json`、`jr200_codec.mjs`、`jr200_codec.wasm`、ライセンス全文が読めることを確認する。
3. ROMなしでもWASMの準備完了を表示し、「起動済み」と誤表示しないことを確認する。権利確認済みのROMとフォントでのJR BASIC起動は、別の利用者操作として確認する。
4. 公開されたファイル一覧にROM、フォント、CJR、WAV、録音、`local-assets/`がないことを確認する。

P12の生成WAVと物理JR-200の往復は未検証です。Pages上で動作しても実機互換を立証したことにはなりません。問題があればPages設定から配信を停止できますが、リポジトリのpublic状態は別に管理してください。
