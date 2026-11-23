import rules from './operationalGuidance.json' with {type:'json'};
import {knowledgeResult,knowledgeScore} from './knowledge.js';
import {permitted} from './readContract.js';

export const workflowFollowUp = prompt => /^(?:what happens (?:next|after that)|and then|what about that workflow|what if that fails|然后呢|接下来呢|selepas itu)[?？.! ]*$/iu.test(prompt?.trim()||'');

export const asksWorkflow = prompt => typeof prompt==='string' && (workflowFollowUp(prompt) || /\b(?:workflow|lifecycle|troubleshoot|discrepancy|how does|what happens|why does|what triggers|who owns|how is .* approved|why might|how do .* work)\b|工作流程|为什么|為什麼|如何运作|流程|aliran kerja|kenapa/iu.test(prompt));

// Rare subject terms distinguish owners better than shared words such as
// "approved", "period" and "records". Keep the trusted retriever for excerpts.
const terms=text=>new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).filter(t=>t.length>=3));
const vocabulary=rules.map(r=>terms(r.source+' '+r.text));
const frequencies=new Map();
for(const words of vocabulary)for(const word of words)frequencies.set(word,(frequencies.get(word)||0)+1);
function relevance(topic,rule){
 const words=terms(rule.text+' '+rule.source);
 return [...terms(topic)].reduce((sum,word)=>sum+(words.has(word)?Math.log((rules.length+1)/(frequencies.get(word)||1)):0),0);
}

// Only release documentation is searchable here. Current records and published
// tenant documents retain their separate source, scope and execution checks.
export async function workflowKnowledge(query,operations,allowed,caller,signal,context={}){
 let previousOwner;
 if(workflowFollowUp(context.prompt)){
  const turn=(await context.history?.())?.turns?.at(-1);
  if(turn?.state!=='completed'||turn.tool_state!=='completed')return [];
  const items=turn.evidence?.items||[turn.evidence];
  const references=items.filter(e=>e?.capability==='read_assistant_system_guidance').flatMap(e=>e.knowledge?.citations||[]);
  const ids=new Set(references.map(c=>c.read_owner).filter(Boolean));
  if(ids.size!==1)return [];
  previousOwner=[...ids][0];
 }
 const topic=query?.replace(/\b(?:workflow|workflows|lifecycle|troubleshoot|rules?|explain|documented|happens|please|does|why|what|when|how|the|a|an|and|is|it|of|at|to|for)\b/giu,' ').replace(/\s+/g,' ').trim();
 if(!topic&&!previousOwner)return [];
 const documents=[];
 const owners=new Map();
 for(const rule of rules){
  const ownersForRule=operations.filter(op=>op.kind==='READ'&&(!previousOwner||op.id===previousOwner)&&allowed(op)&&
   rule.modules.some(id=>id===op.module_id||op.related_module_ids?.includes(id)));
  if(!ownersForRule.length)continue;
  const id='workflow-'+rule.source+'-'+rule.version;
  owners.set(id,ownersForRule[0]);
  documents.push({document_id:id,version:rule.version,title:rule.source.replaceAll('-',' '),
   source:'docs/domains/'+rule.source+'.md',state:'current_release',current:true,
   searchTerms:ownersForRule.map(o=>o.label).join(' '),sections:[{id:rule.version,title:rule.section,text:rule.text}]});
 }
 // Reuse the live Semantic Catalog for ownership and metric definitions. A
 // contract citation describes what can be measured; it contains no observed values.
 const search=previousOwner&&workflowFollowUp(query)?null:topic;
 const scope={type:'documented_workflow'};
 const ranked=documents.map(doc=>({doc,score:relevance(search||'',{source:doc.title,text:doc.sections[0].text})})).sort((a,b)=>b.score-a.score);
 const threshold=(ranked[0]?.score||0)*0.55;
 const words=(search||'').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
 const phrases=words.slice(1).map((w,i)=>words[i]+' '+w).filter(p=>p.split(' ').every(w=>w.length>=3&&(frequencies.get(w)||0)<rules.length/5));
 const relevant=ranked.filter(({doc,score})=>score>=threshold||phrases.some(phrase=>doc.sections[0].text.toLowerCase().includes(phrase))).map(row=>row.doc);
 const workflowHits=knowledgeResult(search,relevant,{scope}).knowledge.citations;
 const contracts=operations.filter(op=>op.kind==='READ'&&allowed(op)&&(!previousOwner||op.id===previousOwner))
  .map(op=>({op,score:knowledgeScore(search||query,[op.label,...op.discoveryPhrases||[]].join(' '))}))
  .filter(row=>row.score>0).sort((a,b)=>b.score-a.score).slice(0,4)
  .map(({op})=>{
   const semantics=op.moduleInterface.semantics;
   const sections=[{id:'scope',title:'Authorized information',text:op.scope},
    ...(semantics?.relationships||[]).map((text,i)=>({id:'relation-'+i,title:'Business relationship',text})),
    ...Object.entries(semantics?.metrics||{}).map(([id,m])=>({id,title:'Metric definition',text:m.definition}))];
   const id='contract-'+op.id;
   owners.set(id,op);
   return {document_id:id,version:op.version,title:op.label,source:op.source,state:'current_release',current:true,sections};
  });
 const ruleOwners=new Set(workflowHits.map(c=>owners.get(c.document_id).id));
 const contractHits=knowledgeResult(search,contracts.filter(c=>!ruleOwners.size||ruleOwners.has(owners.get(c.document_id).id)),{scope}).knowledge.citations;
 const citations=workflowHits.length&&contractHits.length?[...workflowHits.slice(0,3),contractHits[0]]:[...workflowHits,...contractHits];

 const checked=new Set();
 for(const citation of citations){
  const op=owners.get(citation.document_id);
  citation.read_owner=op.id;
  citation.source_kind=citation.document_id.startsWith('contract-')?'query_definition':'documented_rule';
  for(const permission of [op.permission,...op.knowledge?.additional_permissions||[]]){
   if(!checked.has(permission)){await permitted(caller,permission,signal);checked.add(permission);}
  }
 }
 return citations;
}
