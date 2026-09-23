# VJR-200 Windows版との機能対応表

確認日: 2026-09-22。基準はFINDのVJR-200 V1.8.2、commit
`dd748995bede57da5baebc1225c7a33433aa6934`である。Windows 11 ARM上でx64版の
起動とJR BASICの`CTRL+A`を確認し、機能一覧と設定値は固定commitの
`VJR200.cpp`、`VJR200.rc`、`OptionDialog.cpp`、`Address.cpp`、`Mn1544.cpp`、
`AppSettingXml.cpp`を照合した。

Windows版はエミュレータ互換性の参照とする。ただし、Win32 UI、DirectSound、
ローカルパス保存をそのままWebへ移すのではなく、同じ利用目的をブラウザの
安全モデルで実現する。Windows版との一致は物理JR-200との一致を証明しない。

## 対応した項目

| Windows版の機能 | Web版の対応 | 境界 |
|---|---|---|
| CJRセット | 実装済み | 通常のMN1271信号経路でLOAD/MLOAD |
| CJR高速ロード | 実装済み | BASICは`$0801`と終端pointer、マシン語は各blockのaddressへ書込む。カセット信号の成功証拠にはしない |
| Quick Type | 実装済み | 貼り付けたASCII、改行、半角カナを10〜100 ms間隔で入力。実行中はCPU 1000%、ESC/F11で中止 |
| 10件のマクロ | 実装済み | `\r`をRETURN、`\\`を円記号／backslashとしてlocalStorageに保存 |
| ローマ字カナ | 実装済み | カナモードの物理keyboardにだけWindows版の変換表を適用 |
| メモリダンプ | 実装済み | 副作用のないpeekで64 KiBの`dump.bin`を作成 |
| 画面倍率 1〜5倍 | 実装済み | 自動倍率も選択可能 |
| 全画面 | 実装済み | ボタンとAlt+Enter。ビューポートに収まる最大サイズ |
| 正方形／ビデオ相当画素比 | 実装済み | ビデオ相当はWindows版の比率に合わせ横85% |
| smoothing | 実装済み | 既定はpixelated、設定ONでブラウザ補間 |
| 0/90/180/270度回転 | 実装済み | framebufferの画素をCanvasへ回転配置 |
| CPU 50〜1000% | 実装済み | 実行cycle速度を変更。音声再生倍率も追従し、予約先行を250 msで制限。状態欄に設定値と実測FPSを表示 |
| LOAD/MLOAD中のoverclock | 実装済み | REMOTE ONの再生中だけ1000% |
| RAM拡張1 | 実装済み | `$8000–$9FFF` |
| RAM拡張2 | 実装済み | `$A000–$BFFF`をROM1の代わりにRAM化 |
| RAM初期化pattern 0/1 | 実装済み | Windows版の2配置を共通C++コアで再構成。起動／リセット時に反映 |
| joystick A/B番号 | 実装済み | Gamepad APIのbutton 0〜31を選択 |
| 1button／2button | 実装済み | 1button時はWindows版同様、方向以外のどのbuttonもJR-200のAへ入力 |
| 強制joystick | 実装済み | 1Pをjoystick portから外し、方向をcursor code、A/Bを指定JR codeで入力 |
| ボリューム | 実装済み | Web Audioの明示gainとmute。既定ON |
| graph keyboard | 実装済み | 実ROM/fontの字形を用いる画面上keyboardとGRAPHモード |
| debuggerの実行／停止／step、break/watch、履歴 | 実装済み | 固定上限の履歴と副作用なしpeek |
| reset | 実装済み | ROM/fontと選択設定を保ってmachineを再初期化 |
| JP/EN keyboard選択 | Webで同等対応 | `KeyboardEvent.code`を主に使いlayout依存を避け、macOS JISの`]`も補正。手動選択は追加しない |
| 背景実行 | Webで同等対応 | 既定は実行継続。別tabで停止する設定も選択可能。browser自身のthrottlingは制御不可 |

RAM設定のためsystem ABIを9へ上げた。ホスト側から設定を保存するだけでなく、
native、直接WASM、Emscriptenの同じC++メモリmapに反映する。

## 保留した項目

| Windows版の機能 | 現在の判定 | 理由／再開条件 |
|---|---|---|
| 10 slotのstate save/load | 保留 | CPUだけでなくMN1271、MN1544、CRTC、cassette、debugger、PCM等のversion付き直列化が必要。一部memoryだけの偽saveは作らない |
| JR2 new/top/next/previous/eject | 保留 | JR2はCJRと別の生信号format。parser、transport、受入fixtureが必要 |
| FDD/D20/D88 | 保留 | FDD controllerとmedia formatを追加する別milestone |
| printer/page feed | 保留 | printer peripheral、buffer、Web出力形式の設計が必要 |
| debugger label／disassembler | 保留 | symbol format、MC6800命令表示、address空間とbankの受入が必要。現在のbreak/watch/traceは維持 |
| 最近使ったfile | 保留 | Webはfile pathを再利用できない。File System Access APIは対応browserと再許可の設計が必要 |
| CMTの追加blank | 保留 | CJR原byte、logical block、再生波形のどの層にblankを置くかを定義し、Windows出力fixtureと照合する必要がある |
| 手動refresh rate | 非移植 | Webは`requestAnimationFrame`に表示を合わせ、CPU cycleは経過時間から独立計算。Windows timer値をそのまま設定しない |
| stereo pan | 非移植 | JR-200実機を優先する方針に従いmono mixを維持 |
| DirectSound buffer設定 | 非移植 | Web Audioのdevice bufferはbrowserが管理。PCM queueのoverflow/underrunは状態表示と自動試験で監視 |

## 検証境界

- native CTestでRAM mapと初期化2 patternを確認する。
- 直接WASMとJS wrapperでABI 9、設定、CJR高速ロード、dumpを確認する。
- Chromeで画面変換／全画面入退出、CPU/RAM設定、CPU 1000%時の音声先行上限、
  Quick Type、中止、マクロ、ローマ字カナ、
  joystick設定／強制モード、64 KiB dump、CJR高速ロードを合成ROMで確認する。
- これらはWindows版機能のWeb配線と合成コアの確認である。物理gamepad、生成WAVの
  JR-200実機読込み、保留機能の動作を証明しない。

固定上流とlicenseは[UPSTREAM.md](UPSTREAM.md)、テスト実測は
[TEST_RESULTS.md](TEST_RESULTS.md)を参照する。
