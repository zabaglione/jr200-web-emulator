# jr200-dev向け固定WASM runnerの配布準備

関連: [jr200-dev #13](https://github.com/zabaglione/jr200-dev/issues/13)、
[エミュレータ #21](https://github.com/zabaglione/jr200-web-emulator/issues/21)。

`scripts/package_runner.py`は、固定source commit
`c4c0c30f98c5878480c31af8595b6307e66b8ef0`、Emscripten 6.0.9、system API 9で
生成した2つのmoduleと権利表示7ファイルのsize／SHA-256を全件検査し、決定的な
`jr200-runner-v0.3.0.zip`を**ローカルに作成するだけ**です。ROM、フォント、録音、
ゲームやWeb UI、tokenを含めません。余分なbundle入力や既存の異なるZIPは拒否します。
ソースを再ビルドせず、ReleaseへのアップロードやPages更新も行いません。

```sh
python3 scripts/package_runner.py \
  --bundle build/emscripten/web \
  --output build/runner/jr200-runner-v0.3.0.zip
```

現行の固定moduleと権利表示を使ったローカル候補は142,300バイト、ZIP全体の
SHA-256は`860f99be69037a78c6dea557cd28994b83ba7fe05709d512d8e86cb44b6c77b0`です。
同じ入力で再実行するとバイト一致するZIPを再利用します。候補を`jr200-dev`側の
固定取得adapterで展開し、2 module・7権利表示の個別hashと厳密inventoryが一致することを
確認しました。これは**配布前のローカル候補検査**で、Release URLやfresh cloneからの取得、
remote CIでのruntime実行、Mac/Linuxの独立配布受入を示しません。

Release資産の公開は別途明示承認を得た後に限ります。公開時は承認済みZIPのdigestとURLを
`jr200-dev/emulator.lock.json`に固定し、Mac arm64/Linux x86_64のfresh cloneから
同一fixtureを実行してから、remote CIの実行結果を記録します。`joystick-sample`は
利用者提供ROM/FONTが必要なので、公開runnerの合成試験とは分けて記録します。
