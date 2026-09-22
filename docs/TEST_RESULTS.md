# 初期実装の試験記録

## P13 private初版候補のローカル監査（2026-09-22 / macOS）

P12の物理JR-200往復を初版後へ延期し、P13をP11依存のprivate初版受入へ変更した。
SPDX 2.3 SBOM、CI browser smoke、Git tracked sourceと完全一致するallow-list、staged siteの
明示entry検査を追加した。P12はopenかつ未検証のまま残す。

候補treeで`make check`、`make test`、`make sanitize`、`make wasm-smoke`、`make wasm`、
Playwright 1.63.0＋Chrome 153.0.8010.53の`tests/browser_smoke.py`が成功した。nativeと
sanitizerは各CTest 9/9、直接WASMは7系統、正式Emscripten 6.0.9 moduleのNode smokeも
成功した。13ファイル・216 KiBのstaged siteにROM/tape/recording拡張子はなく、browser
smokeの外部requestは0件だった。

remote `main`の実装head `dff63edd501b8f4598718283ec93fe4338c73c60`を`/private/tmp`へ
新規cloneし、`make test`、`make wasm-smoke`、`make wasm`、`make check`を実行した。
native 9/9、直接WASM 7系統、Emscripten 6.0.9正式moduleとNode smoke、配布監査が成功し、
tracked sourceはcleanだった。

同じheadのGitHub Actions run `35675108809`はUbuntu/macOS native、sanitizer、WASM、
browserの5ジョブすべてsuccess。browser jobはPlaywright 1.63.0とChromium 152.0.7977.0で
合成ROM/UI/WAV操作と外部request 0件を確認した。先行run `35674971686`はworkflow YAMLの
未引用コロンによるjob 0件の構文failureで、修正後の受入結果には使用していない。

P13はprivate初版0.0.1として受入完了。これはP12の実機互換合格を意味しない。詳細は
[P13_RELEASE_ACCEPTANCE.md](P13_RELEASE_ACCEPTANCE.md)。

## P11 録音WAV解析・CJR復元受入（2026-09-22 / macOS・GitHub Actions）

RIFF/PCM検査、DC/RMS/極性/channel/half-span/実測baud診断、frame/block/checksum/CJR検証、
CLI/WASM/Webの候補隔離を実装した。独立ツール生成の44.1/48 kHz・600/2400 baud全4 WAVを
入力52 byteのCJRへ戻し、Git対象外の利用者提供録音3本も独立復元済みCJRと各全バイト一致した。

`make test`と`make sanitize`は各CTest 9/9、直接WASMは7系統、Emscripten 6.0.9正式module、
Chrome 153とPlaywright 1.63.0のbrowser smoke、`make check`がローカルで成功した。無音、切断、
noise、不正RIFF、float PCM、checksum破損を検証済み出力として保存しないことも確認した。

実装commit `756d69c4363620bac19a9b936a757e92a47e5fa3`を含むhead
`92722edc10aab6558337b5fbda43fff20f431308`のGitHub Actions run `35672191674`は、
wasm-codec、Ubuntu/macOS native、sanitizedの4ジョブすべてsuccess。これはWAV decoderの
remote受入であり、本実装生成WAVの物理JR-200読込や独立2回の録音往復ではない。
詳細は [P11_WAV_DECODE_ACCEPTANCE.md](P11_WAV_DECODE_ACCEPTANCE.md)。

## P10 CJR信号生成・WAVエンコード受入（2026-09-22 / macOS）

P08の共通4800 Hz信号源から12-bit frame、固定600 baud header、600/2400 data、
VJR-200固定commitのleader/intervalをRIFF PCM mono16の44.1/48 kHzへ変換した。
sample位置は累積有理時刻で決め、CLIはstream、WASMは4096 sample chunk、Webは
256 MiB上限と自動再生なしで保存する。baud無指定はCJR headerへ従う。

`make test`と`make sanitize`は各CTest 8/8、`make wasm-smoke`はCJR/CPU/system/
JS wrapper/Web Audio/WAV ABIの6試験、Emscripten 6.0.9の`make wasm`とChromeの
44.1 kHz/16-bit/mono/2400生成も成功した。

