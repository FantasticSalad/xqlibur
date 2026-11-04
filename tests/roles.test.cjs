const {test}=require('node:test');
const assert=require('node:assert/strict');
const {structure,contextAt,parse,MAX_LENGTH,analyze}=require('../.build/packages/core');
const role=(doc,text,last=false)=>doc.roles.find(r=>r.start===(last?doc.text.lastIndexOf(text):doc.text.indexOf(text)));

test('query IDs isolate nested same-spelled assignments and preserve parent links',()=>{
  const text='dataset xdr_data | alter alpha = 3 | join type = left (dataset xdr_data | alter alpha = 4) as child child.alpha = alpha';
  const doc=structure(text);
  assert.equal(doc.tree.queries.length,2);
  const [parent,child]=doc.tree.queries;
  assert.equal(child.parentId,parent.id);
  assert.equal(doc.assignments.length,2);
  assert.notEqual(doc.assignments[0].queryId,doc.assignments[1].queryId);
  assert.equal(doc.queryAliases[0].childQueryId,child.id);
  assert.equal(role(doc,'child').type,'namespace');
  assert.equal(role(doc,'child').declaration,true);
  assert.equal(role(doc,'child',true).type,'namespace');
  assert.deepEqual(analyze(text),[]);
});
test('dotted LHS retains the entire path; comparisons, options and inner predicates do not declare fields',()=>{
  const text='dataset = xdr_data | alter payload.branch = arrayfilter(items, "@element" -> active = true), beta = 4 | filter beta = 4 | join type = left (dataset = xdr_data) as child child.beta = beta';
  const doc=structure(text);
  assert.deepEqual(doc.assignments.map(a=>a.path.components.map(t=>t.text)),[['payload','branch'],['beta']]);
  assert.equal(text.slice(doc.assignments[0].path.start,doc.assignments[0].path.end),'payload.branch');
  assert.equal(role(doc,'branch').declaration,true);
  assert.equal(role(doc,'payload').type,'property');
  assert.equal(role(doc,'active').declaration,false);
  assert.equal(role(doc,'type').type,'parameter');
  assert.equal(role(doc,'beta',true).declaration,false);
});
test('field-list aliases, exclusion and wildcards have explicit complete paths',()=>{
  const doc=structure('dataset = xdr_data | fields payload.filter as beta, action_*, * | fields - beta, payload.branch');
  const [include,exclude]=doc.fieldLists;
  assert.equal(include.complete,true);
  assert.equal(include.entries[0].alias.text,'beta');
  assert.deepEqual(include.entries[0].path.components.map(t=>t.text),['payload','filter']);
  assert.equal(include.entries[1].path.wildcard,true);
  assert.equal(include.entries[2].path.wildcard,true);
  assert.equal(exclude.exclude,true);
  assert.equal(role(doc,'filter').type,'property');
  assert.equal(role(doc,'beta').declaration,true);
});
test('source clauses cover optional equals, lists, cold source, XDM, presets and saved queries',()=>{
  for(const [text,kind,names] of [
    ['dataset xdr_data','dataset',['xdr_data']],
    ['dataset in (xdr_data, xdr_data)','dataset',['xdr_data','xdr_data']],
    ['cold_dataset = xdr_data','cold_dataset',['xdr_data']],
    ['datamodel dataset = xdr_data','datamodel',['xdr_data']],
    ['preset = authentication_story','preset',['authentication_story']],
    ['call synthetic_saved_query','savedQuery',['synthetic_saved_query']]
  ]) {
    const doc=structure(text), source=doc.sources[0];
    assert.equal(source.kind,kind,text);assert.equal(source.complete,true,text);
    assert.deepEqual(source.names.map(t=>t.text),names,text);
    assert.equal(role(doc,names[0]).type,['preset','savedQuery'].includes(kind)?'namespace':'xqlDataset');
  }
  assert.equal(structure('filter true').sources[0].kind,'implicit');
  assert.equal(structure('datamodel').sources[0].complete,false);
  assert.equal(structure('view graph type = pie xaxis = alpha yaxis = beta').sources[0].kind,'implicit');
});
test('aggregate aliases and both window forms retain field-list and option roles',()=>{
  const doc=structure('dataset = xdr_data | comp count() as total by alpha | windowcomp avg(total) by alpha sort desc beta between null and 0 frame_type = rows as rolling');
  assert.deepEqual(doc.outputs.map(o=>[o.name.text,o.complete]),[['total',true],['rolling',true]]);
  assert.deepEqual(doc.fieldLists.map(f=>[f.kind,f.entries.map(e=>e.path.components.map(t=>t.text).join('.'))]),[['group',['alpha']],['group',['alpha']],['sort',['beta']]]);
  assert.equal(role(doc,'frame_type').type,'parameter');
  const alternate=structure('windowcomp lag(alpha) as previous over(partition by beta order by gamma desc)');
  assert.ok(!alternate.tree.calls.some(c=>c.name.text==='over'));
  assert.equal(role(alternate,'over').type,'keyword');
  assert.equal(role(alternate,'partition').type,'keyword');
  assert.equal(role(alternate,'order').type,'keyword');
  assert.deepEqual(alternate.fieldLists.map(f=>f.kind),['group','sort']);
  assert.ok(alternate.fieldLists.every(f=>f.complete));
});
test('partial assignment values and multi-token option values keep full document spans',()=>{
  const text='alter alpha = concat("amber", ';
  const doc=structure(text);
  assert.equal(doc.assignments[0].complete,false);
  assert.equal(doc.assignments[0].value.end,text.length);
  const config=structure('config timeframe = 3d');
  assert.equal(config.text.slice(config.options[0].value.start,config.options[0].value.end),'3d');
  assert.equal(config.roles.find(r=>config.text.slice(r.start,r.end)==='d').type,'constant');
});
test('member calls never inherit built-in identities',()=>{
  const doc=structure('alter alpha = payload.lowercase(3) + payload.filter + payload -> true');
  assert.ok(!doc.tree.calls.some(c=>c.name.text==='lowercase'));
  for(const name of ['lowercase','filter','true']) assert.equal(role(doc,name).type,'property');
});
test('argument spans retain empty/trailing slots and ignore nested commas',()=>{
  const text='alter alpha = concat(lowercase("a,b"), [3, 4], )';
  const call=parse(text).calls[0];
  assert.deepEqual(call.arguments.map(a=>text.slice(a.start,a.end)),['lowercase("a,b")',' [3, 4]',' ']);
});
test('callback metadata belongs to the innermost reviewed argument and never crosses query scope',()=>{
  const text='alter alpha = arraymap(items, concat("@element", arraymap(items, to_string("@element")))) | alter beta = "@element"';
  const doc=structure(text);
  assert.equal(doc.placeholders.length,2);
  assert.notEqual(doc.placeholders[0].ownerCallStart,doc.placeholders[1].ownerCallStart);
  for(const p of doc.placeholders) assert.equal(text.slice(p.start,p.end),'@element');
  assert.ok(!doc.roles.some(r=>text.slice(r.start,r.end).includes('@element')));
  const nested=structure('alter alpha = arraymap(items, (dataset xdr_data | alter beta = "@element"))');
  assert.deepEqual(nested.placeholders,[]);
});
for(const [marked,kind,replacement,qualifier] of [
  ['dataset = xdr_data | fil^ter alpha = 3','stage','filter'],
  ['alter alpha = low^ercase("amber")','expression','lowercase'],
  ['alter alpha = child.pa^th','member','path',['child']],
  ['fields payload.fi^lter, alpha','member','filter',['payload']],
  ['alter alpha = child. ^','member','',['child']],
  ['dataset = xd^r_data | fields alpha','source','xdr_data'],
  ['fields al^pha as beta','fieldList','alpha'],
  ['join ty^pe = left (dataset xdr_data) as child child.alpha = alpha','stageOption','type'],
  ['alter alpha = "am^ber"','string',''],
  ['// am^ber','comment','']
]) test(`full-document cursor context: ${marked}`,()=>{
  const offset=marked.indexOf('^'),text=marked.replace('^',''),doc=structure(text),context=contextAt(doc,offset);
  assert.equal(context.kind,kind);
  assert.equal(text.slice(context.replace.start,context.replace.end),replacement);
  if(qualifier) assert.deepEqual(context.qualifier,qualifier);
});
test('UTF-16, partial paths, malformed input and limits retain bounded roles',()=>{
  const text='// 🗡\r\ndataset xdr_data | alter payload.branch = 4 | fields payload.';
  const doc=structure(text);
  assert.equal(role(doc,'branch').start,text.indexOf('branch'));
  assert.equal(contextAt(doc,text.length).kind,'member');
  for(let end=0;end<=text.length;end++) {
    const part=text.slice(0,end),current=structure(part);
    for(const r of current.roles) assert.ok(r.start>=0&&r.end<=end&&r.end>r.start);
    assert.ok(contextAt(current,end).replace.end<=end);
  }
  for(const value of ['('.repeat(5000),' '.repeat(MAX_LENGTH+1)]) {
    const current=structure(value);assert.equal(current.tree.limited,true);assert.deepEqual(current.roles,[]);
    assert.equal(contextAt(current,value.length).kind,'unsupported');
  }
  for(const offset of [-1,NaN,100000]) assert.equal(contextAt(doc,offset).kind,'unsupported');
});
