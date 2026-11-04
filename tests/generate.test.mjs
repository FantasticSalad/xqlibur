import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {makeGrammar} from '../scripts/generate.mjs';
const catalogue=JSON.parse(await readFile(new URL('../reference/catalogue.json',import.meta.url),'utf8'));
test('generated grammar is byte-stable and independent of inventory order',async()=>{
  const expected=JSON.stringify(makeGrammar(catalogue),null,2)+'\n';
  const actual=await readFile(new URL('../syntaxes/xql.tmLanguage.json',import.meta.url),'utf8');
  assert.equal(actual.replaceAll('\r\n','\n'),expected);
  assert.equal(JSON.stringify(makeGrammar({...catalogue,symbols:[...catalogue.symbols].reverse()})),JSON.stringify(makeGrammar(catalogue)));
});
test('grammar generation rejects duplicate names and regex-shaped inventory input',()=>{
  for(const mutate of [c=>c.symbols.push(c.symbols[0]),c=>c.symbols[0].name='nested.*',c=>c.symbols[0].name='a|b',c=>c.symbols[0].kind='other']) {
    const bad=structuredClone(catalogue);mutate(bad);assert.throws(()=>makeGrammar(bad));
  }
});
