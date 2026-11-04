import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateReference, validateCatalogueReplacement} from '../scripts/validate-reference.mjs';
const read = async name => JSON.parse(await readFile(new URL('../reference/' + name + '.json', import.meta.url), 'utf8'));
const [signatures, coverage, catalogue] = await Promise.all(['signatures', 'coverage', 'catalogue'].map(read));
const arityFixtures=JSON.parse(await readFile(new URL('./fixtures/verified-arities.json',import.meta.url),'utf8'));
test('v3 reference accounts for every catalogue function and preserves baseline display facts', () => {
  validateReference(signatures, coverage, catalogue);
  assert.equal(coverage.functions.length, 142);
  for (const name of ['lowercase','arrayfilter','arrayindex','concat','coalesce','json_extract_scalar','timestamp_diff','to_string']) assert.ok(signatures.functions.some(f => f.name === name));
  assert.ok(signatures.functions.length >= 18);
  const verified=new Set(arityFixtures.map(f=>f.name));
  for (const entry of signatures.functions) for (const form of entry.forms) assert.equal(form.validation, verified.has(entry.name)&&form.invocation!=='infix'?'arityVerified':'displayOnly');
});
for (const [name, mutate] of [
  ['old schema', s => s.schemaVersion = 1],
  ['v2 without explicit direct-count model', s => s.schemaVersion = 2],
  ['duplicate function', s => s.functions.push(s.functions[0])],
  ['duplicate form', s => s.functions[0].forms.push(s.functions[0].forms[0])],
  ['unofficial host', s => s.functions[0].forms[0].source = 'https://cortex-docs.paloaltonetworks.com.example.com'],
  ['HTTP source', s => s.functions[0].forms[0].source = 'http://cortex-docs.paloaltonetworks.com'],
  ['Markdown link breakout', s => s.functions[0].forms[0].source = 'https://cortex-docs.paloaltonetworks.com/a)[bad](https://example.com)'],
  ['invalid date', s => s.functions[0].forms[0].checked = '2026-02-30'],
  ['unknown arity with slots', s => s.functions[0].forms[0].arityKnown = false],
  ['nonfinal repeat', s => s.functions.find(f => f.name === 'concat').forms[0].parameters[0].repeat = true],
  ['required after optional', s => s.functions.find(f => f.name === 'concat').forms[0].parameters[0].optional = true],
  ['duplicate parameter', s => s.functions[0].forms[0].parameters.push(s.functions[0].forms[0].parameters[0])],
  ['unsupported context', s => s.functions[0].forms[0].contexts = ['imaginary']],
  ['unaccounted form source', s => s.functions[0].forms[0].source = 'https://cortex-docs.paloaltonetworks.com/other-page'],
  ['unproved arity validation', s => s.functions.find(f=>f.name==='coalesce').forms[0].validation = 'arityVerified'],
  ['special without label', s => s.functions[0].forms[0].syntaxKind = 'special'],
  ['infix with positional slots', s => s.functions[0].forms[0].invocation = 'infix'],
  ['negative direct count', s => s.functions.find(f=>f.name==='array_all').forms[0].callCount.min = -1],
  ['fractional direct count', s => s.functions.find(f=>f.name==='array_all').forms[0].callCount.max = 2.5],
  ['unsafe direct count', s => s.functions.find(f=>f.name==='array_all').forms[0].callCount.max = Number.MAX_SAFE_INTEGER+1],
  ['reversed direct count', s => s.functions.find(f=>f.name==='array_all').forms[0].callCount.max = 1],
  ['extra direct-count constraint', s => s.functions.find(f=>f.name==='array_all').forms[0].callCount.step = 2],
  ['infix direct count', s => s.functions.find(f=>f.name==='array_all').forms[0].invocation = 'infix'],
  ['unverified direct count', s => s.functions.find(f=>f.name==='array_all').forms[0].validation = 'displayOnly'],
  ['invented special parameter slots', s => {const f=s.functions.find(f=>f.name==='array_all').forms[0];f.arityKnown=true;f.parameters=[{name:'invented',optional:false,repeat:false}];}],
  ['positional direct count', s => s.functions.find(f=>f.name==='lowercase').forms[0].callCount = {min:1,max:1}],
  ['missing special count proof', s => delete s.functions.find(f=>f.name==='array_all').forms[0].callCount],
  ['coverage missing name', (_s, c) => c.functions.pop()],
  ['coverage duplicate', (_s, c) => c.functions.push(c.functions[0])],
  ['lost aggregate context', (_s, c) => c.functions.find(f => f.name === 'count').contexts = ['comp']],
  ['coverage contradiction', (_s, c) => c.functions.find(f => f.name === 'lowercase').status = 'partial']
]) test(`reference rejects ${name}`, () => {
  const s = structuredClone(signatures), c = structuredClone(coverage); mutate(s, c);
  assert.throws(() => validateReference(s, c, catalogue));
});
test('unknown arity differs from zero parameters and special forms remain display only', () => {
  for (const arityKnown of [false, true]) {
    const s = structuredClone(signatures), form = s.functions.find(f=>f.name==='coalesce').forms[0];
    form.parameters = []; form.arityKnown = arityKnown;
    validateReference(s, coverage, catalogue);
    form.syntaxKind = 'special'; form.syntaxLabel = 'documented non-positional shape';
    validateReference(s, coverage, catalogue);
  }
});
test('incomplete and duplicate catalogue refreshes fail before a snapshot can be written', () => {
  validateCatalogueReplacement(catalogue, catalogue);
  const incomplete = structuredClone(catalogue); incomplete.symbols.pop();
  assert.throws(() => validateCatalogueReplacement(catalogue, incomplete), /Incomplete extraction/);
  const duplicate = structuredClone(catalogue); duplicate.symbols.push(duplicate.symbols[0]);
  assert.throws(() => validateCatalogueReplacement(catalogue, duplicate), /Duplicate/);
  const context = structuredClone(catalogue);
  context.symbols.find(s => s.name === 'count').contexts = ['comp'];
  assert.throws(() => validateCatalogueReplacement(catalogue, context), /lost context/);
});
