const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAnalysis,structure,buildExpressions,expressionAt,analyze}=require('../.build/packages/core');
const {expressionOperators}=require('../.build/packages/core/expressions');
const facts=require('../reference/operator-facts.json');
const fixtures=require('./fixtures/acceptance-cases.json');
const root=(text)=>{const analysis=createAnalysis(text),entry=analysis.expressions.roots.find(r=>r.purpose==='filter'||r.purpose==='assignment');return {analysis,index:analysis.expressions,node:analysis.expressions.nodes[entry.nodeId]};};
test('explicit grouping establishes structure without guessed mixed operator precedence',()=>{
  const {index,node}=root('filter (alpha = 1) and (beta = 2)');
  assert.equal(node.kind,'binary');assert.equal(node.state,'complete');assert.deepEqual(node.operators.map(o=>o.text),['and']);
  assert.deepEqual(node.children.map(id=>index.nodes[id].kind),['group','group']);
  for(const id of node.children) assert.equal(index.nodes[index.nodes[id].children[0]].kind,'binary');
  const mixed=root('filter alpha = 1 or beta = 2 and gamma = 3');assert.equal(mixed.node.kind,'ambiguous');assert.equal(mixed.node.state,'unsupported');assert.equal(mixed.node.reason,'precedenceUnverified');
  assert.deepEqual(mixed.node.operators.map(o=>o.text),['=','or','=','and','=']);
  const repeated=root('filter alpha and beta and gamma');assert.equal(repeated.node.kind,'ambiguous');
  assert.ok(!analyze('filter alpha = 1 or beta = 2 and gamma = 3').some(f=>Number(f.code.slice(3))>=400));
});
test('one comparison/unary/string-range production retains exact source operators and spans',()=>{
  for(const operator of expressionOperators) {
    const text='filter alpha '+operator+' beta',result=root(text);
    assert.equal(result.node.kind,'binary',operator);assert.equal(result.node.state,'complete',operator);
    assert.equal(text.slice(result.node.operators[0].start,result.node.operators[0].end),operator);
  }
  const unary=root('filter not (alpha = 1)');assert.equal(unary.node.kind,'unary');assert.equal(unary.node.state,'complete');
  assert.equal(root('filter not alpha = 1').node.kind,'ambiguous');
});

test('adjacent negative numeric atoms retain exact source spans without evaluating or copying values',()=>{
  for(const value of ['-8','-2.5','-1e-3','-987654321012345']) {
    const text='// synthetic CRLF\r\nalter result = cbrt('+value+')',analysis=createAnalysis(text),index=analysis.expressions;
    const call=index.nodes[index.byCall.get(text.indexOf('cbrt'))],argument=index.nodes[call.children[0]];
    assert.equal(call.state,'complete');assert.equal(argument.kind,'unary');assert.equal(argument.state,'complete');
    assert.equal(text.slice(argument.start,argument.end),value);
    assert.equal(text.slice(argument.operators[0].start,argument.operators[0].end),'-');
    assert.equal(index.nodes[argument.children[0]].kind,'literal');
    assert.equal(expressionAt(index,text.indexOf(value)).id,argument.id);
    assert.ok(!JSON.stringify(index).includes('987654321012345'));
    assert.deepEqual(analysis.findings,[]);
  }
  const comparison=root('filter alpha = -8');assert.equal(comparison.node.kind,'binary');assert.equal(comparison.node.state,'complete');
  const membership=root('filter alpha in (-8, -2.5)');assert.equal(membership.node.state,'complete');
});

