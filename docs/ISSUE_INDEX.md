# 開発Issue一覧

登録日: 2026-09-21。対象は `zabaglione/jr200-web-emulator`（private）。以下はGitHubから返された実際のIssue番号。2026-09-22までにP00〜P11を順に受け入れた。

| 計画 | Issue | 作業 | 依存 |
|---|---|---|---|
| P00 | [#1](https://github.com/zabaglione/jr200-web-emulator/issues/1) | 出典固定・取込済コードのライセンス監査 | なし |
| P01 | [#2](https://github.com/zabaglione/jr200-web-emulator/issues/2) | C++20共通コア・native/WASMビルド基盤 | #1 |
| P02 | [#3](https://github.com/zabaglione/jr200-web-emulator/issues/3) | CJR構造・検証・損失なし保存・BIN包装 | #2 |
| P03 | [#4](https://github.com/zabaglione/jr200-web-emulator/issues/4) | Windows基準実装とのCJR差分試験 | #3 |
| P04 | [#5](https://github.com/zabaglione/jr200-web-emulator/issues/5) | CPUコア・メモリバスの移植 | #4 |
| P05 | [#6](https://github.com/zabaglione/jr200-web-emulator/issues/6) | MN1271・MN1544・CRTCとシステム時刻 | #5 |
| P06 | [#7](https://github.com/zabaglione/jr200-web-emulator/issues/7) | ブラウザBASIC起動・ROM選択・入力と画面 | #6 |
| P07 | [#8](https://github.com/zabaglione/jr200-web-emulator/issues/8) | 開発用デバッガ・追跡・メモリウォッチ | #7 |
| P08 | [#9](https://github.com/zabaglione/jr200-web-emulator/issues/9) | CJRカセットLOAD/MLOAD/SAVE/MSAVE統合 | #8 |
| P09 | [#10](https://github.com/zabaglione/jr200-web-emulator/issues/10) | 音声のWeb出力・休止復帰 | #9 |
| P10 | [#11](https://github.com/zabaglione/jr200-web-emulator/issues/11) | CJR信号生成・WAVエンコード | #10 |
| P11 | [#12](https://github.com/zabaglione/jr200-web-emulator/issues/12) | 録音WAV解析・CJR復元 | #11 |
| P12 | [#13](https://github.com/zabaglione/jr200-web-emulator/issues/13) | 実機とのWAV往復受入試験（初版後へ延期） | #12 |
| P13 | [#14](https://github.com/zabaglione/jr200-web-emulator/issues/14) | 配布監査・再現可能ビルド・初版受入 | #12 |

順序: #1 → #2 → #3 → #4 → #5 → #6 → #7 → #8 → #9 → #10 → #11 → #12。
#12以降は、初版後の実機試験#13と、private初版受入#14へ分岐する。

#1〜#12と#14は受入完了。#13の実機WAV往復は初版後の未検証Issueとしてopenで残す。
独立toolによる生成WAVのdecode、自前WAV decoder、利用者提供録音のdecode、実機WAV
往復の合格はそれぞれ別である。
