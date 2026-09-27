// Local-only ordered replay. Production is read-only and is never a SQL target here.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const container='feedx-payroll-v1-rehearsal', database='payroll_rehearsal';
const files=fs.readdirSync('supabase/migrations').filter(name=>name.endsWith('.sql') && (name.includes('payroll') || name==='20260926153226_replacement_leave_expiry_guard.sql')).sort();
const ledger={20260927073102:'20260927073247',20260927075050:'20260927080221',20260927085319:'20260927085846',20260927090516:'20260927090533',20260927091923:'20260927092010',20260927104700:'20260927110023',20260927110645:'20260927110719',20260927124520:'20260927124803'};
const manifest=files.map(file=>({file,productionVersion:file.split('_')[0],stagingVersion:ledger[file.split('_')[0]] || file.split('_')[0],sha256:crypto.createHash('sha256').update(fs.readFileSync('supabase/migrations/'+file)).digest('hex')}));
if (process.argv.includes('--manifest')) { console.log(JSON.stringify(manifest,null,2)); process.exit(0); }
for(const file of files){
 const result=spawnSync('docker',['exec','-i',container,'psql','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-q','-1'],{input:fs.readFileSync('supabase/migrations/'+file),encoding:'utf8'});
 if(result.status!==0){console.error('FAILED '+file+'\n'+result.stderr);process.exit(1);}
 console.log('PASS '+file);
}
console.log(JSON.stringify({database,container,migrations:manifest},null,2));
