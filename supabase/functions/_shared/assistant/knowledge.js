import {AssistantError} from '../assistantError.js';
import {uuid} from './readContract.js';

export const optionalId={...uuid,nullable:true};
export const optionalName={type:'string',nullable:true,maxLength:120};
export const knowledgeQuery={type:'string',nullable:true,maxLength:160,description:'A short topic or document title. Null lists a small number of current excerpts.'};

export function preferNamedScope(args,idKey,nameKey){
 if(typeof args[nameKey]!=='string'||!args[nameKey].trim())return args;
 return {...args,[nameKey]:args[nameKey].trim(),[idKey]:null};
}

const stopWords=new Set('a an and are at by can could do does for from how i in is it me of on or our please should that the to what when where which with you your current published approved show tell use version know source sop'.split(' '));
const concepts=[
 ['cleanliness','cleaning','sanitation','hygiene','sanitize','clean','kebersihan','清洁','清潔','卫生','衛生'],
 ['greeting','greet','welcome','goodbye','farewell','sambutan','欢迎','歡迎','告别','告別'],
 ['qc','quality check','quality control','inspection','checkpoint','checklist','质检','質檢'],
 ['temperature','thermal','heat','suhu','温度','溫度'],
 ['identity','brand name','brand story','品牌名称','品牌名稱'],
 ['tone','voice','writing style','communication','语气','語氣'],
 ['holiday','public holiday','gazetted holiday','cuti umum','公共假期'],
 ['termination','notice period','resignation','resign','辞职','辭職'],
];
const folded=value=>String(value??'').normalize('NFKC').toLowerCase();
const tokens=value=>new Set((folded(value).match(/[\p{L}\p{N}]+/gu)||[]).filter(word=>!stopWords.has(word)));
const contains=(text,phrase)=>/^[a-z]+$/.test(phrase)?new RegExp(`\\b${phrase}\\b`,'u').test(text):text.includes(phrase);

function match(query,text){
 const q=folded(query).trim(),haystack=folded(text);
 if(!q)return {score:1,mode:'browse'};
 const terms=tokens(haystack);
 const overlap=[...tokens(q)].reduce((count,term)=>count+Number(terms.has(term)||(term.length>=2&&/\p{Script=Han}/u.test(term)&&haystack.includes(term))),0);
 const exact=haystack.includes(q);
 const conceptMatch=concepts.some(group=>group.some(phrase=>contains(q,phrase))&&group.some(phrase=>contains(haystack,phrase)));
 return {score:(exact?10:0)+overlap*3+(conceptMatch?2:0),mode:exact||overlap?'keyword':'concept'};
}

export function knowledgeScore(query,text){return match(query,text).score;}

export function plainKnowledge(value){
 if(typeof value!=='string')return '';
 return value.replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi,' ')
  .replace(/<\/?(?:p|div|li|br|h[1-6]|tr)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' ')
  .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g,entity=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' ','&#39;':"'"})[entity])
  .replace(/[\t\r ]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
}

export const todayInMalaysia=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const alreadyPublished=value=>typeof value==='string'&&Date.parse(value)<=Date.now();

export async function knowledgeSource(query,signal){
 const {data,error}=await query.abortSignal(signal);
 if(error||data==null)throw new AssistantError(error?.code==='42501'?'business_read_denied':'business_read_unavailable',error?.code==='42501'?403:503);
 return data;
}

export function exactScope(rows,id,name,label){
 const matches=rows.filter(row=>id?row.id===id:folded(label(row)).trim()===folded(name).trim());
 if(matches.length!==1)throw new AssistantError('knowledge_scope_unresolved',409);
 return matches[0];
}

export function knowledgeResult(query,documents,{scope,partial=false,status}){
 const candidates=[];
 for(const document of documents){
  const {sections,...citation}=document;
  if(!document.document_id||document.version==null||!document.title||!document.state)continue;
  const headingText=`${document.title} ${document.searchTerms||''}`;
  const heading=match(query,headingText);
  const headingWords=tokens(headingText);
  const topic=[...tokens(query)].filter(term=>!headingWords.has(term)).join(' ');
  for(const [index,section] of sections.entries()){
   const text=plainKnowledge(section.text);
   if(!text)continue;
   const scores=text.split(/(?<=[.!?。！？])\s+|\n+/u).filter(Boolean).map((part,order)=>{
    const searchable=`${section.title||''} ${part}`;
    const relevance=match(query,searchable),specific=topic?match(topic,searchable):{score:0};
    return {part,order,score:relevance.score+2*specific.score,mode:specific.mode||relevance.mode};
   });
   const best=scores.reduce((top,part)=>part.score>top.score?part:top,scores[0]);
   if(!best||!heading.score&&!best.score)continue;
   const excerpt=Array.from(best.score?scores.slice(best.order,best.order+2).map(part=>part.part).join(' '):text).slice(0,520).join('');
   const {searchTerms:_,...identity}=citation;
   candidates.push({score:heading.score+best.score,
    citation:{...identity,section:section.title||`Section ${index+1}`,section_id:section.id||null,excerpt,match:best.score?best.mode:heading.mode}});
  }
 }
 const citations=candidates.sort((a,b)=>b.score-a.score).slice(0,4).map(row=>row.citation);
 return {knowledge:{status:status||(citations.length?'found':'no_matching_excerpt'),scope,citations,
  coverage:partial||candidates.length>4?'bounded_excerpt_selection':'excerpt_selection',
  freshness:'Canonical source checked for this request. Excerpts are bounded and do not establish a current operational measure.'}};
}
