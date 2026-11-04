import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseTable} from '../scripts/reference-table.mjs';
test('index extraction handles stage-qualified aggregate links',()=>{
  const rows='| [`count` (with comp stage)](/functions/count_comp.md) |\n| [`count` (with windowcomp stage)](/functions/count_window.md) |';
  assert.deepEqual(parseTable(rows),[
    {name:'count',context:'comp',href:'/functions/count_comp.md'},
    {name:'count',context:'windowcomp',href:'/functions/count_window.md'}
  ]);
});
test('ordinary symbols remain readable and non-symbol prose is ignored',()=>{
  assert.deepEqual(parseTable('| [`lowercase`](/functions/lowercase.md) |\nordinary prose'),[{name:'lowercase',context:undefined,href:'/functions/lowercase.md'}]);
});
