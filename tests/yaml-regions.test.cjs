const {test}=require('node:test');
const assert=require('node:assert/strict');
const {TextDocument}=require('vscode-languageserver-textdocument');
const {fork}=require('node:child_process');
const {xqlRegions}=require('../.build/packages/language-server/yaml-regions.js');

test('literal XQL regions exclude other YAML and map UTF-16 CRLF positions',()=>{
  const source='note: |\r\n  xql: |\r\nxql: |\r\n  dataset = xdr_data\r\n  | alter emoji = "🗡", value = rand(1)\r\nlabel: ordinary\r\ninvestigate:\r\n  - xql: |-\r\n      dataset = xdr_data\r\n      | filter value = 1\r\n';
  const document=TextDocument.create('untitled:synthetic.yaml','yaml',1,source);
  const regions=xqlRegions(document);
  assert.equal(regions.length,2);
  assert.equal(regions[0].document.getText(),'dataset = xdr_data\n| alter emoji = "🗡", value = rand(1)');
  assert.equal(regions[0].at({line:2,character:3}),undefined);
  assert.equal(regions[0].at({line:4,character:2}),regions[0].document.offsetAt({line:1,character:0}));
  assert.deepEqual(regions[0].position(regions[0].document.getText().indexOf('rand')),{line:4,character:32});
  assert.equal(regions[1].document.getText(),'dataset = xdr_data\n| filter value = 1\n');
  assert.equal(regions[1].at({line:5,character:7}),undefined);
});

test('only literal plain xql keys are analyzed',()=>{
  const text='xql: >\n  dataset = xdr_data\nxql: "dataset = xdr_data"\nother: |\n  xql: |\nxql: |\n  filter foo = 1\n';
  const document=TextDocument.create('untitled:synthetic.yaml','yaml',1,text);
  assert.deepEqual(xqlRegions(document).map(region=>region.document.getText()),['filter foo = 1\n']);
});

test('bundled LSP serves independent YAML XQL blocks and leaves ordinary YAML alone',async t=>{
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
    const timer=setTimeout(()=>reject(new Error('LSP timeout: '+method)),5000);
    requests.set(current,message=>{clearTimeout(timer);requests.delete(current);message.error?reject(message.error):resolve(message.result);});
    child.send({jsonrpc:'2.0',id:current,method,params});
  });}
  const notify=(method,params)=>child.send({jsonrpc:'2.0',method,params});
  await request('initialize',{processId:process.pid,capabilities:{},rootUri:null});
  notify('initialized',{});
  const uri='untitled:synthetic.yaml';
  let source='name: fi\r\nxql: |\r\n  dataset = xdr_data\r\n  | fi\r\ninvestigate:\r\n  - xql: |\r\n      alter value = rand(1)\r\n';
  notify('textDocument/didOpen',{textDocument:{uri,languageId:'yaml',version:1,text:source}});
  assert.deepEqual(await request('textDocument/completion',{textDocument:{uri},position:{line:0,character:7}}),[]);
  const choices=await request('textDocument/completion',{textDocument:{uri},position:{line:3,character:6}});
  const filter=choices.find(item=>item.label==='filter');
  assert.ok(filter);
  const document=TextDocument.create(uri,'yaml',1,source);
  assert.equal(TextDocument.applyEdits(document,[filter.textEdit]),source.replace('| fi','| filter'));
  const stage=await request('textDocument/hover',{textDocument:{uri},position:{line:2,character:4}});
  assert.match(stage.contents.value,/Public documentation/);
  assert.deepEqual(stage.range,{start:{line:2,character:2},end:{line:2,character:9}});
  assert.equal(await request('textDocument/hover',{textDocument:{uri},position:{line:0,character:2}}),null);
  await new Promise(resolve=>setTimeout(resolve,300));
  const findings=notifications.filter(message=>message.method==='textDocument/publishDiagnostics').at(-1).params;
  assert.equal(findings.version,1);
  assert.equal(findings.diagnostics.filter(d=>d.code==='XQL302').length,1);
  assert.equal(findings.diagnostics.find(d=>d.code==='XQL302').range.start.line,6);
  source=source.replace('rand(1)','rand()').replace('| fi','| filter value = 1');
  notify('textDocument/didChange',{textDocument:{uri,version:2},contentChanges:[{text:source}]});
  const help=await request('textDocument/signatureHelp',{textDocument:{uri},position:{line:6,character:25}});
  assert.ok(help);
  assert.match(help.signatures[0].label,/rand/);
  await new Promise(resolve=>setTimeout(resolve,300));
  const updated=notifications.filter(message=>message.method==='textDocument/publishDiagnostics').at(-1).params;
  assert.equal(updated.version,2);
  assert.deepEqual(updated.diagnostics,[]);
  const recovered=source.replace('| filter value = 1','| fi');
  notify('textDocument/didChange',{textDocument:{uri,version:2},contentChanges:[{text:recovered}]});
  assert.deepEqual(await request('textDocument/completion',{textDocument:{uri},position:{line:3,character:6}}),[]);
  notify('textDocument/didChange',{textDocument:{uri,version:3},contentChanges:[{text:recovered}]});
  assert.ok((await request('textDocument/completion',{textDocument:{uri},position:{line:3,character:6}})).some(item=>item.label==='filter'));
});
