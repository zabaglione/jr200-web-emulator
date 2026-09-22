# UI-00〜UI-05 Full HD・仮想キーボード受入記録

確認日: 2026-09-22。対象はGitHub Issue #15〜#20であり、初期計画IDのP15〜P20ではない。
UI変更はprivate repository内のWebアプリだけを対象とし、Pages、公開範囲、デプロイ、課金設定を
変更しない。物理JR-200とのWAV往復はP12（Issue #13）の未検証範囲として分離する。

## Issue対応

| Issue | 実装・証拠 |
|---|---|
| #16 UI-01 | 上部操作バー、中央の320×224整数倍画面と仮想キーボード、右側370px補助パネルへ再編。詳細機能は開閉パネル内に維持 |
| #17 UI-02 | シルバー／ライトグレー外装、チャコールキー、青い機能キー。CSS変数、形状・枠を併用した押下／ラッチ／focus／disabled表示 |
| #18 UI-03 | 英数／カナ／GRAPH、SHIFT／CTRL、制御キーを一つの純粋な解決表へ集約。FONT・標準文字RAM・ユーザー定義文字を区別する副作用なし字形API |
| #19 UI-04 | ROM由来8×8字形を表示する仮想キーボード、物理キーとの共有入力controller、入力元別の押下所有権、短時間tap、解除・focus喪失処理 |
| #20 UI-05 | 合成ROM／fontによる自動回帰、実ROM／fontによるChrome・Firefox・Safari確認、固定性能シナリオ、既存機能の回帰確認 |
| #15 UI-00 | #16〜#20をまとめる親Issue。子Issueの受入後に完了とする |

## 実装境界

- 画面は320×224のまま、`image-rendering: pixelated`と整数倍率を維持する。1920px幅では
  通常2倍、キーボード非表示かつ高さに余裕がある場合は3倍を使用する。16:9へ引き伸ばさない。
- 補助パネルは通常370pxで、長いファイル名、エラー、録音、デバッガ履歴はパネル内部を
  scrollさせる。狭いCSS viewportでは縦配置へ切り替え、ページ横方向へはみ出させない。
- `web/keyboard.mjs`の解決表を、キー表示・物理入力・仮想入力で共有する。入力モードは
  controllerが保持し、画面属性やキャラクタRAM種別とは独立させる。
- CTRLは上流のneutral control-code経路を採用する。VJR-200固有のBASIC keyword自動入力は
  host側の便宜機能であり、物理JR-200の単一key codeではないため移植しない。
- system ABI 6は、FONT asset、`$D000`標準文字RAM、`$C000`ユーザー定義文字RAMの
  ready状態、8行のMSB-left字形、領域別generationを副作用なしで照会する。書込み内容が
  変わった場合だけ該当generationを更新する。
- 仮想キーは標準文字RAMの初期化前には操作不可と明示する。初期化待ちのpreviewには
  読み込んだFONTを使えるが、OS fontや埋込み字形を成功時の代用品にしない。
- pointer、物理keyboard、支援技術による各入力元を分け、同じキーの一入力元だけが離れても
  他入力元を解除しない。pointercancel、lostpointercapture、blur、非表示、reset、
  キーボード非表示では全入力と補助ラッチを解除する。最短押下は45msである。
- 物理キーはCanvasまたは仮想キーにfocusがある場合だけ捕捉する。フォーム、IME、Meta／Alt、
  ブラウザshortcutをJR-200へ転送しない。

## レイアウト・表示試験

合成ROM／fontを使う`tests/browser_smoke.py`をPlaywright 1.63.0と実Google Chrome
153.0.8010.53で実行した。CSS viewportとdevice pixel ratioは別に設定し、次を確認した。

| ブラウザ | CSS viewport | DPR | 画面倍率 | ページ全体のoverflow | 結果 |
|---|---:|---:|---:|---|---|
| Chrome 153 | 1920×960 | 1 | 2倍（640×448） | 縦横なし | 合格 |
| Chrome 153 | 1920×1080 | 1 | 2倍（640×448） | 縦横なし | 合格 |
| Chrome 153 | 1536×768 | 1 | 1倍（320×224） | 縦横なし | 合格 |
| Chrome 153 | 1280×720 | 1 | 1倍（320×224） | 縦横なし | 合格 |
| Chrome 153 | 1920×1080 | 2 | 2倍（640×448） | 縦横なし | 合格 |

1920×960、DPR 1で仮想keyboardを隠した場合は3倍（960×672）へ切り替わり、画面下端が
viewport内に収まることも自動確認した。

