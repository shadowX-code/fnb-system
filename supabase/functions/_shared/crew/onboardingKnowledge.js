import {AssistantError} from '../assistantError.js';
import {alreadyPublished,knowledgeQuery,knowledgeResult,knowledgeSource,optionalId,optionalName} from '../assistant/knowledge.js';
import {pick,readContract,rowsEvidence} from '../assistant/readContract.js';
import {resolveCrewKnowledgeOutlet} from './sopKnowledge.js';

const fields=['id','name','journey_type','status','version','outlet_id','published_at','updated_at','modules','modules_truncated'];
async function loadOnboarding(caller,args,signal){
 const outlet=await resolveCrewKnowledgeOutlet(caller,args,signal);
 const rows=await knowledgeSource(caller.rpc('crew_admin_onboarding_list',{p_outlet_id:outlet.id}),signal);
 if(!args.query)return {outlet,rows,catalogue:true};
 // Match the private crew_current_onboarding_for_outlet authority using its
 // scoped Admin list. Older published versions can remain assigned privately.
 const order=(a,b)=>b.version-a.version||String(b.published_at||'').localeCompare(String(a.published_at||''))||
  String(b.created_at||'').localeCompare(String(a.created_at||''));
 const [current,next]=rows.filter(row=>row.status==='published'&&row.outlet_id===outlet.id).sort(order);
 if(!current||!alreadyPublished(current.published_at))return {outlet,rows:[]};
 if(next&&order(current,next)===0)return {outlet,rows:[],status:'ambiguous_source'};
 const detail=await knowledgeSource(caller.rpc('crew_admin_onboarding_detail',{p_journey_id:current.id}),signal);
 const eligible=detail.id===current.id&&detail.version===current.version&&detail.is_mandatory_onboarding===true&&
  detail.status==='published'&&detail.outlet_id===outlet.id&&detail.published_at===current.published_at;
 return {outlet,rows:eligible?[detail]:[]};
}
function projectOnboarding(data,args){
 if(data.catalogue)return rowsEvidence(data.rows.map(row=>({...pick(row,fields.slice(0,8)),
  modules:(row.modules||[]).slice(0,8).map(module=>({...pick(module,['id','title','status','required']),lesson_count:(module.lessons||[]).length})),
  modules_truncated:(row.modules||[]).length>8})),fields,5);
 const documents=data.rows.map(row=>({document_id:row.id,version_id:row.id,version:row.version,title:row.name,state:'published_current',current:true,published_at:row.published_at,
  sections:(row.modules||[]).flatMap(module=>(module.lessons||[]).flatMap(lesson=>(lesson.blocks||[]).filter(block=>['text','key_point'].includes(block.block_type))
   .map(block=>({id:block.id,title:`${module.title} · ${lesson.title}`,text:block.payload?.body_html||block.payload?.body})))).slice(0,60)}));
 return knowledgeResult(args.query,documents,{scope:{outlet_id:data.outlet.id,outlet:data.outlet.name||null},
  partial:documents.some(doc=>doc.sections.length===60),status:data.status||(!documents.length?'no_current_version':undefined)});
}
export const crewOnboardingKnowledge=readContract({
 id:'read_crew_onboarding_catalogue',module_id:'crew_learning',permission:'crew_learning.manage',version:2,label:'Crew Onboarding published lessons',
 source:'/crew/learning',scope:'One authorized outlet; Admin Onboarding curriculum and current published lesson text.',
 discoveryPhrases:['crew onboarding lessons','onboarding curriculum','published onboarding','Crew Onboarding'],
 knowledge:{type:'managed_knowledge',owner:'Crew Learning',authority:'Onboarding published lessons',publication:'Current published mandatory Onboarding version under existing Admin learning authority.'},
 description:'Search current Crew Onboarding lesson text for an exact outlet name/code or verified outlet ID. Null query returns existing curriculum metadata. Does not read draft lessons, quiz answers, personal assignments or private media.',
 properties:{outlet_id:optionalId,outlet_name:optionalName,query:knowledgeQuery},
 normalizeArguments:a=>a&&typeof a==='object'&&!Array.isArray(a)?{outlet_id:null,outlet_name:null,query:null,...a}:a,
 check:a=>{if(a.outlet_id&&a.outlet_name)throw new AssistantError('tool_arguments_invalid',400);},
 load:loadOnboarding,project:projectOnboarding,
 interface:{authority:'crew_admin_onboarding_list → crew_admin_onboarding_detail',queryKinds:['search','list'],
  unsupported:['Draft text, quizzes, media and employee assignment snapshots are excluded.']},
});
