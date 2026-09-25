# 実装・検証状況
初期基準日: 2026-09-22 / 更新日: 2026-09-25 / 初期パッケージ0.0.1

## リポジトリ初期設定：完了

対象: `zabaglione/jr200-web-emulator`（初期構築時はprivate）、既定ブランチ `main`。
初期ソース・開発文書・ライセンス・CI設定の57ファイルをcommit `072e977343c8aa7655367f926bc29b2b220e93e1` に登録した。Git tree `854042e76159dd80bebd9210387d567e2e1a37c8` が、ローカルで独立計算した全ファイルのtreeと一致した。

P00〜P13は実際のIssue #1〜#14として登録済み。UI follow-upは別系列のIssue #15〜#20であり、P15〜P20という初期計画IDではない。対応と依存関係は [ISSUE_INDEX.md](ISSUE_INDEX.md)。旧bootstrapによる新規作成は不要である。

## GitHub Actions：初回4ジョブ成功

対象commit: `072e977343c8aa7655367f926bc29b2b220e93e1`
実行: [source-and-codec / run 35616519996](https://github.com/zabaglione/jr200-web-emulator/actions/runs/35616519996)
トリガー: mainへのpush。GitHubから取得したstatusはcompleted、conclusionはsuccess。

| ジョブ | 実行内容 | 結果 |
|---|---|---|
| native (ubuntu-latest) | make test | success |
| native (macos-latest) | make test | success |
| sanitized | make sanitize | success |
| wasm-codec | make wasm-smoke | success |

ローカルでもmake testとmake sanitize各3/3、WASMとJSラッパー、make checkが成功。FINDライセンスの原文blob一致、配布表記、ソース限定inventoryも検査した。初期のローカル試験詳細は [TEST_RESULTS.md](TEST_RESULTS.md)。古い計画表のremote CI未実行という記述は、この実測結果で更新する。

## GitHub Actions：remote検証を再開

2026-09-22、利用者がActions予算を設定して追加実行を許可したため、P11のremote検証を
再開した。実装commitを含むhead `92722edc10aab6558337b5fbda43fff20f431308`のrun
`35672191674`は4ジョブすべてsuccessだった。Codexから課金設定は変更していない。

## 実装済みの範囲

P00: 2026-09-22受入完了。上流commit・CJR由来・FINDライセンス原文を固定し、Emscripten配布物から全文へHTTP到達できることを確認。未取込のCPU等は監査対象外であり、監査済みではない。
P01: 2026-09-22受入完了。C++20共通ライブラリ、容量付きC ABI、native/Clang直接WASM、正式Emscripten、CMake/Make、sanitizer、4ジョブCIを確認。
P02: 2026-09-22受入完了。CJR構造/チェックサム検査、元バイト保持、BIN包装、CLI、WASM検査画面を合成データで確認。独立既存実装との互換はP03に残す。
P03: 2026-09-22受入完了。JR2Rescue 0.6.2の固定Windows向けバイナリをMono上で実行し、自作データの標準MSAVE/BASIC、境界長、600/2400、マルチ領域、headerlessを対照した。標準出力は全バイト一致し、600 baudの新規writer値を実測の100へ合わせた。
P04: 2026-09-22受入完了。VJR-200/MAMEのMC6800ファイルを個別監査し、明示bus/IRQ/NMI/wait APIを持つ固定幅コアへ移植した。合成ROMの命令・flag・stack・割込・境界とnative/直接WASMの同一traceを確認した。
P05: 2026-09-22受入完了。Address/MN1271/MN1544/CRTC/JRSystemを個別監査し、CPUとメモリmap、timer/IRQ、key handshake、CMT REMOTE、PCM queue、ARGB framebufferを明示cycle clockで接続した。native/直接WASM/正式Emscriptenの合成試験を確認した。
P06: 2026-09-22受入完了。Emscripten 6.0.9を固定し、結合/分割ROMとフォントのローカル選択、入力検査、Canvas、キー押下/離上、NMI、ポーズ、リセット、フォーカス喪失停止、明示許可式IndexedDBを接続した。利用者提供の実機MSAVE録音をGit対象外でJR2Rescue 0.6.2により抽出し、Chrome 153、Firefox 156、Safari 26.6.2でJR BASIC 5.0のプロンプトと入力を確認した。詳細は [P06_BROWSER_ACCEPTANCE.md](P06_BROWSER_ACCEPTANCE.md)。
P07: 2026-09-22受入完了。OS非依存コアとWeb UIへ、実行前breakpoint、1命令step、命令完了後read/write watchpoint、register表示、手動256 byte peekを接続した。break/watch各16件、命令256件、CPUアクセス512件の固定上限と破棄件数を持ち、履歴有効/無効で全メモリ・register・cycleが一致することをnative/WASMで確認した。実装commit `f85aa1d3db234db71baf91b59779ea84aafe01df` のActions run `35650269016`は4ジョブすべてsuccess。詳細は [P07_DEBUGGER_ACCEPTANCE.md](P07_DEBUGGER_ACCEPTANCE.md)。
P08: 2026-09-22受入完了。OS非依存の固定容量カセットtransportをMN1271のREMOTE/read/writeへ接続し、標準BASIC/マシン語CJRのmount/eject/rewindとLOAD/MLOAD/SAVE/MSAVEを通常信号経路で確認した。正式Emscripten siteの実ROMでBASIC 2行と4 byteの自己往復、および実機MSAVE録音から独立ツールで復元した2048 byte font CJRの通常MLOADを確認した。WAV復元自体は本実装ではない。実装commit `a0cc4c6a96b4c993d2d5bfc84f3280d75dd15426` のActions run `35657825103`は4ジョブすべてsuccess。詳細は [P08_CASSETTE_ACCEPTANCE.md](P08_CASSETTE_ACCEPTANCE.md)。
P09: 2026-09-22受入完了。44.1 kHz固定PCM queueをWASMから一括drainし、利用者操作式Web Audio、既定20%/上限50%のgain、sample rate表示、underrun/overflow計数、mute、pause/resume/disable時のsource停止とqueue破棄を実装した。正式Emscripten siteの実ROMで`SOUND 440,50`から非0 PCM 45945 frame、peak 7000を観測し、overflow/underrun 0、停止後active/queue 0を確認した。物理出力の音圧・panは未計測。実装commit `904781db9c1e2cfefed6237d3d088ee171c3fe33` のActions run `35661382620`は4ジョブすべてsuccess。詳細は [P09_AUDIO_ACCEPTANCE.md](P09_AUDIO_ACCEPTANCE.md)。
P10: 2026-09-22受入完了。P08と共通の4800 Hz信号源から12-bit frame、固定600 baud header、CJR header追従または明示600/2400のdata、VJR-200由来leader/intervalをRIFF PCM mono16の44.1/48 kHzへ累積有理時刻で出力するCLI/WASM/Web機能を実装した。JR2Rescue 0.6.2との4波形比較でhalf-span/位相patternが一致し、独立decodeした4 CJRは各入力と全byte一致した。JR2Rescueの短いleader/interval差と実機未検証は残す。実装commit `b89a9d1717cd892ced06ea5ff8d2ffc2bfa00dfc` のActions run `35666390234`は4ジョブすべてsuccess。詳細は [P10_WAV_ACCEPTANCE.md](P10_WAV_ACCEPTANCE.md)。
P11: 2026-09-22受入完了。RIFF/PCM検査、DC/RMS/極性/channel/half-span/実測baud診断、frame/block/checksum/CJR検証、CLI/WASM/Webの候補隔離を実装した。JR2Rescue生成4 WAVと、Git対象外の利用者提供録音3本を独立復元済みCJRへ全バイト照合した。native/sanitizer各9/9、直接WASM 7系統、Emscripten 6.0.9、Chrome 153 browser smokeはローカル成功。実装commit `756d69c4363620bac19a9b936a757e92a47e5fa3`を含むheadのActions run `35672191674`は4ジョブすべてsuccess。詳細は [P11_WAV_DECODE_ACCEPTANCE.md](P11_WAV_DECODE_ACCEPTANCE.md)。
P13: 2026-09-22受入完了。P12を初版後へ延期し、P00〜P11のprivate初版0.0.1を監査した。SPDX 2.3 SBOM、Git tracked 109ファイルと一致するsource allow-list、13ファイルのWeb配布境界、fresh cloneでnative/直接WASM/Emscripten 6.0.9再ビルドを確認した。実装head `dff63edd501b8f4598718283ec93fe4338c73c60`のActions run `35675108809`はUbuntu/macOS native、sanitizer、WASM、Playwright/Chromium browserの5ジョブすべてsuccess。repositoryはprivate、Pagesなし、artifact 0、releaseなしで、P12はopen・実機互換未検証のまま残す。詳細は [P13_RELEASE_ACCEPTANCE.md](P13_RELEASE_ACCEPTANCE.md)。

UI follow-up #15〜#20: 2026-09-22受入。Full HD向けの操作バー・整数倍画面・仮想keyboard・右補助パネル、シルバー／チャコール／青のtheme、英数／カナ／GRAPHの共有key解決、FONT／文字RAMの副作用なしglyph API、物理・pointer入力元別の解除処理を実装した。合成ROM／fontで1920×960・1920×1080・1536×768・1280×720、DPR 1／2、入力・cache・既存機能を自動回帰した。権利確認済み実ROM／fontでChrome 153、Firefox 156、Safari 26.6.2を確認した。詳細は [UI_ACCEPTANCE.md](UI_ACCEPTANCE.md)。remote CIとIssue closureの証拠は各GitHub Issueに記録する。

ブラウザジョイスティック追補: system ABI 8で2 playerのactive-low状態を公開し、Gamepad APIで検出した接続中の1台目を1P、2台目を2Pへ割り当てた。1台だけならGamepad indexに関係なく1Pとし、1P切断後に残った2Pも1Pへ繰り上げる。左stick／十字キー、A／B、切断時の個別ニュートラル化、focus喪失時の全入力解除、復帰時の再同期を実装した。native、直接WASM、正式Emscripten、Chrome 153の合成Gamepad API試験で`EA`／`D5`と、1台だけ残った場合の`D5 FF`を通常MN1544 scanで確認した。物理USB／Bluetooth gamepadの機種別試験は未実施である。

音声追補: 本体音声を既定ONの待機状態とし、ブラウザの自動再生制限に従って最初の「起動」操作でAudioContextを開始する。サービスマニュアルにあるPB6 key detection sound gateを共通コアへ追加し、実ROMの`POKE 0,0`で無音、`POKE 0,64`で非0 PCMを確認した。別key codeの重複押下、同一key hold、PB6途中無効化、音声開始中の停止競合も自動試験した。波形は資料に規定がないため2400 Hz・6 ms・peak 7000の近似で、物理実機との録音比較は未実施である。固定VJR-200 Windows版ソースは`KEYSOUND`定数だけを持ち、生成・mixは未実装だった。Playwright 1.63.0はGit対象外`.venv/`へ固定し、Chrome 153の実AudioContext lifecycleとfake contextによる決定的PCM browser smokeに成功した。

キークリック出力設定追補（2026-09-25）: 本体音声の既定ONは維持し、ブラウザのキークリック出力だけを既定OFFにした。PB6の生成・制御は変更せず、WASMのPCM混合時にクリック成分だけを除外する。AudioパネルからON/OFFでき、設定はブラウザ内に保存する。固定runner v0.3.0は旧ABI 9のため、新ABI 10のWeb UIとは組み合わせない。

設定復元追補（2026-09-25）: 既存localStorageキーを維持したまま、音声ON/OFF・音量・ミュート、WAV生成/解析条件、BIN→CJRフォーム、マクロ選択スロット、デバッガ履歴記録ON/OFFも前回値で初期化する。旧設定は項目ごとに検証して初回値で補完する。新しいCJR選択時のWAV速度は元ファイルの値を優先し、速度変換には明示選択が必要。ファイル選択、実行・録音状態、ヘッダーなし形式の明示許可は復元しない。ROM/フォントは従来の別途保存許可を必要とする。ローカルnative/sanitizer各13/13、直接WASM 9系統、配布検査、Chrome 153 browser smokeは通過。Emscripten正式buildは手元が6.0.10で固定6.0.9と異なるため、CIで判定する。

CTRL・画面優先追補: 固定Windows版`Mn1544.cpp`のKSTAT分岐を再現し、neutral control codeと
JR BASIC用の直接code／keyword列を物理・仮想keyboardの共通解決へ追加した。Windows 11 ARM上の
VJR-200 1.8.2 x64で実ROMの`CTRL+A`が`AUTO`になることを目視確認し、合成Chrome試験で
物理`Control+C`、`Control+A`、仮想CTRLの1回latchを確認した。画面は320×224内の256×192表示と
TV外周色を維持し、仮想keyboardを既定で閉じた。当時の配置では1920px幅で3倍画面の横、1536／1280px幅で
最大620pxの中央へcompact keyboardを置き、横への間延びと画面縮小を防いだ。この時点の配置はChrome 153で
確認済みだが、Firefox／Safariではこの追補後の再試験を行っていない。後続の自動倍率への変更は下記を参照。

Windows機能差分追補: VJR-200 V1.8.2の固定commitを正とし、File、View、
Tools、Optionsの実装をsourceから棚卸した。Webで実現可能なCJR高速ロード、
Quick Type、10件のmacro、ローマ字カナ、64 KiB memory dump、画面1〜5倍／全画面／
画素比／スムージング／回転、CPU 50〜1000%、cassette overclock、RAM拡張2種と
初期化2 pattern、joystick button指定／1button／強制モード、FPS/CLOCK状態を追加した。
1buttonは方向以外の任意buttonをAとして扱う。CPU倍率はWeb Audioの再生倍率にも反映し、
実行を最大50 ms単位で排出して予約先行を250 ms以内に制限する。
RAM設定はsystem ABI 9で共通C++コアへ反映する。state save、JR2、FDD、printer、
debug label/disassembler、recent-file再選択は、不完全な代用を作らず保留した。詳細は
[WINDOWS_PARITY.md](WINDOWS_PARITY.md)。この差分後はnative 10/10、直接WASM/JS 8系統、
Chrome 153 browser smokeで合成ROMによる新規UI配線を確認した。この実装直後はremote CI、物理JR-200、
物理gamepadでの追試は未実施だった。後続commitのCIは下記を参照。

画面自動倍率・CTRL表示追補（2026-09-25）: 画面倍率の既定を「自動」にし、表示領域の幅と高さから
縦横比を保った最大倍率を連続計算する。1〜5倍の固定倍率は選択肢として残す。
仮想keyboardのCTRL時はJR BASICの機能ラベルを表示し、全キーを一律に枠付きへはしない。
Chromeの合成ROM回帰を行い、この変更を含むcommit `b7103bd` の
[source-and-codec CI](https://github.com/zabaglione/jr200-web-emulator/actions/runs/36102302269)は5ジョブすべて成功した。
2026-09-25の対象commit `535f40a` でも
[CI](https://github.com/zabaglione/jr200-web-emulator/actions/runs/36105566715)と
[Pages](https://github.com/zabaglione/jr200-web-emulator/actions/runs/36105832612)は成功した。
後続の文書変更と起動画面画像は、この対象commitの検証範囲に含まれない。

## 未実装・未検証

WAV→CJR decoderは実装・remote CIまで受入済みだが、実機との生成WAV往復は未実施である。
P09のWeb Audio接続、P10の独立tool decode、P11の利用者提供録音
decodeは、物理出力の音圧・pan、実機register/timing、本実装生成WAVのJR-200実機互換を
示さない。ROM/フォント・商用ソフト・録音は未同梱である。

Emscripten 6.0.9による正式ビルド、生成モジュールのNode試験、合成ROMの直接WASM/JS試験、実ROMの三ブラウザ試験を2026-09-22にローカル実行した。ChromeとSafariはmacOSの実ブラウザ、Firefoxは読み取り専用検体mountを持つ隔離コンテナのWebDriverで確認した。これは物理JR-200のkeyboard、video出力、WAV互換を示さない。

Gamepad入力は合成APIでブラウザ配線まで確認したが、物理controllerの接続、機種固有mapping、無線切断は未実測である。

Windows版のstate save/load、JR2、FDD、printer、debug label/disassemblerは未実装である。
それぞれ全machine状態のversion付き直列化、別media/peripheral、symbol/命令表示の設計が
必要なため、今回のWeb UI差分で代用実装は行っていない。

キークリックのPB6制御とブラウザPCM経路は確認したが、実機波形、周波数、継続時間、音量は未計測である。

## 次の作業

#1 (P00)〜#12 (P11)、#14 (P13)、UI follow-up #15〜#20は受入範囲を完了した。
P12（#13）の実機WAV往復だけは初版後の未検証項目としてopenのまま残す。再開時は
HARDWARE_TEST_PLAN.mdに従い、生成WAVの物理JR-200読込と独立2回録音を実測する。

2026-09-22時点ではprivateを維持し、Pages/外部公開デプロイ、アクセス権・branch protectionは変更していない。以後の公開判断と検査状況は[PUBLICATION_AUDIT.md](PUBLICATION_AUDIT.md)を参照する。

2026-09-23の公開追補では、P12の物理WAV往復を未検証の制限として維持しつつ、固定Emscriptenで生成する`build/site`のみをGitHub Pagesへ配信する手順とワークフローを追加する。リポジトリ可視性、Pagesの有効化、配信成功、公開URLでの実行はそれぞれ別に確認する。[Pages配信手順](PAGES_DEPLOYMENT.md)を参照する。

2026-09-23にリポジトリをpublicへ変更し、GitHub Actionsを配信元とするPagesを有効化した。初回公開のCI・PagesとROMなし実ブラウザ確認の結果は[公開前検査記録](PUBLICATION_AUDIT.md)に追記した。P12は引き続きopenであり、公開サイトでのWASM初期化は物理JR-200とのWAV互換を示さない。

作品IDリンク追補: JR-100方式を参考に、同一Pagesの固定カタログ・SHA-256を使う
`?game=<id>`のCJR自動マウントをローカル実装した。Nodeと合成ROM/FONTのChrome試験では
通常カセットへのセットと起動後の保持を確認した。ローカル保有の実ROM/FONTと
RELIC DIVE開発版CJRでも、Chromeのlocalhost上でマウントと起動後の保持を確認したが、
リンク経由のMLOAD／USR実行までは確認していない。現在の公開用カタログは空で、
SIDE CATCH・RELIC DIVEなど開発中のCJRはPagesへ配信していない。
[作品リンクの契約](GAME_LINKS.md)を参照。remote Pagesでの新機能稼働や
作品別MLOAD／実行の確認は、コードの公開・配信後に別途必要である。

起動支援追補（2026-09-25、ローカル検証）: `?game=<id>&launch=1`を追加し、
対応ROMのBASIC入力待ち、今回の通常カセット読出し、終端・REMOTE OFF、
全ロードbyte一致と新しいBASIC入力待ちを確認してから、カタログ固定のUSRを入力する。
所有ROM/FONTとSIDE CATCH／RELIC DIVE開発版CJRを用いたlocalhostのChrome 153で、
初回選択と保存済みROM/FONTの両方から通常MLOAD/USRを通る起動を確認した。
両作品のタイトル画面と入力後の画面も撮影した。合成ROMは起動支援を拒否する。
Firefox、Safari、公開Pagesの作品カタログとWikiリンク、実機動作は未確認である。

起動パック追補（2026-09-25、ローカル検証）: `pack.json`、CJR、`launch.txt`を
フォルダーまたはstored/deflate ZIPから取り込み、SHA/サイズ/CRCとZIP構造を検査する。
任意の入力テキストは入力支援欄へ置くが自動入力せず、MLOAD→USRとタイトルマーカーの
条件を満たす場合だけ既存の通常カセット起動支援へ接続する。Chrome 153でフォルダー、
2種類のZIPの取込、所有ROM/FONTでSIDE CATCHとRELIC DIVEの圧縮ZIPからの通常起動を
確認した。Firefox/Safari、公開ZIP URL、実機は未確認。詳細は[起動パック](LAUNCH_PACK.md)。

7作品配信追補（2026-09-25、ローカル検証）: jr200-devのclean-source ZIPから
SIDE CATCH 0.1.2、RELIC DIVE 0.1.1、その他5作品の0.1.0を固定CJR・
ライセンス・noticeとして取り込んだ。公開用catalog/asset ledgerは7件・33ファイル。
native/sanitizer各13/13、直接WASMとChrome通常回帰に合格し、所有ROM/FONTを
ローカルChromeへ与えたカタログリンクの通常MLOAD/USR起動と開始キー後の画面変化も
7件すべて成功した。
手元のEmscriptenは6.0.10で固定6.0.9と異なるため正式ビルドは未実施。
PagesのCI・公開URL・Wikiリンク・物理JR-200は、この時点のローカル検証には含めない。

7作品の公開Pages受入（2026-09-25）: main `41fe1ecfe36e7d21596d6f677143dee13cab75d9`
の[CI](https://github.com/zabaglione/jr200-web-emulator/actions/runs/36121921425)5ジョブと
[Pages](https://github.com/zabaglione/jr200-web-emulator/actions/runs/36122124483)の
正式Emscripten build/deployが成功した。公開URLでは7件のカタログ、CJRを含む
33配布fileのSHA-256、backend種別を照合し、所有ROM/FONTのローカル選択から
7作品すべての通常MLOAD/USRと開始入力後の画面変化をChromeで確認した。
private Wikiには作品ページを同期したが、開発リポジトリの一般公開と匿名到達性は別作業。
実機JR-200は未確認。
