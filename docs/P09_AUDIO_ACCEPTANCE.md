# P09 音声Web出力・休止復帰 受入記録

確認日: 2026-09-22。これはMN1271のエミュレータ音声をWeb Audio destinationへ接続し、
開始、sample rate、queue、underrun、ミュート、休止復帰を確認した記録である。
後続追補のカセットロードモニターとキークリックも同じmono PCMへmixするが、P10以降の
WAV生成や物理スピーカーの音圧測定とは別である。

## 実装境界

- P05で分離済みのOS非依存MN1271音声生成と、固定4096 frameのPCM queueを
  維持した。CPU cycleから44.1 kHzを生成し、wall clockや音声callbackをコアへ入れない。
- 3 channel、カセットロードモニター、キークリックのsigned 16-bit PCMを決定的に加算し、
  16-bit範囲へclipするmono mixerを
  追加した。WASM C ABI version 5はsample rate、容量、queue件数、overflow破棄数、
  一括drain buffer、明示discardを公開する。JSは次回drain前にPCMをコピーする。
- `WebAudioOutput`は既定ONの待機状態だが、ページ表示だけでは`AudioContext`を作成しない。
  最初の「起動」操作で開始する。既定gainは20%、UI上限は50%とし、ブラウザの自動再生制限に
  反するページ読込時再生は行わない。明示停止後は「音声を有効化」で再開する。
- 44.1 kHzの`AudioBuffer`を短い`AudioBufferSourceNode`として40 ms先から連続予約する。
  出力deviceのsample rateは指定せず、異なる場合はWeb Audioのsample-rate変換へ委ねる。
  予約位置が現在時刻から5 ms未満へ遅れた回数をunderrunとして数える。
- ミュートではgainを0へし、予約済みsourceを停止してPCM queueを捨てる。音声停止、
  CPU一時停止、debugger停止では同じ消音処理に加えて`AudioContext.suspend()`を行う。
  window blur／ページ非表示は既定でCPU・音声を続行し、自動一時停止設定がONの場合だけ
  suspendする。復帰時は古いPCMを追いつき再生せず、新しい40 ms leadから開始する。
- JR-200UサービスマニュアルのPB6 key detection sound gateを実装した。通常key codeの
  遷移をpendingし、KACK立上り時にPB6が1なら1回だけクリックを生成する。同一keyのhold／repeatは
  再発音せず、別keyが重なって押された場合は新しいcodeとして発音する。PB6を下げると進行中の
  burstも停止する。資料はgateと等しいmix抵抗を示すが波形を規定しないため、2400 Hz・6 ms・
  peak 7000は本実装の可聴近似である。
- pthread、SharedArrayBuffer、deprecatedな`ScriptProcessorNode`は必須にしていない。
  エミュレータ音声とカセットWAVはUIと実装の双方で別経路として表示する。

Web Audioの`AudioContext`、44.1 kHz bufferと異なるcontext sample rateの変換、
`suspend()`/`resume()`の扱いはWeb Audio API 1.1仕様を根拠にした。

## 決定的試験

実行した主なコマンド:

```sh
make test
make sanitize
make wasm-smoke
make wasm
make browser-setup
make browser-smoke
make check
node tests/audio_output_smoke.mjs
python3 -m py_compile scripts/*.py tests/*.py
node --check web/app.mjs
node --check web/audio.mjs
node --check web/codec.mjs
bash -n scripts/build_wasm_smoke.sh
```

- 現行native/sanitizerは各CTest 10/10。3 channel、ロードモニター、キークリックのmono mix、正負clip、pause用queue discard、
  既存のcycle駆動44.1 kHz生成を確認した。
- 直接WASM system試験は既存3 channel出力に加え、PB6有効時の10 click frameがすべて
  絶対値7000、PB6無効時の10 frameがすべて0であることを確認した。
