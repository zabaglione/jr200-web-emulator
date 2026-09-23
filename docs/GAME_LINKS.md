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

検証済み範囲: NodeのID・catalog・同一origin・SHA・容量guard、合成ROM/FONTを使う
Chromeでの自動マウントと起動後の保持、既存の通常CJRマウント・高速ロード回帰。
取得保留中に録音待機へ切り替える競合試験も含みます。
加えてローカル保有の実ROM・FONTとRELIC DIVE開発版CJRをChrome 153のlocalhost試験にのみ使い、
リンク経由のマウントがROM起動後も保持されることを確認しました。ファイルを外部配信せず、
この試験はJR BASICのMLOAD／USR成功や物理JR-200での動作証明ではありません。