JR2Rescue 0.6.2との48/44.1 kHz、600/2400の4波形比較ではhalf-spanと全3 blockの
位相patternが一致した。参照toolは固定VJR-200よりleader/intervalが短く、各block
anchorに400 ms差がある。本実装WAVを同toolでdecodeした4 CJRは入力52 byteと全byte
一致した。これは独立decoder互換であり、物理JR-200のLOAD/MLOAD成功ではない。
詳細は [P10_WAV_ACCEPTANCE.md](P10_WAV_ACCEPTANCE.md)。

実装commit `b89a9d1717cd892ced06ea5ff8d2ffc2bfa00dfc` のGitHub Actions run
`35666390234`はwasm-codec、Ubuntu/macOS native、sanitizedの4ジョブすべてsuccess。

## P09 音声Web出力・休止復帰受入（2026-09-22 / macOS）

P05のcycle駆動44.1 kHz・3 channel固定PCM queueを維持し、決定的mono mix、一括WASM
drain、利用者操作式Web Audio、既定20%/上限50% gain、sample rate表示、underrun計数、
mute、pause/resume/disable時のsource停止とqueue破棄を追加した。

`make test`と`make sanitize`は各CTest 7/7、`make wasm-smoke`はCJR/CPU/system/
JS wrapper/Web Audio schedulerの5試験、Emscripten 6.0.9の`make wasm`も成功した。
fake 48 kHz contextで44.1 kHz buffer、sample正規化、underrun、pause/resume競合を確認した。

正式Emscripten siteをGit対象外の実ROM/fontで起動し、明示操作前はAudioContext未作成、
操作後はrunning、core/outputとも44100 Hzだった。JR BASIC `SOUND 440,50`後は非0 PCM
45945 frame、peak 7000、core overflow/underrun 0。ミュート、一時停止、停止後はactive
sourceとqueueが0で、console error/warningは0件だった。物理出力の音圧・可聴性・panは
未計測であり、カセットWAV生成とは別である。詳細は
[P09_AUDIO_ACCEPTANCE.md](P09_AUDIO_ACCEPTANCE.md)。

実装commit `904781db9c1e2cfefed6237d3d088ee171c3fe33` のGitHub Actions run
`35661382620`はwasm-codec、Ubuntu/macOS native、sanitizedの4ジョブすべてsuccess。

## P08 CJRカセットLOAD/MLOAD/SAVE/MSAVE受入（2026-09-22 / macOS）

OS非依存の固定容量`CassetteDeck`をMN1271のREMOTE、register 7読出し、register 0D
書込みへ接続した。`make test`と`make sanitize`は各CTest 7/7、`make wasm-smoke`は
CJR/CPU/system/JS wrapperの4試験、Emscripten 6.0.9の`make wasm`、`make check`も
成功した。2400/600 baud、279/280 cycle境界、CJR全byte自己往復、footer直後の
REMOTE OFF、容量超過、headerless・未知type・特殊形式拒否を確認した。

正式Emscripten siteをGit対象外の実ROM/fontで起動し、通常`SAVE`→`LOAD`でBASIC
2行と`RUN`結果`42`、通常`MSAVE`→`MLOAD`で`$7000`〜`$7003`の4 byte一致を確認した。
利用者の物理JR-200によるMSAVE WAVからJR2Rescue 0.6.2で復元済みのfont CJRも
通常`MLOAD`し、84784 sample後に変更した`$D008`〜`$D00E`が復元された。
browser consoleのerror/warningは0件だった。Python Playwright moduleがないため
`tests/browser_smoke.py`自身はimport時点で未実行である。

これは標準CJR transportの受入である。WAV復元は独立参照ツールによるもので、
自前WAV decoder、Web Audio、生成WAVの物理JR-200互換を示さない。ROM、font、WAV、
CJR、BIN、画面capture、内容hashはGitへ追加していない。詳細は
[P08_CASSETTE_ACCEPTANCE.md](P08_CASSETTE_ACCEPTANCE.md)。

