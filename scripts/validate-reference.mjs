import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {officialSource, checkedDate} from './validate-facts.mjs';

const namePattern = /^[a-z][a-z0-9_]*$/;
function uniqueStrings(values, pattern) {
  assert.ok(Array.isArray(values) && values.length);
  assert.equal(new Set(values).size, values.length);
  for (const value of values) { assert.equal(typeof value, 'string'); if (pattern) assert.match(value, pattern); }
}
export function validateReference(signatures, coverage, catalogue) {
  assert.equal(signatures.schemaVersion, 3, 'Only signature schema v3 is supported');
  assert.equal(coverage.schemaVersion, 1);
  checkedDate(coverage.catalogueChecked);
  assert.equal(coverage.catalogueChecked, catalogue.checked);
  const inventory = catalogue.symbols.filter(s => s.kind === 'function');
  uniqueStrings(inventory.map(s => s.name), namePattern);
  const facts = new Map(), formIds = new Set();
  assert.ok(Array.isArray(signatures.functions));
  for (const fact of signatures.functions) {
    assert.match(fact.name, namePattern);
    assert.ok(!facts.has(fact.name), 'Duplicate function'); facts.set(fact.name, fact);
    assert.ok(inventory.some(s => s.name === fact.name), 'Unknown function fact');
    assert.ok(['verified', 'partial', 'blocked'].includes(fact.status));
    if (fact.summary !== undefined) assert.ok(typeof fact.summary === 'string' && fact.summary.trim());
    assert.ok(Array.isArray(fact.forms));
    if (fact.status !== 'blocked') assert.ok(fact.forms.length);
    else assert.equal(fact.forms.length, 0, 'Blocked facts cannot supply guessed forms');
    for (const form of fact.forms) {
      assert.match(form.id, /^[a-z][a-z0-9_-]*$/);
      assert.ok(!formIds.has(form.id), 'Duplicate form ID'); formIds.add(form.id);
      uniqueStrings(form.contexts, namePattern);
      officialSource(form.source); checkedDate(form.checked);
      assert.ok(['positional', 'special'].includes(form.syntaxKind));
      if (form.invocation !== undefined) assert.ok(['call', 'infix'].includes(form.invocation));
      if (form.invocation === 'infix') assert.ok(form.syntaxKind === 'special' && !form.arityKnown && form.parameters.length === 0);
      assert.ok(['displayOnly', 'arityVerified'].includes(form.validation));
      assert.equal(typeof form.arityKnown, 'boolean');
      assert.ok(Array.isArray(form.parameters));
      if (!form.arityKnown) assert.equal(form.parameters.length, 0, 'Unknown arity must not invent slots');
      if (form.syntaxKind === 'special') assert.ok(typeof form.syntaxLabel === 'string' && form.syntaxLabel.trim());
      if (form.callCount !== undefined) {
        assert.ok(form.callCount && typeof form.callCount === 'object' && !Array.isArray(form.callCount));
        assert.deepEqual(Object.keys(form.callCount).sort(), ['max','min'], 'Unsupported call-count constraint');
        assert.ok(form.syntaxKind === 'special' && !form.arityKnown && form.parameters.length === 0 && form.invocation !== 'infix', 'Direct counts cannot invent parameter slots or describe infix notation');
        assert.equal(form.validation, 'arityVerified', 'Direct counts require explicit verification');
        assert.ok(Number.isSafeInteger(form.callCount.min) && form.callCount.min >= 0);
        assert.ok(Number.isSafeInteger(form.callCount.max) && form.callCount.max >= form.callCount.min);
      }
      if (form.validation === 'arityVerified') assert.ok(fact.status === 'verified' &&
        (form.arityKnown && form.syntaxKind === 'positional' || form.callCount !== undefined));
      const parameters = new Set(); let optional = false;
      for (const [index, parameter] of form.parameters.entries()) {
        assert.match(parameter.name, namePattern);
        assert.ok(!parameters.has(parameter.name), 'Duplicate parameter'); parameters.add(parameter.name);
        assert.equal(typeof parameter.optional, 'boolean'); assert.equal(typeof parameter.repeat, 'boolean');
        assert.ok(!optional || parameter.optional, 'Required parameter after optional');
        optional ||= parameter.optional;
        if (parameter.repeat) assert.equal(index, form.parameters.length - 1, 'Repeat slot must be last');
        if (parameter.typeLabel !== undefined) assert.ok(typeof parameter.typeLabel === 'string' && parameter.typeLabel.trim());
      }
    }
  }
  assert.ok(Array.isArray(coverage.functions));
  uniqueStrings(coverage.functions.map(s => s.name), namePattern);
  assert.deepEqual(coverage.functions.map(s => s.name).sort(), inventory.map(s => s.name).sort(), 'Coverage must account for the full catalogue');
  for (const entry of coverage.functions) {
    assert.ok(['verified', 'partial', 'blocked', 'notReviewed'].includes(entry.status));
    assert.ok(typeof entry.reason === 'string' && entry.reason.trim());
    uniqueStrings(entry.sources); for (const source of entry.sources) officialSource(source);
    uniqueStrings(entry.contexts, namePattern);
    const symbol = inventory.find(s => s.name === entry.name);
    for (const context of symbol.contexts ?? ['expression']) assert.ok(entry.contexts.includes(context), 'Lost catalogue context');
    for (const source of symbol.sources ?? [symbol.source]) assert.ok(entry.sources.includes(source), 'Lost catalogue source');
    const fact = facts.get(entry.name);
    if (entry.status === 'notReviewed') assert.equal(fact, undefined);
    else assert.ok(fact && entry.status === fact.status, 'Coverage and facts disagree');
    for (const form of fact?.forms ?? []) {
      assert.ok(entry.sources.includes(form.source), 'Unaccounted form source');
      for (const context of form.contexts) assert.ok(entry.contexts.includes(context), 'Unaccounted form context');
    }
  }
}
export function validateCatalogueReplacement(previous, next) {
  const keys = symbols => symbols.map(s => s.kind + ':' + s.name);
  const nextKeys = keys(next.symbols);
  assert.equal(new Set(nextKeys).size, nextKeys.length, 'Duplicate catalogue names');
  for (const key of keys(previous.symbols)) assert.ok(nextKeys.includes(key), 'Incomplete extraction or removed name requires explicit review: ' + key);
  for (const symbol of next.symbols) {
    assert.match(symbol.name, namePattern); officialSource(symbol.source);
    const old = previous.symbols.find(s => s.kind === symbol.kind && s.name === symbol.name);
    if (old) {
      for (const context of old.contexts ?? []) assert.ok(symbol.contexts?.includes(context), 'Incomplete extraction lost context');
      for (const source of old.sources ?? [old.source]) assert.ok((symbol.sources ?? [symbol.source]).includes(source), 'Changed source requires explicit review');
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = async name => JSON.parse(await readFile(new URL('../reference/' + name + '.json', import.meta.url), 'utf8'));
  const [signatures, coverage, catalogue] = await Promise.all(['signatures', 'coverage', 'catalogue'].map(read));
  validateReference(signatures, coverage, catalogue);
  const counts={verified:0,partial:0,blocked:0,notReviewed:0};
  for(const entry of coverage.functions) counts[entry.status]++;
  console.log(`Validated ${coverage.functions.length} coverage entries and ${signatures.functions.length} curated function facts: ${counts.verified} arity-verified, ${counts.partial} partial, ${counts.blocked} blocked, ${counts.notReviewed} not reviewed.`);
}
