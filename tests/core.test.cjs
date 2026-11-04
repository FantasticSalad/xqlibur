const {test}=require('node:test');
const assert=require('node:assert/strict');
const {scan,analyze,completions,hover,catalogue,MAX_LENGTH}=require('../.build/packages/core');

for(const text of [
  'dataset = xdr_data | filter true | limit 1',
  'dataset = xdr_data | alter sample = "a|b // c /* d */"',
  "dataset = xdr_data | alter sample = 'a\\\'b'",
  'dataset = xdr_data | alter sample = """line\n| // literal"""',
  'dataset = xdr_data /* [({ */ | filter true // ]}',
  'dataset = xdr_data | join (dataset = xdr_data | limit 1) as sample sample._time = _time',
  'dataset = xdr_data | filter _time in (1, 2)',
  'dataset = xdr_data | alter sample = arraymap(arraycreate(1), "@element")',
]) test(`valid synthetic query: ${JSON.stringify(text)}`,()=>assert.deepEqual(analyze(text),[]));

for(const [tail,code] of [['"open','XQL101'],['/* open','XQL102'],[')','XQL103'],['(','XQL104']]) {
  test(`structural finding ${code}`,()=>assert.ok(analyze('dataset = xdr_data | alter sample = '+tail).some(f=>f.code===code&&f.severity==='error')));
}
test('future names are warnings with exact ranges',()=>{
  const text='dataset = xdr_data | future_stage sample = future_function(1)';
  const findings=analyze(text);
  assert.equal(findings.length,2);
  assert.ok(findings.every(f=>f.severity==='warning'));
  assert.equal(text.slice(findings[1].start,findings[1].end),'future_function');
});
test('UTF-16 ranges survive CRLF and non-BMP characters',()=>{
  const text='// 🗡\r\ndataset = xdr_data\r\n| alter sample = )';
  const finding=analyze(text).find(f=>f.code==='XQL103');
  assert.equal(finding.start,text.lastIndexOf(')'));
});
test('comment and string token boundaries',()=>{
  const tokens=scan('"//" /* | */ filter');
  assert.deepEqual(tokens.map(t=>t.kind),['string','comment','identifier']);
  assert.equal(tokens[2].text,'filter');
});
test('entry completion is limited to query entry points',()=>{
  assert.deepEqual(completions('',0).map(s=>s.name).sort(),['cold_dataset','config','datamodel','dataset','preset']);
});
test('pipeline completion filters the typed prefix',()=>{const text='dataset = xdr_data | fil'; assert.deepEqual(completions(text,text.length).map(s=>s.name),['filter']);});
test('expression completion offers functions',()=>assert.ok(completions('dataset = xdr_data | alter sample = ',35).some(s=>s.name==='lowercase')));
for(const text of ['// lower','/* lower','"lower',"'lower",'"""lower']) {
  test(`no completion inside literal ${JSON.stringify(text)}`,()=>assert.deepEqual(completions(text,text.length),[]));
}
test('completion resumes after closing a string',()=>{const text='dataset = xdr_data | alter sample = "a" '; assert.ok(completions(text,text.length).length);});
test('completion resumes after a comment newline',()=>{const text='// lower\r\n'; assert.ok(completions(text,text.length).length);});
test('hover contains only catalogue content',()=>{
  const result=hover('dataset = xdr_data | alter sample = lowercase("synthetic")',37);
  assert.equal(result.symbol.name,'lowercase');
  assert.ok(result.symbol.source.startsWith('https://cortex-docs.paloaltonetworks.com/'));
  assert.equal(hover('// lowercase()',5),undefined);
});
test('large documents degrade explicitly',()=>{
  const text=' '.repeat(MAX_LENGTH+1);
  assert.equal(analyze(text)[0].code,'XQL000');
  assert.deepEqual(completions(text,0),[]);
  assert.equal(hover(text,0),undefined);
});
test('bounded diagnostic count and deep nesting',()=>{
  assert.equal(analyze(')'.repeat(10000)).length,100);
  assert.equal(analyze('('.repeat(10000)).at(-1).code,'XQL000');
});
test('catalogue is unique and restricted to official HTTPS sources',()=>{
  const keys=catalogue.map(s=>s.kind+':'+s.name);
  assert.equal(new Set(keys).size,keys.length);
  assert.ok(catalogue.length>140);
  for(const s of catalogue) {
    assert.match(s.name,/^[a-z][a-z0-9_]*$/);
    const url=new URL(s.source);
    assert.equal(url.protocol,'https:');
    assert.ok(['cortex-docs.paloaltonetworks.com','docs-cortex.paloaltonetworks.com'].includes(url.hostname));
  }
});
