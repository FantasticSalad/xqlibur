const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {signatureHelp}=require('../.build/packages/core/signatures');
const {hover}=require('../.build/packages/core');
for(const file of fs.readdirSync('tests/fixtures').filter(f=>/^reviewed-reference-\d+\.json$/.test(f))) {
  const fixtures=JSON.parse(fs.readFileSync('tests/fixtures/'+file,'utf8'));
  for(const fixture of fixtures) test(`${file}: ${fixture.name} reviewed help and recovery`,()=>{
    const text='dataset = xdr_data | '+(fixture.stage??'alter result =')+' '+fixture.call;
    const offset=text.indexOf(fixture.name+'('), open=offset+fixture.name.length+1;
    const info=hover(text,offset);
    assert.equal(info.signature.name,fixture.name);
    if(fixture.blocked) {
      assert.equal(info.signature.status,'blocked');
      assert.deepEqual(info.signature.forms,[]);
      assert.equal(signatureHelp(text,open),undefined);
      return;
    }
    const help=signatureHelp(text,text.lastIndexOf(')'));
    assert.ok(help);
    const display=help.signatures[help.activeSignature];
    assert.deepEqual(display.parameters.map(p=>display.label.slice(...p.label)),fixture.labels);
    assert.ok(display.checked>='2026-10-25');
    if(fixture.infix) {
      assert.ok(info.signature.forms.some(f=>f.invocation==='infix'&&f.syntaxLabel===fixture.infix));
      assert.ok(!help.signatures.some(s=>s.label===fixture.infix));
    }
    for(let end=open;end<text.length;end++) {
      const partial=signatureHelp(text.slice(0,end),end);
      // A nested unknown call must suppress outer hints; otherwise all indexes
      // must remain valid for their own selected form through partial edits.
      if(partial) for(const signature of partial.signatures) {
        if(signature.parameters.length) assert.ok(signature.activeParameter>=0&&signature.activeParameter<signature.parameters.length);
        else assert.equal(signature.activeParameter,undefined);
      }
    }
    const nested=`alter result = concat(${fixture.call}, "ash")`;
    if(!fixture.stage) assert.ok(signatureHelp(nested,nested.indexOf(fixture.name+'(')+fixture.name.length+1));
    assert.equal(signatureHelp(text+' // comment',text.length+5),undefined);
  });
}
