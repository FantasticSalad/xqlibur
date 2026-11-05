const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fork}=require('node:child_process');
const {TextDocument}=require('vscode-languageserver-textdocument');
const {decode}=require('./semantic-protocol.cjs');
test('bundled LSP handles unsaved documents, changes, close, completion and hover',async t=>{
  const child=fork('dist/server.cjs',['--node-ipc'],{silent:true,windowsHide:true});
  t.after(()=>child.kill());
  let id=0;
  const requests=new Map(),notifications=[];
  child.on('message',message=>{
    if(message.id!==undefined) requests.get(message.id)?.(message);
    else notifications.push(message);
  });
  function request(method,params) {return new Promise((resolve,reject)=>{
    const current=++id;
    const timeout=setTimeout(()=>{requests.delete(current);reject(new Error('LSP request timeout: '+method));},5000);
    requests.set(current,message=>{clearTimeout(timeout);requests.delete(current);message.error?reject(message.error):resolve(message.result);});
    child.send({jsonrpc:'2.0',id:current,method,params});
  });}
  const notify=(method,params)=>child.send({jsonrpc:'2.0',method,params});
  const result=await request('initialize',{processId:process.pid,capabilities:{},rootUri:null});
  assert.equal(result.capabilities.positionEncoding,'utf-16');
  assert.deepEqual(result.capabilities.completionProvider.triggerCharacters,['.','>']);
  assert.ok(result.capabilities.signatureHelpProvider.triggerCharacters.includes('('));
  assert.ok(result.capabilities.semanticTokensProvider.legend.tokenTypes.includes('xqlDataset'));
  const legend=result.capabilities.semanticTokensProvider.legend;
  assert.deepEqual(legend.tokenTypes.slice(0,7),['keyword','function','property','variable','xqlDataset','number','operator']);
  assert.deepEqual(legend.tokenModifiers,['declaration','defaultLibrary']);
  notify('initialized',{});
  const uri='untitled:synthetic.xql';
  notify('textDocument/didOpen',{textDocument:{uri,languageId:'cortex-xql',version:1,text:'dataset = xdr_data | alter sample = )'}});
  const items=await request('textDocument/completion',{textDocument:{uri},position:{line:0,character:20}});
  assert.ok(items.some(i=>i.label==='filter'));
  notify('textDocument/didChange',{textDocument:{uri,version:2},contentChanges:[{text:'dataset = xdr_data | alter sample = lowercase("sample")'}]});
  const info=await request('textDocument/hover',{textDocument:{uri},position:{line:0,character:38}});
  assert.match(info.contents.value,/Supporting Documentation/);
  assert.doesNotMatch(info.contents.value,/\d{4}-\d{2}-\d{2}|checked|runtime behavior/);
  assert.ok(info.contents.value.includes('lowercase\\(string\\)'));
  const semantic=await request('textDocument/semanticTokens/full',{textDocument:{uri}});
  assert.ok(semantic.data.length>0);
  assert.equal(semantic.data.length%5,0);
  await new Promise(r=>setTimeout(r,400));
  const published=notifications.filter(n=>n.method==='textDocument/publishDiagnostics');
  assert.equal(published.at(-1).params.version,2);
  assert.deepEqual(published.at(-1).params.diagnostics,[]);
  assert.ok(!published.some(n=>n.params.version===1));
  const hintText='dataset = xdr_data | alter sample = json_extract_scalar("{}", ';
  notify('textDocument/didChange',{textDocument:{uri,version:3},contentChanges:[{text:hintText}]});
  const help=await request('textDocument/signatureHelp',{textDocument:{uri},position:{line:0,character:hintText.length}});
  assert.equal(help.activeParameter,1);
  assert.match(help.signatures[0].label,/json_path/);
  for(const signature of help.signatures) for(const parameter of signature.parameters) {
    assert.ok(Array.isArray(parameter.label));
    assert.ok(signature.label.slice(...parameter.label).length);
  }
  const complete='dataset = xdr_data | alter result = arrayfilter([3, 4], "@element" = 3)';
  notify('textDocument/didChange',{textDocument:{uri,version:4},contentChanges:[{text:complete}]});
  const multiple=await request('textDocument/signatureHelp',{textDocument:{uri},position:{line:0,character:complete.indexOf('"@element"')}});
  assert.equal(multiple.signatures.length,2);
  assert.equal(multiple.activeParameter,1);
  assert.equal(multiple.signatures[1].activeParameter,undefined);
  assert.deepEqual(multiple.signatures[1].parameters,[]);
  const rich=await request('textDocument/hover',{textDocument:{uri},position:{line:0,character:complete.indexOf('arrayfilter')+1}});
  for(const form of require('../reference/signatures.json').functions.find(f=>f.name==='arrayfilter').forms) {
    assert.ok(!rich.contents.value.includes(form.checked));
    assert.ok(rich.contents.value.includes(form.source));
  }
  assert.ok(rich.contents.value.includes('comparison value'));
  let version=4;
  for(const [text,word,expected] of [
    ['alter result = 1','alter',/Creates fields or changes existing field values/],
    ['alter result = json_extract_scalar(payload, "$.status")','json_extract_scalar',/Extracts a scalar value .* returns it as a string/],
    ['filter true','filter',/Keeps records where the condition is true/],
    ['alter result = if(true, 1, 0)','if',/Returns a value according/],
    ['alter result = 1 | filter result = 1','result',/Created or replaced by alter/]
  ]) {
    notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text}]});
    const response=await request('textDocument/hover',{textDocument:{uri},position:{line:0,character:text.indexOf(word)+1}});
    assert.match(response.contents.value,expected);
    assert.doesNotMatch(response.contents.value,/\d{4}-\d{2}-\d{2}|checked|Local analysis|source membership|runtime behavior|conditional_values/);
    if(word!=='result') assert.equal((response.contents.value.match(/Supporting Documentation/g)||[]).length,1);
    if(['alter','json_extract_scalar'].includes(word)) {
      const symbol=require('../reference/catalogue.json').symbols.find(symbol=>symbol.name===word);
      assert.ok(response.contents.value.includes(']('+symbol.source+')'));
    }
  }
  for(const [name,caveat] of [['coalesce',/minimum .*count remains unverified/],['arraycreate',/minimum .*count remains unverified/],['regexcapture',/unavailable in interactive Query Builder queries/]]) {
    const text='alter result = '+name+'()';
    notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text}]});
    const partial=await request('textDocument/hover',{textDocument:{uri},position:{line:0,character:text.indexOf(name)+1}});
    assert.match(partial.contents.value,caveat);
    const suggested=await request('textDocument/completion',{textDocument:{uri},position:{line:0,character:text.indexOf(name)+name.length}});
    const candidate=suggested.find(item=>item.label===name&&item.kind===3);
    assert.match(candidate.documentation.value,caveat);
    assert.ok(candidate.documentation.value.includes('\\.'));
    const help=await request('textDocument/signatureHelp',{textDocument:{uri},position:{line:0,character:text.lastIndexOf(')')}});
    for(const signature of help.signatures) {
      assert.match(signature.documentation.value,caveat);
      assert.ok(signature.documentation.value.includes('\\.'));
    }
  }
  for(const [text,available] of [
    ['alter result = av',false],['comp av',true],['windowcomp av',true],
    ['comp count() as total | union (alter result = av',false],
    ['join (comp av',true]
  ]) {
    notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text}]});
    const candidates=await request('textDocument/completion',{textDocument:{uri},position:{line:0,character:text.length}});
    const avg=candidates.find(item=>item.label==='avg');
    assert.equal(!!avg,available,text);
    if(avg) {
      const document=TextDocument.create(uri,'cortex-xql',version,text);
      assert.equal(TextDocument.applyEdits(document,[avg.textEdit]),text.slice(0,-2)+'avg');
    }
  }
  for(const text of ['alter result = rand()', 'comp count()', 'windowcomp row_number()']) {
    notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text}]});
    const empty=await request('textDocument/signatureHelp',{textDocument:{uri},position:{line:0,character:text.lastIndexOf(')')}});
    assert.ok(empty);
    assert.equal(empty.activeParameter,undefined);
    assert.deepEqual(empty.signatures[empty.activeSignature].parameters,[]);
  }
  const arrow='alter result = json_extract("{}", "$.branch")';
  notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text:arrow}]});
  const callOnly=await request('textDocument/signatureHelp',{textDocument:{uri},position:{line:0,character:arrow.lastIndexOf(')')}});
  assert.equal(callOnly.signatures.length,1);
  assert.ok(!callOnly.signatures[0].label.includes('->'));
  const noAggregate='alter result = avg(alpha)';
  notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text:noAggregate}]});
  assert.equal(await request('textDocument/signatureHelp',{textDocument:{uri},position:{line:0,character:noAggregate.lastIndexOf(')')}}),null);
  const classified='// 🗡\r\nconfig case_sensitive = true\r\n| dataset in (xdr_data, xdr_data)\r\n| alter note = "🗡", payload.branch = lowercase("amber")\r\n| join type = left (dataset xdr_data | fields _time) as child child._time = _time';
  notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text:classified}]});
  const encoded=await request('textDocument/semanticTokens/full',{textDocument:{uri}});
  const decoded=decode(classified,encoded,legend),document=TextDocument.create(uri,'cortex-xql',version,classified);
  const named=name=>{
    const position=document.positionAt(classified.indexOf(name));
    return decoded.find(t=>t.line===position.line&&t.character===position.character);
  };
  assert.equal(named('case_sensitive').type,'parameter');
  assert.equal(named('xdr_data').type,'xqlDataset');
  assert.equal(named('branch').type,'variable');
  assert.deepEqual(named('branch').modifiers,['declaration']);
  assert.deepEqual(named('lowercase').modifiers,['defaultLibrary']);
  assert.equal(named('type').type,'parameter');
  assert.equal(named('child').type,'namespace');
  assert.deepEqual(named('child').modifiers,['declaration']);
  assert.ok(!decoded.some(t=>t.line===0));
  const localText='// 🗡\r\nalter alpha = "synthetic-private-value", payload.branch = 1 | fields alpha as gamma, payload.branch | filter gaamma = 1';
  notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text:localText}]});
  const localDoc=TextDocument.create(uri,'cortex-xql',version,localText),caret=localText.indexOf('gaamma')+2;
  const localItems=await request('textDocument/completion',{textDocument:{uri},position:localDoc.positionAt(caret)});
  const gamma=localItems.find(i=>i.label==='gamma');assert.equal(gamma.kind,5);
  assert.equal(localDoc.getText(gamma.textEdit.range),'gaamma');assert.equal(gamma.textEdit.newText,'gamma');
  assert.equal(TextDocument.applyEdits(localDoc,[gamma.textEdit]),localText.replace('gaamma','gamma'));
  assert.ok(!localItems.some(i=>i.label==='alpha'));
  const localInfo=await request('textDocument/hover',{textDocument:{uri},position:localDoc.positionAt(localText.indexOf('gamma'))});
  assert.match(localInfo.contents.value,/derived field/);assert.ok(!localInfo.contents.value.includes('synthetic-private-value'));
  const memberText='alter payload.branch = 1 | filter payload.';
  notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text:memberText}]});
  const members=await request('textDocument/completion',{textDocument:{uri},position:{line:0,character:memberText.length},context:{triggerKind:2,triggerCharacter:'.'}});
  assert.deepEqual(members.map(i=>i.label),['branch']);assert.equal(members[0].textEdit.newText,'branch');
  const comparison='alter alpha = 1 | filter alpha >';
  notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text:comparison}]});
  assert.deepEqual(await request('textDocument/completion',{textDocument:{uri},position:{line:0,character:comparison.length},context:{triggerKind:2,triggerCharacter:'>'}}),[]);
  const resolvedText='alter alpha = arraymap(items, to_string("@element")) | filter alpha = 1';
  notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text:resolvedText}]});
  const resolvedTokens=decode(resolvedText,await request('textDocument/semanticTokens/full',{textDocument:{uri}}),legend);
  assert.deepEqual(resolvedTokens.filter(t=>t.text==='alpha').map(t=>[t.type,t.modifiers]),[['variable',['declaration']],['variable',[]]]);
  assert.deepEqual(resolvedTokens.filter(t=>t.text==='@element').map(t=>t.type),['parameter']);
  const editedText=resolvedText.replace('alter alpha','alter beta');
  notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text:editedText}]});
  assert.equal(decode(editedText,await request('textDocument/semanticTokens/full',{textDocument:{uri}}),legend).find(t=>t.text==='alpha').type,'property');
  const removedText='alter alpha = 1 | fields alpha as beta | filter alpha = 1';
  notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text:removedText}]});
  await new Promise(r=>setTimeout(r,300));
  const removedPublish=notifications.filter(n=>n.method==='textDocument/publishDiagnostics'&&n.params.uri===uri).at(-1);
  assert.equal(removedPublish.params.version,version);assert.equal(removedPublish.params.diagnostics.length,1);assert.equal(removedPublish.params.diagnostics[0].code,'XQL301');assert.equal(removedPublish.params.diagnostics[0].severity,2);
  const fixedText=removedText.replace('filter alpha','filter beta');
  notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text:fixedText}]});
  await new Promise(r=>setTimeout(r,300));
  const fixedPublish=notifications.filter(n=>n.method==='textDocument/publishDiagnostics'&&n.params.uri===uri).at(-1);
  assert.equal(fixedPublish.params.version,version);assert.deepEqual(fixedPublish.params.diagnostics,[]);
  const arityText='alter alpha = rand(1)';
  notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text:arityText}]});
  await new Promise(r=>setTimeout(r,300));
  const arityPublish=notifications.filter(n=>n.method==='textDocument/publishDiagnostics'&&n.params.uri===uri).at(-1);
  assert.equal(arityPublish.params.version,version);assert.equal(arityPublish.params.diagnostics.length,1);assert.equal(arityPublish.params.diagnostics[0].code,'XQL302');
  notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text:'alter alpha = rand()'}]});
  await new Promise(r=>setTimeout(r,300));
  assert.deepEqual(notifications.filter(n=>n.method==='textDocument/publishDiagnostics'&&n.params.uri===uri).at(-1).params.diagnostics,[]);
  for(const [call,bounds,expected,type] of [
    ['sum()','-null and 0',0,'property'],['sum()','+null and 0',0,'property'],
    ['sum()','null and -null',0,'property'],['sum()','null and 0',1,'variable'],
    ['sum(1)','null and 0',0,'variable']
  ]) {
    const text='alter alpha = 1 | windowcomp '+call+' sort alpha between '+bounds+' as rolling';
    notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text}]});
    const roles=decode(text,await request('textDocument/semanticTokens/full',{textDocument:{uri}}),legend);
    assert.equal(roles.find(token=>token.text==='rolling').type,type,text);
    await new Promise(resolve=>setTimeout(resolve,300));
    const published=notifications.filter(n=>n.method==='textDocument/publishDiagnostics'&&n.params.uri===uri).at(-1);
    assert.equal(published.params.version,version);
    assert.equal(published.params.diagnostics.filter(d=>d.code==='XQL302').length,expected,text);
  }
  const operatorText='filter source_field incidr ("synthetic-range")';
  for(const [text,expected] of [['alter result = array_all(items)',1],['alter result = array_all(items, 1)',0],['alter result = array_any(items, 1, 2)',1],['alter result = array_any(items, 1)',0],['alter result = arrayindexof(items)',0]]) {
    notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text}]});
    await new Promise(r=>setTimeout(r,300));
    const published=notifications.filter(n=>n.method==='textDocument/publishDiagnostics'&&n.params.uri===uri).at(-1);
    assert.equal(published.params.version,version);
    assert.equal(published.params.diagnostics.filter(d=>d.code==='XQL302').length,expected,text);
  }
  for(const [text,expected] of [['windowcomp rank(1) sort source_value as result',1],['windowcomp rank() sort source_value as result',0],['windowcomp lag(1, 2, 3, 4) as result over(partition by group_key order by order_value)',1],['windowcomp lag(1) as result over(partition by group_key order by order_value)',0]]) {
    notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text}]});
    await new Promise(r=>setTimeout(r,300));
    const published=notifications.filter(n=>n.method==='textDocument/publishDiagnostics'&&n.params.uri===uri).at(-1);
    assert.equal(published.params.version,version);
    assert.equal(published.params.diagnostics.filter(d=>d.code==='XQL302').length,expected,text);
  }
  for(const [text,expected] of [['comp avg() as result',1],['comp avg(1) as result',0],['windowcomp avg(1, 2) as result',1],['windowcomp avg(1) as result',0],['alter result = avg()',0],['alter result = pow(-2, 3, 4)',1],['alter result = pow(-2, 3)',0],['alter result = pow(-source_value, 3, 4)',0]]) {
    notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text}]});
    await new Promise(r=>setTimeout(r,300));
    const published=notifications.filter(n=>n.method==='textDocument/publishDiagnostics'&&n.params.uri===uri).at(-1);
    assert.equal(published.params.version,version);
    assert.equal(published.params.diagnostics.filter(d=>d.code==='XQL302').length,expected,text);
  }
  notify('textDocument/didChange',{textDocument:{uri,version:++version},contentChanges:[{text:operatorText}]});
  const operatorTokens=decode(operatorText,await request('textDocument/semanticTokens/full',{textDocument:{uri}}),legend);
  assert.equal(operatorTokens.find(t=>t.text==='incidr').type,'operator');
  assert.equal(await request('textDocument/signatureHelp',{textDocument:{uri},position:{line:0,character:operatorText.lastIndexOf(')')}}),null);
  const otherUri='untitled:second.xql';
  notify('textDocument/didOpen',{textDocument:{uri:otherUri,languageId:'cortex-xql',version:1,text:'fields branch'}});
  const secondTokens=await request('textDocument/semanticTokens/full',{textDocument:{uri:otherUri}});
  assert.equal(decode('fields branch',secondTokens,legend).find(t=>t.text==='branch').type,'property');
  notify('textDocument/didClose',{textDocument:{uri:otherUri}});
  assert.deepEqual(await request('textDocument/completion',{textDocument:{uri:otherUri},position:{line:0,character:0}}),[]);
  assert.equal(await request('textDocument/hover',{textDocument:{uri:otherUri},position:{line:0,character:7}}),null);
  assert.equal(await request('textDocument/signatureHelp',{textDocument:{uri:otherUri},position:{line:0,character:7}}),null);
  assert.deepEqual((await request('textDocument/semanticTokens/full',{textDocument:{uri:otherUri}})).data,[]);
  notify('textDocument/didOpen',{textDocument:{uri:otherUri,languageId:'cortex-xql',version:1,text:'alter branch = 4'}});
  const reopenedTokens=await request('textDocument/semanticTokens/full',{textDocument:{uri:otherUri}});
  assert.deepEqual(decode('alter branch = 4',reopenedTokens,legend).find(t=>t.text==='branch').modifiers,['declaration']);
  const freshText='alter fresh_name = 1 | filter fre';
  notify('textDocument/didChange',{textDocument:{uri:otherUri,version:2},contentChanges:[{text:freshText}]});
  const freshCandidates=await request('textDocument/completion',{textDocument:{uri:otherUri},position:{line:0,character:freshText.length}});
  assert.ok(freshCandidates.some(item=>item.label==='fresh_name'));
  assert.ok(!freshCandidates.some(item=>item.label==='branch'));
  notify('textDocument/didClose',{textDocument:{uri:otherUri}});
  const reopenedText='alter next_name = 1 | filter ne';
  notify('textDocument/didOpen',{textDocument:{uri:otherUri,languageId:'cortex-xql',version:1,text:reopenedText}});
  const reopenedCandidates=await request('textDocument/completion',{textDocument:{uri:otherUri},position:{line:0,character:reopenedText.length}});
  assert.ok(reopenedCandidates.some(item=>item.label==='next_name'));
  assert.ok(!reopenedCandidates.some(item=>['fresh_name','branch'].includes(item.label)));
  notify('textDocument/didClose',{textDocument:{uri:otherUri}});
  const guardedUri='untitled:evicted-version.xql',evictionUris=[];
  notify('textDocument/didOpen',{textDocument:{uri:guardedUri,languageId:'cortex-xql',version:1,text:'alter stale_name = rand(1)'}});
  await request('textDocument/semanticTokens/full',{textDocument:{uri:guardedUri}});
  await new Promise(resolve=>setTimeout(resolve,300));
  const guardedPublish=()=>notifications.filter(n=>n.method==='textDocument/publishDiagnostics'&&n.params.uri===guardedUri).at(-1).params;
  assert.ok(guardedPublish().diagnostics.some(finding=>finding.code==='XQL302'));
  for(let index=0;index<17;index++) {
    const evictUri='untitled:eviction-'+index+'.xql';evictionUris.push(evictUri);
    notify('textDocument/didOpen',{textDocument:{uri:evictUri,languageId:'cortex-xql',version:1,text:'fields field_'+index}});
    await request('textDocument/semanticTokens/full',{textDocument:{uri:evictUri}});
  }
  const changedSameVersion='alter fresh_name = 1';
  notify('textDocument/didChange',{textDocument:{uri:guardedUri,version:1},contentChanges:[{text:changedSameVersion}]});
  assert.deepEqual(await request('textDocument/completion',{textDocument:{uri:guardedUri},position:{line:0,character:changedSameVersion.length}}),[]);
  assert.deepEqual((await request('textDocument/semanticTokens/full',{textDocument:{uri:guardedUri}})).data,[]);
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(guardedPublish().version,1);assert.deepEqual(guardedPublish().diagnostics,[]);
  notify('textDocument/didChange',{textDocument:{uri:guardedUri,version:1},contentChanges:[{text:'alter another_name = 1'}]});
  assert.deepEqual(await request('textDocument/completion',{textDocument:{uri:guardedUri},position:{line:0,character:0}}),[]);
  assert.deepEqual(guardedPublish().diagnostics,[]);
  const recoveredText='alter fresh_name = 1 | filter fr';
  notify('textDocument/didChange',{textDocument:{uri:guardedUri,version:2},contentChanges:[{text:recoveredText}]});
  const recovered=await request('textDocument/completion',{textDocument:{uri:guardedUri},position:{line:0,character:recoveredText.length}});
  assert.ok(recovered.some(item=>item.label==='fresh_name'));
  assert.ok(!recovered.some(item=>['stale_name','another_name'].includes(item.label)));
  for(const closing of [guardedUri,...evictionUris]) notify('textDocument/didClose',{textDocument:{uri:closing}});
  notify('textDocument/didClose',{textDocument:{uri}});
  await request('shutdown',null);
  assert.deepEqual(notifications.filter(n=>n.method==='textDocument/publishDiagnostics').at(-1).params.diagnostics,[]);
  notify('exit');
});
