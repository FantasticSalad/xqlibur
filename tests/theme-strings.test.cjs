const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {Registry,parseRawGrammar}=require('vscode-textmate');
const onig=require('vscode-oniguruma');

test('single and double strings resolve against quote-specific theme rules',async()=>{
  const wasm=fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await onig.loadWASM(wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength));
  const registry=new Registry({
    onigLib:Promise.resolve({createOnigScanner:p=>new onig.OnigScanner(p),createOnigString:s=>new onig.OnigString(s)}),
    loadGrammar:async()=>parseRawGrammar(fs.readFileSync('syntaxes/xql.tmLanguage.json','utf8'),'xql.json'),
    theme:{settings:[{settings:{foreground:'#dddddd',background:'#222222'}},
      {scope:['string.quoted.double','string.quoted.single'],settings:{foreground:'#17c6a3'}}]}
  });
  const grammar=await registry.loadGrammar('source.cortex-xql');
  for(const literal of ['"amber"',"'amber'",'"""amber"""',"'''amber'''"]){
    const line='alter value = '+literal;
    const result=grammar.tokenizeLine2(line,null), offset=line.indexOf('amber');
    let metadata;
    for(let i=0;i<result.tokens.length;i+=2) if(result.tokens[i]<=offset) metadata=result.tokens[i+1];
    const color=registry.getColorMap()[(metadata>>>15)&0x1ff];
    assert.equal(color.toLowerCase(),'#17c6a3',literal);
  }
  registry.dispose();
});

test('Eclipse defaults resolve XQL stages and both kinds of calls',async()=>{
  const wasm=fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await onig.loadWASM(wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength));
  const snippet=fs.readFileSync('README.md','utf8').match(/## Theme fallback[\s\S]*?```jsonc\s*([\s\S]*?)```/);
  assert.ok(snippet,'Documented fallback missing');
  const fallback=JSON.parse('{'+snippet[1]+'}')['editor.tokenColorCustomizations']['[Eclipse Dark]'].textMateRules;
  const contributed=require('../package.json').contributes.configurationDefaults['editor.tokenColorCustomizations']['[Eclipse Dark]'].textMateRules;
  assert.deepEqual(contributed,fallback,'Documented XQL colors must match the contributed defaults');
  const settings=[{settings:{foreground:'#d9e8f7',background:'#2f2f2f'}},
    {scope:'keyword.control.java',settings:{foreground:'#cc6c1d'}},
    {scope:'entity.name.function.java',settings:{foreground:'#a7ec21'}},
    ...fallback];
  const registry=new Registry({onigLib:Promise.resolve({createOnigScanner:p=>new onig.OnigScanner(p),createOnigString:s=>new onig.OnigString(s)}),theme:{settings},
    loadGrammar:async()=>parseRawGrammar(fs.readFileSync('syntaxes/xql.tmLanguage.json','utf8'),'xql.json')});
  const grammar=await registry.loadGrammar('source.cortex-xql');
  const line='alter answer = lowercase("amber") + future_call(3)';
  const encoded=grammar.tokenizeLine2(line,null),map=registry.getColorMap();
  const color=word=>{const offset=line.indexOf(word);let metadata=0;
    for(let i=0;i<encoded.tokens.length;i+=2) if(encoded.tokens[i]<=offset) metadata=encoded.tokens[i+1];
    return map[(metadata>>>15)&0x1ff].toLowerCase();};
  assert.equal(color('alter'),'#e88537');
  assert.equal(color('lowercase'),'#a7ec21');
  assert.equal(color('future_call'),'#a7ec21');
  assert.equal(color('answer'),'#d9e8f7');
  function luminance(hex){return hex.match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);}
  for(const word of ['alter','lowercase','future_call']) assert.ok((luminance(color(word).slice(1))+0.05)/(luminance('2f2f2f')+0.05)>=4.5,word);
  registry.dispose();

  // Probe the extension's semantic fallback scopes as TextMate scopes. This
  // verifies matching the documented palette, not VS Code's rule precedence.
  const mappings=require('../package.json').contributes.semanticTokenScopes.find(s=>s.language==='cortex-xql').scopes;
  const roles=[['stage','keyword','#e88537'],['builtin','function.defaultLibrary','#a7ec21'],['future','function','#a7ec21'],['operator','operator','#e88537']];
  const synthetic={scopeName:'source.semantic-probe',patterns:roles.map(([word,type])=>({match:`\\b${word}\\b`,name:mappings[type][0]}))};
  const semanticRegistry=new Registry({onigLib:Promise.resolve({createOnigScanner:p=>new onig.OnigScanner(p),createOnigString:s=>new onig.OnigString(s)}),theme:{settings},loadGrammar:async()=>synthetic});
  const semanticGrammar=await semanticRegistry.loadGrammar('source.semantic-probe');
  const input=roles.map(([word])=>word).join(' '), result=semanticGrammar.tokenizeLine2(input,null),colors=semanticRegistry.getColorMap();
  for(const [word,,expected] of roles){let metadata=0,offset=input.indexOf(word);
    for(let i=0;i<result.tokens.length;i+=2) if(result.tokens[i]<=offset) metadata=result.tokens[i+1];
    assert.equal(colors[(metadata>>>15)&0x1ff].toLowerCase(),expected,word);
  }
  semanticRegistry.dispose();
});
