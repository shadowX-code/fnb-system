import {describe, expect, it, vi} from 'vitest';
import {managementCatalog, submitWhatsAppTemplate, templateBody} from './whatsappTemplateManagement';
import {CLOUD_TEST_WABA} from './whatsappOnboarding';

const row = {
 id:'123',name:'reservation_notice',language:'en',category:'UTILITY',status:'REJECTED',
 components:[{type:'BODY',text:'Your booking is confirmed.'}],
};
const waba='456';

describe('WhatsApp template management',()=>{
 it('uses the official Meta create payload and leaves approval to the catalog',async()=>{
  const request=vi.fn().mockResolvedValue({id:'789',status:'PENDING'});
  await expect(submitWhatsAppTemplate({request},'credential',waba,{
   name:row.name,language:row.language,category:row.category,text:'Your booking is confirmed for {{1}}.',samples:['Friday'],
  },[])).resolves.toEqual({id:'789',name:row.name});
  expect(request).toHaveBeenCalledWith('456/message_templates','credential',{
   name:row.name,language:row.language,category:row.category,
   components:[{type:'BODY',text:'Your booking is confirmed for {{1}}.',example:{body_text:[['Friday']]}}],
  },'POST');
 });

 it('rejects duplicate creates, out-of-catalog edits and changes to the App Review template before POST',async()=>{
  const request=vi.fn();
  const input={name:row.name,category:row.category,language:'en',text:'New content.',samples:[]};
  const protectedRow={...row,name:'feedx_review_reservation_update_en',status:'APPROVED'};
  await expect(submitWhatsAppTemplate({request},'credential',waba,input,[row])).rejects.toThrow('whatsapp_template_duplicate');
  await expect(submitWhatsAppTemplate({request},'credential',waba,{...input,id:'789'},[row])).rejects.toThrow('whatsapp_template_edit_unavailable');
  await expect(submitWhatsAppTemplate({request},'credential',CLOUD_TEST_WABA,{...input,id:row.id},[protectedRow])).rejects.toThrow('whatsapp_template_edit_unavailable');
  expect(request).not.toHaveBeenCalled();
 });

 it('rejects a stale edit and submits only the scoped template ID after a current catalog read',async()=>{
  const request=vi.fn().mockResolvedValue({success:true});
  const [template]=await managementCatalog([row],waba);
  const edit={id:row.id,revision:template.revision,text:'Your booking was updated.',samples:[]};
  await expect(submitWhatsAppTemplate({request},'credential',waba,edit,[{...row,status:'PAUSED'}])).rejects.toThrow('whatsapp_template_stale');
  expect(request).not.toHaveBeenCalled();
  await submitWhatsAppTemplate({request},'credential',waba,edit,[row]);
  expect(request).toHaveBeenCalledExactlyOnceWith(row.id,'credential',{
   components:[{type:'BODY',text:edit.text}],
  },'POST');
 });

 it('requires sequential placeholders and an example for each',()=>{
  expect(()=>templateBody('Your booking is confirmed for {{2}}.',['Friday'])).toThrow('whatsapp_template_variables_invalid');
  expect(()=>templateBody('Your booking is confirmed for {{1}}.',[])).toThrow('whatsapp_template_variables_invalid');
 });
});

describe('WhatsApp template endpoint scope',()=>{
 it('denies a non-configurator and rejects a connection from another Brand before calling Meta',async()=>{
  const {whatsappSignupHandler}=await import('./whatsappSignupHandler');
  const {STAGING_SUPABASE}=await import('./metaSecurity');
  const {CLOUD_TEST_APP}=await import('./whatsappOnboarding');
  const env=(key:string)=>({
   SUPABASE_URL:STAGING_SUPABASE,MARKETING_META_APP_ID:CLOUD_TEST_APP,
  } as Record<string,string>)[key]||'';
  const body={organizationId:'org',brandId:'brand',connectionId:'connection',generation:3};
  const caller={rpc:vi.fn().mockResolvedValue({data:{can_configure:false}})};
  const service={rpc:vi.fn().mockResolvedValue({data:{brand_id:'another-brand',organization_id:'org',channel:'whatsapp'}})};
  await expect(whatsappSignupHandler('/whatsapp/template-submit',body,caller,service,'actor',env)).rejects.toThrow('whatsapp_template_access_denied');
  expect(service.rpc).not.toHaveBeenCalled();
  caller.rpc.mockResolvedValue({data:{can_configure:true}});
  await expect(whatsappSignupHandler('/whatsapp/template-catalog',body,caller,service,'actor',env)).rejects.toThrow('whatsapp_template_access_denied');
  expect(service.rpc).toHaveBeenCalledExactlyOnceWith('marketing_meta_diagnostic_material',{
   p_connection:'connection',p_auth_user:'actor',
  });
 });
});

it('submits the supported text components and preserves them when editing',async()=>{
 const rich={
  name:row.name,language:row.language,category:row.category,text:'Your booking is confirmed.',samples:[],
  header:'Booking for {{1}}',headerSample:'Friday',footer:'Test Restaurant',
  buttons:[{type:'URL',text:'Booking details',url:'https://example.com/reservations'},{type:'PHONE_NUMBER',text:'Call us',phone_number:'+60123456789'}],
 };
 const components=[
  {type:'HEADER',format:'TEXT',text:rich.header,example:{header_text:['Friday']}},
  {type:'BODY',text:rich.text},{type:'FOOTER',text:rich.footer},{type:'BUTTONS',buttons:rich.buttons},
 ];
 const request=vi.fn().mockResolvedValueOnce({id:'789'}).mockResolvedValueOnce({success:true});
 await submitWhatsAppTemplate({request},'credential',waba,rich,[]);
 expect(request).toHaveBeenNthCalledWith(1,'456/message_templates','credential',{
  name:row.name,language:row.language,category:row.category,components,
 },'POST');
 const current={...row,components};
 const [projected]=await managementCatalog([current],waba);
 expect(projected.editor).toMatchObject({headerSample:'Friday',footer:rich.footer,buttons:rich.buttons});
 await submitWhatsAppTemplate({request},'credential',waba,{...rich,id:row.id,revision:projected.revision,footer:'Contact our team'},[current]);
 expect(request).toHaveBeenNthCalledWith(2,row.id,'credential',{components:[
  components[0],components[1],{type:'FOOTER',text:'Contact our team'},components[3],
 ]},'POST');
 await expect(submitWhatsAppTemplate({request},'credential',waba,{...rich,buttons:[
  {type:'URL',text:'Dynamic link',url:'https://example.com/{{1}}'},
 ]},[])).rejects.toThrow('whatsapp_template_buttons_invalid');
 expect(request).toHaveBeenCalledTimes(2);
});
