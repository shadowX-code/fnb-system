import {nodeFileTrace} from '@vercel/nft';
import {stat,readFile} from 'node:fs/promises';
const routes=['api/marketing-creator-inspect.mjs','api/marketing-xhs-reader.mjs'];
for(const route of routes){
 const trace=await nodeFileTrace([route],{base:process.cwd()});
 const forbidden=[...trace.fileList].filter(p=>/(@sparticuz|playwright-core|creatorExtraction\/(browser|inspect|profiles)\.mjs|chromium\.br|swiftshader)/.test(p));
 if(forbidden.length)throw new Error(`Browser dependency in main route ${route}: ${forbidden.join(',')}`);
 const bytes=(await Promise.all([...trace.fileList].map(async p=>(await stat(p)).size))).reduce((a,b)=>a+b,0);
 console.log(JSON.stringify({route,files:trace.fileList.size,traced_bytes:bytes,chromium_files:0}));
}
const config=JSON.parse(await readFile('vercel.json','utf8'));
if(JSON.stringify(config.functions).match(/chromium|playwright/))throw new Error('Main Vercel config includes browser files');
