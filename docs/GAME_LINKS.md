# 作品IDリンクとCJRセット

`https://zabaglione.github.io/jr200-web-emulator/?game=<id>` は、JR-100と同様に
開発環境とエミュレータを別リポジトリに保ったまま、公開サイトに置いた固定版を読む契約です。
URLから任意の外部CJRを取得しません。

1. `game`は1件だけ受け付け、英小文字・数字・単一ハイフンのIDに制限します。
2. Pagesと同じoriginの`game-catalog.json`からIDを引きます。登録版は
   `games/<id>/<version>/<id>.cjr`だけを参照でき、SHA-256を必須とします。
3. CJRを取得し、長さ、SHA-256、標準マシン語CJRの構造を検証した後、
   通常のカセット入力へ自動マウントします。メモリ注入や自動実行はしません。
   取得中に利用者がカセットの選択、録音、取出しなどを操作した場合は手動操作を優先し、
   遅れて届いた作品CJRでカセット状態を上書きしません。
4. 利用者は権利を持つROM・フォントをローカルで選び、JR BASICの`MLOAD`、
   作品固有の実行コマンド（例: `A=USR($1000)`）を入力します。

`web/game-catalog.json` は現在空です。jr200-devのSIDE CATCHは未公開candidate、
RELIC DIVEは開発版であり、いずれも現時点ではPages配布物へ取り込みません。
固定CJRとライセンス全文の確認、開発環境側の公開ゲート、Pages上のURL・hash・
ROM/FONTを用いたブラウザ確認が済んだ版だけ、作品IDリンクをWikiへ載せます。
初回ゲーム公開時には、jr200-devの固定packageからCJRと必要なライセンス・noticeを
明示的に選んでエミュレータ配布物へ取り込み、`scripts/stage_web.py`のallow-list、
SBOM、WikiのURL、サイトのHTTP到達性を一緒に更新してください。

取り込みは作品・版・配信先の明示承認後に限ります。`jr200-dev/tools/web_export.py`が
出力する`export-manifest.json`（schema 2）は、元のcatalog SHA、追加作品だけの固定
ファイル一覧とhash、CJRのentry/API/ライセンスを持ちます。ここで
`python3 scripts/prepare_game_import.py --export DIR --game id@x.y.z --output EMPTY_DIR`
を実行すると、公開リポジトリを変更せず、hash・CJR構造・entry・ライセンス・
他作品の不変性を再検査した差分を作ります。候補版の`--local-preview`はローカル確認専用で、
公開用の取り込みでは必ず拒否されます。`--game`は選択ミス防止であり、公開承認ではありません。
同じIDの旧版ファイルは残し、catalogの推奨版だけを更新します。既存の`?game=id`は
推奨版を開き、過去版CJRは固定URLのまま配布します。

承認済みの差分だけを`web/`へ反映し、`web/game-assets.json`の完全一致allow-listに
CJR・LICENSE・noticeを登録します。`source-manifest.json`はソースだけ、
`game-assets.json`はゲーム資産だけを列挙し、`make sbom`、
`python3 scripts/update_manifest.py`、`make check`、`make wasm`で配布物を検査します。
Pagesは同一commitのCI成功後に配信し、配信先でCJRとcatalogのHTTP到達性・hashを
確認するまでWikiの「遊ぶ」リンクを有効にしません。純粋なゲーム配布差分向けに、
成功済みの`source-and-codec` main commitを`trusted-fastpath-base.txt`に固定し、
ソース不変性とActions成功履歴を確認してSHA固定runner v0.3.0を再利用する
検証器を用意しました。ただしCI/Pagesで高速経路を有効化するworkflow変更は未反映です。
承認済みcommit後に別途workflowのPRと実CI受入を行うまでは、main更新で通常の
Emscripten再ビルドが走ります。#16の完了条件には数えません。

検証済み範囲: NodeのID・catalog・同一origin・SHA・容量guard、合成ROM/FONTを使う
Chromeでの自動マウントと起動後の保持、既存の通常CJRマウント・高速ロード回帰。
取得保留中に録音待機へ切り替える競合試験も含みます。
加えてローカル保有の実ROM・FONTとRELIC DIVE開発版CJRをChrome 153のlocalhost試験にのみ使い、
リンク経由のマウントがROM起動後も保持されることを確認しました。ファイルを外部配信せず、
この旧試験単体はJR BASICのMLOAD／USR成功や物理JR-200での動作証明ではありません。
2026-09-25に両候補版を公開リポジトリ外のローカルサイトで別々に試遊し、所有ROM/FONTで
MLOAD／USR後の画面を確認しました。これは公開Pages到達性・実機互換の証明ではありません。
