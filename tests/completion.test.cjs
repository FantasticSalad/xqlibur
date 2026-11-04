const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAnalysis,completionCandidates,localHover,completions}=require('../.build/packages/core');
function candidates(marked) {const offset=marked.indexOf('^'),text=marked.replace('^','');return {text,offset,items:completionCandidates(createAnalysis(text),offset)};}
const apply=(text,item)=>text.slice(0,item.replace.start)+item.insertText+text.slice(item.replace.end);

test('function suggestions retain reviewed notes without annotating colliding local fields',()=>{
  const availability=candidates('alter result = regexca^').items.find(item=>item.label==='regexcapture');
  assert.equal(availability.kind,'function');assert.match(availability.summary,/unavailable in interactive Query Builder queries/);
  const minimum=candidates('alter result = coale^').items.find(item=>item.label==='coalesce');
  assert.match(minimum.summary,/minimum argument count remains unverified/);
  const fields=candidates('alter regexcapture = "synthetic-private-value" | filter regexca^').items;
  const shadow=fields.find(item=>item.label==='regexcapture');
  assert.equal(shadow.kind,'field');assert.equal(shadow.summary,undefined);
  assert.ok(!JSON.stringify(fields).includes('synthetic-private-value'));
});

test('explicit edits replace full stage/function suffixes without adding punctuation',()=>{
  for(const [marked,name,expected,kind] of [
    ['dataset xdr_data | fil^ter alpha = 1','filter','dataset xdr_data | filter alpha = 1','stage'],
    ['alter alpha = low^ercase("amber")','lowercase','alter alpha = lowercase("amber")','function']
  ]) {
    const {text,items}=candidates(marked),item=items.find(i=>i.label===name);
    assert.ok(item);assert.equal(item.kind,kind);assert.equal(apply(text,item),expected);assert.equal(item.insertText,name);
  }
});

test('reviewed function contexts agree across typed and compatibility completion providers',()=>{
  for(const [marked,name,expected] of [
    ['alter result = av^g','avg',false],['filter av^g','avg',false],
    ['comp av^g','avg',true],['windowcomp av^g','avg',true],
    ['comp fi^rst','first',true],['windowcomp fi^rst','first',false],
    ['comp fi^rst_value','first_value',false],['windowcomp fi^rst_value','first_value',true],
    ['comp ro^w_number','row_number',false],['windowcomp ro^w_number','row_number',true],
    ['alter result = low^ercase','lowercase',true],['comp avg(low^ercase(source_value)) as result','lowercase',true],
    ['alter result = arraydis^tinct','arraydistinct',true]
  ]) {
    const result=candidates(marked);
    assert.equal(result.items.some(item=>item.kind==='function'&&item.label===name),expected,marked);
    assert.equal(completions(result.text,result.offset).some(item=>item.kind==='function'&&item.name===name),expected,'compatibility: '+marked);
  }
});

test('function context routing follows the child query and preserves colliding field candidates',()=>{
  for(const [marked,name,expected] of [
    ['join (comp av^g(source_value) as result) as child child.result = outer_value','avg',true],
    ['comp count() as total | union (alter result = av^g)','avg',false],
    ['comp count() as total | union (windowcomp ro^w_number() sort source_value as result)','row_number',true]
  ]) assert.equal(candidates(marked).items.some(item=>item.kind==='function'&&item.label===name),expected,marked);
  const collision=candidates('alter avg = 1 | filter av^g = 1').items;
  assert.equal(collision.filter(item=>item.label==='avg').length,1);
  assert.equal(collision.find(item=>item.label==='avg').kind,'field');
});

test('derived fields rank first and renamed/removed fields follow pipeline visibility',()=>{
  const {items}=candidates('alter alpha = 1, beta = 2 | fields alpha as gamma | filter ^');
  assert.equal(items[0].label,'gamma');assert.equal(items[0].kind,'field');
  assert.match(items[0].detail,/derived field/);
  assert.ok(!items.some(i=>['alpha','beta'].includes(i.label)));
  assert.ok(items.some(i=>i.label==='lowercase'&&i.kind==='function'));
  const overwritten=candidates('alter alpha = 1 | alter alpha = 2 | fields al^pha, beta');
  const alpha=overwritten.items.find(i=>i.label==='alpha');assert.ok(alpha);assert.equal(apply(overwritten.text,alpha),'alter alpha = 1 | alter alpha = 2 | fields alpha, beta');
  assert.ok(overwritten.items.every(i=>i.kind==='field'));
  assert.ok(!candidates('alter alpha = 1 | alter alpha = al^').items.some(i=>i.label==='alpha'));
});

