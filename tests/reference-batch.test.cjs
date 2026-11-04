const {test}=require('node:test');
const assert=require('node:assert/strict');
const fixtures=require('./fixtures/reference-batch-01.json');
const {signatureHelp}=require('../.build/packages/core/signatures');
const {hover}=require('../.build/packages/core');
for(const fixture of fixtures) test(`reviewed batch 01: ${fixture.name} complete, nested and partial help`,()=>{
  const text='dataset = xdr_data | alter result = '+fixture.call;
  const offset=text.indexOf(fixture.name);
  const info=hover(text,offset);
  assert.equal(info.signature.name,fixture.name);
  assert.ok(info.signature.summary);
  assert.equal(signatureHelp(text,text.length),undefined);
  const help=signatureHelp(text,text.lastIndexOf(')'));
  const display=help.signatures[0];
  assert.deepEqual(display.parameters.map(p=>display.label.slice(...p.label)),fixture.labels);
  // A later explicit re-review may advance provenance without changing this shape.
  assert.ok(display.checked>='2026-10-25');
  for(let end=offset+fixture.name.length+1;end<text.length;end++) {
    const partial=signatureHelp(text.slice(0,end),end);
    assert.ok(partial);
    assert.ok(partial.activeParameter>=0 && partial.activeParameter<fixture.labels.length);
  }
  const nested=`alter result = concat(${fixture.call}, "z")`;
  assert.equal(signatureHelp(nested,nested.indexOf(fixture.name)+fixture.name.length+1).signatures[0].label.startsWith(fixture.name+'('),true);
});
