import {performance} from 'node:perf_hooks';
import core from '../.build/packages/core/index.js';
for(const lines of [1000,10000]) {
  const text='dataset = xdr_data\n'+'| filter true\n'.repeat(lines)+'| fil';
  core.analyze(text);core.completions(text,text.length);
  for(const [name,operation] of [['analysis',()=>core.analyze(text)],['completion',()=>core.completions(text,text.length)]]) {
    const times=[];
    for(let i=0;i<20;i++){const start=performance.now();operation();times.push(performance.now()-start);}
    times.sort((a,b)=>a-b);
    console.log(`${lines} stages ${name}: p95 ${times[18].toFixed(1)} ms`);
  }
}
