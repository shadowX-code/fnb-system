import {AssistantError} from '../_shared/assistantError.js';
import {entityKey,namedOutlets,outletDirectory} from '../_shared/assistant/entityResolution.js';
import {correctedOutletWording,outcomeFor} from './businessQuery.js';

const marker=/\b(?:i meant|maksud saya|correction|correct (?:outlet|year))\b|我(?:的意思|是说|是說|说的是|說的是)|更正/iu;
const yearWords=/\b(?:year|tahun|this year|last year)\b|今年|去年|年份|20\d{2}\s*年/iu;
const checkAccess=/\b(?:can you (?:see|access)|why can.t you (?:see|access))\b|(?:看不到|查不到|还能|還能|查得到|可以查看).{0,20}(?:数据|資料|记录|記錄)/iu;
const spelled=/\b[a-z](?:[\s\p{Pd},，.]+[a-z]){2,}\b/iu;

function correctionYear(text){
 const years=[...new Set(text.match(/\b20\d{2}\b/gu)||[])];
 return years.length===1&&(yearWords.test(text)||/^20\d{2}[ .?!。？]*$/u.test(text))?Number(years[0]):null;
}

function nameCorrection(directory,text) {
 const words=entityKey(correctedOutletWording(text).replace(/[哦喔啊呀啦。！!]+$/u,'').trim());
 const exact=namedOutlets(directory,text).filter(o=>(' '+words+' ').includes(' '+entityKey(o.name)+' ')||words===entityKey(o.code));
 if(exact.length>1)throw new AssistantError('entity_ambiguous',409);
 const letters=text.match(spelled)?.[0]?.replace(/[^a-z]/giu,'').toLowerCase();
 if(letters){
  const matches=directory.filter(o=>entityKey(o.code)===letters||entityKey(o.name).split(' ').includes(letters));
  if(matches.length>1||exact.length&&matches.length&&matches[0].id!==exact[0].id)throw new AssistantError('entity_ambiguous',409);
  return matches[0]||null;
 }
 if(marker.test(text)||yearWords.test(text))return exact[0]||null;
 const phrase=entityKey(text.replace(/[.?!。？！]+$/u,'').split(/[,，]/u).at(-1));
 const whole=exact.find(o=>[o.name,o.code].some(value=>entityKey(value)===phrase));
 if(whole)return whole;
 const prefixes=phrase.includes(' ')&&phrase.length>=10?directory.filter(o=>entityKey(o.name).startsWith(phrase+' ')):[];
 if(prefixes.length>1)throw new AssistantError('entity_ambiguous',409);
 return prefixes[0]||null;
}

// Only user turns and canonical query evidence participate. Provider replies,
// summaries and tool arguments can never supply an outlet or reporting period.
export async function resumeScopedTask({prompt,history,planned,operationFor,caller,signal}){
 if(!history||!caller||typeof prompt!=='string'||prompt.length>180)return null;
 const recent=(await history())?.turns?.filter(t=>typeof t.prompt==='string'&&t.voice_input_available!==false).slice(-8)||[];
 const fragments=[];
 let anchor;
 for(const turn of recent.toReversed()){
  const owner=planned(turn.prompt);
  if(owner){
   if(!owner.prepareArguments||!owner.tool.parameters.properties.outlet_id)return null;
   anchor={owner,wording:turn.prompt,outlet:null};
   break;
  }
  const items=turn.evidence?.items||[turn.evidence];
  const verified=items.filter(e=>e?.requested_scope&&outcomeFor(e)==='SUCCESS');
  if(verified.length===1){
   const [e]=verified;
   const owner=operationFor(e.capability);
   if(owner?.prepareArguments&&owner.source===e.source&&owner.version===e.version&&e.outlet?.id){
    // A successful previous correction supplies verified scope after reconnect.
    const original=recent.slice(0,recent.indexOf(turn)).toReversed().find(previous=>planned(previous.prompt));
    const wording=original&&planned(original.prompt).id===owner.id?original.prompt:turn.prompt;
    anchor={owner,wording,outlet:e.outlet,args:e.requested_scope};
   }
   break;
  }
  if(verified.length||turn.prompt.length>180)break;
  fragments.unshift(turn.prompt);
 }
 if(!anchor)return null;
 const year=correctionYear(prompt);
 const explicit=marker.test(prompt)||Boolean(prompt.match(spelled));
 // Questions and new tasks should not be treated as an outlet-only answer.
 if(!year&&!explicit&&(/[?？]/u.test(prompt)||checkAccess.test(prompt)))return null;
 const directory=await outletDirectory(caller,signal);
 const correction=nameCorrection(directory,prompt);
 if(!correction&&!year&&!explicit)return null;
 const originalOutlets=anchor.outlet?[]:namedOutlets(directory,anchor.wording);
 let outlet=anchor.outlet||(originalOutlets.length===1?originalOutlets[0]:null);
 let confirmedYear=null;
 for(const fragment of fragments){
  const correction=nameCorrection(directory,fragment);
  if(!correction&&!correctionYear(fragment)&&!marker.test(fragment)&&!checkAccess.test(fragment)&&!spelled.test(fragment))return null;
  if(correction||marker.test(fragment)||spelled.test(fragment))outlet=correction;
  confirmedYear=correctionYear(fragment)??confirmedYear;
 }
 if(correction||explicit)outlet=correction;
 confirmedYear=year??confirmedYear;
 let args=anchor.args||anchor.owner.prepareArguments(anchor.wording);
 if(confirmedYear&&anchor.owner.resumeYear)args=anchor.owner.resumeYear(anchor.wording,args,confirmedYear);
 if(!args)return null;
 return {...anchor,outlet,args};
}
