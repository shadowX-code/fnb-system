import {AssistantError} from '../assistantError.js';
import {pick,readContract} from '../assistant/readContract.js';
import {alreadyPublished,knowledgeQuery,knowledgeResult,knowledgeScore,knowledgeSource,optionalId,optionalName,todayInMalaysia} from '../assistant/knowledge.js';

export async function resolveCrewKnowledgeOutlet(caller,{outlet_id,outlet_name},signal){
 if(outlet_id)return {id:outlet_id};
 if(!outlet_name)throw new AssistantError('knowledge_scope_required',400);
 const pattern=outlet_name.replace(/[\\%_]/g,'\\$&');
 const base=()=>caller.from('outlets').select('id,name,code');
 const exact=(field)=>outlet_name.includes('*')?base().eq(field,outlet_name):base().ilike(field,pattern);
 let matches=await knowledgeSource(exact('name').limit(2),signal);
 if(!matches.length)matches=await knowledgeSource(exact('code').limit(2),signal);
 if(matches.length!==1)throw new AssistantError('knowledge_scope_unresolved',409);
 return matches[0];
}

async function loadSopKnowledge(caller,args,signal){
 let outlet=args.outlet_id||args.outlet_name?await resolveCrewKnowledgeOutlet(caller,args,signal):null;
 const detail=id=>knowledgeSource(caller.rpc('crew_sop_admin_detail',{p_sop_id:id}),signal);
 if(args.sop_id){
  const row=await detail(args.sop_id);
  if(outlet&&row.outlet_id!==outlet.id)throw new AssistantError('knowledge_scope_unresolved',409);
  return {outlet:outlet||{id:row.outlet_id},rows:[row],partial:false};
 }
 outlet=outlet||await resolveCrewKnowledgeOutlet(caller,args,signal);
 const data=await knowledgeSource(caller.rpc('crew_sop_admin_library',{p_outlet_id:outlet.id}),signal);
 if(!Array.isArray(data.sops))throw new AssistantError('business_read_unavailable',503);
 const candidates=data.sops.filter(row=>row.status==='published'&&row.outlet_id===outlet.id)
  .map(row=>({row,score:knowledgeScore(args.query,`${row.title} ${row.category||''} ${row.summary||''}`)}))
  .sort((a,b)=>b.score-a.score);
 const exact=candidates.filter(({row})=>row.title?.normalize('NFKC').toLowerCase()===args.query?.normalize('NFKC').toLowerCase());
 if(exact.length>1)return {outlet,rows:[],partial:false,status:'ambiguous_source'};
 const selected=exact.length?exact:candidates.slice(0,5);
 const rows=await Promise.all(selected.map(({row})=>detail(row.id)));
 if(rows.some(row=>row.outlet_id!==outlet.id))throw new AssistantError('knowledge_scope_unresolved',409);
 return {outlet,rows,partial:!exact.length&&candidates.length>5};
}

function projectSopKnowledge(data,args){
 const today=todayInMalaysia();
 const documents=data.rows.flatMap(row=>{
  if(row.status!=='published'||row.outlet_id!==data.outlet.id||!row.current_version)return [];
  const selected=args.version??row.current_version;
  const versions=(row.versions||[]).filter(v=>v.version===selected&&v.status==='published'&&alreadyPublished(v.published_at)&&(!v.effective_date||v.effective_date<=today));
  if(versions.length!==1)return [];
  const [version]=versions;
  const current=version.version===row.current_version;
  return [{document_id:row.id,version_id:version.id,version:version.version,title:version.title||row.title,
   state:current?'published_current':'published_historical',current,published_at:version.published_at,effective_on:version.effective_date||null,
   searchTerms:[version.summary,row.category].filter(Boolean).join(' '),sections:(version.sections||[]).slice(0,60).map(s=>({
    id:s.id,title:s.title,text:[s.body,s.key_point].filter(v=>typeof v==='string').join('\n'),
   }))}];
 });
 const result=knowledgeResult(args.query,documents,{scope:{outlet_id:data.outlet.id,outlet:data.outlet.name||null},
  partial:data.partial||documents.some(doc=>doc.sections.length===60),status:data.status||(!documents.length?'no_current_version':undefined)});
 if(args.sop_id&&documents.length===1){
  const [document]=documents;
  result.sop={id:document.document_id,title:document.title,outlet_id:data.outlet.id};
  result.document_version={id:document.version_id,version:document.version,effective_date:document.effective_on,published_at:document.published_at};
  result.rows=result.knowledge.citations.map(c=>({title:c.section,body:c.excerpt}));
 }
 return result;
}

export const crewSopKnowledge=readContract({
 id:'read_crew_published_sop',module_id:'crew_sop_library',permission:'crew_sop_library.view',version:2,
 label:'Crew SOP Library published text',source:'/crew/learning/sops',scope:'One authorized outlet or known SOP. Only published current content unless an exact historical version is requested.',
 discoveryPhrases:['Crew SOP','SOP Library','workstation cleanliness','greeting standard','personal grooming','opening closing standard','门店 SOP'],
 knowledge:{type:'managed_knowledge',owner:'Crew Learning',authority:'Crew SOP Library',publication:'Current published version and effective date. Historical versions require exact SOP ID and version.'},
 description:'Search authorized Crew SOPs by topic and exact outlet name/code or verified outlet ID. Or read a known SOP ID directly. Version must be null for current. Request an older version only with the exact SOP ID and version number, and cite it as historical. Never use historical text as current operations.',
 properties:{sop_id:optionalId,outlet_id:optionalId,outlet_name:optionalName,query:knowledgeQuery,version:{type:'number',minimum:1,maximum:10000,nullable:true}},
 normalizeArguments:a=>a&&typeof a==='object'&&!Array.isArray(a)?{sop_id:null,outlet_id:null,outlet_name:null,query:null,version:null,...a}:a,
 check:a=>{if(a.outlet_id&&a.outlet_name||a.version!==null&&!a.sop_id)throw new AssistantError('tool_arguments_invalid',400);},
 load:loadSopKnowledge,project:projectSopKnowledge,
 interface:{authority:'crew_sop_admin_library → crew_sop_admin_detail',queryKinds:['search','detail'],unsupported:['Private media, drafts, archived SOPs and employee-pinned assignments are outside this read.']},
});
