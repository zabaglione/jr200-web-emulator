# 作品IDリンクとCJRセット

`https://zabaglione.github.io/jr200-web-emulator/?game=<id>` は、JR-100と同様に
開発環境とエミュレータを別リポジトリに保ったまま、公開サイトに置いた固定版を読む契約です。
URLから任意の外部CJRを取得しません。

1. `game`は1件だけ受け付け、英小文字・数字・単一ハイフンのIDに制限します。
2. Pagesと同じoriginの`game-catalog.json`からIDを引きます。登録版は
   `games/<id>/<version>/<id>.cjr`だけを参照でき、SHA-256を必須とします。
3. CJRを取得し、長さ、SHA-256、標準マシン語CJRの構造を検証した後、
   通常のカセット入力へ自動マウントします。`?game=<id>`だけでは自動実行しません。
   取得中に利用者がカセットの選択、録音、取出しなどを操作した場合は手動操作を優先し、
   遅れて届いた作品CJRでカセット状態を上書きしません。
4. 利用者は権利を持つROM・フォントをローカルで選び、JR BASICの`MLOAD`、
   作品固有の実行コマンド（例: `A=USR($1000)`）を入力します。

ローカル実装の`?game=<id>&launch=1`は、カタログの固定CJRについて起動支援も要求します。
現在の対応ROM版は所有ROMのSHA-256指紋で限定し、ROM/FONTの実バイトは配布・送信しません。
保存済みの対応ROM/FONTならBASIC起動から進め、初回はローカル選択後に進みます。
BASIC入力待ち、今回のカセット読出し進行、終端とREMOTE OFF、CJRの全ロードbyte、
新しい入力待ちを確認してから、カタログの固定`USR`だけを入力します。手動カセット操作、
キー入力、一時停止、リセット、中止、制限時間超過では自動進行を止めます。
起動完了表示は作品版ごとに登録した自作タイトル文字列が画面に現れた場合だけです。
`titleMarker`未登録の版はCJRのマウントだけ行い、手動起動を案内します。
公開用exportでは、ROM/FONTを用いた実画面確認済みの版に限り
`jr200-dev/tools/web_export.py --title-marker 'SIDE CATCH'`のように指定します。
マーカーはcatalogと`EXPORT.json`の両方へ記録し、取り込み時に一致を検証します。
未対応ROMでは理由を表示して、従来の手動MLOAD/USRへ戻ります。URLの任意コマンド、
外部CJR、ローカルpathは受け付けません。音声がブラウザの許可待ちでもCPU起動とは分けて表示します。
公開Pagesでの起動支援の稼働は配信後に別途確認します。公開用カタログは空です。

Wiki以外でCJRと入力テキストをまとめて渡す場合は、[起動パック v1](LAUNCH_PACK.md)を
利用できます。ローカルのZIP/フォルダーを選ぶ形式で、公開カタログのURLとは独立です。

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
検証器を用意しました。ただし固定runnerはABI 9の旧版であり、現在のABI 10には再利用できません。
CI/Pagesで高速経路を有効化するworkflow変更も未反映です。
承認済みcommit後に別途workflowのPRと実CI受入を行うまでは、main更新で通常の
Emscripten再ビルドが走ります。#16の完了条件には数えません。

検証済み範囲: NodeのID・catalog・同一origin・SHA・容量guard、合成ROM/FONTを使う
Chromeでの自動マウントと起動後の保持、既存の通常CJRマウント・高速ロード回帰。
取得保留中に録音待機へ切り替える競合試験も含みます。
加えて2026-09-25に所有ROM/FONT、SIDE CATCH候補CJR、RELIC DIVE開発版CJRを
Chrome 153のlocalhostでそれぞれ試験しました。リンクから通常のMLOAD／USRを経て
タイトル・操作後の画面まで確認し、再読込後の保存ROM/FONTからの自動起動も確認しました。
これは公開Pages到達性・実機互換の証明ではありません。
