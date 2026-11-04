const {test}=require('node:test');
const assert=require('node:assert/strict');
const {AnalysisStore,createAnalysis,analyze,completions,hover,signatureHelp,MAX_LENGTH}=require('../.build/packages/core');
const {semanticTokens}=require('../.build/packages/core/semantic');

test('binding identities include document/version/query and distinct overwrite versions',()=>{
  const text='dataset xdr_data | alter alpha = 3 | alter alpha = 4 | join (dataset xdr_data | alter alpha = 5) as child child.alpha = alpha';
  const first=createAnalysis(text,{documentId:'first',version:1}), second=createAnalysis(text,{documentId:'second',version:1});
  const bindings=first.symbols.bindings.filter(b=>b.name==='alpha');
  assert.equal(new Set(bindings.map(b=>b.id)).size,3);
  assert.deepEqual(bindings.filter(b=>b.queryId==='q0').map(b=>b.version),[1,2]);
  assert.notEqual(bindings[0].scopeId,bindings[2].scopeId);
  assert.ok(!second.symbols.bindings.some(b=>first.symbols.byId.has(b.id)));
  const next=createAnalysis(text,{documentId:'first',version:2});
  assert.ok(!next.symbols.bindings.some(b=>first.symbols.byId.has(b.id)));
  for(const use of first.symbols.uses.filter(u=>u.access==='write')) assert.ok(first.symbols.byId.has(use.bindingId));
});
test('full dotted names, projection origins and same-stage availability stay explicit',()=>{
  const text='alter payload.branch = 3, beta = payload.branch | fields payload.branch as gamma';
  const analysis=createAnalysis(text),symbols=analysis.symbols;
  const path=symbols.bindings.find(b=>b.name==='payload.branch');
  assert.deepEqual(path.path,['payload','branch']);
  assert.equal(path.availableFrom,text.indexOf('|')+1);
  const read=symbols.uses.find(u=>u.access==='read'&&u.path.join('.')==='payload.branch');
  assert.equal(read.bindingId,undefined);assert.equal(read.certainty,'possible');
  const rename=symbols.bindings.find(b=>b.name==='gamma');
  assert.equal(rename.origin,'projection');assert.deepEqual(rename.sourcePath,['payload','branch']);
  assert.equal(createAnalysis('alter alpha = ').symbols.bindings[0].certainty,'possible');
});
test('observed field candidates never establish source membership',()=>{
  const doc=createAnalysis('config case_sensitive = true | dataset xdr_data | filter alpha = 4 | alter beta = lowercase(alpha)');
  assert.ok(doc.symbols.observations.some(o=>o.name==='alpha'&&o.certainty==='possible'));
  for(const name of ['xdr_data','case_sensitive','true','lowercase']) assert.ok(!doc.symbols.observations.some(o=>o.name===name),name);
  assert.ok(!doc.symbols.uses.some(u=>u.access==='read'&&u.path[0]==='alpha'&&u.bindingId));
});
test('query alias reads resolve only inside their recorded join predicate',()=>{
  const doc=createAnalysis('dataset xdr_data | join (dataset xdr_data | alter alpha = 4) as child child.alpha = alpha | fields child.alpha');
  const alias=doc.symbols.bindings.find(b=>b.role==='queryAlias');
  const uses=doc.symbols.uses.filter(u=>u.access==='read'&&u.path[0]==='child');
  assert.ok(uses.some(u=>u.role==='queryAlias'&&u.bindingId===alias.id));
  const fields=uses.filter(u=>u.path.length===2);
  assert.equal(fields[0].qualifierBindingId,alias.id);
  assert.equal(fields[1].qualifierBindingId,undefined);
});
test('callback parameters have separate identities/scopes and ordinary strings have none',()=>{
  const doc=createAnalysis('alter alpha = arraymap(items, concat("@element", arraymap(items, to_string("@element")))) | alter beta = "@element"');
  const parameters=doc.symbols.bindings.filter(b=>b.role==='parameter');
  assert.equal(parameters.length,2);
  assert.notEqual(parameters[0].id,parameters[1].id);
  assert.equal(doc.symbols.uses.filter(u=>u.role==='parameter').length,2);
  for(const parameter of parameters) assert.ok(doc.symbols.scopes.some(s=>s.id===parameter.scopeId&&s.kind==='callback'));
});
test('providers share one open-document analysis and edits invalidate it',()=>{
  const store=new AnalysisStore();
  const uri='untitled:first',text='dataset xdr_data | alter alpha = lowercase("amber") | fil';
  store.open(uri,1);
  const analysis=store.get(uri,1,text);
  assert.equal(store.get(uri,1,text),analysis);
  assert.ok(completions(text,text.length,analysis).some(i=>i.name==='filter'));
  assert.ok(hover(text,text.indexOf('lowercase'),analysis));
  assert.ok(signatureHelp(text,text.indexOf('"amber"'),undefined,analysis.structure.tree));
  assert.ok(semanticTokens(text,analysis.structure).length);
  analyze(text,analysis);
  assert.equal(store.stats.builds,1);
  assert.equal(store.change(uri,2),true);
  assert.equal(store.get(uri,1,text),undefined);
  const edited=text.replace('lowercase','future_call'),next=store.get(uri,2,edited);
  assert.notEqual(next,analysis);assert.equal(store.stats.builds,2);
  assert.ok(next.findings.some(f=>f.code==='XQL202'));
  assert.equal(store.change(uri,1),false);
});
test('close/reopen, same-version inconsistency and shutdown release owned state',()=>{
  const store=new AnalysisStore(),uri='untitled:reopen',text='alter alpha = 3';
  store.open(uri,1);const before=store.get(uri,1,text);
  assert.equal(store.get(uri,1,'alter beta = 4'),undefined);
  assert.equal(store.get(uri,1,text),undefined);
  store.change(uri,2);assert.ok(store.get(uri,2,text));
  store.close(uri);assert.equal(store.get(uri,2,text),undefined);
  assert.equal(store.stats.cached,0);assert.equal(store.stats.characters,0);assert.equal(store.stats.tokens,0);
  store.open(uri,1);const reopened=store.get(uri,1,text);
  assert.notEqual(reopened.symbols.bindings[0].id,before.symbols.bindings[0].id);
  store.clear();assert.equal(store.stats.open,0);assert.equal(store.stats.cached,0);
});
test('analysis LRU bounds documents, characters and tokens without retaining closed text',()=>{
  const store=new AnalysisStore({maxDocuments:2}),text='fields alpha';
  for(const uri of ['a','b','c']) store.open(uri,1);
  const first=store.get('a',1,text),second=store.get('b',1,text);
  assert.equal(store.get('a',1,text),first);
  store.get('c',1,text);
  assert.notEqual(store.get('b',1,text),second);
  assert.equal(store.stats.cached,2);
  for(const limits of [{maxCharacters:18},{maxTokens:3}]) {
    const bounded=new AnalysisStore(limits);
    bounded.open('a',1);bounded.open('b',1);
    bounded.get('a',1,text);bounded.get('b',1,text);
    assert.equal(bounded.stats.cached,1);
  }
  for(const limits of [{maxDocuments:0},{maxCharacters:NaN},{maxTokens:-1}]) assert.throws(()=>new AnalysisStore(limits));
});
test('oversized analyses remain explicit information and are not cached',()=>{
  const store=new AnalysisStore(),text=' '.repeat(MAX_LENGTH+1);
  store.open('large',1);
  const analysis=store.get('large',1,text);
  assert.equal(analysis.findings[0].code,'XQL000');
  assert.equal(store.stats.cached,0);assert.equal(store.stats.characters,0);
});

