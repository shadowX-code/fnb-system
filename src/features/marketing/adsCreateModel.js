export const newAdForm = () => ({name:'',creative_source:'facebook_post',objective:'OUTCOME_AWARENESS',page_id:'',source_job_id:'',asset_id:'',placements:'facebook_feed',caption:'',headline:'',url:'',budget:'',start_local:'',end_local:'',age_min:'18',age_max:'65',audience_type:'radius',city_key:'',city_name:'',latitude:'',longitude:'',radius:'5',universal_beneficiary:'',universal_payer:''});
// Account-level presentation default; names never become Meta identity references.
export const adAccountDeclarationName = accountId => accountId === '1547787575646373' ? 'THE Y ADVISORY SDN. BHD.' : null;
export const changeAdAccountForm = form => ({...form,city_key:'',city_name:'',start_local:'',end_local:'',universal_beneficiary:'',universal_payer:''});
const localTime=(instant,zone)=>{
 if(!instant)return '';
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
 const p=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
export function reopenAdForm(row,timezone) {
 const c=row?.configuration||{};
 if(c.draft_only)return {...newAdForm(),...c.workspace};
 return {...newAdForm(),...c,creative_source:c.creative_source||'new_image',budget:row?.maximum_budget?String(row.maximum_budget/100):'',start_local:c.start_local||localTime(c.start_time,timezone),end_local:c.end_local||localTime(c.end_time,timezone),audience_type:c.audience?.type||'radius',city_key:c.audience?.key||'',city_name:c.audience?.name||'',latitude:c.audience?.latitude??'',longitude:c.audience?.longitude??'',radius:c.audience?.radius??'5',universal_beneficiary:c.regional_regulation_identities?.universal_beneficiary||'',universal_payer:c.regional_regulation_identities?.universal_payer||''};
}
export function createAdConfiguration(f,pages,{draft=false}={}) {
 if(draft) {
  // Draft data is never a provider payload. Publishable fields are rebuilt and server-validated.
  const workspace=Object.fromEntries(Object.keys(newAdForm()).map(key=>[key,f[key]??'']));
  return {draft_only:true,name:f.name.trim()||'Untitled ad',workspace};
 }
 if(!/^\d{1,7}(\.\d{1,2})?$/.test(f.budget)||Number(f.budget)<=0)throw new Error('Enter a positive MYR lifetime budget with at most two decimal places.');
 const post=f.creative_source==='facebook_post';
 const config={create_contract_version:3,creative_source:f.creative_source,name:f.name.trim(),objective:f.objective,maximum_budget:Math.round(Number(f.budget)*100),start_local:f.start_local,end_local:f.end_local,age_min:Number(f.age_min),age_max:Number(f.age_max),placements:f.placements,page_id:f.page_id,adset_contract_version:2,regional_regulated_categories:['MALAYSIA_UNIVERSAL'],regional_regulation_identities:{universal_beneficiary:f.universal_beneficiary.trim(),universal_payer:f.universal_payer.trim()},audience:f.audience_type==='city'?{type:'city',key:f.city_key,name:f.city_name,radius:Number(f.radius)}:{type:'radius',latitude:Number(f.latitude),longitude:Number(f.longitude),radius:Number(f.radius)}};
 if(!f.name.trim()||!f.page_id||!f.start_local||!f.end_local)throw new Error('Complete the ad name, Page and dates in Setup and Audience.');
 if(!f.universal_beneficiary.trim()||!f.universal_payer.trim())throw new Error('Meta-verified advertiser and payer references are required before review. Complete verification in Meta; Save Draft remains available.');
 if(!/^\d{1,30}$/.test(f.universal_beneficiary.trim())||!/^\d{1,30}$/.test(f.universal_payer.trim()))throw new Error('Use Meta-issued advertiser and payer identity references. Company names, Page names and unverified IDs are not verification evidence.');
 if(f.audience_type==='radius'&&(!String(f.latitude).trim()||!String(f.longitude).trim())||f.audience_type==='city'&&!f.city_key)throw new Error('Choose a local audience in Audience.');
 if(f.objective==='OUTCOME_AWARENESS')config.promoted_object={page_id:f.page_id};
 if(post){if(!f.source_job_id)throw new Error('Select a published Facebook post in Creative.');if(f.objective!=='OUTCOME_AWARENESS'||f.placements!=='facebook_feed')throw new Error('Existing-post promotion supports Awareness and Facebook Feed only.');config.source_job_id=f.source_job_id;}
 else{if(!f.asset_id||!f.caption.trim()||!f.headline.trim()||!/^https:\/\/\S+$/.test(f.url))throw new Error('Complete the image, caption, headline and HTTPS destination in Creative.');Object.assign(config,{asset_id:f.asset_id,caption:f.caption.trim(),headline:f.headline.trim(),url:f.url.trim()});if(f.placements!=='facebook_feed')config.instagram_id=pages.find(p=>p.page_id===f.page_id)?.instagram_id;}
 return config;
}
