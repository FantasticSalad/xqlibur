const {test}=require('node:test');
const assert=require('node:assert/strict');
const {structure}=require('../.build/packages/core');
const {semanticTokens,semanticTokensForRoles,tokenTypes,tokenModifiers,semanticModifierBits}=require('../.build/packages/core/semantic');

test('multiline pipeline stages and calls receive semantic roles',()=>{
  const text='dataset = xdr_data\n| alter answer = concat(lowercase("amber"), "ash")\n| filter answer = "amber"\n| fields answer\n| limit 10\n| fil';
  const tokens=semanticTokens(text);
  for(const word of ['dataset','alter','filter','fields','limit','concat','lowercase']){
    const start=text.indexOf(word),token=tokens.find(t=>t.start===start);
    assert.equal(token?.type,['concat','lowercase'].includes(word)?'function':'keyword',word);
  }
  assert.equal(tokens.find(t=>t.start===text.lastIndexOf('fil'))?.type,'keyword');
});
const roleAt=(text,tokens,name,last=false)=>tokens.find(t=>t.start===(last?text.lastIndexOf(name):text.indexOf(name)));

test('semantic legend preserves indexes and modifier bits',()=>{
  assert.deepEqual(tokenTypes.slice(0,7),['keyword','function','property','variable','xqlDataset','number','operator']);
  assert.deepEqual(tokenTypes.slice(7),['namespace','parameter']);
  assert.deepEqual(tokenModifiers,['declaration','defaultLibrary']);
  assert.equal(semanticModifierBits({declaration:true,defaultLibrary:false}),1);
  assert.equal(semanticModifierBits({declaration:false,defaultLibrary:true}),2);
});
test('built-ins have defaultLibrary while unknown and member calls remain neutral',()=>{
  const text='alter alpha = lowercase("amber") + future_call(4) + payload.lowercase(5)';
  const tokens=semanticTokens(text);
  assert.equal(roleAt(text,tokens,'lowercase').defaultLibrary,true);
  assert.equal(roleAt(text,tokens,'future_call').type,'function');
  assert.equal(roleAt(text,tokens,'future_call').defaultLibrary,false);
  assert.equal(roleAt(text,tokens,'lowercase',true).type,'property');
  assert.equal(roleAt(text,tokens,'lowercase',true).defaultLibrary,false);
});
test('source forms and presentation options have distinct semantic roles',()=>{
  const text='config case_sensitive = true | dataset in (xdr_data, xdr_data) | view graph type = pie xaxis = alpha yaxis = beta';
  const tokens=semanticTokens(text);
  assert.equal(roleAt(text,tokens,'case_sensitive').type,'parameter');
  assert.equal(roleAt(text,tokens,'case_sensitive').declaration,false);
  assert.equal(tokens.filter(t=>t.type==='xqlDataset').length,2);
  assert.equal(roleAt(text,tokens,'type').type,'parameter');
  assert.equal(roleAt(text,tokens,'alpha').type,'property');
  assert.equal(roleAt(text,tokens,'true'),undefined);
  assert.equal(roleAt(text,tokens,'pie'),undefined);
});
test('join aliases are namespace declarations and predicate references only',()=>{
  const text='dataset xdr_data | join type = left (dataset xdr_data | fields _time) as child child._time = _time | fields child._time';
  const tokens=semanticTokens(text),declaration=roleAt(text,tokens,'child');
  assert.equal(declaration.type,'namespace');assert.equal(declaration.declaration,true);
  const references=tokens.filter(t=>t.type==='namespace'&&!t.declaration);
  assert.equal(references.length,1);
  assert.equal(roleAt(text,tokens,'child',true).type,'property');
});
test('ordinary strings/constants/punctuation/comments keep lexical scopes; reviewed placeholder interiors are parameters',()=>{
  const text='alter alpha = arraymap(items, to_string("@element")), beta = true // fake(\n';
  const tokens=semanticTokens(text),stringStart=text.indexOf('"'),stringEnd=text.lastIndexOf('"')+1;
  const inside=tokens.filter(t=>t.start<stringEnd&&t.end>stringStart);
  assert.deepEqual(inside.map(t=>[text.slice(t.start,t.end),t.type]),[['@element','parameter']]);
  for(const t of tokens) {
    assert.ok(t.start<text.indexOf('//'));
    assert.ok(!['(',')',','].includes(text.slice(t.start,t.end)));
  }
  assert.equal(roleAt(text,tokens,'true'),undefined);
});
test('semantic sanitizer drops invalid, overlapping, multiline and split-surrogate spans',()=>{
  const text='🗡 alpha\r\nbeta';
  const candidate=(start,end,type='property')=>({start,end,type,declaration:false,defaultLibrary:false});
  const tokens=semanticTokensForRoles(text,[candidate(-1,1),candidate(0,0),candidate(1,2),candidate(0,1),candidate(3,8),candidate(4,8),candidate(8,10),candidate(10,14),candidate(14,100),candidate(0,2,'missing'),candidate(NaN,3)]);
  assert.deepEqual(tokens.map(t=>[t.start,t.end]),[[3,8],[10,14]]);
  assert.ok(tokens.every(t=>tokenTypes.indexOf(t.type)>=0));
});
test('earlier edits change roles immediately; mismatched analyses are rejected',()=>{
  const before='alter alpha = 4 | fields alpha as beta';
  const after='filter alpha = 4 | fields alpha';
  assert.equal(roleAt(before,semanticTokens(before),'alpha').declaration,true);
  assert.equal(roleAt(after,semanticTokens(after),'alpha').declaration,false);
  assert.deepEqual(semanticTokens(after,structure(before)),[]);
  assert.equal(semanticTokens('fields alpha').some(t=>t.declaration),false);
});
test('non-BMP and CRLF spans stay at the actual UTF-16 source locations',()=>{
  const text='// 🗡\r\ndataset xdr_data\r\n| alter payload.branch = 4';
  const tokens=semanticTokens(text);
  assert.equal(roleAt(text,tokens,'branch').start,text.indexOf('branch'));
  assert.equal(roleAt(text,tokens,'branch').declaration,true);
  for(let i=1;i<tokens.length;i++) assert.ok(tokens[i].start>=tokens[i-1].end);
});