実装commit `a0cc4c6a96b4c993d2d5bfc84f3280d75dd15426`に対する
[Actions run 35657825103](https://github.com/zabaglione/jr200-web-emulator/actions/runs/35657825103)は、
Linux/macOS native、sanitizer、Clang直接WASMの4ジョブすべてsuccessだった。

## P07 デバッガ・追跡・メモリウォッチ受入（2026-09-22 / macOS・GitHub Actions）

`make test`と`make sanitize`は各CTest 6/6、`make wasm-smoke`はCJR/CPU/system/
JS wrapperの4試験、Emscripten 6.0.9の`make wasm`も成功した。breakpointの実行前停止と
1回通過、step、read/write watchpoint、固定長ring eviction、peek非記録を確認した。

履歴有効・無効の2台を同じ1000 cycle以上で実行し、全65536 byte、全CPU register、
CPU/機械cycle、PCM queueが一致した。400命令の記録後は命令256件・破棄144件、
CPUアクセス512件・破棄88件となり、無制限に増えないことを確認した。

正式Emscripten siteを実ROMで起動し、in-app browserで実行前breakpoint、1命令step、
read watchpoint、手動256 byte peekを操作した。peek前後でCPUアクセス履歴件数は不変、
console error/warningは0件で、デスクトップ表示も目視した。ROM/font/captureはGitへ
追加していない。Python Playwright moduleがないため`tests/browser_smoke.py`自身は
import時点で未実行であり、ブラウザ手動操作と区別する。

実装commit `f85aa1d3db234db71baf91b59779ea84aafe01df`に対する
[Actions run 35650269016](https://github.com/zabaglione/jr200-web-emulator/actions/runs/35650269016)は、
Linux/macOS native、sanitizer、Clang直接WASMの4ジョブすべてsuccessだった。詳細と
未検証範囲は [P07_DEBUGGER_ACCEPTANCE.md](P07_DEBUGGER_ACCEPTANCE.md)。

## P06 ブラウザBASIC起動受入（2026-09-22 / macOS・Firefox隔離コンテナ）

Emscriptenを6.0.9へ固定し、`make test`、`make sanitize`、`make wasm-smoke`、
`make wasm`、`make check`を実行した。native/sanitizerは各CTest 6/6、直接WASMは
CJR/CPU/system/JS wrapperの4試験、正式Emscripten moduleはNodeから
boot/run/resetとtimer/peekを確認した。

利用者提供の実機MSAVE録音3本はGit対象外の`local-assets/`だけで扱い、
JR2Rescue 0.6.2でROM1 8192 byte `$A000`、ROM2 8192 byte `$E000`、font 2048 byte
`$D000`を復元した。参照ツールでの復元であり、自前WAV decoderや実機往復の
合格には含めない。

正式Emscripten配信を実ROMで起動し、Chrome 153.0.8010.48ではprogram入力、
`LIST`、`RUN`、出力`5`、Safari 26.6.2では`PRINT 7`と出力`7`を目視した。
Firefox 156.0はSelenium 4.49.0の隔離コンテナで同じ`LIST`/`RUN`/`5`を確認し、
tab切替での自動停止も検査した。Safariは情報dialog表示によるblur後に自動停止した。
Chrome consoleのerror/warningは0件だった。詳しい環境、コマンド、境界は
[P06_BROWSER_ACCEPTANCE.md](P06_BROWSER_ACCEPTANCE.md) に記録した。

## P05 周辺回路受入（2026-09-22 / macOS）

VJR-200のAddress、MN1271、MN1544、CRTC、JRSystemの10ファイルをGit blobで
固定し、メモリmap、32 byte mirror、timer/IRQ、KTEST/KACK、CMT、描画規則を
対照した。ファイル別判断と実機未確認範囲は
[P05_PERIPHERAL_AUDIT.md](P05_PERIPHERAL_AUDIT.md) に記録した。

`make test`はCTest 6/6、`make sanitize`はASan/UBSan付きで6/6成功した。
周辺回路試験はRAM/ROM/open領域、DRAM wait、I/O trace、side-effect-free peek、
TCA IRQ、2049 byteのfont/baud bootstrap、key/joystick handshake、CMT REMOTE、
44.1 kHz 3 channel PCM queue、320×224 ARGB framebuffer、CPU cycle接続を確認した。

Emscripten同梱LLVMを指定した`make wasm-smoke`はCJR、CPU、周辺回路、JS wrapperの
4試験に成功した。Emscripten 6.0.9の`make wasm`も成功し、生成ES moduleを
Node.jsで起動してcodec/CPU/system ABI versionとtimer IRQ/peekを確認した。

Playwrightは現在のPython環境にないためブラウザ自動操作試験は未実行である。
正式Emscripten配信をlocalhostで開き、`WASM起動済み`とP05後の未実装境界表示を
Codex in-app browserで目視した。Node/WASM試験とこの起動確認はCanvas/Web Audio、
メーカーROM/fontによるBASIC起動、実機register/timing、保存済みWAVの検証を
代替しない。

## P04 CPU単体受入（2026-09-22 / macOS）

VJR-200の`m6800.h`、`m6800.cpp`、`6800ops.hxx`、`6800tbl.hxx`を個別に
Git blobで固定し、現行MAMEのBSD-3-Clause表示・全文と割込cycleを照合した。
監査対象、依存除外、blobは [P04_CPU_AUDIT.md](P04_CPU_AUDIT.md) に記録した。

`make test`はCTest 5/5、`make sanitize`はASan/UBSan付きで5/5成功した。
CPU native試験はALU/flag、branch、stack byte順、JSR/RTS、SWI/RTI、reset、
IRQ、NMI、WAI、CLI遅延、access別wait、16 bit境界、全256 opcodeの有界進行を確認した。

Emscripten同梱LLVMを指定した`make wasm-smoke`はCJR、CPU、JS wrapperの3試験に
成功した。CPU試験はnativeと同じ10命令のopcode、全register、memory、base/wait/
total cycle、WAIからのNMI復帰を固定値で照合した。Emscripten 6.0.9の正式buildも
成功し、生成ES moduleをNode.jsで起動してCPU C ABI versionとreset vectorを確認した。

`tests/browser_smoke.py`はPython環境にPlaywrightがなく実行できなかった。ローカル配信を
Codex in-app browserで開き、WASM起動表示とMAMEライセンス導線を目視した。これらは
CPU単体の移植証拠であり、JR-200 ROM/BASIC起動、周辺回路、実機タイミング、WAV互換の
証拠ではない。

## P03独立対照（2026-09-22 / JR2Rescue 0.6.2）

上流commit `8f14894706443288bb9838a28f4e828b7ee551b8`のJR2Rescue 0.6.2 Windows向けバイナリを、Ubuntu 24.04 arm64の隔離コンテナ上のMono 6.8.0.105で実行した。参照ZIPのSHA-256を固定し、自作の全ゼロBIN 1/255/256/257/512バイトと自作BASICメモリ像をGUIでCJR化した。標準MSAVEとBASICは本コーデック出力と全バイト一致した。

本コーデックの257バイトCJRをJR2RescueがWAV化・再読込でき、2400 baudは全バイト一致、600 baudはbaud生値`100`とそのヘッダーチェックサムだけが変化した。この実測に合わせてCLI/Webの600 baud writerを`100`へ変更し、任意の既存非0値を保持するreader/copy契約は維持した。JR2Rescue作成の2領域CJRは警告付きで解析・無変更コピーでき、ヘッダーなしCJRは明示指定時だけ本コーデックが受理し、JR2Rescueもbaud上書き無効時にJR2へ変換した。

検体hash、手順、WAVメタデータ、差分、未検証範囲は [P03_REFERENCE_RESULTS.md](P03_REFERENCE_RESULTS.md)。生成物と参照バイナリはGitに含めていない。ネイティブWindows、VJR-200、自前WAV実装、実機録音、JR-200実機は未検証である。

互換修正後の`make test`と`make sanitize`は各CTest 4/4成功。ネイティブ本体は25テスト群（決定的変異入力12,000件を含む）、新設のCLI試験は`--600`が生値100と正しいチェックサムを出すことを確認した。Emscripten同梱LLVMによる`make wasm-smoke`、Emscripten 6.0.9正式ビルド、JS wrapper、`make check`も成功した。生成サイトをCodex in-app browserで開き、WASM起動表示と`600（フラグ100）`の選択肢を目視した。Playwright自動試験はPythonモジュール未導入のため実行できなかった。

## P00受入再試験（2026-09-22 / macOS）

`make test`はCTest 3/3、`python3 scripts/check_distribution.py`はPASS。`LICENSES/VJR200.txt`のGit blob SHAは上流固定値`8cad34867bad988f97fc237a9259e338f0bedf99`と一致した。

Emscripten 6.0.9を`EM_CACHE=$PWD/build/emcache make wasm`で実行し、正式WASMと`build/site`を生成した。ローカルHTTP配信からトップページ、FINDライセンス全文、第三者表記をHTTP 200で取得し、配信されたライセンスのblob SHAも一致した。

同日の`make wasm-smoke`は、既定のAppleClang 21.0.0に`wasm32`ターゲットがないため失敗した。過去のClang直接WASM成功を取り消すものではないが、現在環境での再成功でもない。Emscripten正式ビルドの成功とは分けて記録する。`tests/browser_smoke.py`はPython環境にPlaywrightがなく、UI操作試験は未実行である。

## P01受入再試験（2026-09-22 / macOS・GitHub Actions）

`make test`と`make sanitize`はそれぞれCTest 3/3成功。Emscripten 6.0.9で生成したES moduleをNode.jsからinstantiateし、C ABI version 1と容量1048576を確認した。

commit `62263249b100330b29e9baccff1b58310747275a`に対するGitHub Actions run 35619769839は、Linux native、macOS native、sanitizer、Clang直接WASM smokeの4ジョブすべて成功した。これはCJRコーデックのビルド基盤の証拠であり、ROM/BASIC/Canvas/音声を含むエミュレータのブラウザ起動証拠ではない。

## P02受入再試験（2026-09-22 / macOS・ローカルブラウザ）

`build/native/test_cjr`は24テスト群に成功し、12,000件の決定的変異入力を含む。Emscripten同梱LLVMを`WASM_CXX`に明示した`make wasm-smoke`は、直接WASMとJS wrapperの両試験に成功した。`cjrtool`は合成payloadのpack→inspect→copy→extractを実行し、payloadとCJR copyはそれぞれ元バイトと完全一致した。これはP03変更前のP02受入時点の件数である。

Clang直接WASM配布物をlocalhostで配信し、Codex in-app browserでWASM起動、未実装範囲の明示、検査/作成UI、入力未選択時のエラー表示を目視した。consoleのerror/warningは0件。ファイル選択・ダウンロードを含むPlaywright試験は依存未導入のため未実行であり、独立Windows実装や実機との互換証拠もP03以降に残る。

記録日: 2026-09-21。以下はこのパッケージに対して実際にローカル実行した結果である。remote CI、既存Windows実装との独立対照、実機成功を意味しない。

## GitHub初期設定時の再試験（2026-09-21）

初期パッケージを展開した作業ディレクトリで `make test`、`make sanitize`、`make wasm-smoke` を再実行し成功。native/ASan/UBSan各3/3、WASMとJSラッパーが成功。P00〜P13のGitHub Issue #1〜#14を登録した。GitHub Actionsの結果はActionsを参照。以下の表は初期パッケージ納品時点の履歴であり、今回のGitHub登録前の状態を記録している。

## 実行環境

Linux x86_64、GCC 14.2.0、Clang 17.0.0、CMake 3.31.6、Python 3.13.5、Node.js 22.16.0。ブラウザ試験に使用した実行ファイルはChromium 144.0.7559.96。emcc/emcmake/認証済みghは利用できなかった。

## 結果

| コマンド/対象 | 観測結果 |
|---|---|
| `make test` | CTest 3/3成功: cjr_native、license_guard、bootstrap_unit |
| `build/native/test_cjr` | 24グループ成功。手計算golden、境界値、破損入力などを含む |
| `make sanitize` | Clang ASan/UBSanで同じネイティブ試験が成功。検出された領域外アクセス・未定義動作なし |
| `make wasm-smoke` | Clangで実際のWASMを生成。Node.jsでgolden、8種のサイズ境界、checksum異常、容量/ABI引数検証に成功 |
| `tests/wrapper_smoke.mjs` | Web画面と同じJSラッパーをNode.jsから実行。inspect/pack、独立出力コピー、エラー表示用情報、入力検査が成功。fetchはローカルファイルのstub |
| `tests/test_bootstrap.py` | 6件のoffline unit testが成功。名前/private属性/依存順/パス検査等。実GitHub書込は含まない |
| bootstrapの引数省略/dry-run | private予定名と14件のIssueを正しい依存順で表示。リモート変更なし |
| `python3 -m py_compile scripts/*.py tests/*.py` | 成功 |
| `node --check web/app.mjs` / `web/codec.mjs` | 成功 |
| `bash -n scripts/build_wasm_smoke.sh` | 成功 |
| `tests/browser_smoke.py` | **ブロックされた**。ローカルHTTPページへの遷移で `net::ERR_BLOCKED_BY_ADMINISTRATOR`。UI試験部分には到達していない |
| 正式Emscriptenビルド | **未実行**。Clang直接WASMの試験と区別する |
| GitHub Actions / private repo作成 / Issue作成 / push | **未実行** |
| VJR-200/JR2Rescueとの独立差分比較 | **未実行** |
| ROM起動 / WAV変換 / JR-200実機 | **未実装・未実行** |

ブラウザ側のアクセス制限は変更していない。ブラウザテストスクリプトは同梱するが、HTTP配信、CSP、ファイル選択、ダウンロードの実動作を確認済みとはしない。JSラッパーのNode試験はこれらの代替ではない。

## ネイティブ24グループの内訳

1. 手計算した47バイトgoldenとの一致
2. ペイロード長1/255/256/257/511/512/513/65024
3. 0〜255の全バイト値
4. BASICの$0801とbaud指定
5. goldenの全切断位置
6. ヘッダーチェックサム異常
7. データチェックサム異常
8. 各ブロックのmagic異常
9. フッターと末尾余剰データ
10. ヘッダーなしの明示指定
11. 生メタデータの保持
12. 離れたアドレスを保持
13. 非連続ブロック番号の診断
14. フッターアドレス相違を勝手に修復しない
15. 未知のファイル種別の保持と警告
16. アドレスoverflowと上端境界
17. エンコーダ引数と出力のtransaction性
18. 標準writerのブロック数上限
19. 入力上限とnull pointer
20. 無効入力で途中callbackを呼ばない
21. 解析失敗時にsummaryを途中更新しない
22. データなし/非標準ヘッダーの警告
23. C ABIのブラウザ側引数検証
24. 決定的な破損・変異入力12,000件

12,000件の変異試験は限定的なsmoke testであり、全入力空間の網羅、継続的libFuzzer運用、安全性の証明ではない。

## 独立性の制限

goldenは公開形式に基づく手計算値である。サイズ境界の多くは本コーデックのencode/inspectの組合せであり、同じ間違いを双方が共有する可能性がある。したがってP03で独立した既存実装との対照が必要である。CJR→WAV→CJRの自己往復も将来それだけでは実機受入にしない。

## ライセンス原文の照合

`LICENSES/VJR200.txt`は `blob <byte-length>\0<original-bytes>` のSHA-1が上流のGit blob `8cad34867bad988f97fc237a9259e338f0bedf99` と一致することを確認した。原文改行等の自動変換を防ぐため `.gitattributes` に `-text` を指定している。

この照合は原文保持の検査であり、上流全ファイルの権利監査や法的助言を代替しない。
