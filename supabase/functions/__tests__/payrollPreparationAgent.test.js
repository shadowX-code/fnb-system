import {it,expect} from 'vitest';
import {createHandler,toolArguments} from '../factory-mesti-mcp/protocol.js';
import {payrollReadinessArguments} from '../factory-mesti-mcp/hr.js';
import actions from '../../../config/hrAgentActions.json';
const id='10000000-0000-4000-8000-000000000001';
const request=message=>new Request('https://staging.test/mcp',{method:'POST',headers:{authorization:'Bearer fxm_'+'a'.repeat(43),'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,...message})});
it('validates explicit Payroll scope and snapshot-bound pagination without exposing arbitrary queries',()=>{
 expect(payrollReadinessArguments({legal_entity_id:id,run_id:id})).toMatchObject({p_run_id:id,p_legal_entity_id:id,p_page_size:100});
 for(const input of [{run_id:id},{legal_entity_id:id,run_id:id,page:2},{legal_entity_id:id,run_id:id,page_size:101},{legal_entity_id:id,run_id:id,employee_fields:['bank_account']}])expect(()=>payrollReadinessArguments(input)).toThrow();
});
it('keeps forbidden financial operations unregistered and Calculate/Recalculate one independent grant',()=>{
 expect(actions.filter(a=>a.key==='hr_payroll.calculate')).toHaveLength(1);
 expect(actions.filter(a=>a.key.startsWith('hr_payroll.')&&['prepare','calculate','update'].includes(a.action))).toHaveLength(3);
 for(const verb of ['finalize','pay','submit','statutory_submit'])expect(()=>toolArguments('execute_hr_action',{action:`hr_payroll.${verb}`,legal_entity_id:id,target_id:id,request_id:id,expected_version:'source',input:{}})).toThrow();
});
it('View discovers canonical readiness without advertising or authorizing a calculation action',async()=>{
 let businessCalls=0;const handler=createHandler(async(_token,tool)=>{if(tool==='authorize')return {tools:['check_payroll_readiness'],hr_companies:[{id}]};businessCalls++;return {preparation_ready:false,financial_totals:null,employees:[{employee_id:id,calculation:{issues:['missing_compensation']}}]};});
 const list=(await (await handler(request({method:'tools/list'}))).json()).result.tools;
 expect(list.map(t=>t.name)).toEqual(['check_payroll_readiness']);expect(list[0]._meta['feedx/authorized-companies']).toEqual([{id}]);
 const denied=await (await handler(request({method:'tools/call',params:{name:'execute_hr_action',arguments:{action:'hr_payroll.calculate',legal_entity_id:id,target_id:id,request_id:id,expected_version:'source',input:{}}}}))).json();expect(denied.error.code).toBe(-32003);expect(businessCalls).toBe(0);
 const read=await (await handler(request({method:'tools/call',params:{name:'check_payroll_readiness',arguments:{legal_entity_id:id,run_id:id}}}))).json();expect(read.result.structuredContent.financial_totals).toBeNull();expect(read.result.isError).toBe(false);
});
it('returns Review Required inside the successful canonical calculation receipt rather than claiming financial completion',async()=>{
 const receipt={status:'completed',action:'hr_payroll.calculate',payroll:{preparation_ready:false,financial_totals:null,employees:[{status:'review_required',calculation:{issues:['monthly_proration_legal_coverage_requires_review']}}]}};
 const handler=createHandler(async(_token,tool)=>tool==='authorize'?{tools:['execute_hr_action'],hr_actions:[{name:'hr_payroll.calculate'}]}:receipt);
 const result=await (await handler(request({method:'tools/call',params:{name:'execute_hr_action',arguments:{action:'hr_payroll.calculate',legal_entity_id:id,target_id:id,request_id:id,expected_version:'source',input:{employee_id:id}}}}))).json();expect(result.result.structuredContent).toEqual(receipt);
});
