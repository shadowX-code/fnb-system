import assert from 'node:assert/strict';
import {operationalCases} from './nativeAssistantOperationalCases.mjs';

const unsafeField=/^(?:api_key|access_token|refresh_token|password|passcode|bank_account_number|ic_no|symptoms|private_note|payslip_body)$/i;
const escaped=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const normalized=value=>String(value).normalize('NFKC').toLowerCase().replaceAll('_',' ').replace(/[\u2010-\u2014]/g,'-')
 .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g,'').replace(/[*`]/g,'').trim();

function fieldValue(record,path){
 let result=record;
 for(const part of path.split('.')){
  if(result===null)return null;
  if(!result||typeof result!=='object'||!Object.hasOwn(result,part))return undefined;
  result=result[part];
 }
 return result;
}
function hasSensitiveField(value){
 return value&&typeof value==='object'&&Object.entries(value).some(([key,child])=>unsafeField.test(key)||hasSensitiveField(child));
}
function aliasPattern(label){
 return normalized(label).split(/[-\s]+/).map(escaped).join('[-\\s]+');
}
const currency='(?:MYR|RM)';
function valuePattern(value,unit){
 if(value===null)return '(?:unavailable|unknown|not recorded|not available|missing)';
 if(typeof value==='boolean')return value?'(?:active|enabled|true|yes)':'(?:inactive|disabled|false|no)';
 if(typeof value!=='number')return aliasPattern(value);
 const number='(?<![\\d.\\-])'+escaped(value)+(Number.isInteger(value)?'(?:\\.0+)?':'')+'(?![\\d.]\\d|\\d)';
 if(!unit)return number;
 if(unit==='MYR')return '(?:'+currency+'\\s*'+number+'|'+number+'\\s*'+currency+')';
 const units=unit==='minutes'?'(?:minutes?|mins?)':unit==='%'?'(?:%|percent)':aliasPattern(unit);
 return number+'\\s*'+units+'(?![a-z])';
}

function answerContainsFact(reply,fact,value,unit){
 const expected=valuePattern(value,unit);
 if(typeof value==='number'||typeof value==='boolean'||value===null){
  const label=aliasPattern(fact.label||fact.path.split('.').at(-1));
  // Accept either grammatical order; never accept an unrelated figure elsewhere
  // in the answer or bind another named measure's amount across a clause.
  const bridge='(?:\\s*(?:[:=|()-]|is|was|were|of|are|at|stood at|recorded|reported|totaled|totalled|employees|records)\\s*|\\s+){0,4}';
  return new RegExp('(?:\\b'+label+'\\b'+bridge+expected+'|'+expected+bridge+'\\b'+label+'\\b)','iu').test(reply);
 }
 return new RegExp('(?<![\\p{L}\\p{N}])'+expected+'(?![\\p{L}\\p{N}])','iu').test(reply);
}

export function checkCapture(entry,source,turn,evidenceTime=turn?.created_at){
 assert(turn&&turn.request_id,'Saved authenticated turn required');
 const capture=source.capture;
 assert(capture?.environment==='staging'&&['admin_view','domain_service'].includes(capture.method),'Independent Staging owner read required');
 assert.equal(capture.module_id,entry.owner,'Independent sample comes from the wrong module');
 assert(typeof capture.authority==='string'&&capture.authority.length>0&&
  capture.authority===(capture.method==='admin_view'?entry.canonicalRoute:entry.rpc),'Wrong independent source authority');
 assert(capture.actor_ref&&capture.actor_ref===(turn.actor_ref||turn.user_id),'Actor or scope cannot be reconciled');
 const at=Date.parse(capture.at),observed=Date.parse(evidenceTime),turnTime=Date.parse(turn.created_at);
 assert([at,observed,turnTime].every(Number.isFinite),'Timestamped owner capture and saved turn required');
 if(Math.abs(at-observed)>15*60000||Math.abs(observed-turnTime)>15*60000){
  const error=Error('A contemporaneous owner capture and saved evidence within 15 minutes of this turn are required');
  error.certificationBlocker=true;
  throw error;
 }
 assert(source.scope&&typeof source.scope==='object','Independent scope is missing');
}

function compareSnapshot(entry,evidence,source,turn){
 checkCapture(entry,source,turn,evidence.as_of);
 assert.equal(evidence.source,entry.source,'Wrong saved source');
 assert(Number.isFinite(Date.parse(evidence.as_of)),'Missing evidence time');
 assert((source.expectation==='empty_page'?['SUCCESS','NO_MATCH']:['SUCCESS']).includes(evidence.query_outcome),'Wrong business evidence outcome');
 assert.deepEqual(evidence.requested_scope,source.scope,'Source and Assistant scope differ');
 assert(!hasSensitiveField(source.records)&&!hasSensitiveField(evidence),'Sensitive fields are outside this acceptance sample');
 if(entry.collection){
  const actual=fieldValue(evidence,entry.collection);
  assert(Array.isArray(actual),'Expected owner-projected records');
  assert.equal(typeof source.has_more,'boolean','Independent page completeness required');
  const boundary=entry.collection.endsWith('.rows')?fieldValue(evidence,entry.collection.slice(0,-5)+'.truncated'):evidence.truncated;
  if(typeof boundary==='boolean')assert.equal(boundary,source.has_more,'Independent page boundary differs');
  // Some authorities return named stages or a complete fixed twelve-month
  // series instead of a page. The capture still records its own row boundary.
  assert.equal(actual.length,source.records.length,'Independent scoped page size differs');
  return actual;
 }
 assert.equal(source.records.length,1,'One independent summary required');
 return [evidence];
}

function matchRecord(entry,actual,expected){
 if(!entry.collection)return actual[0];
 const keys=entry.identity.split('+');
 assert(keys.every(key=>fieldValue(expected,key)!=null),'Missing canonical row identity');
 const found=actual.filter(row=>keys.every(key=>fieldValue(row,key)===fieldValue(expected,key)));
 assert.equal(found.length,1,'Source record missing or duplicated in evidence');
 return found[0];
}

function checkOperational(entry,[evidence],reply,source,turn){
 assert(Array.isArray(source.records),'Independent selected records required');
 if(evidence.pagination_adjustment){
  const size=evidence.page_size,requested=source.scope?.page_size??20;
  assert(entry.collection==='rows'&&source.scope?.mode==='list'&&[1,5,10].includes(size)&&size<requested&&
   (evidence.page-1)*size===(source.scope.page-1)*requested,'Adaptive page changed the authorized start');
  assert(source.records.length<=requested&&typeof source.has_more==='boolean','Full original source page and boundary required');
  source={...source,records:source.records.slice(0,size),has_more:source.records.length>size||source.has_more};
 }
 const actual=compareSnapshot(entry,evidence,source,turn);
 if(source.expectation==='empty_page'){
  assert(entry.collection&&actual.length===0&&source.records.length===0,'A verified empty page is required');
  assert.match(reply,/\bno\b|\bnone\b|\bempty\b|没有|無記錄|tiada/iu);
  assert.doesNotMatch(reply,/permission denied|not authorized|not supported|access denied|zero stock|zero balance/iu);
  return;
 }
 assert(source.records.length>0,'A nonempty independent source sample is required for the positive case');
 const seen=new Set();
 let answered=false;
 const text=normalized(reply);
 assert(!/\bread_[a-z0-9_]+|outlet_id|session_id|arguments_json/i.test(reply),'Technical mechanics appeared in the final answer');
 let sample=source.records;
 if(source.target_identity){
  const keys=entry.identity?.split('+');
  assert(keys&&keys.every(key=>Object.hasOwn(source.target_identity,key))&&Object.keys(source.target_identity).length===keys.length,'Invalid selected owner record identity');
  sample=sample.filter(row=>keys.every(key=>fieldValue(row,key)===source.target_identity[key]));
  assert.equal(sample.length,1,'Independent target is missing or ambiguous');
 }
 for(const expected of sample){
  const result=matchRecord(entry,actual,expected);
  assert(!seen.has(result),'Independent samples duplicate a record');
  seen.add(result);
  if(entry.operation==='read_crew_reward_cycles')assert.equal(result.period_start,source.scope.month,'Reward cycle falls outside requested month');
  if(entry.operation==='read_purchase_comparison'&&expected.month!==Number(source.scope.month?.slice(5,7)))continue;
  const claims=[];
  for(const fact of entry.facts){
   const expectedValue=fieldValue(expected,fact.sourcePath||fact.path);
   assert(expectedValue!==undefined&&['number','string','boolean'].includes(typeof expectedValue)||expectedValue===null,'Missing independent business field '+(fact.sourcePath||fact.path));
   const got=fieldValue(result,fact.path);
   assert.deepEqual(got,expectedValue,'Business evidence differs for '+fact.path);
   let unit=fact.unit;
   if(unit&&typeof unit==='object'){
    unit=fieldValue(expected,unit.field);
    assert.deepEqual(fieldValue(result,fact.unit.field),unit,'Evidence unit differs');
    assert(typeof unit==='string'&&unit.trim(),'Missing recorded unit');
   }
   claims.push({fact,value:expectedValue,unit});
  }
  // All stated facts must belong to one source record. This rejects a name from
  // one item paired with a status or an amount from a second item.
  const sentences=entry.collection&&source.records.length>1?text.split(/\n+/):[text];
  if(sentences.some(sentence=>claims.every(({fact,value,unit})=>answerContainsFact(sentence,fact,value,unit))))answered=true;
  if(!entry.collection||source.records.length===1){
   for(const {fact,value} of claims.filter(claim=>typeof claim.value==='number')){
    const label=aliasPattern(fact.label||fact.path.split('.').at(-1));
    const stated=new RegExp('\\b'+label+'\\b\\s*(?:is|are|was|were|[:=])\\s*(?:(?:RM|MYR)\\s*)?(-?\\d+(?:\\.\\d+)?)','giu');
    for(const match of text.matchAll(stated))assert.equal(Number(match[1]),value,'Contradictory answer for '+fact.path);
   }
  }
 }
 assert(answered,'Final answer does not bind the requested facts, measurements and units to a matching source record');
 if(entry.collection&&source.has_more)
  assert(!/\b(?:complete (?:catalogue|catalog|inventory|list)|all (?:records|entries) are shown)\b/iu.test(text),'A bounded page was presented as a complete population');
 for(const omitted of source.forbidden_claims||[]){
  assert(typeof omitted==='string'&&omitted.trim(),'Invalid forbidden answer claim');
  assert(!text.includes(normalized(omitted)),'Forbidden or out-of-scope claim appeared in the reply');
 }
}

function checkDenial(entry,record){
 const {turn,source,trace}=record;
 checkCapture(entry,source,turn);
 assert(['denied','disabled'].includes(source.expectation),'Expected access boundary is required');
 const denied=source.expectation==='disabled'?['capability_disconnected']:['business_read_denied','factory_read_denied'];
 assert(trace?.some(event=>event.turn_id===turn.id&&event.session_id===turn.session_id&&event.operation===entry.operation&&denied.includes(event.outcome)),
  'A matching sanitized server denial trace is required');
 assert(turn.id&&turn.session_id,'Saved turn identity is required');
 assert(!turn.evidence?.capability&&!turn.evidence?.items?.length,'A denied query produced business evidence');
 assert.match(turn.reply,source.expectation==='disabled'?/disabled|not enabled|not available|turned off|unavailable|未启用/iu:/permi[st]|authori[sz]|access|权限|權限/iu);
 assert.doesNotMatch(turn.reply,/no matching|no records|no data|zero stock|\b0\s+(?:entries|records)/iu);
}

export function operationalScenarios(operations,canonicalRoute){
 const registered=new Map(operations.map(op=>[op.id,op]));
 return Object.fromEntries(operationalCases.map(definition=>{
  const op=registered.get(definition.operation);
  assert.equal(op?.kind,'READ','Certification must bind to a registered READ');
  const entry={...definition,owner:op.module_id,source:op.source||op.moduleInterface.source,rpc:op.rpc,canonicalRoute:canonicalRoute(op.module_id)};
  assert(entry.source,'Missing bound business source');
  return [op.id+'_owner_answer',{
   domain:entry.domain,operations:[entry.operation],question:entry.question,medium:'text',independentOwnerCheck:true,
   check:(evidence,reply,source,turn)=>checkOperational(entry,evidence,reply,source,turn),
   checkDenial:record=>checkDenial(entry,record),
  }];
 }));
}
export function operationalSourceCases(samples,scenarios){
 return samples.map(source=>{
  const id=source.operation+'_owner_answer',definition=scenarios[id];
  assert(definition?.independentOwnerCheck,'Source sample has no operational-answer contract');
  assert(typeof source.scope_label==='string'&&source.scope_label.trim()&&source.scope_label.length<=300,'Human-readable authorized scope required');
  assert(!/[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}/i.test(source.scope_label),'Do not put internal identifiers in the question');
  return {id,question:source.scope_label.trim()+'. '+definition.question,source};
 });
}
