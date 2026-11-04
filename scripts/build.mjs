import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('artifacts',{recursive:true});
const shared = {bundle:true,platform:'node',format:'cjs',target:'node20',sourcemap:false,legalComments:'eof'};
await build({...shared,entryPoints:['packages/vscode/extension.ts'],outfile:'dist/extension.cjs',external:['vscode']});
await build({...shared,entryPoints:['packages/language-server/server.ts'],outfile:'dist/server.cjs'});
await import('./notices.mjs');
