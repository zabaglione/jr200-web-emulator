# Upstream / evidence register
確認日: 2026-09-22。公開資料の観測と、本プロジェクトでの動作検証を区別する。

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
| S11 | https://github.com/mamedev/mame/blob/9940645188b6749e170b62c0ea86af0f440148da/src/devices/cpu/m6800/m6800.cpp | MC6800ファイルのBSD-3-Clause/Aaron Giles表示と割込cycle |
| S12 | https://github.com/mamedev/mame/blob/9940645188b6749e170b62c0ea86af0f440148da/docs/legal/BSD-3-Clause | MAMEのBSD-3-Clause全文。blob `cc9ab753198e41128dc651e0adb4f5e8c1be932a` |
| S13 | https://github.com/find-jr200/VJR200forWindows/blob/dd748995bede57da5baebc1225c7a33433aa6934/VJR200/AnalyzeWave.cpp | SAVE/MSAVEのMN1271出力byteをLSB順の波形sampleへ展開し、600/2400 baudのhalf-spanからCJRへ戻す処理 |
| S14 | https://webaudio.github.io/web-audio-api/ | Web Audio API 1.1のAudioContext、AudioBufferSourceNode、sample-rate変換、suspend/resume |
| S15 | https://find-jr200.github.io/vjr200_man.html | 日本語版の英数／GRAPH／カナ／BREAK割当、英語keyboard時の補助割当、ROMとfontの別設定 |
| S16 | https://github.com/find-jr200/VJR200forWindows/blob/dd748995bede57da5baebc1225c7a33433aa6934/VJR200/Mn1544.cpp | 固定commitの日本向けkey変換、FONTから標準文字RAMへの転送、MN1544入力処理 |
| S17 | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html | 通常文字の最低contrast比4.5:1と、定義色から丸めず判定する基準 |
| S18 | https://asamomiji.jp/antique/JR200/hardware.html | 日本向けJR-200の外装・key配色の観察資料。色値は写真からの解釈で、公称値とは扱わない |

## 上流固定情報
- repo: `https://github.com/find-jr200/VJR200forWindows.git`
- commit: `dd748995bede57da5baebc1225c7a33433aa6934`
- root tree: `66f4c9ddbc65e0556e33bb3d526a22faac1c0a0c`
- license blob: `8cad34867bad988f97fc237a9259e338f0bedf99`
- CjrFormat.cpp blob: `f6d0ca7512b9d831cb7d20f7313130a8b76f43f4`
- CjrFormat.h blob: `b9c347881fba561f0783f3028f72359775f2d95b`
- AnalyzeWave.cpp blob: `af37e398e6bfb53501ffa4fe6ac21b09e052777e`
- AnalyzeWave.h blob: `1355b1d12e57ca6f1f21bae220bcff8007a285f4`
- ITapeFormat.h blob: `d160c85372d6783ad4d040c0e2ceeabfefee31e0`
- m6800.cpp blob: `797a05ff6e54834ab0fe93020ff3eaff47399a85`
- m6800.h blob: `5483a691f2654e9b80d3352ec3b2ce470b5a7237`
- 6800ops.hxx blob: `f22d6510f1d83a60f8837cff2088f48aa7670928`
- 6800tbl.hxx blob: `2f2f0df8a3890187c10125d26b5e2a90bbe4b9af`
- Address.h blob: `f61c7072f4a30ffc1110bf17a95968cd0955d5c1`
- Address.cpp blob: `e43a1d440a2077730f0be721d9f9b1febafea0dc`
- Mn1271.h blob: `9f955734ae49f4b3c3448b6cf2749ac14431fc26`
- Mn1271.cpp blob: `7e64da67c1ebbe5b16c452d514666edff191b0f4`
- Mn1544.h blob: `8169d810aeec5040ef7f660e0d2ae21c17e4f5b8`
- Mn1544.cpp blob: `e1c1f99a9d07f53ecfa4cc2f8beb9518b2cfe21a`
- Crtc.h blob: `7c8509d83c08a612197eb5604e9769a8ada81299`
- Crtc.cpp blob: `1aba9556d8f6e87cf1f7b674cd9185f196b9111b`
- JRSystem.h blob: `e2e1749e5ac3aa51feec21b45c5abdaf7d73a798`
- JRSystem.cpp blob: `0e12ee0ab487f5d25b18f3ac392ce10c06b6daf1`

## 移植境界の観測
`JRSystem.h`はAddress、Crtc、Mn1271、Mn1544、m6800、FDD、プリンタを集約している。`Mn1271.h`はDirectSound/OpenSL ESとcerealに依存する。`Address.cpp`の読み出しにはグローバルなデバッガやDRAM wait制御が混在する。したがって`stdafx.h`の置換だけで移植したとは扱わず、CPU/バスとホスト表示・入出力を分離する。

