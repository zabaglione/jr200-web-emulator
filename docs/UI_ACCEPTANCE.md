# UI-00〜UI-05 Full HD・仮想キーボード受入記録

確認日: 2026-09-22。対象はGitHub Issue #15〜#20であり、初期計画IDのP15〜P20ではない。
UI変更はprivate repository内のWebアプリだけを対象とし、Pages、公開範囲、デプロイ、課金設定を
変更しない。物理JR-200とのWAV往復はP12（Issue #13）の未検証範囲として分離する。

## Issue対応

| Issue | 実装・証拠 |
|---|---|
| #16 UI-01 | 上部操作を1行へ圧縮し、中央の320×224整数倍画面を優先、右側340px補助パネルへ再編。仮想キーボードは既定で閉じ、表示時も固定幅または画面横へ配置 |
| #17 UI-02 | シルバー／ライトグレー外装、チャコールキー、青い機能キー。CSS変数、形状・枠を併用した押下／ラッチ／focus／disabled表示 |
| #18 UI-03 | 英数／カナ／GRAPH、SHIFT／CTRL、制御キーを一つの純粋な解決表へ集約。CTRLはMN1271 KSTATに応じて制御コードまたはWindows版互換のJR BASIC keyword入力へ切替。FONT・標準文字RAM・ユーザー定義文字を区別する副作用なし字形API |
| #19 UI-04 | ROM由来8×8字形を表示する仮想キーボード、物理キーとの共有入力controller、入力元別の押下所有権、短時間tap、解除・focus喪失処理 |
| #20 UI-05 | 合成ROM／fontによる自動回帰、実ROM／fontによるChrome・Firefox・Safari確認、固定性能シナリオ、既存機能の回帰確認 |
| #15 UI-00 | #16〜#20をまとめる親Issue。子Issueの受入後に完了とする |

## 実装境界

- 画面は320×224のまま、`image-rendering: pixelated`と整数倍率を維持する。中央256×192の
  表示領域と、CRTCの下位3bitで指定するTV外周色を左右32px・上下16pxに描く。画面自体を
  16:9へ引き伸ばさない。
- 仮想キーボードは補助機能として既定で閉じる。1920px幅では画面を3倍のまま保ち、表示した
  keyboardを右横へ置く。1536／1280px幅では画面を2倍にし、keyboardを最大620pxで中央へ置いて
  横方向へ引き伸ばさない。
- 補助パネルは通常340pxで、長いファイル名、エラー、録音、デバッガ履歴はパネル内部を
  scrollさせる。狭いCSS viewportでは縦配置へ切り替え、ページ横方向へはみ出させない。
- `web/keyboard.mjs`の解決表を、キー表示・物理入力・仮想入力で共有する。入力モードは
  controllerが保持し、画面属性やキャラクタRAM種別とは独立させる。
- CTRLは固定Windows版の`Mn1544.cpp`と同じく、MN1271 register 3のKSTAT bit 7を参照する。
  KSTAT=1またはSHIFT併用時はneutral control code、KSTAT=0かつSHIFTなしではJR BASIC用の
  直接codeとkeyword列を使う。物理keyboardは同時押し、仮想CTRLは次の1keyだけに効く補助
  latchとし、keyword列の入力中は別keyを混在させない。
- ABI 8で2 playerのactive-low joystick setterを追加した。この受入時のsystem ABI 9は、
  ABI 7までのFONT asset、`$D000`標準文字RAM、`$C000`ユーザー定義文字RAM、
  カセットロードモニターとABI 8のjoystickに加え、RAM拡張2種と初期化patternを
  公開する。書込み内容が変わった場合だけ該当文字領域のgenerationを更新する。
- 仮想キーは標準文字RAMの初期化前には操作不可と明示する。初期化待ちのpreviewには
  読み込んだFONTを使えるが、OS fontや埋込み字形を成功時の代用品にしない。
- 右側の編集・cursor群は主キー列から分離し、BREAK、INS／DEL、`↑`、`←`／`→`、`↓`の
  5段とする。BREAKとDELの右辺を揃え、上下キーは左右キーの中間と同じ中心軸に置いて
  cursorキーを十字に見せる。