各条件で補助パネル幅、通常キー44px以上、画面の整数倍率、長いファイル名・エラー・debugger・
録音状態を検査した。通常UIの文字色と背景色の定義値はWCAG 2.2 SC 1.4.3の計算法で
4.5:1以上だった。押下、ラッチ、focus、disabledは色だけでなくinset、outline、枠形状、
`aria-pressed`／`disabled`でも表す。

実Safari 26.6.2ではmacOS SafariのView menuでActual Sizeが100%であることを確認し、
Zoom Inを2回行った実125%でも確認した。125%時は縦配置へ切り替わり、横方向の切断はなく、
許容した縦scrollで全機能へ到達できた。これは実browser zoomの確認であり、DPR試験の代用では
ない。GUI確認では正確なCSS viewport値を取得していないため、上のviewport表には含めない。

Firefox 156.0はSelenium 4.49.0の隔離container内の実Firefoxを使用した。WebDriverの
inner size 1918×968、DPR 1で画面640×448、補助パネル370px、最小キー44px、ページoverflow
なしを得た。検体directoryはread-only mountとし、成果物やlogへ検体をコピーしなかった。

## 入力・字形試験

合成試験では次を自動確認した。

- 英数、SHIFT記号、カナと修飾、GRAPHと修飾、CTRL、cursor、編集、BREAK/NMIの解決。
- JIS／USの`KeyboardEvent.code`対応、物理・仮想の相互モード反映、SHIFT／CTRL補助ラッチ。
- 同一キーの物理＋仮想入力、二pointer、mode変更中の離上、45ms未満のtap、連続tap。
- pointer領域外離上、pointercancel、lostpointercapture、blur、tab非表示、reset、
  キーボード非表示で押下・ラッチが残らないこと。
- FONTの8行、MSB-left、コード対応、`$D000`／`$C000`の独立generation、同値書込み、
  FONT交換、reset、文字RAM更新でのcache失効。
- 字形照会前後でCPU register、memory、cycle、IRQ、入力状態が変わらないこと。
- 変更のないframeで仮想キーDOM数、listener数、glyph cache数が増えないこと。
- キー上の合成字形、入力コード、通常画面に描画された同コードのpixel一致。
- buttonの読み上げ名、`aria-pressed`、keyboard focus、フォーム入力・browser shortcutの非捕捉。

権利確認済みの実ROM／fontはGit対象外で使用し、Chrome 153、Firefox 156.0、Safari 26.6.2で
BASIC起動、FONTから標準文字RAMへの転送、Key Aの実字形、英数／カナ切替、通常入力を確認した。
Firefoxでは`LIST`／`RUN`とfocus喪失停止、Safariでは100%／125%表示、focus喪失停止、
押下状態の解除も確認した。ROM、font、利用者file名、hash、実データのscreenshotはrepository、
CI artifact、本文書へ含めない。この三ブラウザ確認は実データでのWeb動作であり、物理JR-200の
key matrixやWAV互換を示さない。

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
CHROMIUM_EXECUTABLE='/path/to/Google Chrome' \
  python3 tests/browser_smoke.py
CHROMIUM_EXECUTABLE='/path/to/Google Chrome' \
  python3 tests/ui_performance_probe.py --site build/site
```

実データ試験は、検体へ到達できるWebDriver endpointとread-onlyのROM／font pathを明示して
`tests/webdriver_real_rom_smoke.py --browser firefox|safari`を使う。Safariのremote automationが
無効な環境では設定を無断変更せず、実Safariでの手動確認を別記録にする。

## 出典・配布境界

入力割当とkey codeは固定VJR-200 commitの`Mn1544.cpp`とVJR-200操作説明を照合した。
`web/keyboard.mjs`にはFINDの著作権表示、BSD-3-Clause SPDX、固定上流を明記し、
`LICENSES/VJR200.txt`と`THIRD_PARTY_NOTICES.md`を配布する。配色は日本向けJR-200の公開写真を
観察した設計上の解釈で、公称色値とは称さない。写真、logo、ROM、font字形画像は転載しない。
通常文字の4.5:1基準はW3C WCAG 2.2 SC 1.4.3を参照した。参照URLは
[UPSTREAM.md](UPSTREAM.md)に集約する。

以上は#15〜#20のWeb UI受入範囲である。P12（Issue #13）の生成WAVの物理JR-200読込、
実機SAVE/MSAVE、独立2回録音は未実施であり、本結果で代替しない。
