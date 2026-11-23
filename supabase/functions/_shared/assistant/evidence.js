import {AssistantError} from '../assistantError.js';

function requireEvidence(condition) {
 if (!condition) throw new AssistantError('business_read_unavailable',503);
}

const count=value=>Number.isSafeInteger(value)&&value>=0;

// This runs after the owning read checked the human caller. Metadata cannot
// substitute for that check. Report a source error if a projection disagrees.
export function verifyReadEvidence(contract,operation,evidence,args) {
 requireEvidence(evidence.capability===operation && evidence.source===contract.source &&
  evidence.version===contract.evidence_version && typeof evidence.scope==='string' && evidence.scope.length>0 &&
  Number.isFinite(Date.parse(evidence.as_of)));
 if(evidence.outlet?.id && args.outlet_id) requireEvidence(evidence.outlet.id===args.outlet_id);
 if(evidence.requested_scope) {
  const scope=evidence.requested_scope;
  requireEvidence(Object.keys(scope).length===Object.keys(args).length &&
   Object.keys(args).every(key=>JSON.stringify(scope[key])===JSON.stringify(args[key])));
 }
 if(evidence.rows!==undefined) {
  requireEvidence(Array.isArray(evidence.rows));
  for(const key of ['returned','returned_count']) {
   if(evidence[key]!==undefined) requireEvidence(evidence[key]===evidence.rows.length);
  }
 }
 if(evidence.ranking?.status==='ranked') {
  const unit=evidence.ranking.unit;
  requireEvidence(typeof unit==='string' && unit.trim().length>0 && count(evidence.ranking.ranked_count) &&
   Array.isArray(evidence.rows) && evidence.rows.every(row=>Number.isFinite(row.current_balance) &&
    String(row.uom||'').trim().toLowerCase()===unit.trim().toLowerCase()));
 }
 if(evidence.aggregate_complete===true && evidence.total_matching!==undefined) {
  requireEvidence(count(evidence.total_matching));
  if(evidence.page_size!==undefined && Array.isArray(evidence.rows)) {
   const {page,page_size:size}=evidence;
   requireEvidence(Number.isSafeInteger(page)&&page>=1&&Number.isSafeInteger(size)&&size>0);
   const allowedSizes=contract.filters?.page_size?.enum;
   if(allowedSizes){
    const requested=args.page_size??20;
    requireEvidence(allowedSizes.includes(size)&&allowedSizes.includes(requested)&&size<=requested&&
     (page-1)*size===(args.page-1)*requested&&(size===requested||args.mode==='list'&&typeof evidence.pagination_adjustment==='string'));
   }else requireEvidence(args.page==null||args.page===page);
   const available=evidence.ranking?.ranked_count??evidence.total_matching;
   requireEvidence(count(available)&&available<=evidence.total_matching);
   const end=Math.max(0,available-(page-1)*size);
   const summary=args.mode==='summary';
   requireEvidence(evidence.rows.length===(summary?0:Math.min(size,end)));
   if(typeof evidence.truncated==='boolean') requireEvidence(evidence.truncated===(!summary&&end>size));
  }
 }
 if(evidence.knowledge?.status==='found') {
  const citations=evidence.knowledge.citations;
  requireEvidence(Array.isArray(citations)&&citations.length>0&&citations.every(c=>
   c.document_id&&c.version!=null&&c.title&&c.state&&c.excerpt));
 }
 return evidence;
}

