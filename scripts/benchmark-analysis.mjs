import {performance} from 'node:perf_hooks';
import core from '../.build/packages/core/index.js';
import semantic from '../.build/packages/core/semantic.js';
import assert from 'node:assert/strict';

const measure=operation=>{
  const times=[];
  for(let i=0;i<20;i++) {const start=performance.now();operation();times.push(performance.now()-start);}
  times.sort((a,b)=>a-b);return times[18].toFixed(1);
};
for(const fields of [1000,5000]) {
  const text='dataset = xdr_data | alter '+Array.from({length:fields},(_,i)=>`field_${i} = ${i}`).join(', ')+
    '\n'+'| filter true\n'.repeat(1000)+'| filter fi';
  const uri='untitled:benchmark',store=new core.AnalysisStore();store.open(uri,1);
  const analysis=store.get(uri,1,text);
  const cold=measure(()=>core.createAnalysis(text,{documentId:'benchmark',version:1}));
  const miss=measure(()=>{
    const fresh=new core.AnalysisStore();fresh.open(uri,1);fresh.get(uri,1,text);fresh.close(uri);
    assert.equal(fresh.stats.characters,0);assert.equal(fresh.stats.tokens,0);
  });
  const cached=measure(()=>{
    core.analyze(text,store.get(uri,1,text));
    core.completionCandidates(store.get(uri,1,text),text.length);
    core.hover(text,0,store.get(uri,1,text));
    core.signatureHelp(text,text.length,undefined,store.get(uri,1,text).structure.tree);
    semantic.semanticTokens(text,store.get(uri,1,text));
  });
  assert.equal(analysis.symbols.bindings.length,fields);
  assert.equal(store.stats.builds,1,'Provider requests must reuse the cached analysis');
  console.log(`${fields} fields + 1000 stages: cold analysis p95 ${cold} ms; cache miss p95 ${miss} ms; cached five-provider packet p95 ${cached} ms; ${store.stats.cached} cached document`);
}
