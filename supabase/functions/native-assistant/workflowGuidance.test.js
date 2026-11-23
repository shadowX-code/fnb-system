import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import rules from '../_shared/assistant/operationalGuidance.json' with {type:'json'};
import {createBusinessDispatcher,operations} from './business.js';
import {moduleCoverage} from '../../../scripts/assistantBusinessMatrix.mjs';

test('every release excerpt is an intact passage in its current owner section and has an existing module authority',()=>{
 const modules=moduleCoverage();
 for(const rule of rules){
  const doc=readFileSync('docs/domains/'+rule.source+'.md','utf8');
  const heading=doc.split('\n').find(line=>/^#{1,6} /.test(line)&&line.replace(/^#+ /,'')===rule.section);
  assert(heading,rule.section);
  const section=doc.split('\n'+heading+'\n')[1].split(/\n#{1,6} /)[0].replace(/\s+/g,' ');
  assert(section.includes(rule.text.replace(/\s+/g,' ')),rule.text);
  assert.equal(rule.version,createHash('sha256').update(rule.text).digest('hex').slice(0,16));
  for(const id of rule.modules)assert(modules.some(row=>row.module.id===id&&(row.direct.length||row.shared.length)),id);
 }
 for(const row of modules)assert(rules.some(r=>r.modules.includes(row.module.id))||['blocked','not_applicable'].includes(row.coverage),row.module.id);
});

const fixtures=[
 ['read_crew_roster','Duty Roster publishing','Draft Duty Roster|Publishing atomically'],
 ['read_factory_dispatch_summary','completed Dispatch reversal','Dispatch Reversal'],
 ['read_payroll_holiday_policy','Payroll owns payslips','Payroll owns payslips'],
 ['read_marketing_calendar','creative concept lifecycle','Approved|revision'],
 ['read_operational_financials','canonical accounting EBITDA','accounting EBITDA'],
 ['read_inventory_checks','outlet closing publication','publication chain'],
];
for(const [id,query,expected] of fixtures)test('dispatcher cites authorized source for '+query,async()=>{
 const op=operations.find(o=>o.id===id);
 const config={enabled:true,capability_connections:{[id]:true}};
 let granted=true;
 const caller={rpc(name){assert.equal(name,'current_user_has_permission');return {abortSignal:async()=>({data:granted})};}};
 const b=createBusinessDispatcher({caller,access:{admin:true,permissions:{[op.permission]:true}},config});
 const args={query},run=()=>b.execute('read_assistant_system_guidance',args);
 const result=await run();
 assert(result.knowledge.citations.some(c=>new RegExp(expected,'iu').test(c.excerpt)&&c.source?.startsWith('docs/domains/')));
 granted=false;await assert.rejects(run,{code:'business_read_denied'});
 config.capability_connections[id]=false;
 assert(!(await run()).knowledge.citations.some(c=>c.source?.startsWith('docs/domains/')));
});

test('a follow-up re-reads its single authorized owner and drops history on revocation or an ambiguous prior turn',async()=>{
 const config={enabled:true,capability_connections:{read_crew_roster:true}};
 const op=operations.find(o=>o.id==='read_crew_roster');
 const caller={rpc:()=>({abortSignal:async()=>({data:true})})};
 const b=createBusinessDispatcher({config,caller,access:{admin:true,permissions:{[op.permission]:true}}});
 const guide='read_assistant_system_guidance';
 const previous=await b.execute(guide,{query:'Duty Roster publishing'});
 const follow=()=>b.execute(guide,{query:'what happens next?'},undefined,{prompt:'what happens next?',history:async()=>({turns:[{state:'completed',tool_state:'completed',evidence:previous}]})});
 assert((await follow()).knowledge.citations.every(c=>c.read_owner===op.id));
 assert((await follow()).knowledge.citations.length);
 previous.knowledge.citations.push({...previous.knowledge.citations[0],read_owner:'read_crew_leave'});
 assert.equal((await follow()).knowledge.citations.length,0);
 previous.knowledge.citations.pop();
 config.capability_connections[op.id]=false;
 assert.equal((await follow()).knowledge.citations.length,0);
});

test('all released passages are retrievable from the shared entrypoint with their authority, wording and source version intact',async()=>{
 const caller={rpc:()=>({abortSignal:async()=>({data:true})})};
 for(const rule of rules){
  const op=operations.find(o=>o.kind==='READ'&&rule.modules.includes(o.module_id))||
   operations.find(o=>o.kind==='READ'&&o.related_module_ids?.some(id=>rule.modules.includes(id)));
  assert(op,rule.source);
  const b=createBusinessDispatcher({caller,config:{enabled:true,capability_connections:{[op.id]:true}},
   access:{admin:true,factory:true,permissions:Object.fromEntries([op.permission,...op.knowledge?.additional_permissions||[]].map(p=>[p,true]))}});
  const out=await b.execute('read_assistant_system_guidance',{query:rule.text.slice(0,145)});
  const citation=out.knowledge.citations.find(c=>c.version===rule.version);
  assert(citation,rule.text);
  assert.equal(citation.source,'docs/domains/'+rule.source+'.md');
  assert.equal(citation.read_owner,op.id);
  assert(rule.text.includes(citation.excerpt));
 }
});

test('payable-time troubleshooting cites the Payroll approval boundary alongside Crew roster evidence',async()=>{
 const b=createBusinessDispatcher({caller:{rpc:()=>({abortSignal:async()=>({data:true})})},config:{enabled:true,capability_connections:Object.fromEntries(operations.map(o=>[o.id,true]))},access:{admin:true,factory:true,permissions:Object.fromEntries(operations.map(o=>[o.permission,true]))}});
 const out=await b.execute('read_assistant_system_guidance',{query:'Duty Roster scheduled work and approved Payroll payable time'});
 assert(out.knowledge.citations.some(c=>c.source==='docs/domains/payroll.md'&&c.excerpt.includes('until Payroll explicitly approves')));
 assert(out.knowledge.citations.some(c=>c.source==='docs/domains/crew-workforce.md'));
 assert(!out.knowledge.citations.some(c=>c.source?.includes('factory')));
});
