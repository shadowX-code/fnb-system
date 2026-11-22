import {AssistantError} from '../assistantError.js';
import {date,readContract,rowsEvidence} from '../assistant/readContract.js';
import {alreadyPublished,exactScope,knowledgeQuery,knowledgeResult,knowledgeSource,optionalId,optionalName,todayInMalaysia} from '../assistant/knowledge.js';

const entityFields={legal_entity_id:optionalId,legal_entity_name:optionalName};
const normalize=a=>a&&typeof a==='object'&&!Array.isArray(a)?{legal_entity_id:null,legal_entity_name:null,query:null,...a}:a;
function check(a){if(a.legal_entity_id&&a.legal_entity_name)throw new AssistantError('tool_arguments_invalid',400);}
async function entityScope(caller,args,signal){
 if(args.legal_entity_id)return {id:args.legal_entity_id};
 if(!args.legal_entity_name)throw new AssistantError('knowledge_scope_required',400);
 const rows=await knowledgeSource(caller.rpc('legal_entity_list'),signal);
 return exactScope(rows.filter(row=>row.is_active),null,args.legal_entity_name,row=>row.display_name||row.legal_company_name);
}
async function loadTemplates(caller,args,signal){
 const entity=await entityScope(caller,args,signal);
 const rows=await knowledgeSource(caller.rpc('employment_contract_templates_for_legal_entity',{p_legal_entity_id:entity.id}),signal);
 return {entity,rows};
}
function projectTemplates({entity,rows},args){
 const documents=rows.flatMap(row=>{
  const v=row.current_published_version;
  if(row.legal_entity_id!==entity.id||row.is_active!==true||!v?.id||v.id!==row.current_published_version_id||v.status!=='published'||!alreadyPublished(v.published_at))return [];
  return [{document_id:row.id,version_id:v.id,version:v.version_number,title:row.title,state:'published_current',current:true,
   published_at:v.published_at,content_sha256:v.content_sha256,searchTerms:[row.contract_kind,row.language_code].filter(Boolean).join(' '),
   sections:(v.sections||[]).slice(0,40).map(section=>({title:section.heading,text:section.body}))}];
 });
 return knowledgeResult(args.query,documents,{scope:{legal_entity_id:entity.id,legal_entity:entity.display_name||entity.legal_company_name||null},
  partial:documents.some(doc=>doc.sections.length===40),status:documents.length?undefined:'no_current_version'});
}

export const employmentTemplateKnowledge=readContract({
 id:'read_published_contract_templates',module_id:'employment_contract_templates',permission:'employment_contract_templates.view',version:2,
 label:'Published employment contract template clauses',source:'/people/legal-entities',
 scope:'One named or verified Legal Entity under existing template permission. Unfilled published template text only.',
 discoveryPhrases:['employment contract template','contract template','employment template clause','contract notice period'],
 knowledge:{type:'managed_knowledge',owner:'People / Legal Entities',authority:'Employment Contract Templates',publication:'Active template’s current immutable published version and stored hash.'},
 description:'Search published employment contract template clauses in one exact named Legal Entity or verified entity ID. Cite the version. These are unfilled templates, never an employee contract, employment decision or legal interpretation. Do not render employee data.',
 properties:{...entityFields,query:knowledgeQuery},normalizeArguments:normalize,check,load:loadTemplates,project:projectTemplates,
 interface:{authority:'employment_contract_templates_for_legal_entity',queryKinds:['search','list'],
  unsupported:['Private employment documents, rendered contracts, employer signatures, candidate and employee data, and drafts are excluded.']},
});

async function loadHolidays(caller,args,signal){
 const entity=await entityScope(caller,args,signal);
 const rows=await knowledgeSource(caller.rpc('payroll_ph_policy_read',{p_legal_entity_id:entity.id}),signal);
 return {entity,rows};
}
const policyFields=['id','effective_from','legal_entity_id','treatment','formula_version','created_at'];
function projectHolidays({entity,rows},args){
 if(!args.query&&!args.effective_on)return rowsEvidence(rows,policyFields);
 const today=todayInMalaysia(),on=args.effective_on||today;
 const scope={legal_entity_id:entity.id,legal_entity:entity.display_name||entity.legal_company_name||null,effective_on:on};
 if(on>today)return knowledgeResult(args.query,[],{scope,status:'future_version_unverified'});
 const applicable=rows.filter(row=>row.legal_entity_id===entity.id&&row.effective_from&&row.effective_from<=on).sort((a,b)=>b.effective_from.localeCompare(a.effective_from));
 const [row,next]=applicable;
 if(!row||row.effective_from===next?.effective_from)return knowledgeResult(args.query,[],{scope,status:row?'ambiguous_source':'no_current_version'});
 const current=!args.effective_on||!rows.some(candidate=>candidate.legal_entity_id===entity.id&&candidate.effective_from>row.effective_from&&candidate.effective_from<=today);
 const documents=[{document_id:row.id,version_id:row.id,version:row.formula_version||row.effective_from,title:'Public holiday policy',
  state:current?'effective_current':'effective_historical',effective_on:row.effective_from,current,
  sections:[{title:'Configured public-holiday treatment',text:`Recorded treatment: ${row.treatment}. Effective from ${row.effective_from}.`}]}];
 return knowledgeResult(args.query,documents,{scope});
}

export const payrollHolidayKnowledge=readContract({
 id:'read_payroll_holiday_policy',module_id:'payroll',permission:'payroll.view',version:2,label:'Legal Entity public holiday policy',
 source:'/hr/payroll',scope:'One authorized Legal Entity under the existing Payroll company policy authority.',
 discoveryPhrases:['public holiday policy','public holiday treatment','payroll holiday policy'],
 knowledge:{type:'managed_knowledge',owner:'People / Payroll',authority:'Legal Entity public-holiday policy',publication:'Effective-dated canonical policy and formula identifier.'},
 description:'Use query to retrieve the effective public holiday policy for one verified or named Legal Entity. Set effective_on only for an explicitly requested historical date. Null query and date return a bounded version catalogue. No legal interpretation, payslips, employee data or pay calculation.',
 properties:{...entityFields,query:knowledgeQuery,effective_on:{...date,nullable:true}},
 normalizeArguments:a=>a&&typeof a==='object'&&!Array.isArray(a)?{effective_on:null,...normalize(a)}:a,
 check(args){
  check(args);
  if(args.effective_on){
   const dateValue=new Date(`${args.effective_on}T00:00:00Z`);
   if(!Number.isFinite(dateValue.valueOf())||!dateValue.toISOString().startsWith(args.effective_on))throw new AssistantError('tool_arguments_invalid',400);
  }
 },
 load:loadHolidays,project:projectHolidays,
 interface:{authority:'payroll_ph_policy_read',queryKinds:['search','list'],unsupported:['Actual payroll calculations, employee terms, statutory interpretations and future policy decisions are excluded.']},
});
