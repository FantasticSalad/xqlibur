const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAnalysis}=require('../.build/packages/core');
const {fieldPatternMatches,datasetSystemFields,xdmSystemFields}=require('../.build/packages/core/pipeline');
const facts=require('../reference/stage-facts.json');
const output=text=>{const analysis=createAnalysis(text);return {analysis,pipeline:analysis.pipeline,env:analysis.pipeline.output('q0')};};
const read=(analysis,name)=>analysis.symbols.uses.filter(u=>u.access==='read'&&u.path.join('.')===name).at(-1);

test('wildcard matching agrees with an independent dynamic-programming oracle',()=>{
  const words=(alphabet,depth)=>{
    const result=[''];let level=[''];
    for(let size=0;size<depth;size++) {level=level.flatMap(prefix=>alphabet.map(letter=>prefix+letter));result.push(...level);}
    return result;
  };
  const oracle=(pattern,value)=>{
    let row=Array(value.length+1).fill(false);row[0]=true;
    for(const letter of pattern) {
      const next=Array(value.length+1).fill(false);next[0]=letter==='*'&&row[0];
      for(let index=1;index<=value.length;index++) next[index]=letter==='*'?row[index]||next[index-1]:row[index-1]&&letter===value[index-1];
      row=next;
    }
    return row[value.length];
  };
  for(const pattern of words(['a','b','*'],6)) for(const value of words(['a','b'],5))
    assert.equal(fieldPatternMatches(pattern,value),oracle(pattern,value),pattern+':'+value);
  for(const [pattern,value,expected] of [['a*a','a',false],['*?*','abc',false],['*[a]*','x[a]y',true],['*🗡*','x🗡y',true],['*A*','abc',false]])
    assert.equal(fieldPatternMatches(pattern,value),expected);
});

test('long repeated wildcard prefixes cannot trigger retry backtracking',()=>{
  const repeated='a'.repeat(100000),value=repeated+repeated;
  assert.equal(fieldPatternMatches('*'+repeated+'b',value),false);
  assert.equal(fieldPatternMatches('*'+repeated+'b*',value),false);
  assert.equal(fieldPatternMatches('*'+repeated+'b*'+repeated+'c',value+'b'+value+'c'),true);
});

test('projection keeps the existing wildcard pair budget after matcher preparation',()=>{
  const declaration='alter '+Array.from({length:500},(_,index)=>'field_'+index+' = 1').join(', ');
  for(const [patterns,complete] of [[400,true],[401,false]]) {
    const {pipeline,env}=output(declaration+' | fields '+Array(patterns).fill('field_*').join(', '));
    assert.equal(pipeline.stages.at(-1).complete,complete);
    assert.equal(pipeline.lookup(env,['field_0']).certainty,complete?'known':'possible');
  }
});

test('alter identity is stage-local, versioned, case-sensitive and resolves later reads',()=>{
  const {analysis,pipeline,env}=output('dataset xdr_data | alter alpha = 1 | filter alpha = 1 | alter alpha = 2 | filter alpha = 2');
  const bindings=analysis.symbols.bindings.filter(b=>b.name==='alpha');
  const reads=analysis.symbols.uses.filter(u=>u.access==='read'&&u.path[0]==='alpha');
  assert.deepEqual(reads.map(u=>u.bindingId),bindings.map(b=>b.id));
  assert.equal(pipeline.lookup(env,['alpha']).bindingId,bindings[1].id);
  assert.equal(pipeline.lookup(env,['Alpha']),undefined);
  assert.equal(analysis.findings.length,0);
});

test('reads before a declaration and same-stage writes have no derived identity',()=>{
  const {analysis}=output('filter alpha = 0 | alter alpha = 1 | alter alpha = alpha + 1, beta = alpha | filter beta = 2');
  const reads=analysis.symbols.uses.filter(u=>u.access==='read'&&u.path[0]==='alpha');
  assert.ok(reads.length>=3);assert.ok(reads.every(u=>!u.bindingId));
  assert.equal(read(analysis,'beta').certainty,'known');
});

test('independent child queries do not inherit fields; explicit join composition exports supported outputs',()=>{
  const {analysis,pipeline,env}=output('alter outer_name = 1 | join (dataset xdr_data | filter outer_name = 1 | alter inner_name = 2) as child child.inner_name = outer_name | filter inner_name = 2');
  const child=analysis.structure.tree.queries.find(q=>q.parentId);
  assert.equal(analysis.symbols.uses.find(u=>u.queryId===child.id&&u.path[0]==='outer_name').bindingId,undefined);
  assert.equal(pipeline.lookup(pipeline.output(child.id),['inner_name']).certainty,'known');
  assert.equal(pipeline.lookup(env,['outer_name']).certainty,'possible');
  assert.equal(read(analysis,'inner_name').bindingId,analysis.symbols.bindings.find(b=>b.name==='inner_name').id);
});

