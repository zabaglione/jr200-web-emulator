# 初期実装の試験記録

## CTRL時の仮想キー表示（2026-09-25 / Windows 11 ARM・Chrome）

Windows 11 ARMのVJR-200 1.8.2 x64を実ROMで起動し、Parallelsのゲスト向けキー送信を使って
`CTRL+A`で`AUTO`、続く`CTRL+3`で`SAVE`がBASIC画面へ入力されることを目視確認した。
Web版の入力解決は変更せず、英数・JR BASIC・CTRL・SHIFTなしのときだけ仮想キー上に
キーワードのラベルを示す。その他のCTRL操作では、制御コードをキー面の文字として描かない。

`node tests/keyboard_smoke.mjs`、`make test`（CTest 13/13）、`make sanitize`（CTest 13/13）、
`make wasm-smoke`（9系統）、`make check`、Chrome 153の`make browser-smoke`が成功した。
ブラウザ試験では機能ラベルの可視性・キー幅からのはみ出し・最低7pxの文字サイズ・入力コードの
維持に加え、GRAPH＋SHIFT＋CTRLでキー面の画素がCTRL前と同一であることを確認した。
この画素検査を追加した後、全体試験の後段で`C100: 20`待ちが1回失敗し、続く2回の再実行は
成功した。原因は未特定で、入力タイミングの安定性は引き続き監視する。
Emscripten本体buildは要求6.0.9に対し手元の導入版が6.0.10のため未実施。
物理JR-200での照合、およびWindows版の全CTRL組合せの実操作は未実施である。

## Windows版機能差追補（2026-09-22 / macOS・Windows 11 ARM）

VJR-200 V1.8.2の固定commit `dd748995bede57da5baebc1225c7a33433aa6934`を
Windows版の基準とし、Windows 11 ARMでx64版の起動を確認した。機能と設定値は同commitの
`VJR200.cpp`、`VJR200.rc`、`OptionDialog.cpp`、`Address.cpp`、`Mn1544.cpp`、
`AppSettingXml.cpp`を照合した。Web版にはCJR高速ロード、Quick Type、10件のマクロ、
ローマ字カナ、64 KiBメモリダンプ、画面倍率／全画面／画素比／補間／回転、CPU速度、
CMT再生時の高速化、RAM拡張2種／初期化2種、gamepadのbutton割当／1button／強制入力を追加した。
system ABIは9である。

`make test`と`make sanitize`は各CTest 10/10、`make wasm-smoke`は8系統、
Emscripten 6.0.9の`make wasm`とmodule smokeが成功した。正式Emscripten配布物を
Playwright 1.63.0とGoogle Chrome 153.0.8010.53で検査し、追加機能の画面操作、
Quick Typeの中止、設定保存、高速ロードの書込み、64 KiB download、既存機能の回帰、
外部request 0件を確認した。固定scenarioは非表示2,723,036 cycles、表示2,678,568 cycles、
Web Audio underrunはいずれも0だった。

このturnでは新規3ファイルを利用者のGit indexへstageしていない。そのままの
`make test`／`make sanitize`は機能・安全性の9項目が合格し、tracked source一覧だけが
意図どおり不一致で停止した。実indexのcopyへ3ファイルをintent-to-addした隔離indexでは
両CTest 10/10と`make check`が成功した。実indexは変更していないため、commit候補をstageした
時点で通常indexの追跡一覧gateを再確認する必要がある。

差分レビューで検出したCPU高速時の音声予約蓄積、ローマ字`KKA`の途中子音消失、
最大長BASIC CJRの終端pointer、1700px幅での手動倍率上書き、1button時の任意button、
高速ロードのfile単位provenanceを修正した。音声はCPU倍率へ再生倍率を追従させ、
50 ms相当ごとにPCMを排出し、予約先行を250 ms以内に制限した。Chrome内の決定的な
fake AudioContextではCPU 1000%を1.2秒継続しても先行300 ms以下、active source 30未満だった。
`KKA`は`ｯ`、`ｶ`の順、
`XTU`／`LTU`は`ｯ`、`TSU`は`ﾂ`へ変換し、1button時は標準D-pad以外のbutton 2もAになった。
63,487 byteのBASIC CJRは書込み後の終端pointerが`$0000`となり、途中例外を起こさない。
全画面はボタンで入り、Canvas上の`Alt+Enter`で終了するところまで確認した。

state save、JR2、FDD、printer、debug label／disassembler等は、不完全な代替を作らず
必要な周辺機器、format、直列化または受入fixtureを定義するまで保留した。今回の結果は
Windows版固定ソースとの機能対応と合成ROM上のWeb配線を示す。物理JR-200、物理gamepad、
保留機能、およびWindows版の全機能を実操作で照合した証拠ではない。詳細は
[WINDOWS_PARITY.md](WINDOWS_PARITY.md)を参照する。

## CTRL・TV外周色・画面優先レイアウト追補（2026-09-22 / macOS・Windows 11 ARM）

