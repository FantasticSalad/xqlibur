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

test('Dark 2026 defaults resolve distinct XQL roles and preserve Eclipse defaults',async()=>{
  const wasm=fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await onig.loadWASM(wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength));
  const snippet=fs.readFileSync('README.md','utf8').match(/### Dark 2026[\s\S]*?```jsonc\s*([\s\S]*?)```/);
  assert.ok(snippet,'Documented fallback missing');
  const fallback=JSON.parse('{'+snippet[1]+'}')['editor.tokenColorCustomizations']['[Dark 2026]'].textMateRules;
  const defaults=require('../package.json').contributes.configurationDefaults['editor.tokenColorCustomizations'];
  const contributed=defaults['[Dark 2026]'].textMateRules;
  assert.deepEqual(contributed,fallback,'Documented XQL colors must match the contributed defaults');
  const eclipse=defaults['[Eclipse Dark]'].textMateRules;
  assert.deepEqual(eclipse.map(rule=>rule.settings.foreground),['#E88537','#E88537','#E88537','#E88537','#A7EC21','#A7EC21']);
  const settings=[{settings:{foreground:'#bbbebf',background:'#121314'}},
    ...fallback];
  const registry=new Registry({onigLib:Promise.resolve({createOnigScanner:p=>new onig.OnigScanner(p),createOnigString:s=>new onig.OnigString(s)}),theme:{settings},
    loadGrammar:async()=>parseRawGrammar(fs.readFileSync('syntaxes/xql.tmLanguage.json','utf8'),'xql.json')});
  const grammar=await registry.loadGrammar('source.cortex-xql');
  const line='alter answer = lowercase("amber") + future_call(3) | filter answer in (1, 2) and answer ~= "1"';
  const encoded=grammar.tokenizeLine2(line,null),map=registry.getColorMap();
  const color=word=>{const offset=line.indexOf(word);let metadata=0;
    for(let i=0;i<encoded.tokens.length;i+=2) if(encoded.tokens[i]<=offset) metadata=encoded.tokens[i+1];
    return map[(metadata>>>15)&0x1ff].toLowerCase();};
  assert.equal(color('alter'),'#6cb6ff');
  assert.equal(color('lowercase'),'#4ec9b0');
  assert.equal(color('future_call'),'#4ec9b0');
  for(const operator of ['=','+','in','and','~=']) assert.equal(color(operator),'#c8a0de',operator);
  for(const bracket of ['(',')']) assert.equal(color(bracket),'#b0bec5',bracket);
  assert.equal(color('answer'),'#bbbebf');
  function luminance(hex){return hex.match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);}
  for(const word of ['alter','lowercase','future_call','=','in','and','~=','(',')']) assert.ok((luminance(color(word).slice(1))+0.05)/(luminance('121314')+0.05)>=4.5,word);
  registry.dispose();

  // Probe the extension's semantic fallback scopes as TextMate scopes. This
  // verifies matching the documented palette, not VS Code's rule precedence.
  const mappings=require('../package.json').contributes.semanticTokenScopes.find(s=>s.language==='cortex-xql').scopes;
  const roles=[['stage','keyword','#6cb6ff'],['builtin','function.defaultLibrary','#4ec9b0'],['future','function','#4ec9b0'],['operator','operator','#c8a0de']];
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

test('Dark 2026 installed theme resolves XQL lexical and semantic fallback scopes', {skip:!process.env.XQLIBUR_THEME_DIR}, async()=>{
  const path=require('node:path');
  function loadTheme(file) {
    const theme=JSON.parse(fs.readFileSync(file,'utf8'));
    const parent=theme.include?loadTheme(path.resolve(path.dirname(file),theme.include)):{colors:{},tokenColors:[]};
    return {colors:{...parent.colors,...theme.colors},tokenColors:[...parent.tokenColors,...(theme.tokenColors??[])]};
  }
  const theme=loadTheme(path.join(process.env.XQLIBUR_THEME_DIR,'2026-dark.json'));
  assert.equal(theme.colors['editor.background'],'#121314');
  const wasm=fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await onig.loadWASM(wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength));
  const defaults=require('../package.json').contributes;
  const rules=defaults.configurationDefaults['editor.tokenColorCustomizations']['[Dark 2026]'].textMateRules;
  const mappings=defaults.semanticTokenScopes.find(s=>s.language==='cortex-xql').scopes;
  const semanticRoles=[['stage','keyword','#6cb6ff'],['builtin','function.defaultLibrary','#4ec9b0'],['future','function','#4ec9b0'],['operator','operator','#c8a0de'],['callback','parameter','#ffa657']];
  const probe={scopeName:'source.semantic-probe',patterns:semanticRoles.map(([word,type])=>({match:`\\b${word}\\b`,name:mappings[type][0]}))};
  const registry=new Registry({onigLib:Promise.resolve({createOnigScanner:p=>new onig.OnigScanner(p),createOnigString:s=>new onig.OnigString(s)}),
    theme:{settings:[{settings:{foreground:theme.colors['editor.foreground'],background:theme.colors['editor.background']}},...theme.tokenColors,...rules]},
    loadGrammar:async scope=>scope===probe.scopeName?probe:parseRawGrammar(fs.readFileSync('syntaxes/xql.tmLanguage.json','utf8'),'xql.json')});
  const grammar=await registry.loadGrammar('source.cortex-xql');
  const line='alter result = if(true, 1, 0) | filter result in (1, 2) and result ~= "1" or result != 0 and result !~= "2"';
  function colorAt(grammar,text,offset) {
    const encoded=grammar.tokenizeLine2(text,null);let metadata=0;
    for(let i=0;i<encoded.tokens.length;i+=2) if(encoded.tokens[i]<=offset) metadata=encoded.tokens[i+1];
    return registry.getColorMap()[(metadata>>>15)&0x1ff].toLowerCase();
  }
  for(const [word,expected] of [['alter','#6cb6ff'],['filter','#6cb6ff'],['if','#4ec9b0'],['result','#c9d1d9'],['(','#b0bec5'],[')','#b0bec5'],...['=','in','and','~=','or','!=','!~='].map(word=>[word,'#c8a0de'])]) {
    assert.equal(colorAt(grammar,line,line.indexOf(word)),expected,word);
  }
  const semanticGrammar=await registry.loadGrammar(probe.scopeName);
  const text=semanticRoles.map(([word])=>word).join(' ');
  for(const [word,,expected] of semanticRoles) assert.equal(colorAt(semanticGrammar,text,text.indexOf(word)),expected,word);
  registry.dispose();
});

test('blue stages are separated from the proposal palette and orange callback parameter',()=>{
  // OKLab Euclidean distance is a bounded normal-vision comparison, not an
  // accessibility guarantee or a substitute for actual editor acceptance.
  function lab(hex) {
    const [r,g,b]=hex.match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b);
    const m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b);
    const s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
    return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
  }
  const blue=lab('6cb6ff');
  for(const other of ['4ec9b0','c8a0de','b0bec5','ffa657']) {
    const comparison=lab(other);
    assert.ok(Math.hypot(...blue.map((v,i)=>v-comparison[i]))>.10,other);
  }
});
