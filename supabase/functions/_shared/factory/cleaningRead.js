import {knowledgeQuery,knowledgeResult} from '../assistant/knowledge.js';
import {readContract} from '../assistant/readContract.js';

const normalizedMethod=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();

export const cleaningRead=readContract({
 id:'read_factory_cleaning_methods',module_id:'factory_mesti_cleaning',version:2,label:'Cleaning method references',
 permission:'factory_mesti_cleaning.view',scope:'Factory reference methods, not execution/compliance evidence',source:'/factory/mesti/cleaning',
 knowledge:{type:'managed_knowledge',owner:'Factory MeSTI',authority:'Cleaning method reference',publication:'Current versioned canonical reference methods.'},
 discoveryPhrases:['cleaning method reference','MeSTI cleaning methods','Clean-in-Place method','sanitization instructions'],
 description:'Read canonical versioned MeSTI cleaning method reference instructions. Null query lists the references. These do not establish dilution or chemical safety parameters, execution, verification or compliance.',
 properties:{query:knowledgeQuery},normalizeArguments:args=>args&&typeof args==='object'&&!Array.isArray(args)?{query:null,...args}:args,
 rpc:'factory_mesti_cleaning_methods',arguments:()=>({}),
 project(data,args){
  const limitations='Reference-only instructions; reference_version belongs to each method.';
  if(!args.query)return {rows:data,total_matching:data.length,limitations};
  const references=data.filter(row=>row.reference_only===true);
  const query=' '+normalizedMethod(args.query)+' ';
  const matching=references.filter(row=>row.name&&query.includes(' '+normalizedMethod(row.name)+' '))
   .sort((a,b)=>normalizedMethod(b.name).length-normalizedMethod(a.name).length);
  // A named versioned method takes precedence over overlapping words in another method.
  const longest=normalizedMethod(matching[0]?.name).length;
  const exact=matching.filter(row=>normalizedMethod(row.name).length===longest);
  const scope={factory:'shared_master_catalogue'};
  if(exact.length>1)return {limitations,...knowledgeResult(args.query,[],{scope,status:'ambiguous_source'})};
  const documents=(exact.length?exact:references).map(row=>({
   document_id:row.code,version:row.reference_version,title:row.name,state:'current_reference',current:true,
   sections:[{title:'Reference method',text:(row.steps||[]).filter(Boolean).join('; ')}],
  }));
  return {limitations,...knowledgeResult(args.query,documents,{scope})};
 },
 testArguments:{},
});
