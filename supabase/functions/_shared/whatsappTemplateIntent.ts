import {hash} from './metaSecurity.ts';
import {CLOUD_TEST_WABA,readWhatsAppTemplateRows,type Graph} from './whatsappOnboarding.ts';

type TemplateChoice={id:string;language:string;values?:Record<string,string>;mediaId?:string};

export async function whatsappTemplateIntent(graph:Graph,token:string,choice:TemplateChoice,phone:string,purpose:'staff'|'campaign'='staff'){
 if(!/^\d{1,32}$/.test(choice?.id)||typeof choice.language!=='string'||! /^[a-z]{2,3}(?:_[A-Za-z]{2,8}){0,2}$/.test(choice.language))
  throw new Error('template_identity_invalid');
 // Use the WABA edge and exact provider ID, even when more than one language shares the name.
 const rows=await readWhatsAppTemplateRows(graph,token,CLOUD_TEST_WABA);
 const matches=rows.filter((row:any)=>row.id===choice.id&&row.language===choice.language);
 if(matches.length!==1)throw new Error('template_not_in_verified_waba');
 const row=matches[0];
 if(row.status!=='APPROVED'||!(purpose==='campaign'?['UTILITY','MARKETING'].includes(row.category):row.category==='UTILITY')||! /^[a-z0-9_]{1,512}$/.test(row.name)||!Array.isArray(row.components))
  throw new Error('template_not_approved_utility');
 const components:any[]=[];
 const preview:string[]=[];
 const previewComponents:Record<string,unknown>[]=[];
 if(choice.values!==undefined&&(!choice.values||Array.isArray(choice.values)||typeof choice.values!=='object'))throw new Error('template_parameter_invalid');
 const remaining=new Set(Object.keys(choice.values||{}));
 const take=(key:string,max=1024)=>{
  const value=choice.values?.[key];
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f]/.test(value))throw new Error('template_parameter_invalid');
  remaining.delete(key);
  return value;
 };
 const named=row.parameter_format==='NAMED';
 let mediaRequired=false;
 for(const part of row.components){
  const type=String(part?.type).toLowerCase();
  if(type==='header'&&['IMAGE','VIDEO','DOCUMENT'].includes(part.format)){
   const mediaType=part.format.toLowerCase();
   if(!choice.mediaId||!/^\d{1,32}$/.test(choice.mediaId))throw new Error('template_media_required');
   const media=await graph.request(choice.mediaId,token,{phone_number_id:phone});
   const allowedMime:Record<string,string[]>={
    image:['image/jpeg','image/png'],video:['video/mp4','video/3gpp'],
    document:['application/pdf','text/plain','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
   };
   if(media?.id!==choice.mediaId||media.messaging_product!=='whatsapp'||!allowedMime[mediaType].includes(media.mime_type))
    throw new Error('template_media_type_invalid');
   components.push({type,parameters:[{type:mediaType,[mediaType]:{id:choice.mediaId}}]});
   mediaRequired=true;
   previewComponents.push({type:'HEADER',format:part.format});
  }else if(['header','body','footer'].includes(type)&&typeof part.text==='string'){
   if(type==='header'&&part.format!=='TEXT')throw new Error('template_component_unsupported');
   const source:string=part.text;
   const variables=[...new Set([...source.matchAll(/{{\s*([a-z][a-z0-9_]*|[1-9]\d*)\s*}}/gi)].map(match=>match[1]))];
   if(type==='footer'&&variables.length)throw new Error('template_component_unsupported');
   if(!named)variables.sort((a,b)=>Number(a)-Number(b));
   const replacements=new Map<string,string>();
   const parameters=variables.map((name,index)=>{
    if(named?!/^[a-z][a-z0-9_]*$/.test(name):Number(name)!==index+1)throw new Error('template_parameter_format_invalid');
    const text=take(`${type}:${name}`,type==='header'?60:1024);
    replacements.set(name,text);
    return {type:'text',text,...(named?{parameter_name:name}:{})};
   });
   const rendered=source.replace(/{{\s*([^{}]+?)\s*}}/g,(token,name)=>replacements.get(name)||token);
   if(/{{|}}/.test(rendered))throw new Error('template_parameter_format_invalid');
   preview.push(rendered);
   previewComponents.push({type:type.toUpperCase(),text:rendered});
   if(parameters.length)components.push({type,parameters});
  }else if(type==='buttons'&&Array.isArray(part.buttons)&&part.buttons.length<=10){
   previewComponents.push({type:'BUTTONS',buttons:part.buttons.map((button:any)=>({type:button?.type,text:button?.text}))});
   part.buttons.forEach((button:any,index:number)=>{
    if(typeof button?.text!=='string'||!button.text.trim())throw new Error('template_component_unsupported');
    preview.push(button.text);
    if(button.type==='QUICK_REPLY'){
     components.push({type:'button',sub_type:'quick_reply',index:String(index),parameters:[{type:'payload',payload:take(`button:${index}`,128)}]});
    }else if(button.type==='URL'&&typeof button.url==='string'&&button.url.includes('{{')){
     if(!button.url.endsWith('{{1}}')||!/^https:\/\/[^{}]+$/.test(button.url.slice(0,-5)))throw new Error('template_component_unsupported');
     const text=take(`button:${index}`,256);
     if(!/^[A-Za-z0-9._~%-]+$/.test(text))throw new Error('template_button_value_invalid');
     components.push({type:'button',sub_type:'url',index:String(index),parameters:[{type:'text',text}]});
    }else if(!['URL','PHONE_NUMBER'].includes(button.type))throw new Error('template_component_unsupported');
   });
  }else throw new Error('template_component_unsupported');
 }
 if(remaining.size||(!mediaRequired&&choice.mediaId))throw new Error('template_parameter_unexpected');
 const text=preview.join('\n').trim();
 if(!text||text.length>2000)throw new Error('template_preview_invalid');
 const template={name:row.name,language:{code:row.language},...(components.length?{components}:{})};
 const providerFingerprint=await hash(JSON.stringify([row.id,row.category,row.components,template]));
 return {text,template,providerFingerprint,previewComponents};
}