仮想keyboardを既定で閉じ、上部の状態と操作を1行へ圧縮した。CSS viewport 1920×960と
1920×1080では320×224画面を3倍（960×672）、1536×768と1280×720では2倍（640×448）に
した。keyboard表示時も倍率を変えず、Full HDでは右横の最大520px、1536／1280幅では中央の
最大620pxへ配置した。desktop用key高は通常配置25px以上、Full HD横配置29px以上とし、
BREAK／DELの右辺とcursor十字配置を維持した。仮想keyboardは補助機能であり、画面と物理
keyboardを優先した意図的な受入変更である。

固定commit `dd748995bede57da5baebc1225c7a33433aa6934`のWindows版`Mn1544.cpp`から、
MN1271 KSTAT bit 7に応じたCTRLのneutral／JR BASIC分岐を再構成した。Windows 11 ARM上で
VJR-200 1.8.2 x64を実行し、権利確認済み実ROMのJR BASICで`CTRL+A`が`AUTO`を入力することを
目視確認した。Web側はneutral code、BASIC直接code、keyword列、SHIFT併用、仮想CTRLの1回
latch、macro中断をNodeとChromeの合成ROMで確認した。これはWindows参照実装との一致であり、
物理JR-200のkey matrixを実測した証拠ではない。

CRTCが持つ320×224 framebufferをそのままCanvasへ描き、中央256×192の表示領域と左右32px・
上下16pxのTV外周色を分離した。合成ROMから`$CA00`へ7を書き、Chrome Canvas左上pixelが
赤`[255,0,0,255]`になることを確認した。表示領域を狭める追加panelは作っていない。

現行候補で`make test`と`make sanitize`は各CTest 10/10、`make check`、`make wasm-smoke`の
8系統が成功した。Playwright 1.63.0とGoogle Chrome 153.0.8010.53の`make browser-smoke`は、
上記5 viewport／DPR条件、keyboardの表示・非表示、物理`Control+C`／`Control+A`、外周色、
既存のGamepad、Web Audio、cassette、debugger、CJR／WAV機能、外部request 0件を確認した。
現行layoutのFirefox／Safari再試験と物理JR-200でのCTRL／外周色確認は未実施である。

macOS日本語入力が`Control+3`をcomposition扱いにする場合の回帰試験を追加した。Canvasへ
focusした合成`isComposing` eventでdefault actionが抑止され、JR BASICの`SAVE `列が最後まで
入力されることをChromeで確認する。macOS IMEの実UIを使った最終確認は手動試験として残る。

## CJR自動起動機能の撤回（2026-09-23）

CJRはロード先を記録するが実行開始アドレスを記録しないため、先頭ロード先を実行先とみなす
自動起動機能を削除した。通常のマウントとJR BASICでの手動`MLOAD`は利用できる。
以前のMAZY試験結果はローカル検証記録に残すが、現行UIの機能受入とは扱わない。
`make wasm-smoke`の8系統とChrome 153.0.8010.54の`make browser-smoke`が成功し、
自動起動欄の不在、CJR選択・マウント・高速ロード、既存機能の回帰を確認した。
`make test`と`make sanitize`は各CTest 10/10、`make check`も成功した。未追跡の
新規3ファイルは検査用の隔離Git indexに仮登録し、利用者のindexは変更していない。

## キークリック・音声既定ON追補（2026-09-22 / macOS・Chrome）

JR-200UサービスマニュアルのPB6 key detection sound gateを共通MN1271コアへ追加した。
通常キーコードの遷移を1回のpending clickとし、KACK立上り時にPB6が1なら
2400 Hz・6 ms・peak 7000の短いPCMを生成する。PB6のgate動作は資料準拠だが、波形仕様は
資料にないため可聴確認用の近似である。実ROMを使った直接WASM probeは、`$0000=0`で
66 frame中nonzero 0、`$0000=$40`で66 frame中nonzero 57、peak 7000だった。
重なった別key codeは各1回発音し、同一keyのhold／repeatは再発音せず、PB6を下げると進行中の
burstも停止することをnative／直接WASMで確認した。

固定commit `dd748995bede57da5baebc1225c7a33433aa6934`のWindows版VJR-200全ソースも確認した。
`Mn1271.h`は`KEYSOUND=64`を宣言するが参照はその1か所だけで、`Reg3_write`は
`SetKeyTest(val)`のみ、DirectSound生成は3 channelの`GetWave(ch)`だけだった。したがって、
現行Windows版はキークリックを実装しておらず、実機挙動の対照には使っていない。

Web Audioは既定ONの待機状態に変更した。ページ表示だけではAudioContextを作らず、最初の
「起動」clickで開始するため、自動再生制限と既定ONを両立する。`make test`と`make sanitize`は
各CTest 10/10、`make wasm-smoke`は8系統、Emscripten 6.0.9の`make wasm`も成功した。
永続`.venv/`のPlaywright 1.63.0とGoogle Chrome 153.0.8010.53による`make browser-smoke`は、
実`AudioContext`で起動前0、起動後running、停止後suspended、再開後runningを確認した。
決定的なPCM検査はfake 48 kHz contextを使い、仮想Aキー操作後に追加されたsourceだけで
非0 click PCMを確認した。遅延resume中のdisable競合、既存機能、外部request 0件も成功した。
実機音の録音比較と物理speaker出力は未検証である。

