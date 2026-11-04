const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAnalysis,completionCandidates,structure}=require('../.build/packages/core');
const result=text=>{const analysis=createAnalysis(text);return {analysis,pipeline:analysis.pipeline,env:analysis.pipeline.output('q0')};};
test('comp projects grouping fields and explicit aliases and discards prior ordinary fields',()=>{
  const {analysis,pipeline,env}=result('alter alpha = 1, beta = 2 | comp count() as total by alpha | filter total = 1');
  assert.equal(env.open,false);assert.deepEqual(pipeline.fields(env).map(f=>f.name).sort(),['alpha','total']);
  assert.equal(pipeline.lookup(env,['alpha']).certainty,'known');assert.equal(pipeline.lookup(env,['total']).certainty,'known');
  assert.equal(pipeline.lookup(env,['beta']),undefined);assert.equal(pipeline.removal(env,['beta']).reason,'projected');
  const read=analysis.symbols.uses.find(u=>u.access==='read'&&u.path[0]==='total');assert.equal(read.bindingId,analysis.symbols.bindings.find(b=>b.name==='total').id);
  const text='alter alpha = 1, beta = 2 | comp count() as total by alpha | filter ';
  assert.deepEqual(completionCandidates(createAnalysis(text),text.length).filter(i=>i.kind==='field').map(i=>i.label).sort(),['alpha','total']);
});
test('multiple contextual aggregates retain explicit aliases without guessing implicit names or types',()=>{
  const {pipeline,env}=result('alter alpha = 1, beta = 2 | comp sum(alpha) as total, avg(beta) by alpha');
  assert.equal(env.open,true);assert.equal(pipeline.lookup(env,['total']).certainty,'known');
  assert.equal(pipeline.lookup(env,['beta']),undefined);assert.equal(pipeline.lookup(env,['avg_beta']),undefined);
  const implicit=result('alter alpha = 1 | comp count()');assert.equal(implicit.env.open,true);assert.equal(implicit.pipeline.lookup(implicit.env,['alpha']),undefined);
  assert.ok(!('type' in pipeline.lookup(env,['total'])));
});
test('window direct clauses preserve inputs and append only an explicit output alias',()=>{
  const {analysis,pipeline,env}=result('alter alpha = 1, beta = 2 | windowcomp sum(alpha) by beta sort desc alpha between null and 0 frame_type = rows as rolling | filter rolling = alpha');
  assert.equal(pipeline.lookup(env,['alpha']).certainty,'known');assert.equal(pipeline.lookup(env,['beta']).certainty,'known');assert.equal(pipeline.lookup(env,['rolling']).certainty,'known');
  assert.equal(analysis.structure.aggregates.values().next().value.form,'direct');
  const noAlias=result('alter alpha = 1 | windowcomp sum(alpha) sort alpha');
  assert.equal(noAlias.pipeline.lookup(noAlias.env,['alpha']).certainty,'known');assert.equal(noAlias.env.open,true);assert.equal(noAlias.pipeline.lookup(noAlias.env,['sum_alpha']),undefined);
});
test('reviewed navigation over form is distinct and preserves inputs without SQL grammar assumptions',()=>{
  const {analysis,pipeline,env}=result('alter alpha = 1, beta = 2 | windowcomp lag(alpha) as previous over(partition by beta order by alpha desc) | filter previous = alpha');
  assert.equal(analysis.structure.aggregates.values().next().value.form,'over');assert.equal(pipeline.lookup(env,['previous']).certainty,'known');assert.equal(pipeline.lookup(env,['alpha']).certainty,'known');
  assert.ok(!analysis.structure.tree.calls.some(c=>c.name.text==='over'));
});
test('aggregate alias/group collisions are ambiguous and never choose an invented output identity',()=>{
  for(const stage of ['comp count() as alpha by alpha','comp sum(alpha) as total, count() as total by alpha']) {
    const {pipeline,env}=result('alter alpha = 1 | '+stage);
    const name=stage.includes('as total')?'total':'alpha';assert.equal(pipeline.lookup(env,[name]).certainty,'possible');
  }
});
test('partial or unsupported aggregate/window shapes invalidate output certainty and declaration roles',()=>{
  for(const stage of ['comp count() as','comp count() as total,','comp count(,) as total','comp lowercase(alpha) as total','comp count() as total by','windowcomp sum(alpha) by beta sort','windowcomp sum(alpha) between null and','windowcomp lag(alpha) as previous over(partition by beta order by)','windowcomp sum(alpha) as total over(partition by beta order by alpha)','windowcomp sum(alpha) unreviewed as total']) {
    const {analysis,pipeline,env}=result('alter alpha = 1 | '+stage);
    assert.equal(env.open,true,stage);assert.equal(pipeline.lookup(env,['alpha']).certainty,'possible',stage);
    assert.ok(analysis.structure.outputs.every(o=>!o.complete),stage);
    assert.ok(analysis.structure.outputs.every(o=>analysis.structure.roles.find(r=>r.start===o.name.start)?.type==='property'),stage);
  }
});
test('all partial edits of direct and over windows recover with bounded honest outputs',()=>{
  for(const text of ['windowcomp sum(alpha) by beta sort desc alpha between -3 and 0 as rolling','windowcomp lag(alpha) as previous over(partition by beta order by alpha)']) for(let end=0;end<=text.length;end++) {
    const doc=structure(text.slice(0,end));for(const output of doc.outputs.filter(o=>o.complete)) assert.ok(doc.aggregates.get(output.stageStart).complete);
  }
});

test('signed null window bounds leave outputs uncertain and suppress dependent counts',()=>{
  for(const bounds of ['-null and 0','+null and 0','null and -null','-3 and +null','-null']) {
    const {analysis,pipeline,env}=result('alter alpha = 1 | windowcomp sum() sort alpha between '+bounds+' as rolling');
    assert.equal(pipeline.stages.at(-1).complete,false,bounds);
    assert.equal(env.open,true,bounds);
    assert.notEqual(pipeline.lookup(env,['rolling'])?.certainty,'known',bounds);
    assert.ok(analysis.structure.outputs.every(output=>!output.complete),bounds);
    assert.ok(!analysis.findings.some(finding=>finding.code==='XQL302'),bounds);
  }
  for(const bounds of ['null and 0','-3 and 0','null and null','-3']) {
    const {analysis,pipeline}=result('alter alpha = 1 | windowcomp sum() sort alpha between '+bounds+' as rolling');
    assert.equal(pipeline.stages.at(-1).complete,true,bounds);
    assert.equal(analysis.findings.filter(finding=>finding.code==='XQL302').length,1,bounds);
  }
});
