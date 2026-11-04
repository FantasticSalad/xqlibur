const {test}=require('node:test');
const assert=require('node:assert/strict');
const {signatureHelp,displayForm}=require('../.build/packages/core/signatures');
const {functionFact}=require('../.build/packages/core/reference');
const source='https://cortex-docs.paloaltonetworks.com/xql-command-reference-guide/readme/functions/lowercase';
// Synthetic forms test the renderer; they are never bundled as Cortex facts.
const form=(id,parameters,extra={})=>({id,parameters:parameters.map(p=>({name:p,optional:false,repeat:false})),contexts:['expression'],arityKnown:true,syntaxKind:'positional',validation:'displayOnly',source,checked:'2026-10-25',...extra});
const lookup=forms=>name=>name==='fixture'?{name,status:'partial',forms}:functionFact(name);

test('signature help retains reviewed summary caveats without copying argument values',()=>{
  const text='alter result = fixture("synthetic-private-value", )';
  const publicSummary='Published slots are hints; the minimum count remains unverified.';
  const facts=name=>({name,status:'partial',summary:publicSummary,forms:[form('two',['alpha','beta'])]});
  const help=signatureHelp(text,text.lastIndexOf(')'),facts);
  assert.equal(help.summary,publicSummary);assert.equal(help.activeParameter,1);
  assert.ok(!JSON.stringify(help).includes('synthetic-private-value'));
  const noNote=signatureHelp(text,text.lastIndexOf(')'),lookup([form('two',['alpha','beta'])]));
  assert.equal(noNote.summary,undefined);
});
test('multi-form help keeps overloads and chooses a stable arity-compatible form',()=>{
  const forms=[form('one',['alpha']),form('two',['alpha','beta'])];
  const text='dataset = xdr_data | alter result = fixture(3, 4)';
  const help=signatureHelp(text,text.indexOf('4'),lookup(forms));
  assert.equal(help.signatures.length,2);
  assert.equal(help.activeSignature,1);
  assert.equal(help.activeParameter,1);
  assert.equal(help.signatures[0].activeParameter,0);
  for(const s of help.signatures) for(const p of s.parameters) assert.ok(s.label.slice(...p.label).length);
});
test('full-document caret in an earlier nested argument does not count later commas',()=>{
  const text='dataset = xdr_data | alter result = concat(lowercase("a,b"), "c", "d")';
  const inner=signatureHelp(text,text.indexOf('a,b')+1);
  assert.equal(inner.signatures[0].label,'lowercase(string)');
  assert.equal(inner.activeParameter,0);
  const outer=signatureHelp(text,text.indexOf('"c"')+1);
  assert.equal(outer.activeParameter,1);
});
test('arrays, groups and nested subqueries do not advance an outer call',()=>{
  for(const first of ['[3,4]', '(3,4)', '(dataset = xdr_data | fields alpha, beta)', 'lowercase("x,y")']) {
    const text=`dataset = xdr_data | alter result = arrayindex(${first}, )`;
    assert.equal(signatureHelp(text,text.lastIndexOf(')')).activeParameter,1);
  }
});
test('empty and trailing arguments retain direct positions',()=>{
  const text='dataset = xdr_data | alter result = concat(, , )';
  const open=text.indexOf('concat(')+7;
  assert.equal(signatureHelp(text,open).activeParameter,0);
  assert.equal(signatureHelp(text,text.indexOf(',',open)+1).activeParameter,1);
  assert.equal(signatureHelp(text,text.lastIndexOf(')')).activeParameter,2);
});
test('optional, repeated, zero, unknown and special forms have honest display ranges',()=>{
  const repeated=form('repeated',['alpha','beta']);
  repeated.parameters[1]={name:'beta',optional:true,repeat:true};
  const display=displayForm('fixture',repeated,100);
  assert.equal(display.label,'fixture(alpha, [...beta])');
  assert.equal(display.activeParameter,1);
  assert.deepEqual(display.parameters.map(p=>display.label.slice(...p.label)),['alpha','[...beta]']);
  for(const f of [form('zero',[]),form('unknown',[],{arityKnown:false}),form('special',[],{syntaxKind:'special',syntaxLabel:'fixture(non-positional shape)'})]) {
    const text='alter result = fixture(';
    const help=signatureHelp(text,text.length,lookup([f]));
    assert.equal(help.activeParameter,undefined);
    assert.equal(help.signatures[0].activeParameter,undefined);
    assert.deepEqual(help.signatures[0].parameters,[]);
  }
  assert.equal(displayForm('fixture',form('zero',[])).label,'fixture()');
  assert.equal(displayForm('fixture',form('unknown',[],{arityKnown:false})).label,'fixture(…)');
});
test('context-only forms do not appear in an unrelated stage',()=>{
  const forms=[form('aggregate',[],{contexts:['comp','windowcomp']})];
  assert.equal(signatureHelp('alter a = fixture(',18,lookup(forms)),undefined);
  assert.ok(signatureHelp('comp fixture(',13,lookup(forms)));
});
test('unknown inner calls, comments, limits and invalid offsets suppress help',()=>{
  for(const text of ['concat("x", future_function(', 'concat( // inside', 'concat( /* inside']) assert.equal(signatureHelp(text,text.length),undefined);
  assert.equal(signatureHelp('fixture(',8,()=>({name:'fixture',status:'blocked',forms:[]})),undefined);
  for(const offset of [-1,100,0.5,NaN]) assert.equal(signatureHelp('lowercase(',offset),undefined);
  assert.equal(signatureHelp('('.repeat(5000),5000),undefined);
});
