# P09 音声Web出力・休止復帰 受入記録

確認日: 2026-09-22。これはMN1271のエミュレータ音声をWeb Audio destinationへ接続し、
開始、sample rate、queue、underrun、ミュート、休止復帰を確認した記録である。
カセットCJRの信号やP10以降のWAV生成、物理スピーカーの音圧測定ではない。

## 実装境界

- P05で分離済みのOS非依存MN1271音声生成と、固定4096 frameの3 channel PCM queueを
  維持した。CPU cycleから44.1 kHzを生成し、wall clockや音声callbackをコアへ入れない。
- 3 channelのsigned 16-bit PCMを決定的に加算し、16-bit範囲へclipするmono mixerを
  追加した。WASM C ABI version 5はsample rate、容量、queue件数、overflow破棄数、
  一括drain buffer、明示discardを公開する。JSは次回drain前にPCMをコピーする。
- `WebAudioOutput`は利用者が「音声を有効化」を押すまで`AudioContext`を作成しない。
  既定gainは20%、UI上限は50%とし、開始前の自動再生を行わない。
- 44.1 kHzの`AudioBuffer`を短い`AudioBufferSourceNode`として40 ms先から連続予約する。
  出力deviceのsample rateは指定せず、異なる場合はWeb Audioのsample-rate変換へ委ねる。
  予約位置が現在時刻から5 ms未満へ遅れた回数をunderrunとして数える。
- ミュートではgainを0へし、予約済みsourceを停止してPCM queueを捨てる。音声停止、
  CPU一時停止、debugger停止、window blur、ページ非表示では同じ消音処理に加えて
  `AudioContext.suspend()`を行う。復帰時は古いPCMを追いつき再生せず、新しい40 ms
  leadから開始する。
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
make check
node tests/audio_output_smoke.mjs
python3 -m py_compile scripts/*.py tests/*.py
node --check web/app.mjs
node --check web/audio.mjs
node --check web/codec.mjs
bash -n scripts/build_wasm_smoke.sh
```

- native/sanitizerは各CTest 7/7。3 channel mono mix、正負clip、pause用queue discard、
  既存のcycle駆動44.1 kHz生成を確認した。
- 直接WASM system試験は10 frame生成後、先頭6 frameを一括drainして
  `7000,7000,7000,7000,7000,-7000`と照合し、残り4 frameを明示discardした。
- JS wrapperは44.1 kHz、容量4096、空queue、取得上限を確認した。
- fake 48 kHz contextを使うWeb Audio scheduler試験は、明示開始前にcontextを作らないこと、
  44.1 kHz buffer、gain 20%、sample正規化、underrun、mute、pause/resume競合、queue flush、
  disable後のsuspendを確認した。
- `make wasm-smoke`はCJR、CPU、system、JS wrapper、Web Audio schedulerの5試験、
  Emscripten 6.0.9の正式buildとNode smokeも成功した。

## 実ROM・実ブラウザ

正式Emscripten siteをlocalhostで配信し、利用者提供のGit対象外ROM/fontでJR BASIC 5.0を
起動した。ページ読込とCPU起動だけでは音声statusが`context 未作成（自動再生なし）`で
あることを確認した。

「音声を有効化」を押すと`AudioContext`はrunningとなり、core/output sample rateは
ともに44100 Hz、gainは20%だった。開始直後の非0 PCMは0だった。JR BASICで
`SOUND 440,50`を実行後、予約済み468866 frameのうち非0 PCM 45945 frame、peak 7000を
観測した。PCM queue 0/4096、core overflow 0、underrun 0で、MN1271由来の信号が
Web Audio destinationへ予約された。

ミュート時はgain 0、active source 0、queue 0になった。CPU一時停止時はcontext
suspended、active source 0、queue 0になり、再開操作でcontext runningへ戻った。
音声停止後はWeb Audio無効、context suspended、active source 0、queue 0だった。
browser consoleのerror/warningは0件。ROM、font、音声captureはGitへ追加していない。

## 未検証範囲

- 自動試験とbrowser statusはPCMがWeb Audio destinationへ到達した証拠であるが、
  物理スピーカー/ヘッドホンでの可聴性、音圧、周波数、左右pan、端末固有latencyは
  計測器や録音で確認していない。
- 現在の初版出力は3 channel mono mixである。上流推奨のpan配置は未実装である。
- Python Playwright moduleがないため`tests/browser_smoke.py`自身はimport時点で未実行。
  fake contextによるUI手順は同ファイルへ追加したが、今回の実ブラウザ操作と区別する。
- CJR信号からのWAV生成はP10、録音WAV解析はP11、物理JR-200とのWAV往復はP12で扱う。
