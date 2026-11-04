const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {Registry,parseRawGrammar}=require('vscode-textmate');
const onig=require('vscode-oniguruma');
const fixtures=require('./fixtures/lexical-cases.json');
let registry,grammar;
before(async()=>{
  const wasm=fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await onig.loadWASM(wasm.buffer.slice(wasm.byteOffset,wasm.byteOffset+wasm.byteLength));
  registry=new Registry({onigLib:Promise.resolve({createOnigScanner:p=>new onig.OnigScanner(p),createOnigString:s=>new onig.OnigString(s)}),loadGrammar:async()=>parseRawGrammar(fs.readFileSync('syntaxes/xql.tmLanguage.json','utf8'),'xql.json')});
  grammar=await registry.loadGrammar('source.cortex-xql');
});
after(()=>registry?.dispose());
for(const fixture of fixtures) test(`Oniguruma lexical contract ${fixture.id}`,()=>{
  let stack=null;
  const lines=fixture.lines.map(line=>{const result=grammar.tokenizeLine(line,stack);stack=result.ruleStack;return result.tokens;});
  for(const check of fixture.checks) {
    const text=fixture.lines[check.line]; let start=-1;
    for(let n=0;n<=(check.occurrence??0);n++) start=text.indexOf(check.text,start+1);
    assert.ok(start>=0,'Missing fixture text: '+check.text);
    const token=lines[check.line].find(t=>t.startIndex<=start&&t.endIndex>start);
    assert.ok(token.scopes.includes(check.scope),`${check.text}: ${token.scopes.join(' ')}`);
    if(check.not) assert.ok(!token.scopes.includes(check.not),check.text);
    if(check.exact) assert.equal(text.slice(token.startIndex,token.endIndex),check.text);
  }
});
test('lexical fallback does not classify free stage names or over as calls',()=>{
  const line='alter alpha = filter + over(3)';
  const tokens=grammar.tokenizeLine(line,null).tokens;
  for(const word of ['filter','over']) {
    const position=line.indexOf(word), token=tokens.find(t=>t.startIndex<=position&&t.endIndex>position);
    assert.ok(token.scopes.includes('variable.other.property.xql'));
    assert.ok(!token.scopes.includes('keyword.control.xql')&&!token.scopes.includes('entity.name.function.xql'));
  }
});
test('multiline stages and catalogued function calls keep their lexical roles',()=>{
  const lines=['dataset = xdr_data','| alter answer = concat(lowercase("amber"), "ash")','| filter answer = "amber"','| fields answer','| limit 10','| fil'];
  let stack=null;
  for(const [index,line] of lines.entries()){
    const result=grammar.tokenizeLine(line,stack);stack=result.ruleStack;
    const expect=(word,scope)=>{const offset=line.indexOf(word);const token=result.tokens.find(t=>t.startIndex<=offset&&t.endIndex>offset);assert.ok(token.scopes.includes(scope),`${word}: ${token.scopes.join(' ')}`);};
    if(index===0)expect('dataset','keyword.control.xql');
    if(index===1){expect('alter','keyword.control.xql');expect('concat','support.function.xql');expect('lowercase','support.function.xql');}
    if(index===2)expect('filter','keyword.control.xql');
    if(index===3)expect('fields','keyword.control.xql');
    if(index===4)expect('limit','keyword.control.xql');
    if(index===5)assert.ok(!result.tokens.some(t=>t.scopes.includes('keyword.control.xql')));
  }
});
test('long unfinished literals scan within an explicit tokenizer budget',()=>{
  const result=grammar.tokenizeLine('alter alpha = """'+'amber\\n'.repeat(15000),null,1000);
  assert.equal(result.stoppedEarly,false);
  assert.ok(result.tokens.at(-1).scopes.includes('string.quoted.double.multi.xql'));
});

test('parenthesized word operators keep lexical roles while genuine CIDR calls remain functions',()=>{
  for(const [line,word,scope] of [
    ['filter source_field incidr ("synthetic-range")','incidr','keyword.operator.word.xql'],
    ['filter payload.not not incidr6 ("synthetic-range")','incidr6','keyword.operator.word.xql'],
    ['filter lowercase(source_field) incidr ("synthetic-range")','incidr','keyword.operator.word.xql'],
    ['filter "synthetic-address" contains ("synthetic-text")','contains','keyword.operator.word.xql'],
    ['filter 1 incidr ("synthetic-range")','incidr','keyword.operator.word.xql'],
    ['filter incidr(source_field, "synthetic-range")','incidr','support.function.xql'],
    ['filter not incidr6(source_field, "synthetic-range")','incidr6','support.function.xql'],
    ['alter result = if(incidr(source_field, "synthetic-range"), 1, 0)','incidr','support.function.xql']
  ]) {
    const tokens=grammar.tokenizeLine(line,null).tokens,offset=line.indexOf(word),token=tokens.find(t=>t.startIndex<=offset&&t.endIndex>offset);
    assert.ok(token.scopes.includes(scope),line+': '+token.scopes.join(' '));
    if(scope==='keyword.operator.word.xql') assert.ok(!token.scopes.includes('support.function.xql'));
  }
});

test('operator fallback avoids whole-path backtracking on long nonmatching input',()=>{
  const line='filter '+'payload.'.repeat(5000)+'leaf'+' '.repeat(50000)+'future_call(1)';
  const result=grammar.tokenizeLine(line,null,1000);assert.equal(result.stoppedEarly,false);
  const member='filter payload.not not incidr6 ("synthetic-range")',tokens=grammar.tokenizeLine(member,null).tokens;
  const position=member.indexOf('not');assert.ok(tokens.find(t=>t.startIndex<=position&&t.endIndex>position).scopes.includes('variable.other.property.xql'));
});
test('bare query-entry words in call arguments remain properties',()=>{
  const line='alter alpha = arraycreate(dataset, filter, lowercase)';
  const tokens=grammar.tokenizeLine(line,null).tokens;
  for(const word of ['dataset','filter','lowercase']) {
    const offset=line.indexOf(word), token=tokens.find(t=>t.startIndex<=offset&&t.endIndex>offset);
    assert.ok(token.scopes.includes('variable.other.property.xql'),word+': '+token.scopes.join(' '));
    assert.ok(!token.scopes.includes('keyword.control.xql'));
  }
});
