import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {validateFacts,checkedDate} from '../scripts/validate-facts.mjs';
const require = createRequire(import.meta.url);
const {parse, signatureHelp} = require('../.build/packages/core');
const read = async p => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
const fixtures = await read('./fixtures/acceptance-cases.json');
for (const name of ['syntax', 'stage', 'operator']) test(`${name} facts have evidence, fallback and acceptance cases`, async () => {
  const doc = await read(`../reference/${name}-facts.json`);
  validateFacts(doc, fixtures);
  for (const mutate of [d => d.schemaVersion++, d => d.facts.push(d.facts[0]), d => d.facts[0].source = 'https://example.com', d => d.facts[0].checked = '2026-02-30', d => d.facts[0].fallback = '', d => d.facts[0].fixtures = ['missing']]) {
    const bad = structuredClone(doc); mutate(bad);
    assert.throws(() => validateFacts(bad, fixtures));
  }
});

test('checked calendar dates allow an actual timezone-ahead review without accepting future or invalid dates',()=>{
  const evening=Date.parse('2026-10-25T19:00:00Z');
  assert.doesNotThrow(()=>checkedDate('2026-10-26',evening));
  assert.throws(()=>checkedDate('2026-10-27',evening));
  assert.throws(()=>checkedDate('2026-10-26',Date.parse('2026-10-25T00:00:00Z')));
  assert.throws(()=>checkedDate('2026-02-30',evening));
});
test('acceptance corpus is original structural coverage, including every partial edit', () => {
  assert.equal(new Set(fixtures.map(f => f.id)).size, fixtures.length);
  for (const fixture of fixtures) {
    assert.equal(typeof fixture.structuralOnly, 'boolean');
    assert.ok(fixture.expectation);
    for (let end = 0; end <= fixture.query.length; end++) {
      const text = fixture.query.slice(0, end), tree = parse(text);
      for (const token of tree.tokens) assert.equal(text.slice(token.start, token.end), token.text);
      for (const issue of tree.issues) assert.ok(issue.start >= 0 && issue.end <= end);
      signatureHelp(text, end);
    }
  }
  const literal = parse(fixtures.find(f => f.id === 'quote-recovery').query);
  assert.deepEqual(literal.stages.map(s => s.name.text), ['dataset', 'alter']);
  assert.equal(literal.calls.length, 0);
  const partial = fixtures.find(f => f.id === 'partial-assignment').query;
  assert.equal(signatureHelp(partial, partial.length).activeParameter, 1);
});
