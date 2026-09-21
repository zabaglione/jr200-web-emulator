# P06 ブラウザBASIC起動・入力 受入記録

確認日: 2026-09-22。これはブラウザ画面・入力経路の受入であり、音声、通常カセット、
自前WAV変換、生成WAVの実機互換を証明するものではない。

## 実装境界

- Emscriptenの採用versionを`.emscripten-version`の`6.0.9`へ固定し、
  `scripts/check_emscripten_version.py`を正式build前のgateにした。
- C ABI version 2にROM 16384 byte、font 2048 byteの入力buffer、boot、reset、
  cycle budget実行、NMIを追加した。ROM/fontはWASMへ埋め込まない。
- Web UIは結合ROM、またはROM1 `$A000–$BFFF`とROM2 `$E000–$FFFF`の分割入力を
  受け付ける。サイズ、各半分の全同一byte、ROM2末尾RESET vector、順序を検査する。
- 320×224 Canvas、キー押下/離上、Escape NMI、ポーズ、リセット、ウィンドウblurと
  `visibilitychange`でのキー解放・停止を接続した。requestAnimationFrameの時間を
  1,339,285 Hzのcycle budgetへ変換し、休止後の追いつき量を制限する。
- 永続保存は既定offで、明示チェック時だけIndexedDBへ保存する。ページ自身から
  外部requestを行わず、CSPも同一originへ制限する。

## ローカル検体

利用者がJR-200実機のMSAVEで作成したROM1、ROM2、fontのWAV 3本を、
`local-assets/recordings/msave/raw/`へ配置した。`/local-assets/`は`.gitignore`で
除外され、source manifestとcommitには含めない。

固定済みJR2Rescue 0.6.2をUbuntu 24.04 arm64の隔離コンテナ上のMonoで実行し、
各WAVをCJRへ変換した。CJR検査結果は次のとおり。

| 検体 | payload | 先頭address | footer | warning |
|---|---:|---:|---:|---:|
| ROM1 | 8192 byte | `$A000` | `$C000` | 0 |
| ROM2 | 8192 byte | `$E000` | `$0000` | 0 |
| font | 2048 byte | `$D000` | `$D800` | 0 |

ROM1→ROM2の順で16384 byteへ結合した。検体、CJR、BIN、画面capture、hashは
Gitへ追加していない。JR2Rescueによる復元は独立参照ツールの実測であり、
本プロジェクトのP11 WAV decoderの結果ではない。

## buildと合成試験

実行した主なコマンド:

```sh
make test
make sanitize
make wasm-smoke
make wasm
make check
```

- `make test`: native CTest 6/6。
- `make sanitize`: ASan/UBSan CTest 6/6。
- `make wasm-smoke`: CJR、CPU、system、JS wrapperの4試験。合成ROMの
  boot/run/reset、framebuffer、キー用ABIを含む。
- `make wasm`: Emscripten 6.0.9のversion gate、正式module生成、Node smoke、
  ローカル配信用site stagingに成功。
- `make check`: ライセンス原文、由来表示、source-only manifest、ROM/WAV等の
  禁止拡張子不在を確認。

`tests/browser_smoke.py`はROMなし境界と合成ROMのboot/pause/reset/Canvasを検査する。
実ROMの再現用には、検体を読まずWebDriver側のpathだけを渡す
`tests/webdriver_real_rom_smoke.py`を追加した。

## 実ROMブラウザ試験

ローカルの正式Emscripten siteをHTTP配信し、IndexedDB許可はoffのまま試験した。

| 対象 | 環境 | 観測結果 |
|---|---|---|
| Chrome | macOS / 153.0.8010.48 | JR BASIC 5.0、Free Bytes 30716、Readyを表示。`10 PRINT 5`、`20 END`、`LIST`、`RUN`でprogram listingと`5`、Readyを確認。ポーズ、再開、リセット、console error/warning 0件。 |
| Firefox | Linux aarch64隔離コンテナ / 156.0 / Selenium 4.49.0 | 同じprogramのlisting、`RUN`結果`5`、Readyを画面captureで確認。別tabへの切替で一時停止し、再開後に入力。 |
| Safari | macOS / 26.6.2 (21624.5.1.11.3) | JR BASIC 5.0、Free Bytes 30716、Readyを表示し、`PRINT 7`の結果`7`を確認。Safari情報dialogでblurを発生させ、キー解放と一時停止表示を確認。 |

Firefoxはデスクトップへ追加インストールせず、
`selenium/standalone-firefox@sha256:430b43aa2a573ad692fdde106e19330bdae68c8d5841615c45fd7627225d81d6`
へ検体directoryをread-only mountして試験した。ブラウザにはlocalhost相当の静的siteと
mount済み検体だけを渡し、外部へuploadしていない。

## 未検証範囲

- Web Audioと実音はP09。
- CJRの通常LOAD/MLOAD/SAVE/MSAVE経路はP08。
- 自前CJR→WAVとWAV→CJRはP10/P11。
- 生成WAVを実機で読み、実機からの複数録音を本実装で復元する双方向受入はP12。
- VJR-200由来周辺回路の近似と実機register/timingの一致は、今回のBASIC起動だけでは
  網羅していない。
