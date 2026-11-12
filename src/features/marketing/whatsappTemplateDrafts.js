export const emptyTemplateDrafts = {drafts:[], labels:{}};

export const templateLanguages = [
 ['en','English'],['en_GB','English (UK)'],['en_US','English (US)'],['ms','Malay'],
 ['zh_CN','Chinese (Simplified)'],['zh_TW','Chinese (Traditional)'],['zh_HK','Chinese (Hong Kong)'],
 ['ta','Tamil'],['id','Indonesian'],['th','Thai'],['vi','Vietnamese'],['hi','Hindi'],
 ['ar','Arabic'],['ja','Japanese'],['ko','Korean'],['fr','French'],['de','German'],['es','Spanish'],
 ['es_MX','Spanish (Mexico)'],['pt_BR','Portuguese (Brazil)'],['pt_PT','Portuguese (Portugal)'],
].map(([value,label])=>({value,label}));

export function templateLanguageLabel(code) {
 const known = templateLanguages.find(option=>option.value===code);
 if (known) return known.label;
 try { return new Intl.DisplayNames(['en'],{type:'language',fallback:'none'}).of(code.replaceAll('_','-'))||code; }
 catch { return code; }
}

export function generateMetaTemplateName(value) {
 return value.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,512);
}

export function friendlyTemplateName(value) {
 return value.replaceAll('_',' ').trim().replace(/^./,letter=>letter.toUpperCase()) || value;
}

export function draftStorageKey(userId, brand) {
 return `marketing.whatsapp.templates.v1:${userId}:${brand.organization_id}:${brand.id}`;
}

export function readTemplateDrafts(key) {
 try {
  const data=JSON.parse(localStorage.getItem(key));
  if(Array.isArray(data?.drafts)&&data.labels&&typeof data.labels==='object')return data;
 } catch { /* An unavailable browser store behaves like an empty library. */ }
 return emptyTemplateDrafts;
}

export function makeTemplateDraft(row, friendly) {
 const editor=row?.editor;
 return {
  draftId:crypto.randomUUID(),
  source:row?{id:row.id,revision:row.revision}:null,
  friendly:friendly||'', name:row?.name||'', manualName:Boolean(row),
  language:row?.language||'en', category:row?.category||'UTILITY',
  header:editor?.header||'', headerSample:editor?.headerSample||'', text:editor?.text||'',
  samples:Object.fromEntries((editor?.samples||[]).map((value,index)=>[String(index+1),value])),
  footer:editor?.footer||'', buttons:editor?.buttons||[],
 };
}