## ブラウザジョイスティック追補（2026-09-22 / macOS・Chrome）

system ABI 8へ2 playerのactive-low joystick setterを追加し、Gamepad APIの左stick／D-pad、
A／B、接続中が1台なら必ず1Pとなる割当、切断・focus喪失時のニュートラル化、boot／reset／復帰時の再同期を
実装した。上流固定commitのbit割当とW3C標準mappingを分離して使用している。

`make test`と`make sanitize`は各CTest 10/10、`make wasm-smoke`は直接WASM scan、JS wrapper、
入力controllerを含む8系統、Emscripten 6.0.9の`make wasm`とABI 8 Node smokeが成功した。
Playwright 1.63.0＋Google Chrome 153.0.8010.53では、合成Gamepad APIの2台を通常MN1544
scanで`EA`／`D5`として観測し、2P切断時`FF`、1P切断時に残った2Pが1Pへ移る`D5 FF`、
focus喪失時`FF FF`、復帰時の再同期を確認した。
既存のkeyboard、音声、cassette、debugger、CJR／WAV回帰と外部request 0件も成功した。
これはbrowser配線の合成試験であり、物理USB／Bluetooth controllerの機種別互換証拠ではない。

## 操作性・保存・ロードモニター追補（2026-09-22 / macOS・Chrome）

タブを離れた場合はキーだけを解放して既定で実行継続し、自動一時停止設定をONにした場合だけCPUと
音声を一時停止するよう変更した。CJRの選択名と現在のマウント名を別表示し、未マウントを
黄色、マウント済みを緑と文言で区別した。カセットの実信号レベルをPCMへ加算するロード
モニターを既定ON・25%で追加し、再生中のON/OFFと音量変更を数値試験した。

利用者提供の実機写真を配置参照に、仮想キーボードを数字列、QWERTY列、左右SHIFT、下段の
英数／GRAPH／SPACE／カナ、独立cursor群を持つ5段へ変更した。右側はBREAK、INS／DEL、`↑`、
`←`／`→`、`↓`の順に分離し、BREAKとDELの右辺、上下キーの中心と左右キーの中間を揃えた。全キーは44px以上、
cursor群の縦横間隔は8px以上であることをChrome上の座標で確認した。写真自体は配布物へ含めていない。
macOS JIS配列で`]`キーが`Backslash` codeを報告する場合は`event.key`で右角括弧へ補正し、
右角括弧の仮想キーだけが押下表示となって`$5D`を入力することも確認した。
IndexedDB保存形式にはROM／fontのブラウザ提供ファイル名だけを加え、再起動後は空のfile inputの
代わりに状態欄へ表示する。旧保存形式は名称fallback付きで読み込める。

`make test`と`make sanitize`は各CTest 10/10、`make wasm-smoke`の直接WASM／JS 8系統、
Emscripten 6.0.9の`make wasm`とABI 8 Node smoke、`make check`が成功した。Playwright 1.63.0と
Google Chrome 153.0.8010.53で正式Emscripten siteを検査し、1920×960、1920×1080、
1536×768、1280×720、DPR 2を含むlayout、設定永続化、ROM名自動復元、focus動作2種、
選択／mount差分、モニターUI、5段keyboard、既存機能、外部request 0件を確認した。
このPCM試験は物理RQ-8300の音質や物理JR-200とのカセット互換を証明しない。

## UI follow-up #15〜#20受入（2026-09-22 / macOS・三ブラウザ）

Full HD layout、シルバー／チャコール／青theme、英数／カナ／GRAPHの共有入力解決、
FONT／標準文字RAM／user定義文字RAMの副作用なしglyph API、ROM字形仮想keyboardを実装した。
合成試験は通常文字・記号・カナ・GRAPH、SHIFT／CTRL、cursor・編集・BREAK、JIS／US、
複数入力元、短いtap、cancel／blur／reset、cache失効と機械状態不変を確認した。

Playwright 1.63.0＋Google Chrome 153.0.8010.53で、1920×960、1920×1080、1536×768、
1280×720のDPR 1と1920×1080のDPR 2を検査した。1920系は画面640×448、1536／1280系は
320×224で、page縦横overflowなし、補助panel幅、最小key高44px、通常文字contrast 4.5:1以上を
確認した。実Safari 26.6.2は100%と実125% zoom、Firefox 156.0はWebDriver inner 1918×968、
DPR 1で確認した。権利確認済み実ROM／fontによるBASIC起動と実glyph照合は三browserで成功したが、
検体、file名、hash、実データscreenshotはGitへ含めていない。

