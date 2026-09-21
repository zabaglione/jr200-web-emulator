# 実装・検証状況
基準日: 2026-09-22 / 初期パッケージ0.0.1

## リポジトリ初期設定：完了

対象: `zabaglione/jr200-web-emulator`（private）、既定ブランチ `main`。
初期ソース・開発文書・ライセンス・CI設定の57ファイルをcommit `072e977343c8aa7655367f926bc29b2b220e93e1` に登録した。Git tree `854042e76159dd80bebd9210387d567e2e1a37c8` が、ローカルで独立計算した全ファイルのtreeと一致した。

P00〜P13は実際のIssue #1〜#14として登録済み。対応と依存関係は [ISSUE_INDEX.md](ISSUE_INDEX.md)。受入レビュー前のため自動closeしていない。旧bootstrapによる新規作成は不要である。

## GitHub Actions：初回4ジョブ成功

対象commit: `072e977343c8aa7655367f926bc29b2b220e93e1`
実行: [source-and-codec / run 35616519996](https://github.com/zabaglione/jr200-web-emulator/actions/runs/35616519996)
トリガー: mainへのpush。GitHubから取得したstatusはcompleted、conclusionはsuccess。

| ジョブ | 実行内容 | 結果 |
|---|---|---|
| native (ubuntu-latest) | make test | success |
| native (macos-latest) | make test | success |
| sanitized | make sanitize | success |
| wasm-codec | make wasm-smoke | success |

ローカルでもmake testとmake sanitize各3/3、WASMとJSラッパー、make checkが成功。FINDライセンスの原文blob一致、配布表記、ソース限定inventoryも検査した。初期のローカル試験詳細は [TEST_RESULTS.md](TEST_RESULTS.md)。古い計画表のremote CI未実行という記述は、この実測結果で更新する。

## 実装済みの範囲

P00: 2026-09-22受入完了。上流commit・CJR由来・FINDライセンス原文を固定し、Emscripten配布物から全文へHTTP到達できることを確認。未取込のCPU等は監査対象外であり、監査済みではない。
P01: 2026-09-22受入完了。C++20共通ライブラリ、容量付きC ABI、native/Clang直接WASM、正式Emscripten、CMake/Make、sanitizer、4ジョブCIを確認。
P02: 2026-09-22受入完了。CJR構造/チェックサム検査、元バイト保持、BIN包装、CLI、WASM検査画面を合成データで確認。独立既存実装との互換はP03に残す。
P03: 2026-09-22受入完了。JR2Rescue 0.6.2の固定Windows向けバイナリをMono上で実行し、自作データの標準MSAVE/BASIC、境界長、600/2400、マルチ領域、headerlessを対照した。標準出力は全バイト一致し、600 baudの新規writer値を実測の100へ合わせた。
P04: 2026-09-22受入完了。VJR-200/MAMEのMC6800ファイルを個別監査し、明示bus/IRQ/NMI/wait APIを持つ固定幅コアへ移植した。合成ROMの命令・flag・stack・割込・境界とnative/直接WASMの同一traceを確認した。
P05: 2026-09-22受入完了。Address/MN1271/MN1544/CRTC/JRSystemを個別監査し、CPUとメモリmap、timer/IRQ、key handshake、CMT REMOTE、PCM queue、ARGB framebufferを明示cycle clockで接続した。native/直接WASM/正式Emscriptenの合成試験を確認した。
P06: 2026-09-22受入完了。Emscripten 6.0.9を固定し、結合/分割ROMとフォントのローカル選択、入力検査、Canvas、キー押下/離上、NMI、ポーズ、リセット、フォーカス喪失停止、明示許可式IndexedDBを接続した。利用者提供の実機MSAVE録音をGit対象外でJR2Rescue 0.6.2により抽出し、Chrome 153、Firefox 156、Safari 26.6.2でJR BASIC 5.0のプロンプトと入力を確認した。詳細は [P06_BROWSER_ACCEPTANCE.md](P06_BROWSER_ACCEPTANCE.md)。
P07: 2026-09-22受入完了。OS非依存コアとWeb UIへ、実行前breakpoint、1命令step、命令完了後read/write watchpoint、register表示、手動256 byte peekを接続した。break/watch各16件、命令256件、CPUアクセス512件の固定上限と破棄件数を持ち、履歴有効/無効で全メモリ・register・cycleが一致することをnative/WASMで確認した。実装commit `f85aa1d3db234db71baf91b59779ea84aafe01df` のActions run `35650269016`は4ジョブすべてsuccess。詳細は [P07_DEBUGGER_ACCEPTANCE.md](P07_DEBUGGER_ACCEPTANCE.md)。
P08: 2026-09-22受入完了。OS非依存の固定容量カセットtransportをMN1271のREMOTE/read/writeへ接続し、標準BASIC/マシン語CJRのmount/eject/rewindとLOAD/MLOAD/SAVE/MSAVEを通常信号経路で確認した。正式Emscripten siteの実ROMでBASIC 2行と4 byteの自己往復、および実機MSAVE録音から独立ツールで復元した2048 byte font CJRの通常MLOADを確認した。WAV復元自体は本実装ではない。実装commit `a0cc4c6a96b4c993d2d5bfc84f3280d75dd15426` のActions run `35657825103`は4ジョブすべてsuccess。詳細は [P08_CASSETTE_ACCEPTANCE.md](P08_CASSETTE_ACCEPTANCE.md)。
P09: 2026-09-22受入完了。44.1 kHz固定PCM queueをWASMから一括drainし、利用者操作式Web Audio、既定20%/上限50%のgain、sample rate表示、underrun/overflow計数、mute、pause/resume/disable時のsource停止とqueue破棄を実装した。正式Emscripten siteの実ROMで`SOUND 440,50`から非0 PCM 45945 frame、peak 7000を観測し、overflow/underrun 0、停止後active/queue 0を確認した。物理出力の音圧・panは未計測。実装commit `904781db9c1e2cfefed6237d3d088ee171c3fe33` のActions run `35661382620`は4ジョブすべてsuccess。詳細は [P09_AUDIO_ACCEPTANCE.md](P09_AUDIO_ACCEPTANCE.md)。
P10: 2026-09-22ローカル受入完了。P08と共通の4800 Hz信号源から12-bit frame、固定600 baud header、CJR header追従または明示600/2400のdata、VJR-200由来leader/intervalをRIFF PCM mono16の44.1/48 kHzへ累積有理時刻で出力するCLI/WASM/Web機能を実装した。JR2Rescue 0.6.2との4波形比較でhalf-span/位相patternが一致し、独立decodeした4 CJRは各入力と全byte一致した。JR2Rescueの短いleader/interval差と実機未検証は残す。詳細は [P10_WAV_ACCEPTANCE.md](P10_WAV_ACCEPTANCE.md)。remote CIとIssue closeは実装commitのpush後に記録する。

## 未実装・未検証

自前のCJR→WAVは実装済みだが、WAV→CJR decoderと実機との生成WAV往復は未実装/未実施。P09のWeb Audio接続とP10の独立tool decodeは、物理出力の音圧・pan、実機register/timing、生成WAVのJR-200実機互換を示さない。利用者提供録音の復元には独立参照ツールJR2Rescueを使用しており、本プロジェクト自身のWAV decoder試験ではない。ROM/フォント・商用ソフト・録音は未同梱である。

Emscripten 6.0.9による正式ビルド、生成モジュールのNode試験、合成ROMの直接WASM/JS試験、実ROMの三ブラウザ試験を2026-09-22にローカル実行した。ChromeとSafariはmacOSの実ブラウザ、Firefoxは読み取り専用検体mountを持つ隔離コンテナのWebDriverで確認した。

## 次の作業

#1 (P00)〜#10 (P09) はremote受入完了。#11 (P10) はローカル受入完了で、実装commitのCI成功後にcloseする。次は #12 (P11) の録音WAV解析・CJR復元である。独立参照toolでのdecodeを自前decoder完了へ読み替えない。

privateは維持。Pages/外部公開デプロイ、アクセス権・branch protection・課金設定の変更は行っていない。