- pointer、物理keyboard、支援技術による各入力元を分け、同じキーの一入力元だけが離れても
  他入力元を解除しない。pointercancel、lostpointercapture、blur、非表示、reset、
  キーボード非表示では全入力と補助ラッチを解除する。blur／非表示時のCPU停止は既定OFFで、
  利用者設定がONの場合だけ停止する。最短押下は45msである。
- 物理キーはCanvasまたは仮想キーにfocusがある場合だけ捕捉する。フォーム、IME変換中の
  通常文字、Meta／Alt、ブラウザshortcutをJR-200へ転送しない。Canvas上のCTRL併用キーは
  macOS日本語入力がcomposition扱いにしてもJR-200側を優先する。
- Gamepad APIで検出した接続中の1台目を1P、2台目を2Pへ割り当てる。1台だけの場合は
  Gamepad indexに関係なく1Pとし、1P切断後に2Pだけ残った場合も1Pへ繰り上げる。
  左stick／D-padを方向、button 0／1をA／Bへ変換する。切断とfocus喪失ではニュートラルを送り、
  復帰・boot・reset時に再同期する。仮想keyboardのcursor入力とUI focus移動には使用しない。
- Windows版差分としてbutton 0〜31のA/B指定、方向以外の任意buttonをAにする1button互換、1Pの強制joystick
  モードを追加する。強制モードは1P portをneutralにし、方向をcursor code、
  A/Bを選択したJR codeとして共通入力controllerへ渡す。
- 本体音声は既定ONの待機状態だが、ページ表示だけではAudioContextを作らない。最初の「起動」
  操作で開始し、以後は明示停止／再開、音量、muteを扱う。通常key入力はPB6が有効な場合だけ
  key clickを生成する。

## レイアウト・表示試験

合成ROM／fontを使う`tests/browser_smoke.py`をPlaywright 1.63.0と実Google Chrome
153.0.8010.53で実行した。CSS viewportとdevice pixel ratioは別に設定し、次を確認した。

| ブラウザ | CSS viewport | DPR | 画面倍率 | ページ全体のoverflow | 結果 |
|---|---:|---:|---:|---|---|
| Chrome 153 | 1920×960 | 1 | 3倍（960×672） | 縦横なし | 合格 |
| Chrome 153 | 1920×1080 | 1 | 3倍（960×672） | 縦横なし | 合格 |
| Chrome 153 | 1700×840 | 1 | 3倍／keyboard表示時は自動2倍 | 縦横なし | 合格 |
| Chrome 153 | 1536×768 | 1 | 2倍（640×448） | 縦横なし | 合格 |
| Chrome 153 | 1280×720 | 1 | 2倍（640×448） | 縦横なし | 合格 |
| Chrome 153 | 1920×1080 | 2 | 3倍（960×672） | 縦横なし | 合格 |

仮想keyboardは既定で非表示である。1920×960では表示しても画面右横へ収まり、画面は3倍の
まま変わらない。1536×768と1280×720では表示時も最大620pxの中央配置となり、画面は2倍の
まま変わらないことを自動確認した。

各条件で補助パネル幅、デスクトップ用compact keyの高さ25px以上（Full HD横配置は29px以上）、
BREAK／DELの右辺一致、cursor群の上下中心軸・左右同段・2px以上の間隔、
画面の整数倍率、長いファイル名・エラー・debugger・録音状態を検査した。通常UIの文字色と背景色の定義値はWCAG 2.2 SC 1.4.3の計算法で
4.5:1以上だった。押下、ラッチ、focus、disabledは色だけでなくinset、outline、枠形状、
`aria-pressed`／`disabled`でも表す。

次のSafari／Firefoxの記録は、画面優先・compact keyboardへ変更する前の実ブラウザ確認である。
現行レイアウトはChrome 153の合成試験まで確認し、Safari／Firefoxでは未再試験である。

実Safari 26.6.2ではmacOS SafariのView menuでActual Sizeが100%であることを確認し、
Zoom Inを2回行った実125%でも確認した。125%時は縦配置へ切り替わり、横方向の切断はなく、
許容した縦scrollで全機能へ到達できた。これは実browser zoomの確認であり、DPR試験の代用では
ない。GUI確認では正確なCSS viewport値を取得していないため、上のviewport表には含めない。

