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