Chrome 153の固定3秒scenarioでは、変更前`6fcc41300be7561c899fc6f8371277348a2c1ffa`が
3,370,444 cycles、UI変更後候補が3,415,044 cyclesで、各Web Audio underrun 0、core overflow 0、
外部request 0だった。約1.3%の差はbrowser／host上の相対測定で、実機性能を示さない。

正式Emscripten 6.0.9、native、sanitizer、直接WASM、Chrome browser回帰のコマンドと、
実データ／合成data／物理実機の証拠境界は [UI_ACCEPTANCE.md](UI_ACCEPTANCE.md) に集約した。
remote ActionsとIssue closureの結果は、対象commit確定後にGitHub Issue #15〜#20へ記録する。

## P13 private初版候補のローカル監査（2026-09-22 / macOS）

P12の物理JR-200往復を初版後へ延期し、P13をP11依存のprivate初版受入へ変更した。
SPDX 2.3 SBOM、CI browser smoke、Git tracked sourceと完全一致するallow-list、staged siteの
明示entry検査を追加した。P12はopenかつ未検証のまま残す。

候補treeで`make check`、`make test`、`make sanitize`、`make wasm-smoke`、`make wasm`、
Playwright 1.63.0＋Chrome 153.0.8010.53の`tests/browser_smoke.py`が成功した。nativeと
sanitizerは各CTest 9/9、直接WASMは7系統、正式Emscripten 6.0.9 moduleのNode smokeも
成功した。13ファイル・216 KiBのstaged siteにROM/tape/recording拡張子はなく、browser
smokeの外部requestは0件だった。

remote `main`の実装head `dff63edd501b8f4598718283ec93fe4338c73c60`を`/private/tmp`へ
新規cloneし、`make test`、`make wasm-smoke`、`make wasm`、`make check`を実行した。
native 9/9、直接WASM 7系統、Emscripten 6.0.9正式moduleとNode smoke、配布監査が成功し、
tracked sourceはcleanだった。

同じheadのGitHub Actions run `35675108809`はUbuntu/macOS native、sanitizer、WASM、
browserの5ジョブすべてsuccess。browser jobはPlaywright 1.63.0とChromium 152.0.7977.0で
合成ROM/UI/WAV操作と外部request 0件を確認した。先行run `35674971686`はworkflow YAMLの
未引用コロンによるjob 0件の構文failureで、修正後の受入結果には使用していない。

P13はprivate初版0.0.1として受入完了。これはP12の実機互換合格を意味しない。詳細は
[P13_RELEASE_ACCEPTANCE.md](P13_RELEASE_ACCEPTANCE.md)。

## P11 録音WAV解析・CJR復元受入（2026-09-22 / macOS・GitHub Actions）

RIFF/PCM検査、DC/RMS/極性/channel/half-span/実測baud診断、frame/block/checksum/CJR検証、
CLI/WASM/Webの候補隔離を実装した。独立ツール生成の44.1/48 kHz・600/2400 baud全4 WAVを
入力52 byteのCJRへ戻し、Git対象外の利用者提供録音3本も独立復元済みCJRと各全バイト一致した。

`make test`と`make sanitize`は各CTest 9/9、直接WASMは7系統、Emscripten 6.0.9正式module、
Chrome 153とPlaywright 1.63.0のbrowser smoke、`make check`がローカルで成功した。無音、切断、
noise、不正RIFF、float PCM、checksum破損を検証済み出力として保存しないことも確認した。

実装commit `756d69c4363620bac19a9b936a757e92a47e5fa3`を含むhead
`92722edc10aab6558337b5fbda43fff20f431308`のGitHub Actions run `35672191674`は、
wasm-codec、Ubuntu/macOS native、sanitizedの4ジョブすべてsuccess。これはWAV decoderの
remote受入であり、本実装生成WAVの物理JR-200読込や独立2回の録音往復ではない。
詳細は [P11_WAV_DECODE_ACCEPTANCE.md](P11_WAV_DECODE_ACCEPTANCE.md)。

## P10 CJR信号生成・WAVエンコード受入（2026-09-22 / macOS）

P08の共通4800 Hz信号源から12-bit frame、固定600 baud header、600/2400 data、
VJR-200固定commitのleader/intervalをRIFF PCM mono16の44.1/48 kHzへ変換した。
sample位置は累積有理時刻で決め、CLIはstream、WASMは4096 sample chunk、Webは
256 MiB上限と自動再生なしで保存する。baud無指定はCJR headerへ従う。

`make test`と`make sanitize`は各CTest 8/8、`make wasm-smoke`はCJR/CPU/system/
JS wrapper/Web Audio/WAV ABIの6試験、Emscripten 6.0.9の`make wasm`とChromeの
44.1 kHz/16-bit/mono/2400生成も成功した。

