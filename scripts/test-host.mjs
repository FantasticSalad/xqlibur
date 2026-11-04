import {downloadAndUnzipVSCode} from '@vscode/test-electron';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {unzipSync} from 'fflate';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHostDirectory} from './host-temp.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const hostDirectory=await createHostDirectory(),isolated=hostDirectory.path;
let extensionPath=root;
if(process.argv.includes('--package')) {
  const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const entries=unzipSync(await readFile(path.join(root,'artifacts',`xqlibur-${manifest.version}.vsix`)));
  const allowed=new Set(['[Content_Types].xml','extension.vsixmanifest',...['LICENSE.txt','PRIVACY.md','images/icon.png','THIRD_PARTY_NOTICES.md','changelog.md','language-configuration.json','package.json','readme.md','dist/extension.cjs','dist/server.cjs','dist/THIRD_PARTY_LICENSES.txt','reference/catalogue.json','reference/signatures.json','snippets/xql.json','syntaxes/xql.tmLanguage.json','syntaxes/yaml-injection.tmLanguage.json','docs/parser.md'].map(p=>'extension/'+p)]);
  for(const [name,bytes] of Object.entries(entries)) {
    if(name.endsWith('/')) continue;
    assert.ok(allowed.delete(name),`Unexpected packaged file: ${name}`);
    if(name.endsWith('.png')) {
      // Compressed pixels can resemble path text, so check structure instead:
      // only image-data chunks, so no text, metadata or path can be carried.
      assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10],`Invalid PNG: ${name}`);
      const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      for(let at=8;at<bytes.length;) {
        const type=new TextDecoder().decode(bytes.subarray(at+4,at+8));
        assert.ok(['IHDR','PLTE','tRNS','IDAT','IEND'].includes(type),`Unexpected PNG chunk ${type} in ${name}`);
        at+=12+view.getUint32(at);
      }
    } else {
      const body=new TextDecoder().decode(bytes);
      const normalized=body.replaceAll('\\','/').toLowerCase();
      assert.ok(!/\b[A-Za-z]:[\\/]/.test(body) && ![root,homedir()].some(local=>normalized.includes(local.replaceAll('\\','/').toLowerCase())),`Local path marker in ${name}`);
    }
    const destination=path.join(isolated,'unpacked',name);
    await mkdir(path.dirname(destination),{recursive:true});
    await writeFile(destination,bytes);
  }
  assert.equal(allowed.size,0,'Expected packaged files missing');
  extensionPath=path.join(isolated,'unpacked','extension');
  console.log('VSIX allowlist and local-path review passed. Testing the extracted artifact.');
}
await mkdir(path.join(isolated,'user','User'),{recursive:true});
await copyFile(path.join(root,'tests/fixtures/test-settings.json'),path.join(isolated,'user','User','settings.json'));
await mkdir(path.join(isolated,'workspace'),{recursive:true});
const executable=process.env.XQLIBUR_TEST_VSCODE_EXECUTABLE??await downloadAndUnzipVSCode(process.env.XQLIBUR_TEST_VSCODE_VERSION??'1.143.1');
// The standard runTests helper disables Workspace Trust unconditionally. Launch
// the isolated test executable directly so Restricted Mode is actually tested.
await new Promise((resolve,reject)=>{
  const child=spawn(executable,[path.join(isolated,'workspace'),'--user-data-dir',path.join(isolated,'user'),'--extensions-dir',path.join(isolated,'extensions'),'--skip-welcome','--skip-release-notes','--disable-telemetry','--disable-gpu','--disable-updates','--extensionDevelopmentPath='+extensionPath,'--extensionTestsPath='+path.join(root,'tests/host.cjs')],{windowsHide:true});
  let output='';
  child.stdout.on('data',chunk=>{output=(output+chunk).slice(-100000);});
  child.stderr.on('data',chunk=>{output=(output+chunk).slice(-100000);});
  const timer=setTimeout(()=>{child.kill();reject(new Error('Isolated host timeout'));},60000);
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.on('exit',(code,signal)=>{
    clearTimeout(timer);
    const lines=output.split(/\r?\n/),failure=lines.findIndex(line=>/AssertionError/.test(line));
    // Without an assertion, the editor itself failed (for example a sandbox or
    // display problem), so show its last output to make the cause visible.
    console.log(code!==0&&failure>=0?lines.slice(failure,failure+40).join('\n'):
      code!==0?lines.slice(-40).join('\n'):
      lines.filter(line=>/XQLibur|AssertionError|Error:|true !== false/.test(line)).join('\n'));
    code===0?resolve():reject(new Error(`Isolated host exit ${code}${signal?` (signal ${signal})`:''}`));
  });
});
// Failed runs retain their own synthetic profile for diagnosis. Only success
// reaches this exact-directory cleanup; cached editors and earlier runs stay put.
await hostDirectory.cleanup();
console.log('XQLibur isolated test directory removed.');
