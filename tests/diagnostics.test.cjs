const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAnalysis,analyze,diagnosticRules,MAX_LENGTH}=require('../.build/packages/core');
const fixtures=require('./fixtures/acceptance-cases.json');
test('diagnostic registry states parser/fact/confidence/severity and suppression requirements',()=>{
  assert.equal(new Set(diagnosticRules.map(r=>r.code)).size,diagnosticRules.length);
  for(const rule of diagnosticRules) {assert.ok(rule.parser.length);assert.ok(rule.confidence);assert.ok(['error','warning','information'].includes(rule.severity));assert.ok(Array.isArray(rule.facts)&&Array.isArray(rule.suppress));}
  assert.ok(diagnosticRules.filter(r=>r.category==='localName'||r.category==='arity').every(r=>r.enabled));
});
test('coverage gates dependent rules at incomplete, unknown and nested-root-finding boundaries',()=>{
  for(const text of ['alter alpha =','filter alpha =','fields alpha,','unknown_stage alpha','alter alpha = future_function(1)','join (dataset xdr_data']) {
    const analysis=createAnalysis(text),stage=analysis.coverage.stages.values().next().value;
    assert.equal(stage.dependentRules,false,text);
  }
  const doc=createAnalysis('alter alpha = lowercase(future_function(1))');
  assert.ok([...doc.coverage.calls.values()].every(c=>!c.dependentRules));
  assert.equal(doc.coverage.rootFindings.filter(f=>f.code==='XQL202').length,1);
});
test('supported closed shape is explicit and never inferred from an open dataset',()=>{
  const doc=createAnalysis('dataset xdr_data | alter alpha = 1 | fields alpha | filter alpha = 1');
  const stages=[...doc.coverage.stages.values()];
  assert.equal(stages[1].closedInput,false);assert.equal(stages.at(-1).closedInput,true);assert.equal(stages.at(-1).dependentRules,true);
});
test('valid acceptance corpus and every incomplete prefix introduce no speculative diagnostics',()=>{
  for(const fixture of fixtures) for(let end=0;end<=fixture.query.length;end++) {
    const findings=analyze(fixture.query.slice(0,end));
    assert.ok(findings.every(f=>['XQL000','XQL101','XQL102','XQL103','XQL104','XQL201','XQL202'].includes(f.code)),fixture.id+':'+end);
    assert.ok(findings.length<=100);
  }
});
test('legacy structural/reference codes, severity and exact root ranges remain stable',()=>{
  for(const [tail,code] of [['"open','XQL101'],['/* open','XQL102'],[')','XQL103'],['(','XQL104']]) assert.ok(analyze('alter alpha = '+tail).some(f=>f.code===code&&f.severity==='error'));
  const text='future_stage alpha = future_function(1)',findings=analyze(text);
  assert.deepEqual(findings.map(f=>[f.code,f.severity,text.slice(f.start,f.end)]),[['XQL201','warning','future_stage'],['XQL202','warning','future_function']]);
  assert.match(findings[1].message,/does not establish a Cortex error/);
  const limited=createAnalysis(' '.repeat(MAX_LENGTH+1));assert.equal(limited.coverage.limited,true);assert.equal(limited.findings.length,1);assert.equal(limited.findings[0].code,'XQL000');
});
