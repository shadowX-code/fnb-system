import {AssistantError} from '../assistantError.js';
import {page,readContract,rowsEvidence} from '../assistant/readContract.js';
import {knowledgeQuery,knowledgeResult,knowledgeScore,knowledgeSource,optionalId,todayInMalaysia} from '../assistant/knowledge.js';

const fields=['id','sop_code','title','product_name','finished_good_id','recipe_id','recipe_version','version','effective_date','status','updated_at'];
const roots=fields.join(',');
const steps='steps:factory_production_sop_steps(id,step_no,process_name,instruction,description,control_point,safety_note,is_qc_checkpoint,qc_label,qc_measurement_type,qc_target_value,qc_minimum,qc_maximum,qc_uom,qc_required_before_completion,sub_steps:factory_production_sop_sub_steps(id,sequence_no,instruction),qc_checks:factory_production_sop_step_qc_checks(id,sequence_no,qc_name,instructions,is_required))';

async function readFactorySop(caller,args,signal){
 const root=()=>caller.from('factory_production_sops');
 if(!args.query&&!args.sop_id){
  const rows=await knowledgeSource(root().select(roots).order('id').range((args.page-1)*20,args.page*20),signal);
  return {rows,catalogue:true};
 }
 const today=todayInMalaysia();
 const base=columns=>root().select(columns).eq('status','active');
 let ids=args.sop_id?[args.sop_id]:null;
 let partial=false;
 if(!ids){
  const rows=await knowledgeSource(base(roots).order('id').limit(51),signal);
  const eligible=rows.slice(0,50).filter(r=>!r.effective_date||r.effective_date<=today);
  const exact=eligible.filter(r=>[r.title,r.sop_code,r.product_name].some(term=>term?.toLowerCase()===args.query.toLowerCase()));
  if(exact.length>1)return {rows:[],status:'ambiguous_source'};
  const ranked=eligible.map(row=>({row,score:knowledgeScore(args.query,`${row.title} ${row.sop_code} ${row.product_name}`)})).sort((a,b)=>b.score-a.score);
  ids=(exact.length?exact:ranked.slice(0,4).map(choice=>choice.row)).map(row=>row.id);
  partial=rows.length>50||!exact.length&&ranked.length>4;
 }
 const rows=ids.length?await knowledgeSource(base(roots+','+steps).in('id',ids)
  .order('step_no',{referencedTable:'steps'}).limit(41,{referencedTable:'steps'}),signal):[];
 return {rows:rows.filter(r=>r.status==='active'&&(!r.effective_date||r.effective_date<=today)),partial};
}

function qcInstructions(step){
 if(!(step.is_qc_checkpoint||step.qc_required_before_completion||step.qc_measurement_type))return '';
 const unit=step.qc_uom||'';
 return [
  step.qc_measurement_type,step.qc_target_value==null?'':`Recorded target ${step.qc_target_value} ${unit}`,
  step.qc_minimum==null?'':`Recorded minimum ${step.qc_minimum} ${unit}`,
  step.qc_maximum==null?'':`Recorded maximum ${step.qc_maximum} ${unit}`,
  step.qc_required_before_completion?'Required before completion.':'',
 ].filter(Boolean).join('. ');
}
function projectFactorySop(data,args){
 if(data.catalogue)return rowsEvidence(data.rows,fields);
 const documents=data.rows.map(sop=>({
  document_id:sop.id,version_id:sop.id,version:sop.version,title:sop.title,state:'active_current',current:true,
  effective_on:sop.effective_date,modified_at:sop.updated_at,recipe_version:sop.recipe_version,
  searchTerms:`${sop.sop_code||''} ${sop.product_name||''}`,
  sections:(sop.steps||[]).slice(0,40).flatMap(step=>[
   {id:step.id,title:`Step ${step.step_no} · ${step.process_name||'Production'}`,text:[step.instruction,step.description,step.control_point,step.safety_note].filter(Boolean).join('\n')},
   ...(step.sub_steps||[]).slice().sort((a,b)=>a.sequence_no-b.sequence_no).slice(0,20).map(sub=>({id:sub.id,title:`Step ${step.step_no}.${sub.sequence_no} · Sub-step`,text:sub.instruction})),
   {id:step.id,title:step.qc_label||`Step ${step.step_no} · QC requirements`,text:qcInstructions(step)},
   ...(step.qc_checks||[]).slice().sort((a,b)=>a.sequence_no-b.sequence_no).slice(0,20).map(qc=>({
    id:qc.id,title:`Step ${step.step_no} · QC · ${qc.qc_name}`,text:[qc.instructions,qc.is_required?'Required check.':'Optional check.'].filter(Boolean).join(' '),
   })),
  ]),
 }));
 return knowledgeResult(args.query,documents,{scope:{factory:'shared_master_catalogue'},
  partial:data.partial||data.rows.some(row=>row.steps?.length>40||row.steps?.some(step=>step.sub_steps?.length>20||step.qc_checks?.length>20)),
  status:data.status||(!documents.length?'no_current_version':undefined)});
}

export const factorySopKnowledge=readContract({
 id:'read_factory_sop_versions',module_id:'factory_production_sop',permission:'factory_production_sop.view',version:2,
 label:'Factory Production SOP and QC instructions',source:'/factory/master-data/production-sops',scope:'Factory shared SOP authority. Instructions from active, effective versions only.',
 discoveryPhrases:['Factory SOP','production SOP','production instructions','Factory QC','QC instructions','生产 SOP','工厂 SOP'],
 knowledge:{type:'managed_knowledge',owner:'Factory',authority:'Factory Production SOP',publication:'Active version, effective date and pinned Recipe version.'},
 description:'Search active Factory Production SOP instructions, steps and specified QC requirements by product/SOP title or topic. Set query for excerpts or use exact sop_id. With both null only paged version metadata is returned. Archived or draft text and actual batch QC readings are excluded.',
 properties:{page,sop_id:optionalId,query:knowledgeQuery},
 normalizeArguments:a=>a&&typeof a==='object'&&!Array.isArray(a)?{page:1,sop_id:null,query:null,...a}:a,
 check:a=>{if((a.sop_id||a.query)&&a.page!==1)throw new AssistantError('tool_arguments_invalid',400);},
 load:readFactorySop,project:projectFactorySop,
 interface:{authority:'Factory Production SOP canonical root, step, sub-step and QC projections under human RLS',queryKinds:['list','search','detail'],
  unsupported:['Draft or archived instructions, private attachments, QC results and active stock are separate.']},
});
