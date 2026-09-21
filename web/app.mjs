// SPDX-License-Identifier: BSD-3-Clause
import {loadCodec} from './codec.mjs';
const $=id=>document.getElementById(id);
let codec;
try {codec=await loadCodec();$('status').textContent='WASM起動済み / 処理はローカルのみ';for(const id of ['cjr','bin','create'])$(id).disabled=false;}
catch(error){$('status').textContent=`初期化エラー: ${error.message}`;}
async function readLimited(file){if(!file)throw new Error('ファイルを選択してください');if(file.size>1024*1024)throw new Error('上限は1 MiBです');return new Uint8Array(await file.arrayBuffer());}
async function inspectFile(){try{const s=codec.inspect(await readLimited($('cjr').files[0]),$('headerless').checked);const flags=[[1,'ヘッダーなし：形式・速度は不明'],[2,'ブロック番号が非連続'],[4,'アドレスが非連続：単純なBIN連結は不可'],[8,'フッターアドレスが最終領域末尾と異なる'],[16,'未知のファイル種別'],[32,'標準と異なるヘッダーアドレス'],[64,'データブロックなし']].filter(([bit])=>s.warnings&bit).map(([,text])=>text);$('result').textContent=JSON.stringify({...s,diagnostics:flags,hardwareVerified:false},null,2);}catch(error){$('result').textContent=`エラー: ${error.message}`;}}
$('cjr').addEventListener('change',inspectFile);$('headerless').addEventListener('change',()=>{if($('cjr').files.length)inspectFile();});
$('pack').addEventListener('submit',async event=>{event.preventDefault();try{const file=$('bin').files[0],data=await readLimited(file);const output=codec.pack(data,$('name').value,parseInt($('address').value,16),$('kind').value==='0',Number($('baud').value));const url=URL.createObjectURL(new Blob([output],{type:'application/octet-stream'}));const link=document.createElement('a');link.href=url;link.download=file.name.replace(/\.[^.]*$/,'')+'.cjr';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('pack-status').textContent=`${output.length}バイトを書き出しました。実機互換は未検証です。`;}catch(error){$('pack-status').textContent=`エラー: ${error.message}`;}});
