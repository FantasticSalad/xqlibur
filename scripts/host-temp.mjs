import assert from 'node:assert/strict';
import {lstat,mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

/** Validate the exact creation path, never a parent, sibling or substituted link. */
export function checkedHostDirectory(parent,created,resolved) {
  assert.ok([parent,created,resolved].every(value=>path.isAbsolute(value)),'Expected absolute host paths');
  assert.equal(path.dirname(created),parent,'Host must be a direct child of its creation root');
  assert.notEqual(created,parent,'Cannot remove the host creation root');
  assert.ok(path.basename(created).startsWith('xqlibur-host-'),'Unexpected host directory name');
  assert.equal(resolved,created,'Host directory path changed after creation');
  return resolved;
}

/** The cleanup closure owns only the unique directory created by this call. */
export async function createHostDirectory(parent=tmpdir()) {
  const root=await realpath(parent),created=await mkdtemp(path.join(root,'xqlibur-host-'));
  return Object.freeze({path:created,cleanup:async()=>{
    const [resolved,stat]=await Promise.all([realpath(created),lstat(created)]);
    const target=checkedHostDirectory(root,created,resolved);
    assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'Host target is no longer a directory');
    await rm(target,{recursive:true,force:false,maxRetries:10,retryDelay:100});
  }});
}