Firefox 156.0はSelenium 4.49.0の隔離container内の実Firefoxを使用した。WebDriverの
inner size 1918×968、DPR 1で画面640×448、補助パネル370px、最小キー44px、ページoverflow
なしを得た。検体directoryはread-only mountとし、成果物やlogへ検体をコピーしなかった。

## 入力・字形試験

合成試験では次を自動確認した。

- 英数、SHIFT記号、カナと修飾、GRAPHと修飾、cursor、編集、BREAK/NMIの解決。
- CTRLのneutral code、KSTAT=0時の直接code、`CTRL+A`の`AUTO`を含むJR BASIC keyword列、
  SHIFT併用、仮想CTRLの1回だけのlatch、物理`Control+C`／`Control+A`。
- JIS／USの`KeyboardEvent.code`対応、macOS JISの`]`／`Backslash` code補正、物理・仮想の
  相互モード反映、SHIFT／CTRL補助ラッチ。
- macOS日本語入力がcomposition扱いにした物理`Control+3`をCanvas上で抑止し、JR BASICの
  `SAVE `列として処理すること。IME変換中の通常文字とフォーム入力は引き続き捕捉しない。
- 同一キーの物理＋仮想入力、二pointer、mode変更中の離上、45ms未満のtap、連続tap。
- pointer領域外離上、pointercancel、lostpointercapture、blur、tab非表示、reset、
  キーボード非表示で押下・ラッチが残らないこと。blur時は既定で実行を継続し、設定ON時だけ
  CPUと音声を一時停止すること。
- FONTの8行、MSB-left、コード対応、`$D000`／`$C000`の独立generation、同値書込み、
  FONT交換、reset、文字RAM更新でのcache失効。
- 字形照会前後でCPU register、memory、cycle、IRQ、入力状態が変わらないこと。
- 変更のないframeで仮想キーDOM数、listener数、glyph cache数が増えないこと。
- キー上の合成字形、入力コード、通常画面に描画された同コードのpixel一致。
- `$CA00`へ7を書いたframeでCanvas左上の外周pixelが赤`[255,0,0,255]`となり、中央表示領域と
  別に描画されること。
- buttonの読み上げ名、`aria-pressed`、keyboard focus、フォーム入力・browser shortcutの非捕捉。
- 合成Gamepad APIの2台を通常MN1544 scanで`EA`／`D5`として読み、2P切断で`FF`、1P切断で
  残った2Pが1Pへ移って`D5 FF`、focus喪失で両player `FF`、復帰で元の状態へ戻ること。
  物理USB／Bluetooth controllerは未確認。
- button mappingの変更、1buttonのAへの集約、強制モードのcursor codeと
  1P port `FF`、解除後の再同期。
- Quick Typeの複数byte入力、ESC中止、macroの`\r`、ローマ字`KA`／`KKA`の
  半角カナ`$B6`への変換。自動入力の各codeはMN1544が観測するまで少なくとも1回の
  実行区間で押下状態を保つ。
- 1〜5倍／自動画面、横85%のビデオ相当画素比、90度回転、smoothingの
  Canvas内部サイズとCSS表示サイズ。1700×840・keyboard表示中も手動1倍は320×224を維持する。
- 全画面ボタンでscreen shellへ入り、Canvas上の`Alt+Enter`で通常表示へ戻る。
- CPU速度の反映表示、RAM設定の次回reset表示、64 KiB memory dump、
  CJR高速ロードの`$7000` payloadと通常cassette経路との区別。
- マシン語CJR選択時の先頭ロードアドレス表示と自動起動button、未対応file typeでの無効化。
- 実AudioContextを追跡する独立browser contextで、起動前は音声既定ONかつcontext 0、
  起動操作後はrunning、停止後はsuspended、再開後はrunningとなること。決定的PCM検査では
  fake 48 kHz contextを使い、仮想Aキー操作後に追加されたsourceだけに通常MN1544 handshake
  由来の非0 key-click PCMがあること。
- CPU 1000%を継続してもWeb Audioの予約先行が300 ms以下、active sourceが30未満で、
  速度を戻した時に長い遅延音声が残らないこと。

