import {expect,it,vi} from 'vitest';
import {generateAIFlow} from '../../../../supabase/functions/_shared/aiFlowGeneration.ts';

it('asks the configured provider for a structured draft and strips inapplicable node fields',async()=>{
 const response={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({
  supported:true,draft:{name:'Question flow',nodes:[{id:'trigger',type:'trigger',next:'end',yes:null},{id:'end',type:'end',next:null}]},
 })}]}]};
 const transport=vi.fn(async()=>Response.json(response));
 const draft=await generateAIFlow('Collect a fictional question.','fixture-key','gpt-5-mini',transport as typeof fetch);
 expect(draft.nodes).toEqual([{id:'trigger',type:'trigger',next:'end'},{id:'end',type:'end'}]);
 expect(transport).toHaveBeenCalledTimes(1);
 const options=(transport.mock.calls[0] as unknown as [string,RequestInit])[1];
 expect(JSON.parse(String(options.body))).toMatchObject({model:'gpt-5-mini',store:false,text:{format:{type:'json_schema',strict:true}}});
});

it('rejects a refused or incomplete provider result',async()=>{
 const send=(value:unknown)=>vi.fn(async()=>Response.json(value)) as unknown as typeof fetch;
 await expect(generateAIFlow('Submit a real payment.','key','model',send({status:'completed',output:[
  {type:'message',content:[{type:'output_text',text:'{"supported":false,"draft":{}}'}]},
 ]}))).resolves.toBeNull();
 await expect(generateAIFlow('Make a sample flow.','key','model',send({status:'incomplete'}))).rejects.toThrow('flow_generation_incomplete');
});

it('preserves untouched nodes and rejects broken or cyclic edits',async()=>{
 const {applyDesignerPatch}=await import('../../../../supabase/functions/_shared/aiFlowGeneration.ts');
 const ask={id:'ask',type:'ask',next:'end',field:'guests',prompt:'How many guests?',value_type:'number',required:true};
 const draft={name:'Booking enquiries',nodes:[{id:'trigger',type:'trigger',next:'ask'},ask,{id:'end',type:'end'}]};
 const patched=applyDesignerPatch(draft,[{id:'ask',type:'ask',next:'handoff',field:'guests',prompt:'How many guests?',value_type:'number',required:true},
  {id:'handoff',type:'handoff',prompt:'Our team will review your enquiry.'}],['end']);
 expect(patched.nodes[0]).toBe(draft.nodes[0]);
 expect(patched.nodes[1].field).toBe('guests');
 expect(draft.nodes[1]).toBe(ask);
 expect(()=>applyDesignerPatch(draft,[{...ask,next:'trigger'}],[])).toThrow('flow_edit_invalid');
 expect(()=>applyDesignerPatch(draft,[],['end'])).toThrow('flow_edit_invalid');
});

it('returns a concise clarification without changing the current draft',async()=>{
 const {designAIFlow}=await import('../../../../supabase/functions/_shared/aiFlowGeneration.ts');
 const reply={kind:'question',message:'Nak kutip tarikh juga?',choices:['Ya','Tidak'],draft:null,upsert:[],remove:[]};
 const transport=vi.fn(async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(reply)}]}]}));
 const result=await designAIFlow({description:'booking macam mana',brandName:'Fixture',history:[],draft:null,selected:null},'key','model',transport as typeof fetch);
 expect(result).toEqual({kind:'question',message:reply.message,choices:reply.choices});
});

it('fills optional collection defaults on new steps without changing existing fields',async()=>{
 const {applyDesignerPatch}=await import('../../../../supabase/functions/_shared/aiFlowGeneration.ts');
 const ask={id:'ask',type:'ask',next:'end',field:'guests',prompt:'Guests?',value_type:'number',required:true};
 const draft={nodes:[{id:'trigger',type:'trigger',next:'ask'},ask,{id:'end',type:'end'}]};
 const result=applyDesignerPatch(draft,[{...ask,next:'date',value_type:null,required:null},{id:'date',type:'ask',field:'date',prompt:'Preferred date?',next:'end',value_type:null,required:null}],[]);
 expect(result.nodes[1]).toMatchObject({value_type:'number',required:true});
 expect(result.nodes[2]).toMatchObject({value_type:'text',required:false});
});
