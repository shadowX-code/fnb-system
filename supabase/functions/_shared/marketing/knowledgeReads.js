import {AssistantError} from '../assistantError.js';
import {readContract,rowsEvidence} from '../assistant/readContract.js';
import {knowledgeQuery,knowledgeResult,knowledgeSource,optionalId,optionalName,preferNamedScope} from '../assistant/knowledge.js';
import {resolveBrand} from '../assistant/entityResolution.js';

const scopeFields={brand_id:optionalId,brand_name:optionalName,query:knowledgeQuery};
const normalize=a=>a&&typeof a==='object'&&!Array.isArray(a)?preferNamedScope({brand_id:null,brand_name:null,query:null,...a},'brand_id','brand_name'):a;
async function brandScope(caller,args,signal){
 if(args.brand_id)return {id:args.brand_id};
 if(!args.brand_name)throw new AssistantError('knowledge_scope_required',400);
 const brand=await resolveBrand(caller,args.brand_name,signal);
 if(!brand)throw new AssistantError('entity_unresolved',409);
 return brand;
}
const approvedFaqs=payload=>(payload.faqs||[]).filter(row=>row.status==='approved'&&row.is_active===true&&row.use_issue===null
 &&(row.knowledge_revision===0||row.knowledge_revision===payload.knowledge?.revision&&payload.knowledge?.approved_for_replies===true));

async function loadFaq(caller,args,signal){
 const brand=await brandScope(caller,args,signal);
 const data=await knowledgeSource(caller.rpc('marketing_faq_settings_read',{p_brand:brand.id}),signal);
 return {brand,data};
}
function projectFaq({brand,data},args){
 const rows=data.policy?.ai_allowed===true?approvedFaqs(data):[];
 const documents=rows.map(row=>({
  document_id:row.id,version:row.revision,title:row.question,state:'approved_active',current:true,modified_at:row.updated_at,
  sections:[{title:'Approved answer',text:row.answer}],searchTerms:(row.alternative_questions||[]).join(' '),
 }));
 return knowledgeResult(args.query,documents,{scope:{brand_id:brand.id,brand:brand.name||null},
  status:data.policy?.ai_allowed!==true?'source_ai_not_allowed':!documents.length?'no_current_version':undefined});
}

async function loadBrand(caller,args,signal){
 const brand=await brandScope(caller,args,signal);
 const data=await knowledgeSource(caller.rpc('marketing_knowledge_workspace',{p_brand:brand.id}),signal);
 // The second canonical authority verifies approval/AI consent at the same revision.
 const eligibility=args.query?await knowledgeSource(caller.rpc('marketing_faq_settings_read',{p_brand:brand.id}),signal):null;
 return {brand,data,eligibility};
}
const fields={identity:'Brand identity',positioning:'Brand positioning',audience:'Brand audience',voice:'Brand voice'};
function projectBrand({brand,data,eligibility},args){
 if(!args.query)return {...rowsEvidence(data.customer_knowledge,['id','kind','revision','state','filename','mime_type','updated_at','confirmed_at']),
  knowledge_approval_revision:data.knowledge_approval_revision,knowledge_confirmed_revision:data.knowledge_confirmed_revision};
 const scope={brand_id:brand.id,brand:brand.name||null};
 if(eligibility?.policy?.ai_allowed!==true)return knowledgeResult(args.query,[],{scope,status:'source_ai_not_allowed'});
 const rows=(data.knowledge||[]).filter(row=>row.brand_id===brand.id&&row.revision===data.knowledge_approval_revision
  &&row.revision===eligibility.knowledge?.revision&&eligibility.knowledge?.approved_for_replies===true);
 if(rows.length!==1)return knowledgeResult(args.query,[],{scope,status:'no_current_version'});
 const [profile]=rows;
 const sections=Object.entries(fields).flatMap(([key,title])=>{
  const value=profile.profile?.[key];
  return value?.provenance==='verified_brand_fact'&&typeof value.text==='string'?[{id:key,title,text:value.text}]:[];
 });
 return knowledgeResult(args.query,[{document_id:brand.id,version:profile.revision,title:'Approved Brand Knowledge',
  state:'approved_current_revision',current:true,modified_at:profile.updated_at,sections}],{scope});
}

export const marketingFaqKnowledge=readContract({
 id:'read_marketing_usable_faq',module_id:'marketing_faq',permission:'marketing_inbox.view',version:2,label:'Approved Brand FAQ answers',
 source:'/marketing/faq-ai',scope:'Authorized Brand under Marketing Inbox access and Brand AI consent. Approved active FAQs passing current use checks.',
 discoveryPhrases:['approved FAQ','brand FAQ','customer FAQ','FAQ answer'],
 knowledge:{type:'managed_knowledge',owner:'Marketing',authority:'FAQ Library',publication:'Current approved, active revision and canonical use decision.'},
 description:'Search current approved FAQ answers for an exact named Brand or verified Brand ID. A draft or stale FAQ cannot answer. Use live operational READs for current stock, prices, hours or promotions.',
 properties:scopeFields,normalizeArguments:normalize,load:loadFaq,project:projectFaq,
 interface:{authority:'marketing_faq_settings_read',queryKinds:['search','list'],unsupported:['Draft, disabled, outdated or unsafe FAQs and private customer conversations are excluded.']},
});

export const marketingBrandKnowledge=readContract({
 id:'read_marketing_knowledge_sources',module_id:'marketing_knowledge',permission:'marketing_settings.view',version:2,label:'Current approved Brand Knowledge',
 source:'/marketing/brand-knowledge',scope:'Authorized Brand. Text requires existing Marketing Settings and Inbox authority, current approved revision and Brand AI consent.',
 discoveryPhrases:['Brand Knowledge','brand voice','brand identity','brand positioning','brand tone'],
 knowledge:{type:'managed_knowledge',owner:'Marketing',authority:'Brand Knowledge and approved-reply snapshot',publication:'The current Brand revision must match the approved revision and carry verified facts.',additional_permissions:['marketing_inbox.view']},
 description:'Search approved Brand identity, positioning, audience or voice using query and one exact named Brand or verified Brand ID. Null query returns source metadata. Content requires current Brand AI consent and Inbox access. No research, historical prices, live outlet facts or private files.',
 properties:scopeFields,normalizeArguments:normalize,load:loadBrand,project:projectBrand,
 interface:{authority:'marketing_knowledge_workspace + marketing_faq_settings_read',queryKinds:['search','list'],
  unsupported:['Uploaded files, research, unapproved profile fields, historical revisions, contact and operational fields are excluded.']},
});
