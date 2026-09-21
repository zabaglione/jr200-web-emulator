# 初期実装の試験記録

## P00受入再試験（2026-09-22 / macOS）

`make test`はCTest 3/3、`python3 scripts/check_distribution.py`はPASS。`LICENSES/VJR200.txt`のGit blob SHAは上流固定値`8cad34867bad988f97fc237a9259e338f0bedf99`と一致した。

Emscripten 6.0.9を`EM_CACHE=$PWD/build/emcache make wasm`で実行し、正式WASMと`build/site`を生成した。ローカルHTTP配信からトップページ、FINDライセンス全文、第三者表記をHTTP 200で取得し、配信されたライセンスのblob SHAも一致した。

同日の`make wasm-smoke`は、既定のAppleClang 21.0.0に`wasm32`ターゲットがないため失敗した。過去のClang直接WASM成功を取り消すものではないが、現在環境での再成功でもない。Emscripten正式ビルドの成功とは分けて記録する。`tests/browser_smoke.py`はPython環境にPlaywrightがなく、UI操作試験は未実行である。

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
