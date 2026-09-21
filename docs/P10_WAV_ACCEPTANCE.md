# P10 CJR信号生成・WAVエンコード 受入記録

確認日: 2026-09-22。これは標準CJRからカセット信号を生成し、RIFF PCM WAVとして
保存できることを確認した記録である。独立ツールでの波形比較と再読込は含むが、
JR-200実機での読込成功はP12まで未検証である。

## 実装境界

- P08のOS非依存`CassetteDeck`を唯一の信号源として再利用した。1 byteはstart 0、
  LSB-firstのdata 8 bit、stop 1を3 bitとする12-bit frameである。
- VJR-200固定commitの`CjrFormat::GetLoadData`に合わせ、header blockは600 baud固定、
  data/footer blockはCJR headerのbaud値に従う。CLI/Webで600/2400を明示した場合だけ
  data速度を上書きし、CJR原バイトは変更しない。
- VJR-200の136-byte leader、12-byte first/final interval、36-byte inter-block
  intervalと、`WaveGetter`の符号位相を維持した。抽象信号は4800 sample/sである。
- WAVはRIFF PCM、mono、signed 16-bit、振幅50%（±16384）。48 kHzを基準とし、
  44.1 kHzも選択できる。出力sample `n`は`floor(n * 4800 / rate)`の信号値を使い、
  総数は`ceil(signal_samples * rate / 4800)`とするため、bitごとの切捨てを累積しない。
- C++ encoderは割当てを行わず、44-byte headerと上限付きPCM chunkを返す。CLIは
  stream書込み、WASM ABI version 1は4096 sampleずつ返す。ブラウザ側は256 MiBを
  上限とし、生成後にだけdownloadし、自動再生しない。

根拠は[UPSTREAM.md](UPSTREAM.md)のS3/S5である。JR2Rescueのバイナリや逆コンパイル
結果は移植していない。

## 独立ツールとの波形比較

基準実装はP03と同じJR2Rescue 0.6.2（assembly version `0.6.2.0`、上流commit
`8f14894706443288bb9838a28f4e828b7ee551b8`）である。固定ZIP SHA-256は
`8de2bc6b3ff40cf032bec6f0d26f11ef0edcdafb9fffdc4de9d8c4056e10f483`。
Ubuntu 24.04 arm64の使い捨てcontainer、Mono 6.8.0.105、XvfbでWindows向け
実行ファイルを英語UIのまま操作した。検体は`.emscripten-version`の6 byteだけを
格納した自作MSAVE CJRで、メーカーROM、font、商用テープ、利用者録音を含まない。

`scripts/compare_wav_reference.py`は両WAVの符号反転runを短/長half-spanへ正規化し、
header/data/footerの3 blockについて内部位相pattern、最初の符号、block anchor間隔を
比較する。実測は次のとおりだった。

| rate / data baud | 短/長half-span 本実装 | 短/長half-span JR2Rescue | 最初のblock anchor ms 本実装 / JR2Rescue | block anchor間隔 ms 本実装 / JR2Rescue |
|---|---:|---:|---:|---:|
| 48000 / 2400 | 10.000 / 20.000 | 10.000 / 20.000 | 1974.167 / 907.521 | 1140.000, 545.000 / 740.000, 145.000 |
| 44100 / 2400 | 9.199 / 18.373 | 9.000 / 18.484 | 1974.172 / 913.673 | 1140.000, 545.011 / 736.508, 144.218 |
| 48000 / 600 | 10.000 / 20.000 | 10.000 / 20.000 | 1974.167 / 907.521 | 1140.000, 740.000 / 740.000, 340.000 |
| 44100 / 600 | 9.196 / 18.373 | 9.000 / 18.500 | 1974.172 / 913.673 | 1140.000, 740.000 / 736.644, 338.503 |

