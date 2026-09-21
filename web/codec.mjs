// SPDX-License-Identifier: BSD-3-Clause
export async function loadCodec() {
  const config = await (await fetch('./backend.json')).json();
  let e, memory;
  if (config.backend === 'emscripten') {
    const { default: createModule } = await import('./jr200_codec.mjs');
    const m = await createModule();
    e = new Proxy({}, {get: (_, key) => m[`_${String(key)}`]});
    memory = () => m.HEAPU8;
  } else {
    const response = await fetch('./jr200_codec.wasm');
    if (!response.ok) throw new Error(`WASM取得失敗: ${response.status}`);
    const {instance} = await WebAssembly.instantiate(await response.arrayBuffer(), {});
    e = instance.exports; memory = () => new Uint8Array(e.memory.buffer);
  }
  if (e.jr200_codec_api_version() !== 1) throw new Error('C ABIのバージョンが一致しません');
  const text = new TextDecoder();
  const checked = code => {
    if (code) {
      const heap = memory(), start = e.jr200_error_message();
      let end = start;
      while (end < heap.length && end - start < 512 && heap[end]) ++end;
      throw new Error(`${text.decode(heap.subarray(start,end))} (offset ${e.jr200_error_offset()})`);
    }
  };
  return {
    inspect(bytes, allowHeaderless=false) {
      if (!(bytes instanceof Uint8Array) || bytes.length > e.jr200_capacity()) throw new Error('入力上限は1 MiBです');
      memory().set(bytes,e.jr200_input_ptr());
      checked(e.jr200_inspect(bytes.length,allowHeaderless?1:0));
      const names=['hasHeader','fileType','baudFlag','dataBlocks','payloadBytes','firstAddress','footerAddress','lastEndExclusive','warnings'];
      const summary=Object.fromEntries(names.map((n,i)=>[n,e.jr200_summary_field(i)]));
      const name=memory().slice(e.jr200_name_ptr(),e.jr200_name_ptr()+16);
      summary.nameHex=Array.from(name,v=>v.toString(16).padStart(2,'0')).join(' ');
      summary.nameAscii=Array.from(name).filter(v=>v!==0).map(v=>v>=32&&v<127?String.fromCharCode(v):'·').join('');
      return summary;
    },
    pack(bytes,name,address,basic,baudFlag) {
      if (!(bytes instanceof Uint8Array)) throw new Error('入力はUint8Arrayで指定してください');
      if (typeof basic !== 'boolean') throw new Error('BASIC指定はbooleanが必要です');
      if (!Number.isInteger(baudFlag)||baudFlag<0||baudFlag>255) throw new Error('ボーレート指定は0〜255の整数です');
      if (!/^[\x20-\x7e]{1,16}$/.test(name)) throw new Error('ファイル名は半角ASCII 1〜16文字を指定してください');
      if (!Number.isInteger(address)||address<0||address>65535) throw new Error('アドレスは0000〜FFFFです');
      if (bytes.length > e.jr200_capacity()-16) throw new Error('入力が大きすぎます');
      const heap=memory(), p=e.jr200_input_ptr();
      heap.fill(0,p,p+16); heap.set(new TextEncoder().encode(name),p); heap.set(bytes,p+16);
      checked(e.jr200_encode(bytes.length,name.length,address,basic?1:0,baudFlag));
      return memory().slice(e.jr200_output_ptr(),e.jr200_output_ptr()+e.jr200_output_size());
    }
  };
}
