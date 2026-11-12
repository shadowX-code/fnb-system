import {MetaError} from './metaGraph.ts';
import {hash} from './metaSecurity.ts';
import {CLOUD_TEST_WABA,presentWhatsAppTemplates,type Graph} from './whatsappOnboarding.ts';

import {compileTemplateBody,compileTemplateComponents,numberedVariables,templateCategories,templateNamePattern,templateLanguagePattern} from './whatsappTemplateContent.mjs';
const editableStatuses = ['APPROVED', 'REJECTED', 'PAUSED'];

function editorContent(row:any, waba:string) {
 if(!row||!templateCategories.includes(row.category)||!editableStatuses.includes(row.status)
  ||row.parameter_format==='NAMED'||!Array.isArray(row.components)
  ||(waba===CLOUD_TEST_WABA&&/^(hello_world|jaspers_market_.*|feedx_review_reservation_update_en|feedx_review_reservation_cancelled_en)$/.test(row.name)))return null;
 const parts = new Map<string,any>(row.components.map((part:any)=>[part?.type,part]));
 if(parts.size!==row.components.length||[...parts.keys()].some(type=>!['HEADER','BODY','FOOTER','BUTTONS'].includes(String(type))))return null;
 const {HEADER:header,BODY:body,FOOTER:footer,BUTTONS:actions}=Object.fromEntries(parts);
 if(typeof body?.text!=='string'||(header&&(header.format!=='TEXT'||typeof header.text!=='string'))
  ||(footer&&typeof footer.text!=='string')||(actions&&(!Array.isArray(actions.buttons)||actions.buttons.some((button:any)=>!button))))return null;
 const fields={
  text:body.text, samples:numberedVariables(body.text).map((_,i)=>String(body.example?.body_text?.[0]?.[i]??'')),
  header:header?.text??'', headerSample:String(header?.example?.header_text?.[0]??''), footer:footer?.text??'',
  buttons:(actions?.buttons??[]).map(({type,text,url,phone_number}:any)=>({type,text,...(type==='URL'?{url}:{}),...(type==='PHONE_NUMBER'?{phone_number}:{})})),
 };
 const structural=compileTemplateComponents({...fields,samples:fields.samples.map(()=> 'Sample'),headerSample:'Sample'});
 return structural.error?null:fields;
}

function revision(row:any) {
 return hash(JSON.stringify([row.id,row.name,row.language,row.status,row.category,row.parameter_format,row.components]));
}

export async function managementCatalog(rows:any[],waba:string) {
 const source = new Map(rows.map(row=>[row?.id,row]));
 return Promise.all(presentWhatsAppTemplates(rows).map(async template=>{
  const row = source.get(template.id);
  const editor = editorContent(row,waba);
  return {...template, canEdit:Boolean(editor), editor, revision:editor?await revision(row):null};
 }));
}

export function templateBody(text:unknown,samples:unknown) {
 const result=compileTemplateBody(text,samples);
 if(result.error)throw new MetaError(result.error);
 return result.body;
}

export async function submitWhatsAppTemplate(graph:Graph,token:string,waba:string,input:any,rows:any[]) {
 const {components,error}=compileTemplateComponents(input);
 if(error)throw new MetaError(error);
 if(input?.id!=null){
  const row=rows.find(row=>row?.id===input.id);
  const previous=editorContent(row,waba);
  if(!previous)throw new MetaError('whatsapp_template_edit_unavailable');
  if(await revision(row)!==input.revision)throw new MetaError('whatsapp_template_stale');
  if(JSON.stringify(compileTemplateComponents(previous).components)===JSON.stringify(components))
   throw new MetaError('whatsapp_template_unchanged');
  const result=await graph.request(row.id,token,{components},'POST');
  if(result?.success!==true)throw new MetaError('whatsapp_template_outcome_uncertain',true);
  return {id:row.id,name:row.name};
 }
 if(typeof input?.name!=='string'||!templateNamePattern.test(input.name)||typeof input.language!=='string'
  ||!templateLanguagePattern.test(input.language)||!templateCategories.includes(input.category))
  throw new MetaError('whatsapp_template_invalid');
 if(rows.some(row=>row?.name===input.name&&row.language===input.language))
  throw new MetaError('whatsapp_template_duplicate');
 const result=await graph.request(`${waba}/message_templates`,token,{
  name:input.name,language:input.language,category:input.category,components,
 },'POST');
 if(typeof result?.id!=='string'||!/^\d{1,32}$/.test(result.id))
  throw new MetaError('whatsapp_template_outcome_uncertain',true);
 return {id:result.id,name:input.name};
}

