const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {Registry,parseRawGrammar}=require('vscode-textmate');
const onig=require('vscode-oniguruma');
test('TextMate grammar preserves multiline strings and recovers after closure',async()=>{
  const wasm=fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await onig.loadWASM(wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength));
  const registry=new Registry({onigLib:Promise.resolve({createOnigScanner:p=>new onig.OnigScanner(p),createOnigString:s=>new onig.OnigString(s)}),loadGrammar:async()=>parseRawGrammar(fs.readFileSync('syntaxes/xql.tmLanguage.json','utf8'),'xql.json')});
  const grammar=await registry.loadGrammar('source.cortex-xql');
  let state=null;
  for(const line of ['| alter sample = """start','| filter fake // still a string','end""" | filter true']) {
    const result=grammar.tokenizeLine(line,state); state=result.ruleStack;
    if(line.startsWith('| filter')) assert.ok(result.tokens.every(t=>t.scopes.includes('string.quoted.double.multi.xql')));
    if(line.startsWith('end')) assert.ok(result.tokens.some(t=>t.scopes.includes('keyword.control.xql')));
  }
  registry.dispose();
});