対象ファイルの基準URLはS1と同じcommitを使う。CPU4ファイルの個別監査、
MAME側の照合blob、取込/除外判断は [P04_CPU_AUDIT.md](P04_CPU_AUDIT.md) に記録した。
MN1271、MN1544、CRTC、Address、JRSystemの個別監査、OS依存機能の除外、
register traceと近似範囲は [P05_PERIPHERAL_AUDIT.md](P05_PERIPHERAL_AUDIT.md) に記録した。
P08では`CjrFormat`のleader/intermission、start/data/stop framing、280 CPU cycle/sampleと、
`AnalyzeWave`のLSB順sample展開・half-span復号をOS非依存の固定容量transportへ再構成した。
Windowsの保存先、ファイル命名、UI、直接memory loadは移植していない。詳細と通常
LOAD/MLOAD/SAVE/MSAVEの実測は [P08_CASSETTE_ACCEPTANCE.md](P08_CASSETTE_ACCEPTANCE.md)。
P09ではP05の固定PCM queueをWASMから一括drainし、利用者操作後だけWeb Audioへ接続した。
44.1 kHz bufferとdevice contextのsample rate差、休止復帰の境界はS14を根拠とし、
DirectSound、音声device API、wall clockはC++コアへ移植していない。詳細は
[P09_AUDIO_ACCEPTANCE.md](P09_AUDIO_ACCEPTANCE.md)。
P10ではS3の`BitGetterD`、`WaveGetter`、`GetLoadData`をP08の共通信号源からRIFF PCMへ
変換し、S5のJR2Rescue 0.6.2を独立した波形・decode基準にした。JR2Rescueで観測した
短いleader/inter-block intervalへは合わせず、S3固定commitの136/36 byteを維持した。
比較値と未検証範囲は [P10_WAV_ACCEPTANCE.md](P10_WAV_ACCEPTANCE.md)。
P11ではS13のtransition/half-span/frame復号をOS非依存のbounded decoderへ再構成した。
Win32 UI、ファイル保存処理、無制限buffer、bit補正は移植していない。JR2Rescue生成WAVと
利用者提供録音による照合、候補と検証済みCJRの境界、未対応PCM、完了したremote CIは
[P11_WAV_DECODE_ACCEPTANCE.md](P11_WAV_DECODE_ACCEPTANCE.md)に記録した。
UI Issue #15〜#20ではS15とS16を日本向けkey割当の根拠にし、`web/keyboard.mjs`へ
表示・物理入力・仮想入力で共有する解決表を再構成した。FINDの表示とlicense全文を保持する。
外装themeはS18の観察に基づく設計上の解釈であり、写真やlogoは配布しない。S17を通常文字の
contrast検査に使った。実装、browser条件、実データとの境界は
[UI_ACCEPTANCE.md](UI_ACCEPTANCE.md)に記録した。

## ライセンス台帳
| 対象 | 観測した表示/条件 | 初期成果物への取込 | 方針 |
|---|---|---|---|
| FIND / CJR | BSD-3-Clause表示、FIND著作権、S2の条件 | 形式処理を再構成して取込 | 著作権表示とLICENSES/VJR200.txt原文を保持 |
| MAME由来CPU | CPU4ファイルを個別監査。BSD-3-Clause / Aaron Giles、6800opsはFIND改変あり | P04でMC6800命令/表を適応 | 各source表示、THIRD_PARTY_NOTICES、MAMEライセンス全文を保持。逆アセンブラ/M6801内蔵I/Oは未取込 |
| X88000 | 公式ページに使用の記載 | 未取込 | 取り込む具体ファイルに対応づけてから監査 |
| cereal | 公式ページでBSD三条項扱い。Mn1271.hにinclude | 未取込 | 初版は使用しない。必要になればversionとLICENSEを固定 |
| TinyXML-2 | 公式ページでzlibライセンス | 未取込 | Windows設定XMLを移植せず初版から除外 |
| ROM/フォント/ソフト | エミュレータのライセンスでの許諾は確認できない | 未取込 | ローカル提供のみ、別途権利確認 |
| JR2Rescue/JR2WAV Editor | 別ツール | 未取込 | 実行結果の独立対照に限定。バイナリや逆コンパイル結果を移植しない |

取込済CJR部分の条件確認は行ったが、上流リポジトリ全ファイルの網羅的な権利監査が完了したという意味ではない。法律専門家による個別案件の判断を代替する文書でもない。