test('same-version content inconsistencies remain rejected after LRU eviction',()=>{
  const store=new AnalysisStore({maxDocuments:1});store.open('a',1);store.open('b',1);
  store.get('a',1,'alter alpha = 1');store.get('b',1,'alter beta = 2');
  assert.equal(store.get('a',1,'alter gamma = 3'),undefined);
  assert.equal(store.get('a',1,'alter alpha = 1'),undefined);
  assert.equal(store.stats.builds,2);
  assert.equal(store.change('a',2),true);
  assert.ok(store.get('a',2,'alter gamma = 3').symbols.bindings.some(binding=>binding.name==='gamma'));
});

test('uncached and oversized versions retain consistency without retaining source text',()=>{
  for(const options of [{maxCharacters:1},{maxTokens:1}]) {
    const store=new AnalysisStore(options);store.open('a',1);
    assert.ok(store.get('a',1,'alter alpha = 1'));assert.equal(store.stats.cached,0);
    assert.equal(store.get('a',1,'alter beta = 2'),undefined);
    assert.equal(store.stats.builds,1);assert.equal(store.stats.characters,0);
    store.change('a',2);assert.ok(store.get('a',2,'alter beta = 2'));
  }
  const store=new AnalysisStore();store.open('large',1);
  assert.equal(store.get('large',1,' '.repeat(MAX_LENGTH+1)).findings[0].code,'XQL000');
  assert.equal(store.get('large',1,'alter alpha = 1'),undefined);
  assert.equal(store.stats.cached,0);assert.equal(store.stats.characters,0);
  store.change('large',2);assert.ok(store.get('large',2,'alter alpha = 1'));
});

test('evicted content identity preserves exact UTF-16 code units',()=>{
  const store=new AnalysisStore({maxDocuments:1});store.open('a',1);store.open('b',1);
  store.get('a',1,'alter alpha = "\ud800"');store.get('b',1,'fields beta');
  assert.equal(store.get('a',1,'alter alpha = "\ud801"'),undefined);
});
test('different open documents never share names, identities or findings',()=>{
  const store=new AnalysisStore();store.open('a',1);store.open('b',1);
  const first=store.get('a',1,'alter alpha = future_call(3)'),second=store.get('b',1,'fields beta');
  assert.ok(first.symbols.bindings.some(b=>b.name==='alpha'));
  assert.deepEqual(second.symbols.bindings,[]);
  assert.deepEqual(second.findings,[]);
  assert.ok(!second.symbols.observations.some(o=>o.name==='alpha'));
});
