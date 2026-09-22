# P11 録音WAV解析・CJR復元 ローカル受入記録

確認日: 2026-09-22。実装commitは
`756d69c4363620bac19a9b936a757e92a47e5fa3`（ローカルのみ）である。
P11の技術的な受入条件はローカルで満たしたが、GitHub Actionsの月間枠が利用者申告で
3000/3000分に達しているため、push、remote CI、Issue #12のcloseは実施していない。
したがって本記録は最終受入完了やremote反映を主張しない。

## 実装境界

- OS非依存のC++20 decoderを`src/tape/wav_decode.cpp`へ実装し、native CLI、固定容量
  WASM ABI、Web UIで共用した。CLI入力上限は128 MiB、Web入力上限は8 MiB、CJR候補
  上限は1 MiBである。
- RIFF全長、chunk header、odd-size padding、重複/欠落`fmt `/`data`、PCM format、
  channel数、sample rate、bit幅、byte rate、block alignment、data長を復号前に検査する。
  対応はinteger PCM、mono/stereo、8/16-bit、22050/44100/48000 Hzに限定し、float、
  3 channel以上、24/32-bit、その他のsample rateを明示的に拒否する。
- stereoのauto選択はDC除去後RMSが大きいchannelを使用する。downmixは行わないため、
  逆相信号の相殺を避ける。channelごとのDC/RMS、選択channel、min/max、threshold、
  極性、transition数、短/長half-span平均、無効span、位相境界で連結したspan、block数、
  実測data baudを診断値として返す。
- Schmitt thresholdでtransitionを抽出し、start、LSB-first data、stop、block境界、magic、
  block長、加算checksum、最終CJR構造を順に検査する。bit多数決やchecksumに合わせた
  data修正は行わない。data速度はheader flagを最初の候補とし、timing不一致時だけ
  600/2400 baudの反対条件を全block checksumまで再検証する。明示速度で生成され、
  header flagと実波形速度が異なるP10 WAVも原CJR byteを変更せず復元できる。
- 失敗はPCM frame、秒換算時刻、CJR候補offset、error detailを返す。途中まで読めたbyteは
  `candidateBytes`として数だけを診断できるが、CLIはファイルを書かず、WASMは出力sizeを
  0にし、Webは保存ボタンを無効にする。検証済みCJRだけを保存できる。
- decoder入力はread-onlyであり、生WAVは変更しない。Web処理はブラウザ内だけで完結する。

根拠は[UPSTREAM.md](UPSTREAM.md)のS3/S13である。FINDの`AnalyzeWave`にあるhalf-span
復号を参照したが、Win32 UI、ファイル保存処理、無制限bufferは移植していない。
JR2Rescueのバイナリや逆コンパイル結果も取り込んでいない。

## 独立WAVと利用者提供録音

P10でJR2Rescue 0.6.2が生成した合成MSAVE WAVを入力した。44.1/48 kHzと
600/2400 baudの4条件すべてを検証済みCJRへ復元し、各52 byteが対応する入力CJRと
全バイト一致した。これは本実装自身が作ったWAVだけの自己往復ではない。

Git対象外の`local-assets/recordings/msave/raw/`に保存した利用者提供WAV 3本も入力した。
3本は44.1 kHz、mono、16-bit PCMで、すべて検証済みCJRへ復元できた。出力は、P11実装前に
独立ツールで作成済みの`local-assets/recordings/msave/derived/`内CJRとそれぞれ全バイト
一致した。生WAV、派生CJR、内容、hashはcommitへ含めていない。

録音がJR-200実機のMSAVEであることは利用者から提供された文脈であり、この作業中に録音
操作や接続を立ち会って再確認したものではない。この一致は入力WAVとのdecoder互換証拠で
あり、P12で必要な本実装生成WAVの実機読込や独立2回の物理往復の代替ではない。

## 正常系・異常系試験

合成fixtureで次を確認した。

- 44.1/48 kHz、600/2400 baud、22.05 kHz downsample、8/16-bit、mono/stereo、
  RIFF odd-size chunk/padding、正負極性、2%の速度低下を全バイト一致で復元する。
- CJR header flagと実波形の600/2400 baudが互いに異なる2条件を、実測速度の診断付きで
  原CJRへ戻す。
- 無音、途中切断、seed固定noise、RIFF長不一致、float PCMを成功扱いしない。
- 意図的なdata bit破損はchecksum mismatch、PCM frame/時刻、CJR checksum offsetを返し、
  41 byteの候補を検証済み出力として保存しない。
- 逆相は拒否するのではなく正しく復元し、誤ったCJRを成功扱いしない。

主な実行コマンドと観測結果:

```sh
make test
make sanitize
make wasm-smoke
make wasm
CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  /private/tmp/jr200-p11-playwright/bin/python tests/browser_smoke.py
make check
python3 -m py_compile scripts/*.py tests/*.py
node --check web/codec.mjs
node --check web/app.mjs
```

- nativeとAddressSanitizer/UndefinedBehaviorSanitizerは各CTest 9/9成功。
- 直接WASMはCJR、CPU、system、JS wrapper、Web Audio、WAV encode、WAV decodeの
  7系統すべて成功。未検証候補のWASM出力size 0も確認した。
- Emscripten 6.0.9正式moduleのNode smokeでCJR→WAV→CJRの全バイト一致を確認した。
- 一時仮想環境のPlaywright 1.63.0と既存Chrome 153.0.8010.48で正式siteを試験し、
  検証済みCJRのdownload、無音入力時の保存禁止、外部request 0件を確認した。
- `make check`はライセンス全文、source notice、Web link、source-only inventoryを合格した。

## CLIとWeb

- `cjrtool wav-decode input.wav output.cjr [--channel auto|left|right]`を追加した。
  既存出力の上書きを拒否し、成功時だけ検証済みCJRとbounded診断を表示する。
- WebではWAVとchannelを明示選択して解析する。結果は候補/検証済み、error frame/時刻、
  波形診断、生WAV非変更、hardware由来を推定しないことを表示し、成功時だけCJR保存を
  有効にする。

## 未完了・未検証範囲

- 実装commitはローカルにだけ存在する。Actions枠のreset後にpushし、4 jobのremote CIを
  実測し、結果を追記してからIssue #12をcloseする。
- 圧縮WAV、WAVE_FORMAT_EXTENSIBLE、24/32-bit PCM、3 channel以上、対応外sample rate、
  JR2、headerなし、特殊loaderは未対応である。
- 2%を超えるtransport速度差、dropout、wow/flutter、clipping、非常に低いS/N比を網羅した
  という意味ではない。候補の手動修復機能は意図的に実装していない。
- JR-200実機への生成WAV入力、物理再生level/pan/cable、BASIC LIST/RUN、machine-code領域
  比較、独立2回の録音はP12に残る。
