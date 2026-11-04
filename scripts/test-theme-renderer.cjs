const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const root=process.cwd();
if(!process.env.XQLIBUR_THEME_TEST_EXTENSIONS || !process.env.XQLIBUR_TEST_VSCODE_EXECUTABLE) throw Error('Set XQLIBUR_THEME_TEST_EXTENSIONS and XQLIBUR_TEST_VSCODE_EXECUTABLE');
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
const artifactRoot=fs.realpathSync(path.join(root,'artifacts'));
const themeDirectory=fs.realpathSync(process.env.XQLIBUR_THEME_TEST_EXTENSIONS);
const themeRelative=path.relative(artifactRoot,themeDirectory);
if(!themeRelative || themeRelative==='..' || themeRelative.startsWith('..'+path.sep) || path.isAbsolute(themeRelative)) throw Error('Theme directory must be inside this worktree artifacts directory');
const tmp=fs.mkdtempSync(path.join(root,'artifacts','render-probe-'));
const executable=process.env.XQLIBUR_TEST_VSCODE_EXECUTABLE;
const args=[tmp,'--user-data-dir',path.join(tmp,'user'),'--extensions-dir',themeDirectory,'--skip-welcome','--skip-release-notes','--disable-telemetry','--disable-updates','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--extensionDevelopmentPath='+root,'--extensionTestsPath='+path.join(root,'tests/theme-renderer-host.cjs')];
const child=spawn(executable,args,{windowsHide:true});let output='',port,ws,id=0,count=0,requests=new Map(),chain=Promise.resolve();
const expression=process.env.XQL_RENDER_CASE==='roles'
  ? `(()=>{let lines=[...document.querySelectorAll('.view-lines .view-line')];if(!lines.some(x=>x.textContent.includes('case_sensitive')))return null;return lines.flatMap(line=>[...line.querySelectorAll('span span')].map(x=>({text:x.textContent,color:getComputedStyle(x).color})));})()`
  : `(()=>{let lines=[...document.querySelectorAll('.view-lines .view-line')];let line=lines.find(x=>x.textContent.includes('xdr_data')&&x.textContent.includes('future_call'));if(!line)return null;return [...line.querySelectorAll('span span')].map(x=>({text:x.textContent,color:getComputedStyle(x).color}));})()`;
async function connect(){
  if(ws)return;
  for(let i=0;i<50;i++){
    try {const targets=await (await fetch('http://127.0.0.1:'+port+'/json')).json();const page=targets.find(t=>t.type==='page'&&t.url.includes('workbench'));
      if(page){const url=new URL(page.webSocketDebuggerUrl);if(url.hostname!=='127.0.0.1'||url.port!==port||url.protocol!=='ws:') throw Error('Unexpected debugger endpoint');
        ws=new WebSocket(url);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
        ws.onmessage=e=>{const msg=JSON.parse(e.data),pending=requests.get(msg.id);if(pending){requests.delete(msg.id);pending(msg)}};return;}}
    catch{} await new Promise(r=>setTimeout(r,100));
  }throw Error('Isolated renderer not found');
}
async function readStyles(label){
  await connect();const seq=++id;
  const reply=new Promise(resolve=>requests.set(seq,resolve));
  ws.send(JSON.stringify({id:seq,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));
  const result=await reply;if(result.error||result.result.exceptionDetails||!result.result.result.value)throw Error('No synthetic editor output '+label);
  const info=JSON.parse(label),spans=result.result.result.value;count++;
  if(info.theme==='Eclipse Dark'){
    const color=word=>spans.find(x=>x.text.includes(word))?.color;
    const expected=info.mode==='override'?'rgb(171, 205, 239)':'rgb(232, 133, 55)';
    if(color('dataset')!==expected) throw Error('Eclipse stage mismatch '+label+' '+color('dataset'));
    const call='rgb(167, 236, 33)';
    if(color('lowercase')!==call||color('future_call')!==call) throw Error('Eclipse function mismatch '+label);
    console.log('XQLSTYLE RESULT '+label+' stage='+color('dataset')+' known='+color('lowercase')+' unknown='+color('future_call'));
  }else if(process.env.XQL_RENDER_CASE==='roles'){
    const words=['case_sensitive','xdr_data','type','child','_time','output','arraymap','items','@element'];
    const values=Object.fromEntries(words.map(word=>[word,spans.find(x=>x.text.includes(word))?.color]));
    if(Object.values(values).some(x=>!x))throw Error('Missing rendered role '+label+' '+JSON.stringify(values));
    console.log('XQLSTYLE RESULT '+label+' '+JSON.stringify(values));
  }else console.log('XQLSTYLE RESULT '+label+' '+JSON.stringify(spans));
}
function input(chunk){
  const s=chunk.toString();output+=s;
  const p=output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);if(p)port=p[1];
  let i;while((i=output.indexOf('\n'))>=0){const line=output.slice(0,i);output=output.slice(i+1);if(/Error|Exception|XQLSTYLE/.test(line))console.log(line);const m=line.match(/XQLSTYLE READY (\{.*\})/);if(m)chain=chain.then(()=>readStyles(m[1])).catch(e=>{console.error(e);process.exitCode=1;child.kill();});}
}
child.stdout.on('data',input);child.stderr.on('data',input);
child.on('error',e=>{console.error(e);process.exitCode=1;});
child.on('exit',async code=>{try{await chain;ws?.close();const expected=process.env.XQL_RENDER_CASE==='eclipse'?6:16;if(code!==0 || process.exitCode || count!==expected)throw Error(`Isolated host exit ${code}; received ${count} of ${expected} cases`);console.log('XQLSTYLE complete; temporary directory retained: '+tmp);}catch(e){console.error(e);process.exitCode=1;}});
setTimeout(()=>{child.kill();console.error('XQLSTYLE timeout');process.exitCode=1;},120000).unref();