test('duplicate and overlapping writes retain candidates without choosing an identity',()=>{
  const {analysis,pipeline,env}=output('alter payload = 1, payload.branch = 2, alpha = 3, alpha = 4, safe = 5 | filter payload.branch = alpha and safe = 5');
  for(const path of [['payload'],['payload','branch'],['alpha']]) assert.equal(pipeline.lookup(env,path).certainty,'possible');
  assert.equal(read(analysis,'payload.branch').bindingId,undefined);assert.equal(read(analysis,'alpha').bindingId,undefined);
  assert.equal(read(analysis,'safe').certainty,'known');
});

test('later writes sharing a root conservatively invalidate related path identities',()=>{
  const {analysis,pipeline,env}=output('alter payload.branch = 1 | alter payload = 2 | filter payload.branch = 1');
  assert.equal(pipeline.lookup(env,['payload']).certainty,'known');
  assert.equal(pipeline.lookup(env,['payload','branch']).certainty,'possible');
  assert.equal(read(analysis,'payload.branch').bindingId,undefined);
});

test('JSON navigation resolves the base binding without assigning its identity to members',()=>{
  const {analysis}=output('alter payload.branch = 1 | filter payload.branch->leaf = 1');
  const use=read(analysis,'payload.branch.leaf');
  assert.equal(use.certainty,'known');assert.equal(use.resolvedPathLength,2);
});

test('inclusion, exclusion and renaming retain only supported field identities',()=>{
  const {analysis,pipeline,env}=output('alter alpha = 1, beta = 2, gamma = 3 | fields alpha as renamed, beta | fields - beta | filter renamed = 1');
  assert.equal(env.open,false);
  assert.equal(pipeline.lookup(env,['renamed']).certainty,'known');
  assert.equal(read(analysis,'renamed').bindingId,analysis.symbols.bindings.find(b=>b.name==='renamed').id);
  assert.equal(pipeline.lookup(env,['alpha']),undefined);assert.equal(pipeline.lookup(env,['beta']),undefined);assert.equal(pipeline.lookup(env,['gamma']),undefined);
  assert.equal(pipeline.removal(env,['beta']).reason,'excluded');
});

test('rename and projection removal evidence is precise and canceled by reintroduction',()=>{
  const first=output('alter alpha = 1, beta = 2 | fields alpha as renamed');
  assert.equal(first.pipeline.removal(first.env,['alpha']).reason,'renamed');
  assert.equal(first.pipeline.removal(first.env,['alpha']).replacement,'renamed');
  assert.equal(first.pipeline.removal(first.env,['beta']).reason,'projected');
  const next=output('alter alpha = 1 | fields - alpha | alter alpha = 2');
  assert.equal(next.pipeline.removal(next.env,['alpha']),undefined);
  assert.equal(next.pipeline.lookup(next.env,['alpha']).certainty,'known');
});

test('wildcards filter candidates without claiming closed unknown source membership',()=>{
  const first=output('alter alpha = 1, alphabet = 2, beta = 3 | fields alpha*');
  assert.equal(first.env.open,true);
  assert.deepEqual(first.pipeline.fields(first.env).map(f=>f.name).sort(),['alpha','alphabet']);
  const excluded=output('alter alpha = 1, beta = 2 | fields - alpha*');
  assert.equal(excluded.pipeline.lookup(excluded.env,['alpha']),undefined);
  assert.equal(excluded.pipeline.lookup(excluded.env,['beta']).certainty,'known');
  for(const [pattern,value,match] of [['*','abc',true],['a*b*c','axbyc',true],['a.b','axb',false],['[a]*','[a]x',true],['ab*','a',false]]) assert.equal(fieldPatternMatches(pattern,value),match);
});

test('retention exceptions match reviewed facts and never invent system-field presence',()=>{
  const fact=facts.facts.find(f=>f.id==='system-field-retention');
  assert.deepEqual(datasetSystemFields,fact.datasetFields);assert.deepEqual(xdmSystemFields,fact.xdmFields);
  const dataset=output('dataset xdr_data | alter _time = 1, _id = 2, alpha = 3 | fields alpha');
  assert.equal(dataset.pipeline.lookup(dataset.env,['_time']).certainty,'known');assert.equal(dataset.pipeline.lookup(dataset.env,['_id']).certainty,'known');
  const xdm=output('datamodel dataset xdr_data | alter _time = 1, _id = 2, alpha = 3 | fields alpha');
  assert.ok(xdm.pipeline.lookup(xdm.env,['_time']));assert.equal(xdm.pipeline.lookup(xdm.env,['_id']),undefined);
  const absent=output('dataset xdr_data | fields alpha');
  assert.equal(absent.pipeline.lookup(absent.env,['_time']),undefined);assert.equal(absent.pipeline.removal(absent.env,['_time']),undefined);
});

