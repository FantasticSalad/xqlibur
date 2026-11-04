const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Registry,parseRawGrammar}=require('vscode-textmate');
const onig=require('vscode-oniguruma');

test('YAML injection scopes only XQL literal blocks', {skip:!process.env.XQLIBUR_YAML_GRAMMAR_DIR}, async()=>{
  const wasm=fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await onig.loadWASM(wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength));
  const registry=new Registry({
    onigLib:Promise.resolve({createOnigScanner:p=>new onig.OnigScanner(p),createOnigString:s=>new onig.OnigString(s)}),
    getInjections:scope=>scope==='source.yaml'?['xqlibur.yaml.injection']:[],
    loadGrammar:async scope=>{
      const local={'xqlibur.yaml.injection':'syntaxes/yaml-injection.tmLanguage.json','source.cortex-xql':'syntaxes/xql.tmLanguage.json'}[scope];
      const file=local||path.join(process.env.XQLIBUR_YAML_GRAMMAR_DIR,scope.replace('source.','').replace(/^yaml\./,'yaml-')+'.tmLanguage.json');
      return fs.existsSync(file)?parseRawGrammar(fs.readFileSync(file,'utf8'),file):null;
    }
  });
  const grammar=await registry.loadGrammar('source.yaml');
  let state=null;
  const lines=['description: |','  xql: |','    | filter fake','xql: |','  datamodel dataset = example','  | filter lowercase(field) contains "x"','next: value','nested:','  xql: |-','    | filter true','  other: value'];
  const tokens=lines.map(line=>{const r=grammar.tokenizeLine(line,state);state=r.ruleStack;return r.tokens;});
  const has=(line,scope)=>tokens[line].some(t=>t.scopes.includes(scope));
  assert.equal(has(2,'keyword.control.xql'),false,JSON.stringify(tokens.slice(0,3)));
  assert.equal(has(4,'keyword.control.xql'),true);
  assert.equal(has(5,'keyword.control.xql'),true);
  assert.equal(has(6,'meta.embedded.block.xql'),false);
  assert.equal(has(9,'keyword.control.xql'),true);
  assert.equal(has(10,'meta.embedded.block.xql'),false);
  registry.dispose();
});
