const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fork}=require('node:child_process');
const {catalogue,createAnalysis,completionCandidates,analyze}=require('../.build/packages/core/index.js');
const {stageHelp}=require('../.build/packages/core/stage-help.js');
const {reference}=require('../.build/packages/core/reference.js');

const noDate=value=>assert.doesNotMatch(JSON.stringify(value),/\b\d{4}-\d{2}-\d{2}\b|Reference checked|· checked /);

test('every catalogued stage has sourced help and completion documentation',()=>{
  const candidates=completionCandidates(createAnalysis('dataset = xdr_data | '),21);
  for(const stage of catalogue.filter(s=>s.kind==='stage')) {
    const help=stageHelp(stage.name);
    assert.ok(help?.summary,stage.name);
    assert.equal(help.source,stage.source);
    assert.match(help.checked,/^\d{4}-\d{2}-\d{2}$/);
    assert.equal(candidates.find(c=>c.kind==='stage'&&c.label===stage.name)?.summary,help.summary);
  }
  assert.equal(stageHelp('toString'),undefined);
  assert.match(stageHelp('fields').summary,/Selects, excludes, or renames/);
  assert.match(stageHelp('view').summary,/displayed/);
  noDate(candidates);
  const findings=analyze('dataset = xdr_data | unknown_stage | alter result = unknown_function()');
  assert.ok(findings.some(f=>f.code==='XQL201'));
  assert.ok(findings.some(f=>f.code==='XQL202'));
  noDate(findings);
});

test('bundled server hides provenance dates in all reference help and diagnostics',async t=>{
  const child=fork('dist/server.cjs',['--node-ipc'],{silent:true,windowsHide:true});
  t.after(()=>child.kill());
  let id=0,version=1;
  const pending=new Map(),notifications=[];
  child.on('message',message=>{
    if(message.id!==undefined) pending.get(message.id)?.(message);
    else notifications.push(message);
  });
  function request(method,params) {return new Promise((resolve,reject)=>{
    const current=++id,timer=setTimeout(()=>reject(new Error(method+' timed out')),5000);
    pending.set(current,message=>{clearTimeout(timer);pending.delete(current);message.error?reject(message.error):resolve(message.result);});
    child.send({jsonrpc:'2.0',id:current,method,params});
  });}
  const notify=(method,params)=>child.send({jsonrpc:'2.0',method,params});
  const uri='untitled:reference-help.xql';
  await request('initialize',{processId:process.pid,capabilities:{},rootUri:null});
  notify('initialized',{});
  notify('textDocument/didOpen',{textDocument:{uri,languageId:'cortex-xql',version,text:''}});
  const change=text=>notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text}]});
  const at=character=>({textDocument:{uri},position:{line:0,character}});
  for(const symbol of catalogue) {
    const text=symbol.kind==='stage'?symbol.name+' ': 'alter result = '+symbol.name+'()';
    change(text);
    const hover=await request('textDocument/hover',at(text.indexOf(symbol.name)+1));
    assert.ok(hover,symbol.name);
    noDate(hover);
    assert.match(hover.contents.value,/Supporting Documentation/);
    if(symbol.kind==='stage') assert.ok(hover.contents.value.replaceAll('\\','').includes(stageHelp(symbol.name).summary),symbol.name);
  }
  // Probe every reviewed call form in a permitted stage, including forms with
  // different internal checked dates and incomplete/overloaded argument hints.
  for(const fact of reference) for(const form of fact.forms) {
    if(form.invocation==='infix') continue;
    const stage=form.contexts.includes('expression')?'alter result = ':form.contexts[0]+' ';
    const text=stage+fact.name+'(';
    change(text);
    const help=await request('textDocument/signatureHelp',at(text.length));
    assert.ok(help,fact.name+':'+form.id);
    noDate(help);
  }
  for(const text of ['dataset = xdr_data | ','alter result = ']) {
    change(text);
    const choices=await request('textDocument/completion',at(text.length));
    assert.ok(choices.length);
    noDate(choices);
    if(text.endsWith('| ')) for(const choice of choices.filter(c=>c.kind===14)) assert.ok(choice.documentation?.value,choice.label);
  }
  change('dataset = xdr_data | unknown_stage | alter result = unknown_function()');
  for(let attempt=0;attempt<30&&!notifications.some(n=>n.method==='textDocument/publishDiagnostics'&&n.params.version===version);attempt++) await new Promise(resolve=>setTimeout(resolve,25));
  const diagnostics=notifications.find(n=>n.method==='textDocument/publishDiagnostics'&&n.params.version===version)?.params.diagnostics;
  assert.ok(diagnostics?.some(d=>d.code==='XQL201'));
  assert.ok(diagnostics?.some(d=>d.code==='XQL202'));
  noDate(diagnostics);
  await request('shutdown',null);
  notify('exit',null);
});
