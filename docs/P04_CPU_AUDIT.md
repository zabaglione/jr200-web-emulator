# P04 CPU取込監査

実施日: 2026-09-22。対象はMC6800 CPUコアだけであり、ROM、メーカー由来
フォント、周辺LSI、逆アセンブラ、M6801内蔵I/O、Windows UIは対象外である。

## 固定した上流

VJR-200は`find-jr200/VJR200forWindows`のcommit
`dd748995bede57da5baebc1225c7a33433aa6934`（root tree
`66f4c9ddbc65e0556e33bb3d526a22faac1c0a0c`）を監査した。

| ファイル | Git blob / 行数 | 表示 | 依存と取込判断 |
|---|---:|---|---|
| `VJR200/m6800.h` | `5483a691f2654e9b80d3352ec3b2ce470b5a7237` / 425 | BSD-3-Clause / Aaron Giles | `emu.h`、`Address.h`、PAIR、cereal、M6801用状態を含むため直接コピーせず、固定幅の公開APIを再構成 |
| `VJR200/m6800.cpp` | `797a05ff6e54834ab0fe93020ff3eaff47399a85` / 684 | BSD-3-Clause / Aaron Giles | `stdafx.h`、`JRSystem`、デバッガ、周辺機器tick、グローバルwaitに結合しているため、MC6800命令サイクル表と動作だけを適応 |
| `VJR200/6800ops.hxx` | `f22d6510f1d83a60f8837cff2088f48aa7670928` / 2,383 | BSD-3-Clause / Aaron Giles, FIND | 命令実装を適応。`TCHAR`、ジャンプ履歴、`g_dramWait`、暗黙の追加命令実行を除去 |
| `VJR200/6800tbl.hxx` | `2f2f0df8a3890187c10125d26b5e2a90bbe4b9af` / 38 | BSD-3-Clause / Aaron Giles | MC6800のopcode dispatch表を適応 |

由来確認の独立点として、MAMEのcommit
`9940645188b6749e170b62c0ea86af0f440148da`も確認した。

| MAMEファイル | Git blob | 確認事項 |
|---|---|---|
| `src/devices/cpu/m6800/m6800.cpp` | `580a9798ea4205dd54f1617f068bd07c4b83a97a` | BSD-3-Clause / Aaron Giles、通常割込12 cycle、WAI復帰4 cycle |
| `src/devices/cpu/m6800/m6800.h` | `d7db49864e8a8c18e531ff2a4c391d23f77e1106` | BSD-3-Clause / Aaron Giles |
| `src/devices/cpu/m6800/6800ops.hxx` | `98e45de37d1131d492e374d62be1ff0c635d29b9` | BSD-3-Clause / Aaron Giles |
| `docs/legal/BSD-3-Clause` | `cc9ab753198e41128dc651e0adb4f5e8c1be932a` | ライセンス全文。ローカルの同名ファイルとblob一致 |

現行MAMEでは`6800tbl.hxx`は独立ファイルではない。VJR-200の4ファイルを
監査対象として固定し、MAME現行版を権利表示と割込cycleの追加根拠にした。
dispatchは基準VJR-200との互換を優先し、2025-01-04追加の未文書命令`$14 NBA`と
旧tableのaliasを保持する。現行MAMEがillegal扱いするopcodeとの差は確認したが、
JR-200実機上の全未文書opcodeは未測定である。試験は全entryが停止せず進むことまでを
確認し、未文書opcodeの実機一致とは扱わない。

## ローカルへの対応

- `include/jr200/m6800.hpp`: OS非依存CPU API、明示的bus/IRQ/NMI入力。
- `src/core/m6800.cpp`: 固定幅register、cycle/wait trace、reset/interrupt実装。
- `src/core/6800ops.hxx`: 適応した命令動作。
- `src/core/6800tbl.hxx`: 適応したdispatch表。
- `LICENSES/MAME_BSD-3-Clause.txt`: MAMEのBSD-3-Clause全文をbyte単位で保持。
- `THIRD_PARTY_NOTICES.md`: Aaron GilesとFINDの由来、除外した依存を記録。

`M6800Bus`はopcode、operand、data、stack、vectorを区別し、各read/writeが
返すwait stateを命令のbase cycleと別に加算する。CPUは周辺機器をtickせず、
呼出側が返されたcycleを使う。IRQはlevel入力、NMIはpending pulseとし、WAIは
状態を一度だけstackへ退避する。

VJR-200の割込処理には通常割込を26 cycleとするJR-200固有コメントがあるが、
根拠資料と周辺schedulerとの分担をそのファイルだけから確定できない。CPU単体では
現行MAMEの12 cycle、WAI復帰4 cycleを採用し、合成試験で固定した。今後、実機または
公開タイミング資料からJR-200固有の追加waitが確認された場合は、CPU命令表を書き換えず
bus/scheduler側の明示waitとして扱う。

## 移植時に除外したもの

`JRSystem`、`Address`具象型、Win32/TCHAR、DirectSound/Direct2D、cereal、
UIデバッガ、global breakpoint/jump history、周辺LSIの直接tick、cheat-loadingの
cycle補正、endian依存のPAIR unionは含めていない。A/Bは明示したhigh/low byteで
保持し、16 bit値はshiftで構成する。

## 検証境界

合成ROMでALU/flag、分岐、stack byte順、JSR/RTS、SWI/RTI、reset、IRQ、NMI、
WAI、CLI遅延、wait state、`0xffff`境界、256 opcodeの有界進行をnativeで試験する。
同じ固定traceを直接WASMでも照合する。これはCPU単体の移植証拠であり、JR-200の
ROM起動、周辺回路、実機タイミング、保存済みWAVの正しさを証明しない。