権利確認済みの実ROM／fontはGit対象外で使用し、Chrome 153、Firefox 156.0、Safari 26.6.2で
BASIC起動、FONTから標準文字RAMへの転送、Key Aの実字形、英数／カナ切替、通常入力を確認した。
Firefoxでは`LIST`／`RUN`、Safariでは100%／125%表示と押下状態の解除も確認した。当時確認した
focus喪失停止は既定値変更前の挙動であり、現行の継続／設定停止切替はChrome 153の合成試験で
確認した。Firefox／Safariではこの切替を未再試験である。この受入試験で使用したROM、font、利用者file名、hash、実データのscreenshotはrepository、
CI artifact、本文書へ含めない。この三ブラウザ確認は実データでのWeb動作であり、物理JR-200の
key matrixやWAV互換を示さない。

2026-09-25に、別途依頼されたREADMEの操作説明用として、利用者所有の実機MSAVE録音から
用意したROM・fontをlocalhostのブラウザで起動し、画面だけを撮影した。
この1枚は上記の初回UI受入証拠画像とは別に扱う。ROM・fontのバイナリ、録音、
利用者のローカルpathは公開しない。画像内の第三者の表示と字形は本プロジェクトの
BSDライセンスの対象外であり、実機互換の証拠でもない。

## 回帰・性能

正式Emscripten 6.0.9 siteに対するbrowser smokeでは、CPU／表示、Web Audio、通常CJR
cassette、debugger、CJR検査・BIN包装、WAV encode／decodeを操作し、page error、console
error、外部requestがないことを確認した。native、sanitizer、直接WASM、Emscripten module、
JS wrapperのglyph/input回帰も実行する。

固定3秒の合成ROM／font、1920×960、DPR 1、fake 48kHz AudioContextによる比較結果は次の通り。
cycle値はbrowser／host上の相対的な回帰指標で、JR-200実機性能の測定ではない。

| 対象 | cycles / 3秒 | cycles/s | Web Audio underrun | core overflow |
|---|---:|---:|---:|---:|
| 変更前 `6fcc41300be7561c899fc6f8371277348a2c1ffa` | 3,370,444 | 1,123,481 | 0 | 0 |
| UI変更後候補 | 3,415,044 | 1,138,348 | 0 | 0 |

同じChrome 153上でUI変更後は約1.3%高く、今回の固定シナリオでは速度低下や音声underrunを
観測しなかった。測定の再実行には`tests/ui_performance_probe.py`を使う。

## 実行手順

```sh
make test
make sanitize
make wasm-smoke
make wasm
make browser-setup
make browser-smoke
CHROMIUM_EXECUTABLE='/path/to/Google Chrome' \
  python3 tests/ui_performance_probe.py --site build/site
```

`make browser-setup`は固定Playwright依存をGit対象外の`.venv/`へ一度だけ導入し、
`requirements-ci.txt`が変わるまで再インストールしない。browser smokeは既存Chrome／Chromiumを
優先し、必要な場合だけ`CHROMIUM_EXECUTABLE`で明示する。

実データ試験は、検体へ到達できるWebDriver endpointとread-onlyのROM／font pathを明示して
`tests/webdriver_real_rom_smoke.py --browser firefox|safari`を使う。Safariのremote automationが
無効な環境では設定を無断変更せず、実Safariでの手動確認を別記録にする。

## 出典・配布境界

入力割当とkey codeは固定VJR-200 commitの`Mn1544.cpp`とVJR-200操作説明を照合した。
`web/keyboard.mjs`にはFINDの著作権表示、BSD-3-Clause SPDX、固定上流を明記し、
`LICENSES/VJR200.txt`と`THIRD_PARTY_NOTICES.md`を配布する。配色は日本向けJR-200の公開写真を
観察した設計上の解釈で、公称色値とは称さない。現行の数字列、QWERTY列、左右SHIFT、
下段モードキー／SPACE、独立cursor群は利用者提供の実機写真を配置参照にしたが、写真自体は
転載しない。実機写真、logo、ROM・fontの元データや字形一覧は配布物へ含めない。
READMEの起動画面だけは、上記の説明目的で撮影した画像として区別する。
通常文字の4.5:1基準はW3C WCAG 2.2 SC 1.4.3を参照した。参照URLは
[UPSTREAM.md](UPSTREAM.md)に集約する。

以上は#15〜#20のWeb UI受入範囲である。P12（Issue #13）の生成WAVの物理JR-200読込、
実機SAVE/MSAVE、独立2回録音は未実施であり、本結果で代替しない。
