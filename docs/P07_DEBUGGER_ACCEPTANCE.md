# P07 開発用デバッガ・追跡・メモリウォッチ 受入記録

確認日: 2026-09-22。これはエミュレータ内部の観測・停止機能の受入であり、
カセット、音声、WAV変換、実機タイミングの一致を証明するものではない。

## 実装境界

- OS非依存のC++コアに、命令実行前のPC breakpoint、CPU read/write watchpoint、
  1命令step、停止・再開を実装した。
- breakpointとwatchpointは各16件までで、動的allocationや無制限の登録を行わない。
- 命令履歴は256件、CPUメモリアクセス履歴は512件の固定長リングバッファである。
  上限後は古い項目を破棄し、破棄件数を保持する。履歴は既定で無効である。
- breakpointは対象命令を実行する前に停止する。再開時は現在位置のbreakpointを
  1回だけ通過させ、同じPCへ再到達した場合は再び停止する。
- watchpointはCPUが実際に行ったopcode、operand、data、stack、vectorアクセスを
  区別して記録し、該当アクセスを含む命令の完了後に停止する。追加の読出しで
  値を推測しないため、観測自体がI/O副作用を増やさない。
- メモリ画面は`peek`だけを使い、利用者の明示操作で1回最大256 byteを表示する。
  副作用のあるCPU読出しとは別経路であり、ROM全体の自動表示・送信を行わない。
- resetは停止状態と履歴を消去する一方、履歴の有効設定、breakpoint、watchpointを
  保持する。system clearは設定も含めて消去する。
- system C ABIをversion 3へ更新し、同じ機能を直接WASMと正式Emscripten moduleへ
  公開した。JavaScript wrapperは64 bitのcycle/sequenceをlow/highから復元する。

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

- `make test`: native CTest 6/6。指定PCでの実行前停止、停止中のcycle不変、
  breakpointの1回通過と再到達停止、step、read/write watchpointを確認した。
- native試験では400命令を記録し、命令履歴256件・破棄144件、CPUアクセス履歴
  512件・破棄88件となることと、残存sequenceの時系列を固定値で確認した。
- 同じプログラムを履歴有効・無効の2台で1000 cycle以上実行し、全65536 byte、
  全CPU register、CPU/機械cycle、PCM queueが一致することを確認した。
- read-sensitive I/O registerに対して、`peek`では値・I/O trace・CPUアクセス履歴が
  変化せず、CPU data readでは返却値を履歴へ記録してregister副作用が起こることを
  確認した。
- `make sanitize`: ASan/UBSan付きCTest 6/6。検出された領域外アクセス・未定義動作なし。
- `make wasm-smoke`: CJR、CPU、system ABI、JS wrapperの4試験に成功。合成ROMで
  breakpoint、再開、step、write watchpoint、bounded capacity、peek非記録を確認した。
- `make wasm`: Emscripten 6.0.9のversion gate、正式module生成、Node smoke、
  ローカルsite stagingに成功した。

`tests/browser_smoke.py`にも合成ROMによるbreakpoint、再開、step、write watchpoint、
peek、履歴表示の操作を追加した。ただし現在の既定Python環境にはPlaywright moduleが
ないため、このスクリプト自身はimport時点で未実行となった。これは下記の実ブラウザ
操作結果と、Node/WASMの決定的試験を区別して記録する。

## 実ブラウザ確認

正式Emscripten siteをlocalhostで配信し、Codex in-app browserで利用者提供の
Git対象外ROM/fontを選択した。IndexedDB保存は許可せず、外部requestを行っていない。

- JR BASIC 5.0の画面を表示した状態から一時停止し、現在PCのbreakpointで命令実行前に
  停止した。
- 1命令stepでPC、register、cycleが更新され、命令履歴1件とopcode access 1件が
  表示された。
- I/O領域の256 byteを手動peekしてもCPUアクセス履歴件数が増えなかった。
- 次命令のopcode addressにread watchpointを設定し、命令完了後に停止した。
  履歴にはopcode/operandの種別と実際の読出し値が表示された。
- browser consoleのerror/warningは0件。デスクトップ幅で操作部、メモリ、2列の履歴に
  clippingや重なりがないことを目視した。

ROM、font、録音、画面capture、内容hashはGitへ追加していない。

## 未検証範囲

- Python Playwrightによる`tests/browser_smoke.py`の自動実行は、module未導入のため未実行。
- 物理JR-200上のregister/cycleとの比較、通常カセット経路、Web Audio、WAV生成・復元は
  P08以降の別受入条件である。
- デバッガは開発用であり、逆アセンブラ、条件式breakpoint、永続設定、remote debug、
  ROMやメモリの外部送信機能は実装していない。

## commitとremote CI

- 実装commit: `f85aa1d3db234db71baf91b59779ea84aafe01df`
- GitHub Actions: [source-and-codec / run 35650269016](https://github.com/zabaglione/jr200-web-emulator/actions/runs/35650269016)
- 結果: `completed / success`。Linux native、macOS native、sanitizer、
  Clang直接WASM smokeの4ジョブがすべて成功した。
