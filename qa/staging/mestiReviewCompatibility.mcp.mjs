import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const credential=JSON.parse(readFileSync(process.argv[2],'utf8'));
const endpoint='https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/factory-mesti-mcp';
assert.equal(credential.endpoint,endpoint);
let sequence=1;
async function rpc(method,params){const r=await fetch(endpoint,{method:'POST',headers:{authorization:credential.authorization,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:sequence++,method,params}),signal:AbortSignal.timeout(30000)});assert.equal(r.status,200);return r.json();}
async function tool(name,args){const r=await rpc('tools/call',{name,arguments:args});assert(!r.error,JSON.stringify(r.error));assert(!r.result.isError);return r.result.structuredContent;}
const range={from:'2026-10-23',to:'2026-10-29'};
const sort=rows=>rows.toSorted((a,b)=>a.evidence_reference.localeCompare(b.evidence_reference));
async function query(q){return (await tool('query_factory_resources',{queries:[{resource:'mesti_review',date_range:range,...q}]})).results[0];}
let items=[],cursor,page;
do{page=await query({action:'list',limit:7,...(cursor?{cursor}:{})});items.push(...page.items.map(({id,label,...r})=>r));cursor=page.next_cursor;}while(page.has_more);
const schedule=await tool('get_mesti_requirement_schedule',{date_range:range});
assert.deepEqual(sort(items),sort(schedule.findings));
assert.deepEqual(page.review_coverage,schedule.coverage);
assert.deepEqual(page.data_quality_limitations,schedule.data_quality_limitations);
assert.equal(page.undated_completed_production_count,schedule.undated_completed_production_count);
assert.equal(page.review_coverage.length,56);
assert.equal(new Set(page.review_coverage.map(r=>r.module)).size,8);
for(let day=23;day<=29;day++){
 const date=`2026-10-${day}`;
 const daily=await tool('get_mesti_daily_status',{date});
 assert.deepEqual(sort(items.filter(r=>r.date===date)),sort(daily.findings));
 const filtered=await query({action:'filter',filters:{business_date:date},limit:100});
 assert.deepEqual(sort(filtered.items.map(({id,label,...r})=>r)),sort(daily.findings));
 assert.deepEqual(filtered.review_coverage,schedule.coverage,'Filter must not hide coverage gaps');
}
for(const status of new Set(items.map(r=>r.evidence.record_status).filter(Boolean))){const filtered=await query({action:'filter',filters:{record_status:status},limit:100});assert.deepEqual(sort(filtered.items.map(({id,label,...r})=>r)),sort(items.filter(r=>r.evidence.record_status===status)));}
for(const severity of ['all','high','medium','info']){const old=await tool('list_mesti_exceptions',{date_range:range,severity});assert.deepEqual(sort(old.findings),sort(items.filter(r=>['missing','overdue','awaiting_verification','evidence_issues','incomplete','unavailable'].includes(r.status)&&(severity==='all'||r.severity===severity))));}
const pending=await tool('list_pending_verifications',{date_range:range});const filtered=await query({action:'filter',filters:{pending_verification:'true'},limit:100});assert.deepEqual(sort(pending.findings),sort(filtered.items.map(({id,label,...r})=>r)));
for(const row of items){const detail=await tool('get_mesti_evidence_details',{reference_id:row.evidence_reference});const read=await query({action:'read',id:row.evidence_reference});assert.deepEqual(detail.findings,read.items.map(({id,label,...r})=>r));}
const scoped=await tool('query_factory_resources',{queries:[{business_module:'factory_mesti_cleaning',resource:'occurrences',action:'list',date_range:range,limit:100}]});assert(!('undated_completed_production_count' in scoped.results[0]));assert(!('review_coverage' in scoped.results[0]));assert(scoped.results[0].items.every(r=>r.module==='cleaning_of_area'&&!('subject_id'in r)));
const denial=await rpc('tools/call',{name:'query_factory_resources',arguments:{queries:[{business_module:'factory_production',resource:'production_records',action:'list',date_range:range}]}});assert.equal(denial.error.code,-32003);
console.log(JSON.stringify({filter_accuracy:'PASS',coverage_metadata:'PASS',review_equivalence:'PASS',module_isolation:'PASS',findings:items.length,evidence_reads:items.length,coverage_entries:page.review_coverage.length,undated_completed_productions:page.undated_completed_production_count}));