test('unsupported or incomplete stages invalidate certainty and removal proofs',()=>{
  for(const middle of ['mystery alpha','join (dataset xdr_data) as child child.alpha = alpha','comp lowercase(alpha) as total','alter beta =','alter beta = alpha gamma','alter beta = 1;','fields alpha as','filter alpha =','filter alpha beta','sort alpha,','limit unknown']) {
    const {pipeline,env}=output('alter alpha = 1 | fields - beta | '+middle);
    assert.equal(env.open,true,middle);
    const alpha=pipeline.lookup(env,['alpha']);assert.ok(!alpha||alpha.certainty==='possible',middle);
    assert.equal(pipeline.removal(env,['beta']),undefined,middle);
  }
  const fresh=output('alter old = 1 | mystery old | alter fresh = 2 | filter fresh = 2');
  assert.equal(fresh.pipeline.lookup(fresh.env,['old']).certainty,'possible');assert.equal(read(fresh.analysis,'fresh').certainty,'known');
});

test('complete preserving stages reuse environments and document positions use stage input',()=>{
  const text='alter alpha = 1 | filter alpha = 1 | sort alpha | limit 10 | dedup alpha | config case_sensitive = true';
  const {analysis,pipeline,env}=output(text);
  for(const transfer of pipeline.stages.slice(1)) assert.equal(transfer.before,transfer.after);
  assert.equal(pipeline.environmentAt('q0',text.indexOf('alpha = 1')),pipeline.stages[0].before);
  assert.equal(pipeline.environmentAt('q0',text.length),pipeline.stages.at(-1).before);
  assert.equal(pipeline.lookup(env,['alpha']).certainty,'known');
  assert.equal(analysis.findings.length,0);
});

test('observations remain possible, projections close ordinary shape and source resets discard identities',()=>{
  const first=output('filter observed = 1 | fields observed');
  assert.equal(first.env.open,false);assert.equal(first.pipeline.lookup(first.env,['observed']).certainty,'possible');
  const reset=output('alter alpha = 1 | dataset xdr_data');
  assert.equal(reset.pipeline.lookup(reset.env,['alpha']),undefined);
  const removed=output('alter alpha = 1 | fields - alpha | filter alpha = 1');
  assert.equal(removed.pipeline.lookup(removed.env,['alpha']),undefined);assert.equal(removed.pipeline.removal(removed.env,['alpha']).reason,'excluded');
});

test('negative field prefilter respects older snapshots, scopes, source resets and explicit composition',()=>{
  const text='filter early_name = 1 | alter later_name = 2 | fields later_name | join (alter child_name = 3 | fields child_name) as child child.child_name = later_name | filter child_name = 3';
  const {analysis,pipeline,env}=output(text),child=analysis.structure.tree.queries.find(q=>q.parentId);
  const first=pipeline.stages[0];
  assert.equal(pipeline.lookup(first.before,['early_name']),undefined);
  assert.equal(pipeline.lookup(first.after,['early_name']).certainty,'possible');
  assert.equal(pipeline.lookup(first.after,['later_name']),undefined);
  assert.equal(pipeline.lookup(first.after,['child_name']),undefined);
  assert.equal(pipeline.lookup(pipeline.output(child.id),['later_name']),undefined);
  assert.equal(pipeline.lookup(env,['child_name']).certainty,'known');
  assert.equal(pipeline.output(child.id).queryId,child.id);assert.equal(env.queryId,'q0');
  const reset=output('alter old_name = 1 | dataset xdr_data | alter fresh_name = 2');
  assert.equal(reset.pipeline.lookup(reset.env,['old_name']),undefined);assert.equal(reset.pipeline.lookup(reset.env,['fresh_name']).certainty,'known');
  const excluded=output('fields - not_declared | filter not_declared = 1');
  assert.equal(excluded.pipeline.lookup(excluded.env,['not_declared']),undefined);
  assert.equal(excluded.pipeline.removal(excluded.env,['not_declared']).certainty,'possible');
  assert.deepEqual(excluded.analysis.findings,[]);
});

test('thousands of distinct observations retain possible names and no future field identities',()=>{
  const text='dataset xdr_data'+Array.from({length:2000},(_,i)=>' | filter observed_'+i+' = 1').join('');
  const {analysis,pipeline,env}=output(text);assert.equal(pipeline.fields(env).length,2000);
  assert.ok(pipeline.fields(env).every(f=>f.certainty==='possible'&&!f.bindingId));
  assert.equal(pipeline.lookup(pipeline.stages[100].before,['observed_1500']),undefined);
  assert.ok(analysis.symbols.uses.every(u=>!u.bindingId));assert.deepEqual(analysis.findings,[]);
});
