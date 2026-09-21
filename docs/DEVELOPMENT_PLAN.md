# 開発順序

計画IDはP00〜P13。登録済みGitHub Issue番号は #1〜#14。対応表は ISSUE_INDEX.md を参照する。

| 順序 | 作業 | 依存 | 初期実装時点の記録 |
|---|---|---|---|
| P00 | [出典固定・取込済コードのライセンス監査](issues/P00.md) | なし | 取込済CJR部分をローカル確認済み。上流全ファイルの網羅監査ではない。 |
| P01 | [C++20共通コア・native/WASMビルド基盤](issues/P01.md) | P00 | nativeとClang WASMをローカル検証。Emscriptenとremote CIは未実行。 |
| P02 | [CJR構造・検証・損失なし保存・BIN包装](issues/P02.md) | P01 | 初期実装と合成テストあり。独立した既存実装との互換はP03。 |
| P03 | [Windows基準実装とのCJR差分試験](issues/P03.md) | P02 | 未着手。Windows実行結果または権利確認済み対照検体が必要。 |
| P04 | [CPUコア・メモリバスの移植](issues/P04.md) | P03 | 受入完了。CPU4ファイル監査、明示bus/wait/IRQ、native/WASM同一traceを確認。 |
| P05 | [MN1271・MN1544・CRTCとシステム時刻](issues/P05.md) | P04 | 受入完了。上流監査、明示cycle、timer/key/CMT、PCM/framebufferを合成試験。 |
| P06 | [ブラウザBASIC起動・ROM選択・入力と画面](issues/P06.md) | P05 | 受入完了。実ROMで三ブラウザのBASIC表示・入力、ポーズ/リセット/フォーカス喪失を確認。 |
| P07 | [開発用デバッガ・追跡・メモリウォッチ](issues/P07.md) | P06 | 2026-09-22受入完了。固定長履歴、break/watch、step、peekをnative/WASM/ブラウザで確認。 |
| P08 | [CJRカセットLOAD/MLOAD/SAVE/MSAVE統合](issues/P08.md) | P07 | 2026-09-22受入完了。通常LOAD/MLOAD/SAVE/MSAVEと固定容量transportを確認。 |
| P09 | [音声のWeb出力・休止復帰](issues/P09.md) | P08 | 2026-09-22受入完了。明示開始Web Audio、sample rate、mute、休止復帰を確認。 |
| P10 | [CJR信号生成・WAVエンコード](issues/P10.md) | P09 | 2026-09-22ローカル受入完了。44.1/48 kHz、600/2400、独立decodeを確認。 |
| P11 | [録音WAV解析・CJR復元](issues/P11.md) | P10 | 未実装。合成WAVと実機録音を別のテスト分類にする。 |
| P12 | [実機とのWAV往復受入試験](issues/P12.md) | P11 | 未実施。実機MSAVE録音は受領済みだが、自前変換と双方向往復は未確認。 |
| P13 | [配布監査・再現可能ビルド・初版受入](issues/P13.md) | P12 | 未着手。初版の一般公開はこのIssueにも含めない。 |

最新の検証結果は [STATUS.md](STATUS.md) を正とする。初期commitのGitHub Actionsは4ジョブ成功しており、上表のremote CI未実行という履歴とは区別する。

## 実行上の注意

P00→P01→P02の順にローカルの初期実装を進めた。P01はnative/直接WASM基盤とEmscripten/CI設定の作成までを対象とし、正式Emscripten実行確認はP06、remote CIの最終受入はP13へ明示的に分離した。設定ファイルを置くこと自体は実行成功を意味しない。現在の実行証拠はSTATUS.mdを参照する。

P00〜P09はremote受入完了、P10はローカル受入完了。実装commitのCI成功後にP10をcloseし、次の依存工程はP11の録音WAV解析・CJR復元である。スクリプトによる自動closeはしない。実機試験に進めない場合も、未検証を隠して依存工程を完了扱いにしない。

主な優先順位は、ライセンス/由来の喪失防止、既存CJRとの互換、CPU/周辺回路の根拠付き移植、通常カセット経路、最後に実機WAV往復。画面の見た目やFDD追加を先行させない。

## 登録済みGitHub Issue

実際のIssue番号は [ISSUE_INDEX.md](ISSUE_INDEX.md)。P00〜P13は #1〜#14 に対応する。初期実装があるP00〜P02も受入レビュー前にはcloseしない。