test('write/source/options/comments/strings suppress function and field candidates',()=>{
  for(const marked of ['alter low^ercase = 1','alter alpha = 1, low^','fields alpha as low^','comp count() as low^','dataset xd^r_data','config case_sensitive = tr^ue','// low^','alter alpha = "low^"']) assert.deepEqual(candidates(marked).items,[],marked);
  assert.deepEqual(candidates('alter payload.br^anch = 1').items,[]);
});

test('observed candidates are qualified as uncertain and cannot reintroduce removed names',()=>{
  const {items}=candidates('filter observed = 1 | filter ob^');
  assert.equal(items[0].label,'observed');assert.match(items[0].detail,/presence unverified/);
  assert.ok(!candidates('alter alpha = 1 | fields - alpha | filter alpha = 1 and al^').items.some(i=>i.label==='alpha'));
  assert.ok(!candidates('filter ob^served = 1').items.some(i=>i.label==='observed'));
});

test('member edits retain qualifier, suffix and surrounding syntax',()=>{
  const {text,items}=candidates('alter payload.branch = 1 | filter payload.br^anch = 1');
  assert.deepEqual(items.map(i=>i.label),['branch']);
  assert.equal(apply(text,items[0]),'alter payload.branch = 1 | filter payload.branch = 1');
  assert.ok(items.every(i=>i.kind==='field'));
  assert.equal(candidates('alter payload.branch = 1 | filter payload. ^').items[0].insertText,'branch');
});

test('known predicate aliases offer independent child outputs and never double qualifiers',()=>{
  const {text,items}=candidates('alter outer_name = 1 | join (dataset xdr_data | alter child_name = 2 | fields child_name) as child child.ch^ild_name = outer_name');
  assert.deepEqual(items.map(i=>i.label),['child_name']);
  assert.equal(apply(text,items[0]),text);assert.ok(!items[0].insertText.includes('child.'));
  assert.deepEqual(candidates('alter outer_name = 1 | join (dataset xdr_data | filter ou^) as child child._time = _time').items.filter(i=>i.kind==='field'),[]);
  assert.deepEqual(candidates('join (dataset xdr_data | alter child_name = 2) as child child.child_name = _time | filter child.^').items,[]);
});

test('unknown member and JSON key contexts remain open without reference candidates',()=>{
  for(const marked of ['filter unknown.pa^th = 1','alter payload = 1 | filter payload->^','alter payload.branch = 1 | filter payload.branch->le^af = 1']) assert.deepEqual(candidates(marked).items,[]);
});

test('exact insertion dedup preserves case and distinct qualified paths',()=>{
  const {items}=candidates('alter alpha = 1, Alpha = 2, payload.branch = 3 | filter ^');
  assert.ok(items.some(i=>i.label==='alpha'));assert.ok(items.some(i=>i.label==='Alpha'));assert.ok(items.some(i=>i.label==='payload.branch'));
  assert.equal(new Set(items.map(i=>i.insertText)).size,items.length);
  const collision=candidates('alter lowercase = 1 | filter low^');
  assert.equal(collision.items.filter(i=>i.label==='lowercase').length,1);assert.equal(collision.items[0].kind,'field');
});

test('local hovers expose role/origin/confidence and never declaration values',()=>{
  const text='alter alpha = "synthetic-private-value" | filter alpha = 1',analysis=createAnalysis(text);
  const info=localHover(analysis,text.lastIndexOf('alpha'));
  assert.equal(info.role,'derived field');assert.equal(info.origin,'alter');assert.equal(info.certainty,'known');
  assert.ok(!JSON.stringify(info).includes('synthetic-private-value'));
  const duplicate='alter alpha = 1, alpha = 2';assert.equal(localHover(createAnalysis(duplicate),duplicate.indexOf('alpha')).certainty,'possible');
  const partial='alter alpha =';assert.equal(localHover(createAnalysis(partial),partial.indexOf('alpha')).certainty,'possible');
  assert.equal(localHover(analysis,text.indexOf('synthetic-private-value')),undefined);
});

test('completion edit ranges preserve UTF-16 CRLF and all partial edits recover',()=>{
  const marked='// 🗡\r\nalter alpha = 1 | filter al^pha = 1',result=candidates(marked),item=result.items.find(i=>i.label==='alpha');
  assert.equal(apply(result.text,item),result.text);
  for(let end=0;end<=result.text.length;end++) {
    const text=result.text.slice(0,end),items=completionCandidates(createAnalysis(text),end);
    for(const item of items) assert.ok(item.replace.start>=0&&item.replace.end<=text.length&&item.replace.start<=end);
  }
});