JR2Rescue 0.6.2との48/44.1 kHz、600/2400の4波形比較ではhalf-spanと全3 blockの
位相patternが一致した。参照toolは固定VJR-200よりleader/intervalが短く、各block
anchorに400 ms差がある。本実装WAVを同toolでdecodeした4 CJRは入力52 byteと全byte
一致した。これは独立decoder互換であり、物理JR-200のLOAD/MLOAD成功ではない。
詳細は [P10_WAV_ACCEPTANCE.md](P10_WAV_ACCEPTANCE.md)。

実装commit `b89a9d1717cd892ced06ea5ff8d2ffc2bfa00dfc` のGitHub Actions run
`35666390234`はwasm-codec、Ubuntu/macOS native、sanitizedの4ジョブすべてsuccess。

## P09 音声Web出力・休止復帰受入（2026-09-22 / macOS）

P05のcycle駆動44.1 kHz・3 channel固定PCM queueを維持し、決定的mono mix、一括WASM
drain、利用者操作式Web Audio、既定20%/上限50% gain、sample rate表示、underrun計数、
mute、pause/resume/disable時のsource停止とqueue破棄を追加した。

`make test`と`make sanitize`は各CTest 7/7、`make wasm-smoke`はCJR/CPU/system/
JS wrapper/Web Audio schedulerの5試験、Emscripten 6.0.9の`make wasm`も成功した。
fake 48 kHz contextで44.1 kHz buffer、sample正規化、underrun、pause/resume競合を確認した。

正式Emscripten siteをGit対象外の実ROM/fontで起動し、明示操作前はAudioContext未作成、
操作後はrunning、core/outputとも44100 Hzだった。JR BASIC `SOUND 440,50`後は非0 PCM
45945 frame、peak 7000、core overflow/underrun 0。ミュート、一時停止、停止後はactive
sourceとqueueが0で、console error/warningは0件だった。物理出力の音圧・可聴性・panは
未計測であり、カセットWAV生成とは別である。詳細は
[P09_AUDIO_ACCEPTANCE.md](P09_AUDIO_ACCEPTANCE.md)。

実装commit `904781db9c1e2cfefed6237d3d088ee171c3fe33` のGitHub Actions run
`35661382620`はwasm-codec、Ubuntu/macOS native、sanitizedの4ジョブすべてsuccess。

## P08 CJRカセットLOAD/MLOAD/SAVE/MSAVE受入（2026-09-22 / macOS）

OS非依存の固定容量`CassetteDeck`をMN1271のREMOTE、register 7読出し、register 0D
書込みへ接続した。`make test`と`make sanitize`は各CTest 7/7、`make wasm-smoke`は
CJR/CPU/system/JS wrapperの4試験、Emscripten 6.0.9の`make wasm`、`make check`も
成功した。2400/600 baud、279/280 cycle境界、CJR全byte自己往復、footer直後の
REMOTE OFF、容量超過、headerless・未知type・特殊形式拒否を確認した。

正式Emscripten siteをGit対象外の実ROM/fontで起動し、通常`SAVE`→`LOAD`でBASIC
2行と`RUN`結果`42`、通常`MSAVE`→`MLOAD`で`$7000`〜`$7003`の4 byte一致を確認した。
利用者の物理JR-200によるMSAVE WAVからJR2Rescue 0.6.2で復元済みのfont CJRも
通常`MLOAD`し、84784 sample後に変更した`$D008`〜`$D00E`が復元された。
browser consoleのerror/warningは0件だった。Python Playwright moduleがないため
`tests/browser_smoke.py`自身はimport時点で未実行である。

これは標準CJR transportの受入である。WAV復元は独立参照ツールによるもので、
自前WAV decoder、Web Audio、生成WAVの物理JR-200互換を示さない。ROM、font、WAV、
CJR、BIN、画面capture、内容hashはGitへ追加していない。詳細は
[P08_CASSETTE_ACCEPTANCE.md](P08_CASSETTE_ACCEPTANCE.md)。

