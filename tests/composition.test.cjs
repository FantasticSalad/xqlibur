const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAnalysis,completionCandidates}=require('../.build/packages/core');
const result=text=>{const analysis=createAnalysis(text);return {analysis,pipeline:analysis.pipeline,env:analysis.pipeline.output('q0')};};
const binding=(analysis,name,queryId)=>analysis.symbols.bindings.find(b=>b.name===name&&b.queryId===queryId);
test('join predicate members resolve the independent child identity and export verified flat outputs',()=>{
  const {analysis,pipeline,env}=result('alter parent_name = 1 | fields parent_name | join (alter child_name = 2 | fields child_name) as child child.child_name = parent_name | filter child_name = 2');
  const child=analysis.structure.tree.queries.find(q=>q.parentId),childBinding=binding(analysis,'child_name',child.id);
  const member=analysis.symbols.uses.find(u=>u.qualifierBindingId);assert.equal(member.bindingId,childBinding.id);assert.equal(member.certainty,'known');
  assert.equal(pipeline.lookup(env,['parent_name']).bindingId,binding(analysis,'parent_name','q0').id);
  assert.equal(pipeline.lookup(env,['child_name']).bindingId,childBinding.id);
  assert.equal(pipeline.lookup(env,['child','child_name']),undefined);
  assert.equal(env.open,false);
});
test('explicit left/right/default conflicts choose only evidenced identities; both remains ambiguous',()=>{
  for(const strategy of ['left','right','both',undefined]) {
    const option=strategy?'conflict_strategy = '+strategy+' ':'';
    const {analysis,pipeline,env}=result('alter shared = 1 | fields shared | join '+option+'(alter shared = 2 | fields shared) as child child.shared = shared');
    const field=pipeline.lookup(env,['shared']),child=analysis.structure.tree.queries.find(q=>q.parentId);
    if(strategy==='both') {assert.equal(field.certainty,'possible');assert.equal(field.bindingId,undefined);}
    else assert.equal(field.bindingId,binding(analysis,'shared',strategy==='left'?'q0':child.id).id);
    assert.equal(pipeline.fields(env).length,1);assert.equal(analysis.findings.length,0);
  }
});
test('open opposite schemas and related path collisions cannot guarantee a surviving origin',()=>{
  const right=result('alter parent_name = 1 | join (dataset xdr_data) as child child._time = _time');
  assert.equal(right.pipeline.lookup(right.env,['parent_name']).certainty,'possible');
  const left=result('alter parent_name = 1 | join conflict_strategy = left (dataset xdr_data) as child child._time = _time');
  assert.equal(left.pipeline.lookup(left.env,['parent_name']).certainty,'known');
  const related=result('alter payload.branch = 1 | fields payload.branch | join conflict_strategy = left (alter payload.leaf = 2 | fields payload.leaf) as child child.payload.leaf = payload.branch');
  assert.equal(related.pipeline.lookup(related.env,['payload','branch']).certainty,'possible');
});
test('all supported join types preserve named output candidates without claiming row presence',()=>{
  for(const type of ['inner','left','right']) {
    const {pipeline,env}=result('alter parent_name = 1 | fields parent_name | join type = '+type+' (alter child_name = 2 | fields child_name) as child child.child_name = parent_name');
    assert.deepEqual(pipeline.fields(env).map(f=>f.name).sort(),['child_name','parent_name']);
    assert.ok(pipeline.fields(env).every(f=>!('nullable' in f)&&!('presentInEveryRow' in f)));
  }
});
test('union merges independent branch candidates without per-row identity or aliases',()=>{
  const {pipeline,env}=result('alter parent_name = 1, shared = 2 | fields parent_name, shared | union (alter child_name = 3, shared = 4 | fields child_name, shared)');
  assert.equal(env.open,false);assert.deepEqual(pipeline.fields(env).map(f=>f.name).sort(),['child_name','parent_name','shared']);
  assert.ok(pipeline.fields(env).every(f=>f.certainty==='possible'&&!f.bindingId));
  const text='alter parent_name = 1 | union (alter child_name = 2) | fields ';
  const items=completionCandidates(createAnalysis(text),text.length);assert.deepEqual(items.map(i=>i.label).sort(),['child_name','parent_name']);
  assert.ok(items.every(i=>/unverified/.test(i.detail)));
});
test('named union sources stay open and are never mistaken for output field observations',()=>{
  const {analysis,pipeline,env}=result('alter parent_name = 1 | union xdr_data');
  assert.equal(env.open,true);assert.equal(pipeline.lookup(env,['parent_name']).certainty,'possible');assert.equal(pipeline.lookup(env,['xdr_data']),undefined);
  assert.ok(!analysis.symbols.observations.some(o=>o.name==='xdr_data'));
});
test('nested/sibling queries are evaluated independently, then composed only at their stage boundary',()=>{
  const text='alter root_name = 1 | fields root_name | join (alter first_name = 2 | fields first_name | union (alter nested_name = 3 | fields nested_name)) as first first.first_name = root_name | join (filter first_name = 2 | alter second_name = 4 | fields second_name) as second second.second_name = root_name';
  const {analysis,pipeline,env}=result(text),second=analysis.structure.queryAliases.find(a=>a.name.text==='second');
  const read=analysis.symbols.uses.find(u=>u.queryId===second.childQueryId&&u.path[0]==='first_name'&&u.access==='read');
  assert.equal(read.bindingId,undefined);assert.equal(pipeline.lookup(pipeline.output(second.childQueryId),['root_name']),undefined);
  assert.ok(pipeline.lookup(env,['second_name']));assert.ok(!pipeline.lookup(env,['first','first_name']));
});
test('incomplete, unsupported options and unknown boundaries suppress guarantees and old absence proofs',()=>{
  for(const stage of ['join (alter child_name = 1','join (alter child_name = 1) as child','join type = future (alter child_name = 1) as child child.child_name = alpha','join conflict_strategy = left conflict_strategy = right (alter child_name = 1) as child child.child_name = alpha','join unreviewed = 1 (alter child_name = 1) as child child.child_name = alpha','union (alter child_name = 1','union (alter child_name = 1) extra','enrich alpha','view type = pie']) {
    const {pipeline,env}=result('alter alpha = 1 | fields - removed_name | '+stage);
    assert.equal(env.open,true,stage);assert.equal(pipeline.lookup(env,['alpha']).certainty,'possible',stage);assert.equal(pipeline.removal(env,['removed_name']),undefined,stage);
  }
});
test('composition partial edits recover without outer/sibling identity inheritance',()=>{
  const text='alter alpha = 1 | join (alter beta = 2 | union (alter gamma = 3)) as child child.beta = alpha';
  for(let end=0;end<=text.length;end++) {const analysis=createAnalysis(text.slice(0,end));for(const use of analysis.symbols.uses.filter(u=>u.bindingId)) assert.ok(analysis.symbols.byId.has(use.bindingId));}
});
test('composition snapshots store sparse deltas rather than cloning every accumulated field map',()=>{
  const text='alter root_name = 1 | fields root_name'+Array.from({length:80},(_,i)=>' | join (alter child_'+i+' = 1 | fields child_'+i+') as child child.child_'+i+' = root_name').join('');
  const {pipeline,env}=result(text);
  assert.equal(pipeline.fields(env).length,81);
  const joins=pipeline.stages.filter(s=>s.kind==='join');assert.equal(joins.length,80);
  assert.ok(joins.every(s=>s.after.changes.size<=1));assert.ok(joins.every(s=>!s.after.reset));
});
