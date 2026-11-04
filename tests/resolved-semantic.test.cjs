const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAnalysis}=require('../.build/packages/core');
const {semanticTokens}=require('../.build/packages/core/semantic');
const named=(text,name,last=false)=>semanticTokens(text).find(t=>t.start===(last?text.lastIndexOf(name):text.indexOf(name)));
test('declarations and resolved reads share variable roles after stage boundaries and overwrites',()=>{
  const text='alter alpha = 1 | filter alpha = 1 | alter alpha = 2 | filter alpha = 2';
  const analysis=createAnalysis(text),tokens=semanticTokens(text,analysis),uses=analysis.symbols.uses.filter(u=>u.path[0]==='alpha');
  assert.deepEqual(tokens.filter(t=>text.slice(t.start,t.end)==='alpha').map(t=>[t.type,t.declaration]),[['variable',true],['variable',false],['variable',true],['variable',false]]);
  assert.notEqual(uses[0].bindingId,uses[2].bindingId);assert.equal(uses[1].bindingId,uses[0].bindingId);assert.equal(uses[3].bindingId,uses[2].bindingId);
});
test('projection rename/removal and uncertainty barriers prevent stale variable styling',()=>{
  const text='alter alpha = 1 | fields alpha as beta | filter alpha = beta | fields - beta | filter beta = 1';
  assert.equal(named(text,'alpha',true).type,'property');assert.equal(named(text,'beta').type,'variable');assert.equal(named(text,'beta',true).type,'property');
  for(const stage of ['unknown_stage alpha','alter beta =','comp count() as total,']) {
    const query='alter alpha = 1 | '+stage+' | filter alpha = 1';assert.equal(named(query,'alpha',true).type,'property');
  }
});
test('same-stage, duplicate and incomplete assignments never imply proven variable references or declarations',()=>{
  const same='alter alpha = 1 | alter alpha = alpha + 1';assert.equal(named(same,'alpha',true).type,'property');
  const duplicate='alter alpha = 1, alpha = 2 | filter alpha = 2';assert.ok(semanticTokens(duplicate).filter(t=>duplicate.slice(t.start,t.end)==='alpha').every(t=>t.type==='property'));
  assert.equal(named('alter alpha =','alpha').type,'property');
});
test('dotted names and JSON navigation style only the bound terminal, preserving member/property roles',()=>{
  const text='alter payload.branch = 1 | filter payload.branch->leaf = 1';
  assert.equal(named(text,'payload',true).type,'property');assert.equal(named(text,'branch',true).type,'variable');assert.equal(named(text,'leaf').type,'property');
  assert.equal(named(text,'branch').declaration,true);assert.equal(named(text,'branch',true).declaration,false);
});
test('nested shadowing and predicate aliases retain independent identities and neutral post-join qualification',()=>{
  const text='alter alpha = 1 | fields alpha | join conflict_strategy = left (alter alpha = 2 | fields alpha) as child child.alpha = alpha | filter child.alpha = alpha';
  const analysis=createAnalysis(text),tokens=semanticTokens(text,analysis);
  const predicate=analysis.structure.queryAliases[0].name.end;
  const alias=tokens.find(t=>t.start===text.indexOf('child.',predicate));assert.equal(alias.type,'namespace');
  assert.equal(tokens.find(t=>t.start===alias.end+1).type,'variable');
  assert.equal(named(text,'child',true).type,'property');
  const laterChildMember=tokens.find(t=>t.start===text.lastIndexOf('child.')+6);assert.equal(laterChildMember.type,'property');
  assert.equal(named(text,'alpha',true).type,'variable');
});
test('comp/window aliases resolve while missing/unsupported aliases and union identities stay neutral',()=>{
  const aggregate='alter alpha = 1 | comp count() as total by alpha | windowcomp sum(total) as rolling | filter rolling = total';
  assert.equal(named(aggregate,'rolling',true).type,'variable');assert.equal(named(aggregate,'total',true).type,'variable');
  assert.equal(named('comp lowercase(alpha) as total','total').type,'property');
  const union='alter alpha = 1 | union (alter beta = 2) | filter alpha = beta';assert.equal(named(union,'alpha',true).type,'property');assert.equal(named(union,'beta',true).type,'property');
});
test('only exact reviewed callback interiors receive parameter subspans owned by innermost callback',()=>{
  const text='alter alpha = arraymap(items, concat("@element", arrayfilter(items, "@element" = 1))), beta = "@element", gamma = concat("@element", "x"), delta = arraymap(items, "prefix @element")';
  const tokens=semanticTokens(text),parameters=tokens.filter(t=>t.type==='parameter');
  assert.equal(parameters.length,2);assert.ok(parameters.every(t=>text.slice(t.start,t.end)==='@element'&&!t.declaration));
  assert.equal(named(text,'@element',true),undefined);
  assert.equal(semanticTokens('alter alpha = arraymap(items, "\\u0040element")').filter(t=>t.type==='parameter').length,0);
});
test('editing earlier declarations invalidates roles and mismatched document analysis is rejected',()=>{
  const old='alter alpha = 1 | filter alpha = 1',analysis=createAnalysis(old);
  const next='alter beta = 1 | filter alpha = 1';assert.equal(named(next,'alpha',true).type,'property');assert.deepEqual(semanticTokens(next,analysis),[]);
  const text='// 🗡\r\nalter alpha = 1 | filter alpha = 1';assert.equal(named(text,'alpha',true).start,text.lastIndexOf('alpha'));
});