実装commit `a0cc4c6a96b4c993d2d5bfc84f3280d75dd15426`に対する
[Actions run 35657825103](https://github.com/zabaglione/jr200-web-emulator/actions/runs/35657825103)は、
Linux/macOS native、sanitizer、Clang直接WASMの4ジョブすべてsuccessだった。

## P07 デバッガ・追跡・メモリウォッチ受入（2026-09-22 / macOS・GitHub Actions）

`make test`と`make sanitize`は各CTest 6/6、`make wasm-smoke`はCJR/CPU/system/
JS wrapperの4試験、Emscripten 6.0.9の`make wasm`も成功した。breakpointの実行前停止と
1回通過、step、read/write watchpoint、固定長ring eviction、peek非記録を確認した。

履歴有効・無効の2台を同じ1000 cycle以上で実行し、全65536 byte、全CPU register、
CPU/機械cycle、PCM queueが一致した。400命令の記録後は命令256件・破棄144件、
CPUアクセス512件・破棄88件となり、無制限に増えないことを確認した。

正式Emscripten siteを実ROMで起動し、in-app browserで実行前breakpoint、1命令step、
read watchpoint、手動256 byte peekを操作した。peek前後でCPUアクセス履歴件数は不変、
console error/warningは0件で、デスクトップ表示も目視した。ROM/font/captureはGitへ
追加していない。Python Playwright moduleがないため`tests/browser_smoke.py`自身は
import時点で未実行であり、ブラウザ手動操作と区別する。

実装commit `f85aa1d3db234db71baf91b59779ea84aafe01df`に対する
[Actions run 35650269016](https://github.com/zabaglione/jr200-web-emulator/actions/runs/35650269016)は、
Linux/macOS native、sanitizer、Clang直接WASMの4ジョブすべてsuccessだった。詳細と
未検証範囲は [P07_DEBUGGER_ACCEPTANCE.md](P07_DEBUGGER_ACCEPTANCE.md)。

## P06 ブラウザBASIC起動受入（2026-09-22 / macOS・Firefox隔離コンテナ）

Emscriptenを6.0.9へ固定し、`make test`、`make sanitize`、`make wasm-smoke`、
`make wasm`、`make check`を実行した。native/sanitizerは各CTest 6/6、直接WASMは
CJR/CPU/system/JS wrapperの4試験、正式Emscripten moduleはNodeから
boot/run/resetとtimer/peekを確認した。

利用者提供の実機MSAVE録音3本はGit対象外の`local-assets/`だけで扱い、
JR2Rescue 0.6.2でROM1 8192 byte `$A000`、ROM2 8192 byte `$E000`、font 2048 byte
`$D000`を復元した。参照ツールでの復元であり、自前WAV decoderや実機往復の
合格には含めない。

正式Emscripten配信を実ROMで起動し、Chrome 153.0.8010.48ではprogram入力、
`LIST`、`RUN`、出力`5`、Safari 26.6.2では`PRINT 7`と出力`7`を目視した。
Firefox 156.0はSelenium 4.49.0の隔離コンテナで同じ`LIST`/`RUN`/`5`を確認し、
tab切替での自動停止も検査した。Safariは情報dialog表示によるblur後に自動停止した。
Chrome consoleのerror/warningは0件だった。詳しい環境、コマンド、境界は
[P06_BROWSER_ACCEPTANCE.md](P06_BROWSER_ACCEPTANCE.md) に記録した。

## P05 周辺回路受入（2026-09-22 / macOS）

VJR-200のAddress、MN1271、MN1544、CRTC、JRSystemの10ファイルをGit blobで
固定し、メモリmap、32 byte mirror、timer/IRQ、KTEST/KACK、CMT、描画規則を
対照した。ファイル別判断と実機未確認範囲は
[P05_PERIPHERAL_AUDIT.md](P05_PERIPHERAL_AUDIT.md) に記録した。

`make test`はCTest 6/6、`make sanitize`はASan/UBSan付きで6/6成功した。
周辺回路試験はRAM/ROM/open領域、DRAM wait、I/O trace、side-effect-free peek、
TCA IRQ、2049 byteのfont/baud bootstrap、key/joystick handshake、CMT REMOTE、
44.1 kHz 3 channel PCM queue、320×224 ARGB framebuffer、CPU cycle接続を確認した。

Emscripten同梱LLVMを指定した`make wasm-smoke`はCJR、CPU、周辺回路、JS wrapperの
4試験に成功した。Emscripten 6.0.9の`make wasm`も成功し、生成ES moduleを
Node.jsで起動してcodec/CPU/system ABI versionとtimer IRQ/peekを確認した。

Playwrightは現在のPython環境にないためブラウザ自動操作試験は未実行である。
正式Emscripten配信をlocalhostで開き、`WASM起動済み`とP05後の未実装境界表示を
Codex in-app browserで目視した。Node/WASM試験とこの起動確認はCanvas/Web Audio、
メーカーROM/fontによるBASIC起動、実機register/timing、保存済みWAVの検証を
代替しない。

## P04 CPU単体受入（2026-09-22 / macOS）

VJR-200の`m6800.h`、`m6800.cpp`、`6800ops.hxx`、`6800tbl.hxx`を個別に
Git blobで固定し、現行MAMEのBSD-3-Clause表示・全文と割込cycleを照合した。
監査対象、依存除外、blobは [P04_CPU_AUDIT.md](P04_CPU_AUDIT.md) に記録した。

`make test`はCTest 5/5、`make sanitize`はASan/UBSan付きで5/5成功した。
CPU native試験はALU/flag、branch、stack byte順、JSR/RTS、SWI/RTI、reset、
IRQ、NMI、WAI、CLI遅延、access別wait、16 bit境界、全256 opcodeの有界進行を確認した。

Emscripten同梱LLVMを指定した`make wasm-smoke`はCJR、CPU、JS wrapperの3試験に
成功した。CPU試験はnativeと同じ10命令のopcode、全register、memory、base/wait/
total cycle、WAIからのNMI復帰を固定値で照合した。Emscripten 6.0.9の正式buildも
成功し、生成ES moduleをNode.jsで起動してCPU C ABI versionとreset vectorを確認した。

`tests/browser_smoke.py`はPython環境にPlaywrightがなく実行できなかった。ローカル配信を
Codex in-app browserで開き、WASM起動表示とMAMEライセンス導線を目視した。これらは
CPU単体の移植証拠であり、JR-200 ROM/BASIC起動、周辺回路、実機タイミング、WAV互換の
証拠ではない。

## P03独立対照（2026-09-22 / JR2Rescue 0.6.2）

上流commit `8f14894706443288bb9838a28f4e828b7ee551b8`のJR2Rescue 0.6.2 Windows向けバイナリを、Ubuntu 24.04 arm64の隔離コンテナ上のMono 6.8.0.105で実行した。参照ZIPのSHA-256を固定し、自作の全ゼロBIN 1/255/256/257/512バイトと自作BASICメモリ像をGUIでCJR化した。標準MSAVEとBASICは本コーデック出力と全バイト一致した。

本コーデックの257バイトCJRをJR2RescueがWAV化・再読込でき、2400 baudは全バイト一致、600 baudはbaud生値`100`とそのヘッダーチェックサムだけが変化した。この実測に合わせてCLI/Webの600 baud writerを`100`へ変更し、任意の既存非0値を保持するreader/copy契約は維持した。JR2Rescue作成の2領域CJRは警告付きで解析・無変更コピーでき、ヘッダーなしCJRは明示指定時だけ本コーデックが受理し、JR2Rescueもbaud上書き無効時にJR2へ変換した。

検体hash、手順、WAVメタデータ、差分、未検証範囲は [P03_REFERENCE_RESULTS.md](P03_REFERENCE_RESULTS.md)。生成物と参照バイナリはGitに含めていない。ネイティブWindows、VJR-200、自前WAV実装、実機録音、JR-200実機は未検証である。

互換修正後の`make test`と`make sanitize`は各CTest 4/4成功。ネイティブ本体は25テスト群（決定的変異入力12,000件を含む）、新設のCLI試験は`--600`が生値100と正しいチェックサムを出すことを確認した。Emscripten同梱LLVMによる`make wasm-smoke`、Emscripten 6.0.9正式ビルド、JS wrapper、`make check`も成功した。生成サイトをCodex in-app browserで開き、WASM起動表示と`600（フラグ100）`の選択肢を目視した。Playwright自動試験はPythonモジュール未導入のため実行できなかった。

## P00受入再試験（2026-09-22 / macOS）

`make test`はCTest 3/3、`python3 scripts/check_distribution.py`はPASS。`LICENSES/VJR200.txt`のGit blob SHAは上流固定値`8cad34867bad988f97fc237a9259e338f0bedf99`と一致した。

Emscripten 6.0.9を`EM_CACHE=$PWD/build/emcache make wasm`で実行し、正式WASMと`build/site`を生成した。ローカルHTTP配信からトップページ、FINDライセンス全文、第三者表記をHTTP 200で取得し、配信されたライセンスのblob SHAも一致した。

同日の`make wasm-smoke`は、既定のAppleClang 21.0.0に`wasm32`ターゲットがないため失敗した。過去のClang直接WASM成功を取り消すものではないが、現在環境での再成功でもない。Emscripten正式ビルドの成功とは分けて記録する。`tests/browser_smoke.py`はPython環境にPlaywrightがなく、UI操作試験は未実行である。

## P01受入再試験（2026-09-22 / macOS・GitHub Actions）

`make test`と`make sanitize`はそれぞれCTest 3/3成功。Emscripten 6.0.9で生成したES moduleをNode.jsからinstantiateし、C ABI version 1と容量1048576を確認した。

commit `62263249b100330b29e9baccff1b58310747275a`に対するGitHub Actions run 35619769839は、Linux native、macOS native、sanitizer、Clang直接WASM smokeの4ジョブすべて成功した。これはCJRコーデックのビルド基盤の証拠であり、ROM/BASIC/Canvas/音声を含むエミュレータのブラウザ起動証拠ではない。

## P02受入再試験（2026-09-22 / macOS・ローカルブラウザ）

`build/native/test_cjr`は24テスト群に成功し、12,000件の決定的変異入力を含む。Emscripten同梱LLVMを`WASM_CXX`に明示した`make wasm-smoke`は、直接WASMとJS wrapperの両試験に成功した。`cjrtool`は合成payloadのpack→inspect→copy→extractを実行し、payloadとCJR copyはそれぞれ元バイトと完全一致した。これはP03変更前のP02受入時点の件数である。

Clang直接WASM配布物をlocalhostで配信し、Codex in-app browserでWASM起動、未実装範囲の明示、検査/作成UI、入力未選択時のエラー表示を目視した。consoleのerror/warningは0件。ファイル選択・ダウンロードを含むPlaywright試験は依存未導入のため未実行であり、独立Windows実装や実機との互換証拠もP03以降に残る。

記録日: 2026-09-21。以下はこのパッケージに対して実際にローカル実行した結果である。remote CI、既存Windows実装との独立対照、実機成功を意味しない。

## GitHub初期設定時の再試験（2026-09-21）

初期パッケージを展開した作業ディレクトリで `make test`、`make sanitize`、`make wasm-smoke` を再実行し成功。native/ASan/UBSan各3/3、WASMとJSラッパーが成功。P00〜P13のGitHub Issue #1〜#14を登録した。GitHub Actionsの結果はActionsを参照。以下の表は初期パッケージ納品時点の履歴であり、今回のGitHub登録前の状態を記録している。

## 実行環境

Linux x86_64、GCC 14.2.0、Clang 17.0.0、CMake 3.31.6、Python 3.13.5、Node.js 22.16.0。ブラウザ試験に使用した実行ファイルはChromium 144.0.7559.96。emcc/emcmake/認証済みghは利用できなかった。

## 結果

| コマンド/対象 | 観測結果 |
|---|---|
| `make test` | CTest 3/3成功: cjr_native、license_guard、bootstrap_unit |
| `build/native/test_cjr` | 24グループ成功。手計算golden、境界値、破損入力などを含む |
| `make sanitize` | Clang ASan/UBSanで同じネイティブ試験が成功。検出された領域外アクセス・未定義動作なし |
| `make wasm-smoke` | Clangで実際のWASMを生成。Node.jsでgolden、8種のサイズ境界、checksum異常、容量/ABI引数検証に成功 |
| `tests/wrapper_smoke.mjs` | Web画面と同じJSラッパーをNode.jsから実行。inspect/pack、独立出力コピー、エラー表示用情報、入力検査が成功。fetchはローカルファイルのstub |
| `tests/test_bootstrap.py` | 6件のoffline unit testが成功。名前/private属性/依存順/パス検査等。実GitHub書込は含まない |
| bootstrapの引数省略/dry-run | private予定名と14件のIssueを正しい依存順で表示。リモート変更なし |
| `python3 -m py_compile scripts/*.py tests/*.py` | 成功 |
| `node --check web/app.mjs` / `web/codec.mjs` | 成功 |
| `bash -n scripts/build_wasm_smoke.sh` | 成功 |
| `tests/browser_smoke.py` | **ブロックされた**。ローカルHTTPページへの遷移で `net::ERR_BLOCKED_BY_ADMINISTRATOR`。UI試験部分には到達していない |
| 正式Emscriptenビルド | **未実行**。Clang直接WASMの試験と区別する |
| GitHub Actions / private repo作成 / Issue作成 / push | **未実行** |
| VJR-200/JR2Rescueとの独立差分比較 | **未実行** |
| ROM起動 / WAV変換 / JR-200実機 | **未実装・未実行** |

ブラウザ側のアクセス制限は変更していない。ブラウザテストスクリプトは同梱するが、HTTP配信、CSP、ファイル選択、ダウンロードの実動作を確認済みとはしない。JSラッパーのNode試験はこれらの代替ではない。

## ネイティブ24グループの内訳

1. 手計算した47バイトgoldenとの一致
2. ペイロード長1/255/256/257/511/512/513/65024
3. 0〜255の全バイト値
4. BASICの$0801とbaud指定
5. goldenの全切断位置
6. ヘッダーチェックサム異常
7. データチェックサム異常
8. 各ブロックのmagic異常
9. フッターと末尾余剰データ
10. ヘッダーなしの明示指定
11. 生メタデータの保持
12. 離れたアドレスを保持
13. 非連続ブロック番号の診断
14. フッターアドレス相違を勝手に修復しない
15. 未知のファイル種別の保持と警告
16. アドレスoverflowと上端境界
17. エンコーダ引数と出力のtransaction性
18. 標準writerのブロック数上限
19. 入力上限とnull pointer
20. 無効入力で途中callbackを呼ばない
21. 解析失敗時にsummaryを途中更新しない
22. データなし/非標準ヘッダーの警告
23. C ABIのブラウザ側引数検証
24. 決定的な破損・変異入力12,000件

12,000件の変異試験は限定的なsmoke testであり、全入力空間の網羅、継続的libFuzzer運用、安全性の証明ではない。

## 独立性の制限

goldenは公開形式に基づく手計算値である。サイズ境界の多くは本コーデックのencode/inspectの組合せであり、同じ間違いを双方が共有する可能性がある。したがってP03で独立した既存実装との対照が必要である。CJR→WAV→CJRの自己往復も将来それだけでは実機受入にしない。

## ライセンス原文の照合

`LICENSES/VJR200.txt`は `blob <byte-length>\0<original-bytes>` のSHA-1が上流のGit blob `8cad34867bad988f97fc237a9259e338f0bedf99` と一致することを確認した。原文改行等の自動変換を防ぐため `.gitattributes` に `-text` を指定している。

この照合は原文保持の検査であり、上流全ファイルの権利監査や法的助言を代替しない。
