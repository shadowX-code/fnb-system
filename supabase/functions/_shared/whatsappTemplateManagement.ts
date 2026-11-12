import {MetaError} from './metaGraph.ts';
import {hash} from './metaSecurity.ts';
import {CLOUD_TEST_WABA,presentWhatsAppTemplates,type Graph} from './whatsappOnboarding.ts';

const categories = ['UTILITY', 'MARKETING'];
const editableStatuses = ['APPROVED', 'REJECTED', 'PAUSED'];
const namePattern = /^[a-z0-9_]{1,512}$/;
const languagePattern = /^[a-z]{2,3}(?:_[A-Za-z]{2,8}){0,2}$/;

function editable(row:any, waba:string) {
 const body = row?.components?.[0];
 return Boolean(row && categories.includes(row.category) && editableStatuses.includes(row.status)
  && row.parameter_format !== 'NAMED' && Array.isArray(row.components) && row.components.length === 1
  && body?.type === 'BODY' && typeof body.text === 'string'
  && !(waba === CLOUD_TEST_WABA && /^(hello_world|jaspers_market_.*|feedx_review_reservation_update_en|feedx_review_reservation_cancelled_en)$/.test(row.name)));
}

function revision(row:any) {
 return hash(JSON.stringify([row.id,row.name,row.language,row.status,row.category,row.parameter_format,row.components]));
}

export async function managementCatalog(rows:any[],waba:string) {
 const source = new Map(rows.map(row=>[row?.id,row]));
 return Promise.all(presentWhatsAppTemplates(rows).map(async template=>{
  const row = source.get(template.id);
  const canEdit = editable(row,waba);
  return {...template, canEdit, revision:canEdit?await revision(row):null};
 }));
}

export function templateBody(text:unknown,samples:unknown) {
 if(typeof text!=='string'||!text.trim()||text.length>1024||!Array.isArray(samples))
  throw new MetaError('whatsapp_template_invalid');
 const names = [...text.matchAll(/{{([1-9]\d*)}}/g)].map(match=>match[1]);
 const positions = [...new Set(names)];
 if(text.replace(/{{[1-9]\d*}}/g,'').match(/[{}]/)
  ||positions.length>10||positions.some((name,index)=>name!==String(index+1))
  ||samples.length!==positions.length||samples.some(sample=>typeof sample!=='string'||!sample.trim()||sample.length>100))
  throw new MetaError('whatsapp_template_variables_invalid');
 return {type:'BODY',text:text.trim(),...(samples.length?{example:{body_text:[samples.map(sample=>sample.trim())]}}:{})};
}

export async function submitWhatsAppTemplate(graph:Graph,token:string,waba:string,input:any,rows:any[]) {
 const body = templateBody(input?.text,input?.samples);
 if(input?.id!=null){
  const row=rows.find(row=>row?.id===input.id);
  if(!editable(row,waba))throw new MetaError('whatsapp_template_edit_unavailable');
  if(await revision(row)!==input.revision)throw new MetaError('whatsapp_template_stale');
  if(row.components[0].text===body.text&&JSON.stringify(row.components[0].example?.body_text??[])===JSON.stringify(body.example?.body_text??[]))
   throw new MetaError('whatsapp_template_unchanged');
  const result=await graph.request(row.id,token,{components:[body]},'POST');
  if(result?.success!==true)throw new MetaError('whatsapp_template_outcome_uncertain',true);
  return {id:row.id,name:row.name};
 }
 if(typeof input?.name!=='string'||!namePattern.test(input.name)||typeof input.language!=='string'
  ||!languagePattern.test(input.language)||!categories.includes(input.category))
  throw new MetaError('whatsapp_template_invalid');
 if(rows.some(row=>row?.name===input.name&&row.language===input.language))
  throw new MetaError('whatsapp_template_duplicate');
 const result=await graph.request(`${waba}/message_templates`,token,{
  name:input.name,language:input.language,category:input.category,components:[body],
 },'POST');
 if(typeof result?.id!=='string'||!/^\d{1,32}$/.test(result.id))
  throw new MetaError('whatsapp_template_outcome_uncertain',true);
 return {id:result.id,name:input.name};
}

