import {cp,mkdir,mkdtemp,writeFile,readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
const root=resolve(import.meta.dirname,'..'),out=await mkdtemp(join(tmpdir(),'feedx-creator-worker-'));
await cp(join(root,'services/creator-inspection'),out,{recursive:true,filter:path=>!path.includes('node_modules')&&!path.endsWith('.test.mjs')});
await mkdir(join(out,'runtime/server'),{recursive:true});
await cp(join(root,'server/creatorExtraction'),join(out,'runtime/server/creatorExtraction'),{recursive:true});
await cp(join(root,'server/functionTelemetry.mjs'),join(out,'runtime/server/functionTelemetry.mjs'));
await mkdir(join(out,'runtime/src/features/marketing'),{recursive:true});
await cp(join(root,'src/features/marketing/creatorProfiles.js'),join(out,'runtime/src/features/marketing/creatorProfiles.js'));
await mkdir(join(out,'public'),{recursive:true});await writeFile(join(out,'public/index.html'),'Not a public application.');
async function files(dir,prefix=''){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const name=join(prefix,entry.name);if(entry.isDirectory())result.push(...await files(join(dir,entry.name),name));else result.push({file:name,data:await readFile(join(dir,entry.name),'utf8'),encoding:'utf-8'})}return result}
if(process.argv.includes('--manifest'))console.log(JSON.stringify({directory:out,files:await files(out)}));else console.log(out);
