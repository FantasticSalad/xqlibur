const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAnalysis,parse,hover,signatureHelp}=require('../.build/packages/core');
const {semanticTokens}=require('../.build/packages/core/semantic');
test('word operators with parenthesized right operands are not calls or signature sites',()=>{
  for(const operator of ['incidr','incidr6','contains','not incidr','not incidr6','not contains']) {
    const text='filter source_field '+operator+' ("synthetic-range")',analysis=createAnalysis(text),name=operator.split(' ').at(-1);
    assert.ok(!analysis.structure.tree.calls.some(c=>c.name.text===name),operator);
    assert.equal(signatureHelp(text,text.lastIndexOf(')')),undefined,operator);
    assert.equal(hover(text,text.indexOf(name)),undefined,operator);
    assert.equal(semanticTokens(text,analysis).find(t=>t.start===text.indexOf(name)).type,'operator',operator);
    assert.deepEqual(analysis.findings,[],operator);
  }
});
test('CIDR functions retain genuine call syntax at operand positions and under unary not',()=>{
  for(const text of ['alter result = incidr(source_field, "synthetic-range")','filter incidr6(source_field, "synthetic-range")','filter not incidr(source_field, "synthetic-range")','alter result = if(incidr(source_field, "synthetic-range"), 1, 0)']) {
    const name=text.includes('incidr6')?'incidr6':'incidr',tree=parse(text);
    assert.ok(tree.calls.some(c=>c.name.text===name),text);
    const offset=text.indexOf(name),inside=tree.calls.find(c=>c.name.text===name).open.end;
    assert.equal(hover(text,offset).symbol.name,name);assert.ok(signatureHelp(text,inside));
    assert.equal(semanticTokens(text).find(t=>t.start===offset).type,'function');
  }
});
test('member/literal/closed-group left operands and nested queries retain operator context',()=>{
  for(const left of ['payload.not','payload.in','"synthetic-address"','(source_field)','lowercase(source_field)']) {
    const text='filter '+left+' not incidr ("synthetic-range")';assert.ok(!parse(text).calls.some(c=>c.name.text==='incidr'),left);
  }
  const text='join (dataset xdr_data | filter source_field incidr ("synthetic-range")) as child child._time = _time';
  assert.ok(!parse(text).calls.some(c=>c.name.text==='incidr'));
});
test('every operator/function edit prefix retains bounded recovery and direct call arguments',()=>{
  for(const text of ['filter source_field not incidr ("synthetic-range")','alter result = incidr(source_field, "synthetic-range")']) for(let end=0;end<=text.length;end++) {
    const partial=text.slice(0,end),tree=parse(partial);for(const call of tree.calls) assert.ok(call.name.start>=0&&call.end<=partial.length);
    createAnalysis(partial);
  }
});
