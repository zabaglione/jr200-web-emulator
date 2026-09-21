# P05 周辺回路監査と移植境界

確認日: 2026-09-22。対象はVJR-200 commit
`dd748995bede57da5baebc1225c7a33433aa6934`である。ここでいう一致は固定した
上流ソースとの静的対照および合成テストであり、JR-200実機との一致ではない。

## 監査した上流ファイル

| ファイル | Git blob / 行数 | 表示 | 取込判断 |
|---|---|---|---|
| `VJR200/Address.h` | `f61c7072f4a30ffc1110bf17a95968cd0955d5c1` / 46 | BSD-3-Clause / FIND | メモリ属性APIは再構成 |
| `VJR200/Address.cpp` | `e43a1d440a2077730f0be721d9f9b1febafea0dc` / 501 | BSD-3-Clause / FIND | アドレス範囲、MN1271ミラー、DRAM waitを適応 |
| `VJR200/Mn1271.h` | `9f955734ae49f4b3c3448b6cf2749ac14431fc26` / 211 | BSD-3-Clause / FIND | Win32/OpenSL/cerealを除きレジスタ状態を再構成 |
| `VJR200/Mn1271.cpp` | `7e64da67c1ebbe5b16c452d514666edff191b0f4` / 1677 | BSD-3-Clause / FIND | timer、IRQ、CMT、矩形波の観測挙動を適応 |
| `VJR200/Mn1544.h` | `8169d810aeec5040ef7f660e0d2ae21c17e4f5b8` / 131 | BSD-3-Clause / FIND | font/key handshake状態を適応 |
| `VJR200/Mn1544.cpp` | `e1c1f99a9d07f53ecfa4cc2f8beb9518b2cfe21a` / 1181 | BSD-3-Clause / FIND | KTEST/KACKと100 cycle遅延を適応 |
| `VJR200/Crtc.h` | `7c8509d83c08a612197eb5604e9769a8ada81299` / 83 | BSD-3-Clause / FIND | Direct2D資源を除き状態を再構成 |
| `VJR200/Crtc.cpp` | `1aba9556d8f6e87cf1f7b674cd9185f196b9111b` / 779 | BSD-3-Clause / FIND | 320×224描画規則とscan値を適応 |
| `VJR200/JRSystem.h` | `e2e1749e5ac3aa51feec21b45c5abdaf7d73a798` / 45 | BSD-3-Clause / FIND | global所有モデルは不採用 |
| `VJR200/JRSystem.cpp` | `0e12ee0ab487f5d25b18f3ac392ce10c06b6daf1` / 352 | BSD-3-Clause / FIND | ホストloopを不採用、明示cycle APIへ置換 |

全ファイルの条件は既存の [VJR200ライセンス全文](../LICENSES/VJR200.txt) で
保持する。cereal、DirectSound、Direct2D、Win32 keyboard/joystick、printer、FDD、
上流のファイルI/Oは取り込んでいない。

## OS非依存の境界

- `JR200Machine`が64 KiB空間とCPU、MN1271、MN1544、CRTCを所有する。
- CPU命令が返したbase cycleとbus waitの合計だけを`advance_cycles`へ渡す。
  wall clock、`requestAnimationFrame`、音声callbackの時刻はコアへ入れない。
- WAI中のCPUは推測cycleを返さない。ホストschedulerは休止区間を
  `advance_cycles`で進め、IRQ/NMI発生後に再度CPUをstepする。
- DirectSoundの3 bufferは、固定容量の3 channel `PcmFrame` queueへ置換した。
  Direct2D描画は、明示的な320×224 ARGB framebuffer生成へ置換した。
- 通常read/writeだけを上限256件のI/O traceへ記録する。`peek_byte`はregister、
  IRQ、activity、trace、cycleのいずれも変更しない。
- `-nostdlib`のClang直接WASM smokeだけは、compilerがzero初期化を
  `memset`等へlowerした場合に備え、`freestanding_memory.cpp`の最小実装を明示する。
  Emscripten/nativeのコアへはこのshimをlinkしない。

## アドレス範囲

