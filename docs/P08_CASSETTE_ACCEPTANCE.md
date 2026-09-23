# P08 CJRカセットLOAD/MLOAD/SAVE/MSAVE 受入記録

確認日: 2026-09-22。これはCJRとエミュレータ内MN1271を結ぶ通常カセット経路の
受入である。自前WAV変換、生成WAV、物理JR-200との往復、実音出力の証拠ではない。

## 実装境界

- OS非依存の`CassetteDeck`を追加し、mount、eject、rewind、REMOTE、再生、録音待機、
  録音、出力準備、終端、errorを明示状態として扱う。高速RAM注入は実装していない。
- CJR再生はleader 136 byte、最初のintermission 12 byte、block間36 byte、終端12 byte、
  start bit 0、data 8 bit LSB first、stop bit 1を3個として生成する。header blockは常に
  600 baud、以後はheader byte 23の0を2400 baud、非0を600 baudとして扱う。
- MN1271 register 7の最初の読出し後だけ、1 sampleあたり280 CPU cycleで信号位置を
  進める。REMOTE OFFでは停止し、位置を保持する。rewindは先頭へ戻す。
- SAVE/MSAVE時はREMOTE ON中のMN1271 register 0D出力byteを固定容量bufferへ保存し、
  各byteをLSB firstの8 sampleとしてhalf-span復号する。header内のblock長を境界として
  利用し、実ROMがfooter末尾直後にREMOTEを切る場合も、存在しない後続leaderを要求しない。
- 入力、録音波形、復号CJRは各1 MiB固定上限で、overflow、復号失敗、CJR検査失敗を
  errorにする。動的allocation、OS file API、無制限logは使わない。
- system C ABIをversion 4へ更新し、同じtransportを直接WASMと正式Emscriptenへ公開した。
  Web UIはCJRのmount/eject/rewind、新規録音、検証済み録音CJRの保存と再マウントを持つ。
- transportはheader付きの標準BASIC type 0とmachine type 1だけを受理する。
  PRINT#、INPUT#、headerless、未知type、特殊形式、連結CJRは黙って成功にしない。

## 決定的試験

実行した主なコマンド:

```sh
make test
make sanitize
make wasm-smoke
make wasm
make check
python3 -m py_compile scripts/*.py tests/*.py
node --check web/app.mjs
node --check web/codec.mjs
bash -n scripts/build_wasm_smoke.sh
```

- `make test`と`make sanitize`は各CTest 7/7、直接WASM/JavaScript wrapperは4試験、
  Emscripten 6.0.9の正式buildとNode smoke、`make check`が成功した。
- native cassette試験はmount/eject/rewind、REMOTE前の停止、最初のread後の開始、
  279/280 cycle境界、2400/600 baud、CJR→信号→CJRの全byte一致を確認した。
- footer後のgapを除いた入力でも復号し、JR BASICがREMOTEを切る終端条件を回帰試験した。
- headerless、未知type、容量overflowを明示errorとして確認した。
- `JR200Machine`のregister 7読出しとregister 0D書込みを経由し、signal再生と録音CJRの
  生成がtransport直呼出しと同じになることを確認した。
- 直接WASMとJavaScript wrapperはABI 4、CJR mount、state、rewind、eject、record arm、
  特殊type拒否、固定容量を確認した。合成ブラウザ試験にもカセット操作を追加した。

## 実ROMによる通常カセット経路

正式WASM siteをlocalhostで配信し、利用者提供のGit対象外ROM/fontでJR BASIC 5.0を
起動した。IndexedDB保存はoff、外部requestはなく、browser consoleのerror/warningは
0件だった。以下はメモリ注入ではなく、JR BASIC自身のLOAD/MLOAD/SAVE/MSAVEと
MN1271のREMOTE・信号入出力を通した観測である。

### BASIC SAVE → LOAD

1. `10 PRINT 42`、`20 END`を入力し、Web UIを録音待機にして`SAVE "P08B"`を実行した。
2. REMOTE ON中に1164 byteの波形を取得し、65 byteの標準BASIC CJRへ復号した。
   検査結果はpayload 19 byte、領域`$0801`〜`$0814`だった。
3. `NEW`後、録音CJRを再生へmountして通常`LOAD`を実行した。18784 sampleを通常経路で
   読み、REMOTE OFFとReadyを確認した。
4. `LIST`は元の2行と一致し、`RUN`は`42`とReadyを表示した。

### machine MSAVE → MLOAD

1. BASICの`POKE`で`$7000`〜`$7003`へ4 byteを設定し、peekで確認した。
2. 録音待機後に`MSAVE "P08M",$7000,$7003`を実行した。1119 byteの波形から
   50 byteのmachine CJRを復号し、payload 4 byte、領域`$7000`〜`$7004`を検査した。
3. 同じ4 byteを0へ変更した後、録音CJRを再生へmountして通常`MLOAD`を実行した。
   18424 sampleとREMOTE OFFを確認し、4 byteすべてが元の内容へ戻ったことをpeekで照合した。

### 実機録音由来CJRのMLOAD

利用者が物理JR-200のMSAVEで作成したWAVから、P06で固定済みJR2Rescue 0.6.2により
復元したfont CJRも正式Emscripten siteの通常経路で試験した。事前に`$D008`〜`$D00E`を変更し、payload
2048 byte、領域`$D000`〜`$D800`のCJRをmountして`MLOAD`した。84784 sample後に
REMOTE OFFとReadyになり、変更領域が元CJRの内容へ戻った。これはCJR transportの
非自己往復確認だが、WAV復元自体は独立参照ツールの結果でありP11の自前decoder証拠ではない。

ROM、font、WAV、CJR、BIN、画面capture、内容hashはGitへ追加していない。

## Web操作の追補（2026-09-22）

- CJRを選んだだけの状態を黄色の「未マウント」、現在の媒体と一致する状態を緑の
  「マウント済み」とし、選択名と現在のマウント名を同時表示する。色だけでなく文言と
  `data-state`でも区別する。
- 実機RQ-8300のモニター用途に相当する機能として、LOAD/MLOAD中の実カセット信号レベルを
  共通コアの44.1 kHz PCMへ加算する。既定はON・25%、再生中にON/OFFと0〜100%を変更できる。
  本体音声も既定ONだが、ブラウザの自動再生制限に従ってAudioContextは「起動」など最初の
  利用者操作で開始する。本体音声を停止した後は「音声を有効化」で再開する。
- 現行system ABI 9は、ABI 7で追加したモニター設定・音量・出力中状態、ABI 8の
  joystick setter、後続のRAM設定を公開する。nativeと直接WASMでは、
  読出し開始前は無音、開始後は設定振幅、再生中のOFFで無音、音量変更で振幅が変わることを
  数値検査した。これはブラウザPCM経路の検査であり、RQ-8300実機の音質再現証拠ではない。

## remote受入

実装commit `a0cc4c6a96b4c993d2d5bfc84f3280d75dd15426` に対する
[Actions run 35657825103](https://github.com/zabaglione/jr200-web-emulator/actions/runs/35657825103)は、
Linux/macOS native、sanitizer、Clang直接WASMの4ジョブすべてsuccessだった。

## 未検証範囲

- Web Audio出力と休止復帰はP09、自前CJR→WAVはP10、自前WAV→CJRはP11で扱う。
- 生成WAVを物理JR-200で読むこと、物理JR-200の複数録音を本実装で復元すること、
  信号電圧・波形・速度の測定はP12まで未検証である。
- PRINT#、INPUT#、JR2、生波形、複数program連結、特殊loaderは本Issueの標準CJR
  transportでは未対応であり、UIとmount時の検査で明示する。
