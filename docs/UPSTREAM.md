# Upstream / evidence register
確認日: 2026-09-21。公開資料の観測と、本プロジェクトでの動作検証を区別する。

| ID | 一次情報 | 確認した事項 |
|---|---|---|
| S1 | https://github.com/find-jr200/VJR200forWindows/commit/dd748995bede57da5baebc1225c7a33433aa6934 | 基準commit。2025-01-15、V1.8.2を示す変更 |
| S2 | https://github.com/find-jr200/VJR200forWindows/blob/dd748995bede57da5baebc1225c7a33433aa6934/license_vjr200.txt | FINDの条件付き改変・再配布許可。全文と著作権・免責を保持 |
| S3 | https://github.com/find-jr200/VJR200forWindows/blob/dd748995bede57da5baebc1225c7a33433aa6934/VJR200/CjrFormat.cpp | CJR構造、加算checksum、BASIC/MSAVE区別、波形生成、ヘッダーなし分岐 |
| S4 | https://find-jr200.github.io/vjr200.html | ROM/フォント準備、CJR/JR2差、PRINT#/INPUT#制約、MN1271近似実装、第三者ライブラリ |
| S5 | https://find-jr200.github.io/jr2rescue.html | CJR↔WAV、600/2400、マルチCJR、2025-02-23の44.1kHz/16bit/2400修正 |
| S6 | https://github.com/find-jr200/JR2Rescue | 調査した公開ルートは配布ZIPとreadme。ソースコードはそのルートでは確認できない。ZIP内部は今回未調査 |
| S7 | https://find-jr200.github.io/aboutjr2format.html | JR2はCJRと別の生信号用経路。将来拡張の調査対象 |
| S8 | https://emscripten.org/docs/porting/connecting_cpp_and_javascript/Interacting-with-code.html | C/C++とJSの接続方法、C ABIとメモリアクセス |
| S9 | https://cli.github.com/manual/gh_repo_create | private repoを作成するCLIの仕様 |
| S10 | https://github.com/actions/checkout/releases/tag/v7.0.1 | CIのcheckoutを固定。commit 3d3c42e5aac5ba805825da76410c181273ba90b1 |

## 上流固定情報
- repo: `https://github.com/find-jr200/VJR200forWindows.git`
- commit: `dd748995bede57da5baebc1225c7a33433aa6934`
- root tree: `66f4c9ddbc65e0556e33bb3d526a22faac1c0a0c`
- license blob: `8cad34867bad988f97fc237a9259e338f0bedf99`
- CjrFormat.cpp blob: `f6d0ca7512b9d831cb7d20f7313130a8b76f43f4`
- m6800.cpp blob: `797a05ff6e54834ab0fe93020ff3eaff47399a85`

## 移植境界の観測
`JRSystem.h`はAddress、Crtc、Mn1271、Mn1544、m6800、FDD、プリンタを集約している。`Mn1271.h`はDirectSound/OpenSL ESとcerealに依存する。`Address.cpp`の読み出しにはグローバルなデバッガやDRAM wait制御が混在する。したがって`stdafx.h`の置換だけで移植したとは扱わず、CPU/バスとホスト表示・入出力を分離する。

対象ファイルの基準URLはS1と同じcommitを使う。

## ライセンス台帳
| 対象 | 観測した表示/条件 | 初期成果物への取込 | 方針 |
|---|---|---|---|
| FIND / CJR | BSD-3-Clause表示、FIND著作権、S2の条件 | 形式処理を再構成して取込 | 著作権表示とLICENSES/VJR200.txt原文を保持 |
| MAME由来CPU | m6800.cpp冒頭にBSD-3-Clause / Aaron Giles | 未取込 | CPU移植Issueで関連.h/.hxx/逆アセンブラも全件確認し各条件・クレジット保持 |
| X88000 | 公式ページに使用の記載 | 未取込 | 取り込む具体ファイルに対応づけてから監査 |
| cereal | 公式ページでBSD三条項扱い。Mn1271.hにinclude | 未取込 | 初版は使用しない。必要になればversionとLICENSEを固定 |
| TinyXML-2 | 公式ページでzlibライセンス | 未取込 | Windows設定XMLを移植せず初版から除外 |
| ROM/フォント/ソフト | エミュレータのライセンスでの許諾は確認できない | 未取込 | ローカル提供のみ、別途権利確認 |
| JR2Rescue/JR2WAV Editor | 別ツール | 未取込 | 実行結果の独立対照に限定。バイナリや逆コンパイル結果を移植しない |

取込済CJR部分の条件確認は行ったが、上流リポジトリ全ファイルの網羅的な権利監査が完了したという意味ではない。法律専門家による個別案件の判断を代替する文書でもない。
