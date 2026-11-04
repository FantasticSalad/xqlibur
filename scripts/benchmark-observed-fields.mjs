import {performance} from 'node:perf_hooks';
import core from '../.build/packages/core/index.js';
import assert from 'node:assert/strict';
// Each stage introduces a different observed candidate, unlike the stable-name
// provider benchmark. This exposes repeated negative lookup across delta chains.
for(const fields of [1000,5000]) {
  const text='dataset xdr_data'+Array.from({length:fields},(_,i)=>' | filter observed_'+i+' = 1').join('');
  const start=performance.now(),analysis=core.createAnalysis(text),elapsed=performance.now()-start;
  assert.equal(analysis.symbols.observations.length,fields);
  assert.equal(analysis.pipeline.fields(analysis.pipeline.output('q0')).length,fields);
  assert.ok(analysis.symbols.uses.every(u=>u.access==='write'||!u.bindingId));
  assert.deepEqual(analysis.findings,[]);
  console.log(`${fields} distinct observed fields/stages: cold analysis ${elapsed.toFixed(1)} ms; candidates remain possible`);
}