| 範囲 | 初期構成 | 観測/移植挙動 |
|---|---|---|
| `$0000–$7FFF` | RAM | read/writeごとに1 cycleのDRAM wait |
| `$8000–$9FFF` | open | expansion 1指定時だけRAM |
| `$A000–$BFFF` | ROM1 | expansion 2指定時だけRAM |
| `$C000–$C7FF` | RAM | PCG/TVRAM/attributeを含む |
| `$C800–$C9FF` | MN1271 | 32 byte単位でmirror |
| `$CA00–$CBFF` | CRTC | readはscan値、writeは下位3 bitのborder色 |
| `$CC00–$CFFF` | open | FDDはP05範囲外 |
| `$D000–$D7FF` | RAM | font RAM |
| `$D800–$DFFF` | open | FDD ROMはP05範囲外 |
| `$E000–$FFFF` | ROM2 | writeを無視 |

16 KiB ROMを明示的に渡すAPIはROM1 `$A000–$BFFF`、ROM2
`$E000–$FFFF`の順だけを受け付ける。ROMやfont本体は同梱しない。

## 上流対照用timer trace

`tests/test_system.cpp`は次の固定列を検査する。値は上流の
`Address.cpp`の32 byte mirror、`Mn1271::Write`、`TickTimerCounter`、
`Read`、`ReadForDebug`から導出した。

| cycle | 操作 | bus address / register | 観測値・状態 |
|---:|---|---|---|
| 0 | write | `$C80F` / `$0F` | TCA reload = 2 |
| 0 | write | `$C82E` / mirror `$0E` | COUNT+IRQ = `$41`、TCA status clear |
| 1 | tick | — | IRQなし、counter残り1 |
| 2 | tick | — | reg `$0E=$61`、reg `$1D=$81`、IRQ assert |
| 2 | debug peek | `$C80E` / `$0E` | `$61`を返し状態・traceを変更しない |
| 2 | normal read | `$C80E` / `$0E` | `$61`を返してBORROW/TCA status/IRQをclear |

別fixtureで`$C83F`へのwriteと`$C91F`からのreadが、ともにregister
`$1F`としてtraceされることも固定した。traceはcycle、元のbus address、mirror後の
register、値、device、read/writeを保持するため、上流または実機記録を後から同じ列で
比較できる。

## 合成試験で確認した範囲

- TCAの境界前後、BORROW、mask、aggregate status、IRQ acknowledge。
- 2048 byte fontと末尾baud byteのKTEST/KACK転送、100 cycle遅延、通常時の
  key + joystick 2 byte handshake。
- CMT REMOTE、入力level、出力byte queue、read/write activity。
- 44.1 kHzの3 channel PCM queueをCPU cycleから整数演算で生成。
- 通常文字、ユーザー文字/PCG、semigraphics規則を共有するARGB framebuffer。
- native、ASan/UBSan、Clang直接WASM、Emscripten moduleで同じ公開ABI。

## 上流近似と未確認事項

- 上流作者自身がMN1271を近似実装としている。register maskやtimer式を移植しても、
  実チップの全bit、IRQ電気特性、発振誤差を実証したことにはならない。
- IRQはlatched statusが残る間のlevelとしてCPUへ渡す。上流はCPU側のIRQ要求を
  受理時にclearするため、未acknowledge時の再割込は差分候補である。
- 大きなcycle batchで複数回timer満了した場合はstatusを1回latchedし、counterを
  moduloで正規化する。上流の1 callbackあたり1回だけ減算する実装より決定的だが、
  実機のlost-event仕様は未確認である。
- CRTC scan値は上流の`floor(2*cycle/3) mod 768`を維持し、ホスト描画時刻による
  counter resetは除いた。scan timing、blanking、表示周波数は実機未確認である。
- PCMは基本dividerによる3 channelの矩形波までで、上流の特定prescale補正式、
  volume、pan、Web Audioへの供給、音質確認はP09。
  CMT byte queueは上流の論理SAVE経路の境界であり、波形や実機SAVEの証拠ではない。
- ホストkeyからJR文字codeへの配列変換、かな/GRAPH補助、auto type、物理joystick取得は
  UI層の後続作業である。P05では変換済みcodeとactive-low joystick状態を受け取る。
- printer readは上流のEPSON分岐に相当するready bit `$10`を固定した。printer/FDDは
  未実装である。
- メーカーROM/font、保存済みWAVはこの試験に使用していない。BASIC起動、実機表示、
  実音、通常LOAD/SAVE、実機往復は未検証である。