test('negative numeric atoms do not admit general negation, subtraction or mixed precedence',()=>{
  for(const text of ['alter result = - source_value','alter result = - 8','alter result = +8','alter result = --8','alter result = -"8"','alter result = -lowercase("amber")','alter result = source_value-8','alter result = -8-1','alter result = 1 + -8','filter payload->-8 = 1','filter not alpha = -8','filter alpha = -8 or beta = -2']) {
    assert.equal(root(text).node.state,'unsupported',text);
    assert.ok(!analyze(text).some(f=>Number(f.code.slice(3))>=400),text);
  }
  for(const maxNodes of [1,2,3]) {
    const index=buildExpressions(structure('alter result = cbrt(-8)'),{maxNodes});
    assert.equal(index.limited,true);assert.ok(index.nodes.length<=maxNodes);
  }
});
test('member paths preserve field components including keyword members, without copying literal payloads',()=>{
  const {index,node}=root('filter payload.true->filter = "synthetic-private-value"');
  assert.equal(node.kind,'binary');const path=index.nodes[node.children[0]];assert.equal(path.kind,'member');assert.equal(path.state,'complete');
  assert.equal(path.children.length,3);assert.deepEqual(path.operators.map(o=>o.text),['.','->']);
  assert.ok(!JSON.stringify(index).includes('synthetic-private-value'));
  assert.ok(index.nodes.every(n=>!('text' in n)&&!('value' in n)&&!('closed' in n)));
  assert.equal(root('filter payload->"key" = 1').node.state,'unsupported');
  assert.equal(root("filter alpha = 'amber'").node.state,'unsupported');
  assert.equal(root('filter alpha = "a\\\"b"').node.state,'unsupported');
  assert.equal(root('filter alpha = "a\\nb"').node.state,'complete');
});
test('calls own direct arguments and nested call nodes without reinterpreting commas inside strings',()=>{
  const text='alter alpha = concat(lowercase("a,b"), to_string(beta))',analysis=createAnalysis(text),index=analysis.expressions;
  const outer=index.nodes[index.byCall.get(text.indexOf('concat'))];
  assert.equal(outer.kind,'call');assert.equal(outer.state,'complete');assert.equal(outer.children.length,2);
  assert.deepEqual(outer.children.map(id=>index.nodes[id].kind),['call','call']);
  assert.equal(index.roots.filter(r=>r.purpose==='argument'&&r.ownerStart===text.indexOf('concat')).length,2);
  assert.equal(root('alter alpha = rand()').node.state,'complete');
  for(const text of ['alter alpha = concat(, beta)','alter alpha = concat(alpha,)','alter alpha = lowercase(alpha']) assert.equal(root(text).node.state,'incomplete',text);
});
test('membership lists and child queries are distinct nodes with independent query expression roots',()=>{
  const list=root('filter alpha not in (1, 2)');assert.equal(list.node.kind,'binary');assert.equal(list.node.state,'complete');assert.equal(list.index.nodes[list.node.children[1]].kind,'list');
  const query=root('filter alpha in (dataset xdr_data | alter beta = lowercase("amber") | fields beta)');
  const nested=query.index.nodes[query.node.children[1]];assert.equal(nested.kind,'subquery');assert.equal(nested.state,'complete');assert.notEqual(nested.queryId,query.node.queryId);
  assert.ok(query.index.roots.some(r=>r.queryId===nested.queryId&&r.purpose==='assignment'));
  assert.equal(root('filter alpha in ()').node.state,'unsupported');
  assert.equal(root('filter (alpha, beta)').node.state,'unsupported');
});
test('unsupported arithmetic/array/object/unknown-call productions stay explicit and quiet',()=>{
  for(const text of ['alter alpha = 1 + 2 * 3','alter alpha = [1, 2]','alter alpha = {"key":1}','filter alpha == 1','filter future_function(alpha) = 1','filter payload.lowercase(alpha) = 1']) {
    const {node}=root(text);assert.equal(node.state,'unsupported',text);assert.ok(!analyze(text).some(f=>Number(f.code.slice(3))>=400),text);
  }
  const text='alter alpha = 1 | fields alpha as beta | filter alpha = 1 or beta = 1';assert.ok(!analyze(text).some(f=>f.code==='XQL301'));
});
test('expression arenas have valid acyclic child IDs and UTF-16 full-document caret spans',()=>{
  const text='// 🗡\r\nfilter (payload.branch = lowercase("amber"))',analysis=createAnalysis(text),index=analysis.expressions;
  for(const node of index.nodes) {assert.ok(node.start>=0&&node.end<=text.length&&node.end>=node.start);assert.ok(node.children.every(id=>Number.isInteger(id)&&id>=0&&id<node.id));}
  const offset=text.indexOf('branch')+2,at=expressionAt(index,offset);assert.equal(at.kind,'name');assert.equal(text.slice(at.start,at.end),'branch');
  assert.equal(expressionAt(index,-1),undefined);assert.equal(expressionAt(index,NaN),undefined);
});
test('every corpus prefix recovers and explicit frame/node/work/root limits stop bounded analysis',()=>{
  for(const fixture of fixtures) for(let end=0;end<=fixture.query.length;end++) {const text=fixture.query.slice(0,end),index=buildExpressions(structure(text));for(const node of index.nodes) assert.ok(node.start>=0&&node.end<=end&&node.end>=node.start,fixture.id+':'+end);}
  for(const [limits,text] of [[{maxFrames:8},'filter '+'('.repeat(100)+'alpha'+')'.repeat(100)],[{maxNodes:10},'filter '+Array.from({length:100},(_,i)=>'a'+i).join(' and ')],[{maxWork:5},'filter alpha = beta and gamma = delta'],[{maxRoots:2},'alter alpha = concat(a,b,c,d)']]) {
    const index=buildExpressions(structure(text),limits);assert.equal(index.limited,true);assert.ok(index.nodes.length<=(limits.maxNodes??50000));assert.ok(index.roots.length<=(limits.maxRoots??20000));
  }
  for(const limits of [{maxFrames:0},{maxWork:Infinity},{maxNodes:-1}]) assert.throws(()=>buildExpressions(structure('filter true'),limits),RangeError);
  const deep=createAnalysis('filter '+'('.repeat(1000)+'alpha'+')'.repeat(1000));assert.equal(deep.expressions.limited,true);assert.deepEqual(deep.findings,[]);
  const wide=buildExpressions(structure('filter '+Array.from({length:100},(_,i)=>'a'+i+'.branch').join(' and ')),{maxNodes:200});assert.equal(wide.limited,true);assert.ok(wide.nodes.length<=200);
});
test('runtime expression spellings match reviewed facts and no binding powers are invented',()=>{
  const fact=facts.facts.find(f=>f.id==='comparison-expression-spellings');assert.deepEqual([...expressionOperators,'not'].sort(),[...fact.spellings].sort());
  assert.ok(facts.facts.every(f=>['unverified','explicitBoundary'].includes(f.precedence)&&f.associativity==='unverified'));
});
