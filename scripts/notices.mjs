import {readFile,writeFile} from 'node:fs/promises';
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
const notices=['Bundled runtime dependency licences. Generated from locked installed packages.'];
for(const [location,entry] of Object.entries(lock.packages)) {
  if(!location || entry.dev) continue;
  if(!['MIT','ISC'].includes(entry.license)) throw new Error(`Review dependency licence: ${location}: ${entry.license}`);
  let licence;
  for(const file of ['LICENSE','LICENSE.md','LICENSE.txt','License.txt']) {
    try {licence=await readFile(`${location}/${file}`,'utf8');break;} catch(error) {if(error.code!=='ENOENT') throw error;}
  }
  if(!licence) throw new Error(`Missing licence text: ${location}`);
  notices.push(`\n${entry.name??location.replace('node_modules/','')} ${entry.version}\n${licence}`);
}
await writeFile('dist/THIRD_PARTY_LICENSES.txt',notices.join('\n')+'\n');
