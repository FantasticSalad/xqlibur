import {test} from 'node:test';
import assert from 'node:assert/strict';
import {access,mkdir,writeFile,readFile,realpath,rmdir} from 'node:fs/promises';
import path from 'node:path';
import {checkedHostDirectory,createHostDirectory} from '../scripts/host-temp.mjs';

test('successful host cleanup removes only its newly created directory',async()=>{
  const fixture=await createHostDirectory();
  try {
    const sibling=path.join(fixture.path,'sibling');await mkdir(sibling);
    const marker=path.join(sibling,'synthetic.txt');await writeFile(marker,'synthetic fixture');
    const child=await createHostDirectory(fixture.path);
    await writeFile(path.join(child.path,'synthetic.txt'),'generated host fixture');
    assert.ok(Object.isFrozen(child));
    await child.cleanup();
    await assert.rejects(access(child.path),{code:'ENOENT'});
    assert.equal(await readFile(marker,'utf8'),'synthetic fixture');
    await assert.rejects(child.cleanup(),{code:'ENOENT'});
  } finally {await fixture.cleanup();}
});

test('host deletion guard rejects roots, siblings, substituted links and relative paths',()=>{
  const root=path.resolve('synthetic-host-root'),created=path.join(root,'xqlibur-host-fixture');
  assert.equal(checkedHostDirectory(root,created,created),created);
  for(const [parent,target,resolved] of [
    [root,root,root],
    [root,created,path.join(root,'xqlibur-host-another')],
    [root,created,path.join(path.dirname(root),'xqlibur-host-outside')],
    [root,path.join(root,'unrelated'),path.join(root,'unrelated')],
    [root,'xqlibur-host-relative','xqlibur-host-relative'],
    ['relative-root',created,created]
  ]) assert.throws(()=>checkedHostDirectory(parent,target,resolved));
});

test('host cleanup refuses a file substituted at its creation path',async()=>{
  const fixture=await createHostDirectory();
  try {
    const child=await createHostDirectory(fixture.path);
    const target=checkedHostDirectory(fixture.path,child.path,await realpath(child.path));
    await rmdir(target);
    await writeFile(target,'synthetic replacement');
    await assert.rejects(child.cleanup(),/no longer a directory/);
    assert.equal(await readFile(target,'utf8'),'synthetic replacement');
  } finally {await fixture.cleanup();}
});