// Only owner-selected, complete observations from this turn can be compared.
// One axis may change. Different metrics, populations or currencies never join.
export function operationalAnalysis(evidences,lookup) {
 const observations=[];
 for(const e of evidences) {
  if(!e?.capability||e.error||e.no_evidence||e.not_business_evidence||e.query_outcome&&e.query_outcome!=='SUCCESS')continue;
  const owner=lookup(e.capability);
  if(owner.kind!=='READ'||!owner.analysisObservations||e.source!==owner.moduleInterface.source||
   e.version!==owner.moduleInterface.evidence_version)continue;
  for(const item of owner.analysisObservations(e)) {
   if(item.outlet?.id&&item.outlet?.name&&item.metric&&item.population&&item.unit&&item.period&&
    item.grain&&Number.isFinite(item.value))observations.push({...item,source:e.source,capability:e.capability});
  }
 }
 const comparisons=[];
 // Ignore contradictory values for an identical coordinate (e.g. a changed
 // record between reads). The source reads remain available individually.
 const coordinate=o=>JSON.stringify([o.capability,o.metric,o.unit,o.population,o.grain,o.period,o.outlet.id]);
 const values=new Map();
 for(const o of observations) {
  const key=coordinate(o);
  if(values.has(key)&&values.get(key)!==o.value)values.set(key,null);
  else values.set(key,o.value);
 }
 const unique=[...new Map(observations.filter(o=>values.get(coordinate(o))!==null).map(o=>[coordinate(o),o])).values()];
 for(let i=0;i<unique.length;i++) {
  for(const next of unique.slice(i+1)) {
   let base=unique[i],observed=next;
   if(base.capability!==next.capability||base.metric!==next.metric||base.unit!==next.unit||
    base.grain!==next.grain||base.population!==next.population)continue;
   const sameOutlet=base.outlet.id===next.outlet.id;
   if(sameOutlet===(base.period===next.period))continue;
   if(sameOutlet&&base.period>next.period)[base,observed]=[next,base];
   const point=o=>({label:o.outlet.name+' · '+o.period,outlet_id:o.outlet.id,period:o.period,value:o.value});
   const difference=Number((observed.value-base.value).toFixed(6));
   if(!Number.isFinite(difference))continue;
   comparisons.push({source:base.source,metric:base.metric,unit:base.unit,population:base.population,
    basis:sameOutlet?'period':'outlet',baseline:point(base),observed:point(observed),difference});
   if(comparisons.length===7)break;
  }
  if(comparisons.length===7)break;
 }
 return comparisons.length?{comparisons:comparisons.slice(0,6),has_more:comparisons.length>6,
  inference:'Pairwise differences describe these observations. They do not establish a ranking, a cause or a performance target.'}:null;
}