- JS wrapperは44.1 kHz、容量4096、空queue、取得上限を確認した。
- fake 48 kHz contextを使うWeb Audio scheduler試験は、既定ONでも利用者操作前にcontextを
  作らないこと、
  44.1 kHz buffer、gain 20%、sample正規化、underrun、mute、pause/resume競合、queue flush、
  disable後のsuspendを確認した。`resume()`完了待ちの最中にdisableした場合も、完了後に最新の
  停止要求を再確認してsuspendedへ戻る。
- `make wasm-smoke`はCJR、CPU、system、JS wrapper、Web Audio、入力controller、
  WAV encode/decodeの8試験、
  Emscripten 6.0.9の正式buildとNode smokeも成功した。
- 実ROMを直接WASMで起動し、`$0000=0`では66 frame中nonzero 0、`$0000=$40`では
  66 frame中nonzero 57、peak 7000を観測した。

## 実ROM・実ブラウザ

正式Emscripten siteをlocalhostで配信し、利用者提供のGit対象外ROM/fontでJR BASIC 5.0を
起動した。以下は初回P09受入時の実測であり、当時は音声開始buttonを別に押すUIだった。

「音声を有効化」を押すと`AudioContext`はrunningとなり、core/output sample rateは
ともに44100 Hz、gainは20%だった。開始直後の非0 PCMは0だった。JR BASICで
`SOUND 440,50`を実行後、予約済み468866 frameのうち非0 PCM 45945 frame、peak 7000を
観測した。PCM queue 0/4096、core overflow 0、underrun 0で、MN1271由来の信号が
Web Audio destinationへ予約された。

ミュート時はgain 0、active source 0、queue 0になった。CPU一時停止時はcontext
suspended、active source 0、queue 0になり、再開操作でcontext runningへ戻った。
音声停止後はWeb Audio無効、context suspended、active source 0、queue 0だった。
browser consoleのerror/warningは0件。ROM、font、音声captureはGitへ追加していない。

追補後はPlaywright 1.63.0をGit対象外`.venv/`へ固定し、Google Chrome 153.0.8010.53で
`make browser-smoke`を実行した。実`AudioContext`を数える別contextではページ読込時0、最初の
「起動」操作後はrunningかつ1、明示停止でsuspended、再開でrunningとなった。これはブラウザの
実context lifecycleの証拠だが、物理音声出力の証拠ではない。主回帰は時計を固定したfake 48 kHz
contextを使い、仮想Aキー操作より後に新規作成されたsourceだけを対象として非0 click PCMを
確認した。既存keyboard、gamepad、cassette、debugger、CJR/WAV、外部request 0件も回帰した。

固定VJR-200 Windows版commit `dd748995bede57da5baebc1225c7a33433aa6934`は
`Mn1271.h`で`KEYSOUND=64`を宣言するが、全sourceで参照は宣言1か所だけだった。
`Reg3_write`は`SetKeyTest(val)`だけを呼び、DirectSound生成は3 channelの`GetWave(ch)`だけで
ある。この版はキークリックを実装していないため、その欠落挙動を実機互換基準にはしない。

実装commit `904781db9c1e2cfefed6237d3d088ee171c3fe33` のGitHub Actions run
`35661382620`はwasm-codec、Ubuntu/macOS native、sanitizedの4ジョブすべてsuccessだった。

## 未検証範囲

- 自動試験とbrowser statusはPCMがWeb Audio destinationへ到達した証拠であるが、
  物理スピーカー/ヘッドホンでの可聴性、音圧、周波数、左右pan、端末固有latencyは
  計測器や録音で確認していない。
- 現在の出力は3 channel、ロードモニター、キークリックのmono mixである。上流推奨のpan配置は
  未実装である。
- PB6 gateは資料と実ROM制御で確認したが、クリックの波形、周波数、継続時間、音量は物理実機で
  録音・計測していない。2400 Hz・6 msは暫定近似である。
- CJR信号からのWAV生成はP10、録音WAV解析はP11、物理JR-200とのWAV往復はP12で扱う。
