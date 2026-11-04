const {test}=require('node:test');
const assert=require('node:assert/strict');
const corpus=require('./fixtures/syntax-cases.json');
const {parse,analyze,completions,hover,signatureHelp,scan,catalogue}=require('../.build/packages/core');
const {semanticTokens}=require('../.build/packages/core/semantic');
const {reference:signatures}=require('../.build/packages/core/reference');

for(const fixture of corpus) test(`structural corpus: ${fixture.name}`,()=>{
  const tree=parse(fixture.query);
  assert.deepEqual(tree.stages.map(s=>s.name.text),fixture.stages);
  assert.deepEqual(tree.calls.map(c=>c.name.text),fixture.calls);
  assert.deepEqual(analyze(fixture.query),[]);
});
test('nested unknown stages receive their own exact ranges',()=>{
  const text='dataset = xdr_data | join (dataset = xdr_data | future_stage true) as sample';
  const findings=analyze(text);
  assert.equal(findings.length,1);
  assert.equal(findings[0].code,'XQL201');
  assert.equal(text.slice(findings[0].start,findings[0].end),'future_stage');
});
test('unfinished nested call and query retain useful structure',()=>{
  const text='dataset = xdr_data | join (dataset = xdr_data | alter sample = concat("a", ';
  const tree=parse(text);
  assert.deepEqual(tree.stages.map(s=>s.name.text),['dataset','join','dataset','alter']);
  assert.equal(tree.calls[0].close,undefined);
  assert.equal(signatureHelp(text,text.length).activeParameter,1);
});
test('nested query stage completion and entry completion',()=>{
  for(const text of ['dataset = xdr_data | join (dataset = xdr_data | fil','dataset = xdr_data | join (dat']) {
    const names=completions(text,text.length).map(s=>s.name);
    assert.ok(names.includes(text.endsWith('fil')?'filter':'dataset'));
    assert.ok(!names.includes('concat'));
  }
});
test('keywords used as fields receive no stage/function hover',()=>{
  const text='dataset = xdr_data | fields payload.lowercase, payload.filter';
  assert.equal(hover(text,text.indexOf('lowercase')),undefined);
  assert.equal(hover(text,text.indexOf('filter')),undefined);
});
test('lexer recognizes numeric exponents and JSON access as complete tokens',()=>{
  assert.deepEqual(scan('1.25e-3 -> key').map(t=>[t.kind,t.text]),[['number','1.25e-3'],['operator','->'],['identifier','key']]);
});
test('signature help counts only the selected call argument separators',()=>{
  const text='dataset = xdr_data | alter sample = json_extract_scalar(concat("a,b", "c"), ';
  const help=signatureHelp(text,text.length);
  assert.equal(help.signatures[0].label,'json_extract_scalar(json_object_formatted_string, json_path)');
  assert.equal(help.activeParameter,1);
  const nested=text.slice(0,text.indexOf('"c"'));
  assert.equal(signatureHelp(nested,nested.length).signatures[0].label,'concat(string1, string2, [...strings])');
});
test('array and grouped commas do not advance outer signature parameters',()=>{
  const text='dataset = xdr_data | alter sample = arrayindex([1, 2, 3], ';
  assert.equal(signatureHelp(text,text.length).activeParameter,1);
});
test('variadic parameters clamp to the documented repeat slot',()=>{
  const text='dataset = xdr_data | alter sample = concat("a", "b", "c", ';
  assert.equal(signatureHelp(text,text.length).activeParameter,2);
});
test('unknown inner calls do not inherit misleading outer argument hints',()=>{
  const text='dataset = xdr_data | alter sample = concat("a", future_function(';
  assert.equal(signatureHelp(text,text.length),undefined);
});
test('signature help closes and is suppressed in comments',()=>{
  const closed='dataset = xdr_data | alter sample = lowercase("a")';
  assert.equal(signatureHelp(closed,closed.length),undefined);
  const comment='dataset = xdr_data | alter sample = concat( /* comment';
  assert.equal(signatureHelp(comment,comment.length),undefined);
});
test('signature facts have unique names and official source links',()=>{
  assert.equal(new Set(signatures.map(s=>s.name)).size,signatures.length);
  for(const s of signatures) {
    assert.ok(catalogue.some(entry=>entry.kind==='function'&&entry.name===s.name));
    assert.ok(s.status==='blocked' ? s.forms.length===0 : s.forms.length>0);
    for (const form of s.forms) {
      assert.equal(new URL(form.source).hostname,'cortex-docs.paloaltonetworks.com');
      assert.equal(new URL(form.source).protocol,'https:');
    }
  }
});
test('documented aggregate names are recognized rather than flagged as future functions',()=>{
  for(const name of ['count','sum','avg','min','max']) {
    const entry=catalogue.find(s=>s.kind==='function'&&s.name===name);
    assert.ok(entry,name);
    assert.ok(entry.contexts.includes('comp'));
    assert.ok(entry.contexts.includes('windowcomp'));
    assert.deepEqual(analyze(`dataset = xdr_data | comp ${name}(1) as sample`),[]);
  }
});
test('semantic roles distinguish datasets, calls, fields and declarations',()=>{
  const text='dataset = xdr_data | alter sample = lowercase(action_process_image_name) | fields sample';
  const tokens=semanticTokens(text);
  const role=(name,last=false)=>tokens.find(t=>t.start===(last?text.lastIndexOf(name):text.indexOf(name)));
  assert.equal(role('dataset').type,'keyword');
  assert.equal(role('xdr_data').type,'xqlDataset');
  assert.equal(role('lowercase').type,'function');
  assert.equal(role('action_process_image_name').type,'property');
  assert.equal(role('sample').type,'variable');
  assert.equal(role('sample').declaration,true);
  assert.equal(role('sample',true).type,'variable');
  assert.equal(role('sample',true).declaration,false);
});
test('structural-only callback-like predicate comparisons are not treated as field declarations',()=>{
  const text='dataset = xdr_data | alter sample = arrayfilter(items, "@element" -> active = true)';
  const active=semanticTokens(text).find(t=>t.start===text.indexOf('active'));
  assert.equal(active.type,'property');
  assert.equal(active.declaration,false);
});
test('nested datasets receive their own source classification',()=>{
  const text='dataset = xdr_data | join (dataset = xdr_data | limit 1) as sample sample._time = _time';
  assert.equal(semanticTokens(text).filter(t=>t.type==='xqlDataset').length,2);
});
test('member keywords, comments and strings retain their correct roles',()=>{
  const text='dataset = xdr_data | fields payload.filter, payload.lowercase // concat(fake)';
  const roles=semanticTokens(text);
  assert.equal(roles.find(t=>t.start===text.indexOf('filter')).type,'property');
  assert.equal(roles.find(t=>t.start===text.indexOf('lowercase')).type,'property');
  assert.ok(!roles.some(t=>t.start>=text.indexOf('//')));
});
test('all prefixes of nested synthetic queries recover without crashing',()=>{
  for(const fixture of corpus) for(let i=0;i<=fixture.query.length;i++) {
    const prefix=fixture.query.slice(0,i), tree=parse(prefix);
    for(const issue of tree.issues) assert.ok(issue.start>=0&&issue.end<=i);
    signatureHelp(prefix,i);
  }
});
