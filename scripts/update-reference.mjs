// Development-only network access. Retain names and URLs, never downloaded prose.
import { readFile, writeFile } from 'node:fs/promises';
import {parseTable} from './reference-table.mjs';
import {validateCatalogueReplacement} from './validate-reference.mjs';
const destination = new URL('../reference/catalogue.json', import.meta.url);
const previous = JSON.parse(await readFile(destination, 'utf8'));
const root = 'https://cortex-docs.paloaltonetworks.com/xql-command-reference-guide/readme/';
const symbols = [];
for (const [kind, path] of [['stage', 'stages/stages-list'], ['function', 'functions/functions-list']]) {
  const url = root + path;
  const response = await fetch(url + '.md', { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Reference HTTP ${response.status}`);
  const markdown = await response.text();
  const entries = parseTable(markdown);
  if (entries.length < (kind === 'stage' ? 15 : 100)) throw new Error(`Unexpected ${kind} table; refusing update`);
  const seen = new Map();
  for (const {name,context,href} of entries) {
    let source = new URL(href, url + '.md').href.replace(/\.md$/, '');
    // Some official index rows link to external draft documents. Cite the
    // official index for those names, without importing the draft material.
    if (!['cortex-docs.paloaltonetworks.com','docs-cortex.paloaltonetworks.com'].includes(new URL(source).hostname) || new URL(source).protocol!=='https:') source=url;
    const existing=seen.get(name);
    if(existing) {
      if(context) {
        existing.contexts??=[];
        if(!existing.contexts.includes(context)) existing.contexts.push(context);
      }
      existing.sources??=[existing.source];
      if(!existing.sources.includes(source)) existing.sources.push(source);
      continue;
    }
    const entry=context?{name,kind,source,contexts:[context],sources:[source]}:{name,kind,source};
    seen.set(name,entry);
    symbols.push(entry);
  }
}
// Documented query entry point, maintained separately from the stage index.
if (!symbols.some(s=>s.kind==='stage'&&s.name==='cold_dataset')) symbols.push({name:'cold_dataset',kind:'stage',source:root+'stages/dataset'});
symbols.push({name:'datamodel',kind:'stage',source:'https://cortex-docs.paloaltonetworks.com/cortex-xsiam/reference-and-developer-docs/cortex-agentix-xql/build-xql-queries/how-to-build-xql-queries/xql-query-best-practices'});
symbols.sort((a,b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
const next = {schemaVersion:1,checked:new Date().toISOString().slice(0,10),sources:[root+'stages/stages-list',root+'functions/functions-list'],symbols};
validateCatalogueReplacement(previous, next);
await writeFile(destination, JSON.stringify(next,null,2)+'\n');
console.log(`Wrote ${symbols.length} symbols. Review provenance and diff before committing.`);
