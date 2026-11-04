import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function officialSource(source) {
  assert.equal(typeof source, 'string');
  assert.ok(!/[\s<>()[\]\\]/.test(source), 'Unsafe source URL characters');
  const url = new URL(source);
  assert.equal(url.protocol, 'https:');
  assert.ok(['cortex-docs.paloaltonetworks.com', 'docs-cortex.paloaltonetworks.com'].includes(url.hostname));
  assert.equal(url.username + url.password + url.hash + url.search, '');
  assert.equal(url.port, '');
}
export function checkedDate(date,now=Date.now()) {
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(date).toISOString().slice(0, 10), date);
  // A checked calendar date may be recorded in any real reviewer's timezone.
  // UTC+14 is the earliest legitimate next date; later dates are still rejected.
  assert.ok(date <= new Date(now+14*60*60*1000).toISOString().slice(0, 10), 'Future checked date');
}
export function validateFacts(doc, fixtures) {
  assert.equal(doc.schemaVersion, 1);
  assert.ok(Array.isArray(doc.facts) && doc.facts.length);
  const ids = new Set();
  for (const fact of doc.facts) {
    assert.match(fact.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(!ids.has(fact.id), 'Duplicate fact'); ids.add(fact.id);
    assert.ok(['verified', 'partial', 'blocked'].includes(fact.status));
    officialSource(fact.source); checkedDate(fact.checked);
    for (const key of ['behavior', 'fallback']) assert.ok(typeof fact[key] === 'string' && fact[key].trim());
    assert.ok(Array.isArray(fact.fixtures) && fact.fixtures.length);
    for (const id of fact.fixtures) assert.ok(fixtures.some(f => f.id === id), 'Missing acceptance case: ' + id);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = async p => JSON.parse(await readFile(new URL('../' + p, import.meta.url), 'utf8'));
  const fixtures = await read('tests/fixtures/acceptance-cases.json');
  for (const name of ['syntax', 'stage', 'operator']) validateFacts(await read(`reference/${name}-facts.json`), fixtures);
  const operators=await read('reference/operator-facts.json');
  const spellings=new Set();
  for(const fact of operators.facts) {
    assert.ok(['explicitBoundary','unverified'].includes(fact.precedence));
    assert.equal(fact.associativity,'unverified');
    assert.ok(fact.spellings.length);
    for(const spelling of fact.spellings) {assert.equal(typeof spelling,'string');assert.ok(spelling.length&&spelling.length<30);assert.ok(!spellings.has(spelling));spellings.add(spelling);}
  }
  console.log('Syntax/stage/operator facts and acceptance links validated.');
}