// A backstop for explicit currency figures, not a certification of free-form prose.
// For comparable amounts return the scoped observations; checking an unordered
// set of numbers cannot tell which period or outlet a sentence assigned them to.
export function verifiedAnswerAmounts(reply,evidences,lookup) {
 const text=reply.replace(/(?<=\d)[\u00a0\u202f](?=\d{3}(?:\D|$))/gu,'').normalize('NFKC').replaceAll('**','').replaceAll('−','-');
 const amount=/[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g.source;
 const gap='\\p{Zs}*';
 const scale='(?:thousand\\b|million\\b|[km]\\b|[千万萬])';
 const digits='('+amount+')(?:'+gap+'('+scale+'))?';
 // Do not pair a date, count or prior table row with the next amount's currency.
 const prefix='(?:\\b(?:MYR|RM)|令吉|马币|馬幣)';
 const suffix='(?:(?:MYR|RM)\\b(?!'+gap+'[+-]?\\d)|ringgit\\b|令吉|马币|馬幣)';
 const claims=[...text.matchAll(new RegExp('(?:'+prefix+gap+digits+'|'+digits+gap+suffix+')','giu'))];
 if(!claims.length||!evidences.length)return null;
 const supported=[];
 let monetary=false;
 for(const e of evidences) {
  if(!e?.capability||e.no_evidence||e.error||e.query_outcome&&e.query_outcome!=='SUCCESS')return null;
  const owner=lookup(e.capability);
  if(owner.kind!=='READ'||owner.moduleInterface.source!==e.source||owner.moduleInterface.evidence_version!==e.version)return null;
  if(owner.answerAmounts) {
   monetary=true;
   supported.push(...owner.answerAmounts(e).filter(Number.isFinite));
  } else if(!owner.noMonetaryMeasure)return null;
 }
 if(!monetary)return null;
 const analysis=operationalAnalysis(evidences,lookup);
 const monetaryComparisons=analysis?.comparisons.filter(row=>row.unit==='MYR')||[];
 const pairedFacts=new Map(evidences.map(e=>[e,lookup(e.capability).comparisonFacts?.(e)||[]]));
 const facts=[...pairedFacts.values()].flat();
 if(monetaryComparisons.length||facts.length){
  // An incomplete third month or another outlet from the same source still
  // needs its own answer. Match the evidence's actual coordinates, not its URL.
  const coveredEvidence=evidences.filter(e=>{
   const owner=lookup(e.capability);
   if(pairedFacts.get(e).length)return true;
   const observations=owner.analysisObservations?.(e);
   return observations?.length&&observations.every(o=>monetaryComparisons.some(row=>
    row.source===e.source&&row.metric===o.metric&&row.population===o.population&&
    [row.baseline,row.observed].some(point=>point.outlet_id===o.outlet?.id&&point.period===o.period&&point.value===o.value)));
  });
  return {comparisons:monetaryComparisons,facts,has_more:analysis?.has_more,coveredEvidence};
 }
 return claims.every(match=>{
  let value=Number((match[1]||match[3]).replaceAll(',',''));
  const prefix=text.slice(0,match.index);
  const suffix=text.slice(match.index+match[0].length);
  if(prefix.endsWith('-')||/\(\s*$/.test(prefix)&&/^\s*\)/.test(suffix))value=-Math.abs(value);
  const unit=(match[2]||match[4]||'').toLowerCase();
  const multiplier={k:1000,thousand:1000,'千':1000,'万':10000,'萬':10000,m:1000000,million:1000000}[unit]||1;
  return supported.some(x=>Math.round(x*100)===Math.round(value*multiplier*100));
 });
}

export function formatMonetaryComparisons(analysis,prompt,{recommend=false}={}) {
 const zh=/\p{Script=Han}/u.test(prompt);
 const ms=!zh&&/\b(?:berapa|jumlah|semak|perbelanjaan|bandingkan|kos|cawangan)\b/iu.test(prompt);
 const number=new Intl.NumberFormat(zh?'zh-MY':ms?'ms-MY':'en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
 const amount=value=>(value<0?'−':'')+'RM'+number.format(Math.abs(value));
 const change=zh?'差额':ms?'Perbezaan':'Difference';
 const unavailable=zh?'无可用数据':ms?'Tidak tersedia':'Unavailable';
 const rows=analysis.comparisons.map(row=>[
  row.metric,row.baseline.label+' '+amount(row.baseline.value)+' → '+row.observed.label+' '+amount(row.observed.value),
  change+' '+amount(row.difference),
 ].join(' · '));
 const factsByScope=new Map();
 for(const {label,scope,value,unit} of analysis.facts){
  const display=value==null?unavailable:unit==='MYR'?amount(value):unit==='%'?number.format(value)+'%':String(value);
  if(!factsByScope.has(scope))factsByScope.set(scope,[]);
  factsByScope.get(scope).push(label+' · '+display);
 }
 for(const [scope,lines] of factsByScope)rows.push(scope,...lines);
 if(analysis.has_more)rows.push(zh?'这里只列出部分可比较的数据。':ms?'Sebahagian perbandingan dipaparkan.':'Showing a subset of the available comparisons.');
 if(recommend)rows.push(zh?'请核对差额两侧的原始记录，再判断变动原因。':ms?'Semak rekod sumber bagi kedua-dua nilai sebelum menentukan punca perbezaan.':'Check the supporting records for both values before attributing the difference to a cause.');
 return rows.join('\n');
}

const comparableFacts=' Use checked comparisons or domain-reported drivers when available. Distinguish measured changes from possible explanations.';
const comparisonLimits=' Never infer an expense category, a performance target, or a cause from a balance, missing period, or partial page. Compare only equivalent populations, units and periods.';
export const comparisonInstructions=comparableFacts+comparisonLimits;
export const analysisInstructions=' For analysis, lead with what the records show.'+comparableFacts+' Recommend a concrete next check tied to an observed fact, and say what evidence would distinguish causes.'+comparisonLimits+' A recommendation is advisory and cannot authorize an action.';
