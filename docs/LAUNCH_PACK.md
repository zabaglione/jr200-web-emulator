# JR-200 起動パック v1

Webアプリの「起動パックZIP」または「起動パックのフォルダー」で、CJRと入力支援テキストを
一緒に選べます。フォルダーはブラウザのフォルダー選択機能を使い、ZIPはstored/deflateに
対応します。URLから任意の外部ZIPを取得しません。ROM/FONTは同梱せず、利用者が従来どおり
ローカルで選択します。ファイルはブラウザ内で処理し、サーバーへアップロードしません。

最小構成は以下です。ZIPはこれらを直下または単一の外側フォルダーに置きます。

```text
pack.json
game.cjr
launch.txt
```

`pack.json`はUTF-8 JSONで、CJRとテキストの元バイト数・SHA-256を指定します。
`LICENSE.txt`、`THIRD_PARTY_NOTICES.md`、`README.md`/`README.txt`も同梱できますが、
自動入力には使いません。ROM/FONT、余分なCJR、その他のファイルや下位フォルダーは拒否します。

```json
{
  "schemaVersion": 1,
  "title": "SIDE CATCH",
  "media": {"file": "game.cjr", "size": 1593, "sha256": "<CJRのSHA-256>"},
  "input": {"file": "launch.txt", "size": 19, "sha256": "<テキストのSHA-256>"},
  "titleMarker": "SIDE CATCH"
}
```

入力テキストはUTF-8です。任意のテキストは入力支援欄へ取り込むだけで、自動送信しません。
自動起動は、実ROM/FONTで確認したタイトル文字列`titleMarker`があり、テキストが
次の2行に厳密に一致するマシン語CJRだけを対象とします。

```text
MLOAD
A=USR($1000)
```

この場合も、対応ROMのBASIC入力待ち、通常カセット読込完了、RAMの全ロードbyte、
新しいBASIC入力待ちを確認してから2行目を入力します。実行後はタイトル文字列と
PCのロード領域内滞在を確認します。入力テキストや目録の自己申告hashは、
権利・作者・プログラムの安全性の証明にはなりません。知らないパックは内容と配布元を
確認してから選んでください。

ローカルパックは次の作成ツールで生成できます。既存の出力先は上書きしません。
`--title-marker`はROM/FONTで実画面を確認した場合だけ指定してください。

```sh
python3 scripts/create_launch_pack.py \
  --program /path/to/game.cjr --input /path/to/launch.txt \
  --title 'SIDE CATCH' --title-marker 'SIDE CATCH' \
  --license /path/to/LICENSE --output /path/to/side-catch.zip
```

ZIPは2 MiB以下、展開後の合計は1200 KiB以下、最大8ファイルです。暗号化・ZIP64・
分割ZIP・symlink・重複名・経路横断を拒否します。展開中にも容量を監視し、全ファイルの
検査が済むまで既存のカセットを置き換えません。ブラウザがdeflate-rawに未対応のときは
圧縮ZIPを拒否するため、非圧縮ZIPかフォルダーを使ってください。

公開Wiki用の`?game=<id>&launch=1`は従来の固定カタログ経路のままです。起動パックは
配布先を選ばないローカル取込形式であり、公開カタログへの登録やPages配信、実機互換の
証明を省略できる仕組みではありません。