4条件とも3 blockの位相patternが一致し、最初の比較anchorも負符号で一致した。
44.1 kHzのhalf-spanが整数でないことによる9/10、18/19 sampleの分配も長時間で
ずれなかった。JR2Rescueは観測上、leaderと最初のintervalの合計が本実装より80 byte、
各inter-block intervalが30 byte短い。後者はanchor間隔の400 ms差に一致する。
本実装は独立ツールへ合わせて短縮せず、固定したVJR-200 S3の136-byte leaderと
36-byte inter-block intervalを採用した。この差は隠さず、P12の実機比較対象に残す。

## 独立デコーダによる再読込

本実装の4 WAVをJR2Rescueの`WAVtoCJR`で読み、出力CJRを`cmp`した。
2400 baud入力のSHA-256は
`c254619d3cd6166fae314bee824487228d790a605217915a71dc2ad61bf86c81`、
baud headerを100にした600 baud入力は
`2acaeaa61ca676c022bd3d3d6ab7a5863a305ffe3f1585fae2e1db7d89879e7f`である。

| rate | data baud | JR2Rescue読込 | 復元CJR |
|---:|---:|---|---|
| 48000 | 2400 | 成功 | 入力52 byteと全バイト一致 |
| 44100 | 2400 | 成功 | 入力52 byteと全バイト一致 |
| 48000 | 600 | 成功 | baud 100入力52 byteと全バイト一致 |
| 44100 | 600 | 成功 | baud 100入力52 byteと全バイト一致 |

600 baudをheader値0のCJRへ明示上書きしたWAVは、JR2Rescueのheader追従decodeでは
data速度が一致しない。これは明示変換の結果であり、既定変換はCJR headerへ追従する。

## 決定的試験と正式WASM

主な実行コマンド:

```sh
make test
make sanitize
make wasm-smoke
make wasm
make check
python3 scripts/compare_wav_reference.py OUR.wav REFERENCE.wav INPUT.cjr --data-baud 600
python3 -m py_compile scripts/*.py tests/*.py
node --check web/codec.mjs
node --check web/app.mjs
```

- nativeとsanitizerは各CTest 8/8。RIFF field、streaming、44.1/48 kHz、600/2400、
  CJR header速度の既定継承、破損/未知type/無効optionを確認した。
- `make wasm-smoke`はCJR、CPU、system、JS wrapper、Web Audio、WAV ABIの6試験に成功。
- Emscripten 6.0.9の正式moduleはNode smokeに成功した。正式siteをChromeで開き、
  44.1 kHz/16-bit/mono/2400の生成結果を337262 byte、168609 frame、RIFFとして確認し、
  console error/warningは0件だった。
- `tests/browser_smoke.py`へdownloadとRIFF検査を追加したが、ローカルPython環境に
  `playwright` moduleがないため同ファイル自体は未実行である。上記Chrome試験と、
  Node wrapperの同一Emscripten/直接WASM試験を区別する。

## CLIとWeb

- `cjrtool wav input.cjr output.wav [--rate 44100|48000] [--600|--2400]`を追加した。
  baud無指定時はCJR headerへ従い、既存出力への上書きを拒否する。
- WebのCJR検査後にrateとdata baudを選んでWAVを保存できる。初期baud選択は
  CJR headerへ従う。画面にはmono 16-bit、50%、自動再生なし、P12未検証を表示する。

## 未検証範囲

- JR-200実機によるLOAD/MLOAD、実機側の音量・極性許容度、再生device/ケーブル差は
  P12まで未検証である。JR2Rescueでの読込成功は物理実機互換の証拠ではない。
- WAVからCJRを復元する本プロジェクト自身のdecoderはP11であり、まだ未実装である。
- JR2、特殊loader、headerなしCJR、stereo/8-bit/22.05 kHz出力は本Issueの対象外。
- 参照実行はMono上であり、native Windows上の同一操作は今回再確認していない。
- ROM、font、WAV、CJR、BIN、browser download、参照バイナリをGitへ追加していない。
  利用者提供MSAVE録音は本試験に使用していない。
