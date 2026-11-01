import {it,expect,vi} from 'vitest';
import actions from '../../../config/restaurantAgentActions.json';
import resources from '../../../config/restaurantAgentResources.json';
import {restaurantActions,restaurantResources,restaurantActionArguments,restaurantReadArguments,safeRestaurantActions,safeRestaurantRpcError} from '../factory-mesti-mcp/restaurant.js';
import {createHandler} from '../factory-mesti-mcp/protocol.js';
const id='11111111-1111-4111-8111-111111111111';
const request=(params)=>new Request('https://example.test',{method:'POST',headers:{authorization:`Bearer fxm_${'a'.repeat(43)}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params})});
const args={action:'restaurant_asset.create',outlet_id:id,request_id:id,expected_version:null,input:{record:{name:'QA'}}};
it('transport catalogs exactly match the canonical action and resource manifests',()=>{expect(restaurantActions).toEqual(actions.map(a=>a.key));expect(restaurantResources).toEqual(resources.map(r=>r.key));expect(actions.every(a=>a.requires_human_confirmation===false)).toBe(true);});
it('requires explicit scope, stable retry identity and a current target version',()=>{
 expect(restaurantActionArguments(args).p_input.outlet_id).toBe(id);
 for(const patch of [{outlet_id:null},{request_id:'bad'},{expected_version:undefined},{input:{actor_id:id}},{action:'restaurant_asset.delete'},{action:'restaurant_asset.update',target_id:id,expected_version:null}])expect(()=>restaurantActionArguments({...args,...patch})).toThrow();
 expect(()=>restaurantReadArguments({queries:[{business_module:'outlet-pnl',resource:'restaurant_outlet_pnl',outlet_id:id,page_size:101}]})).toThrow();
 expect(safeRestaurantActions([{business_module:'outlet-pnl',resource:'restaurant_outlet_pnl',outlet_id:id,year:2026}])).toEqual([{business_module:'outlet-pnl',resource:'restaurant_outlet_pnl',action:'read'}]);
});
it('keeps permission denials ahead of business execution and exposes no ungranted tools',async()=>{
 const read=vi.fn().mockResolvedValue({tools:['query_factory_resources']});const handler=createHandler(read);
 const response=await (await handler(request({name:'execute_restaurant_action',arguments:args}))).json();expect(response.error.code).toBe(-32003);expect(read).toHaveBeenCalledTimes(1);
});
it('retains committed receipts if telemetry fails and gives lost responses a stable retry path',async()=>{
 const receipt={status:'completed',request_id:id,action:args.action,target_id:id};
 const read=vi.fn().mockImplementation(async(_token,tool)=>tool==='authorize'?{tools:['execute_restaurant_action'],restaurant_actions:[{name:args.action}]}:receipt);
 const handler=createHandler(read,{observe:async()=>{throw new Error('telemetry');}});
 const response=await (await handler(request({name:'execute_restaurant_action',arguments:args}))).json();expect(response.result.structuredContent).toEqual(receipt);
 read.mockImplementation(async(_token,tool)=>{if(tool==='authorize')return {tools:['execute_restaurant_action'],restaurant_actions:[{name:args.action}]};throw new Error('network lost');});
 const unknown=await (await handler(request({name:'execute_restaurant_action',arguments:args}))).json();expect(unknown.result.structuredContent).toMatchObject({status:'outcome_unknown',request_id:id,retry_same_request_id:true});
});
it('only returns allowlisted canonical business errors',()=>{expect(safeRestaurantRpcError({code:'P0001',message:'Purchase order is not open for receiving.'}).safeBusinessMessage).toBe(true);expect(safeRestaurantRpcError({code:'XX000',message:'sensitive arbitrary database detail'}).message).not.toContain('sensitive');});

it('retains unique workflow/action identities and independent Asset/Inspection grants',()=>{
 const identities=actions.map(a=>`${a.capability_module}/${a.action}`);expect(new Set(identities).size).toBe(actions.length);
 const asset=actions.find(a=>a.key==='restaurant_asset.create'),inspection=actions.find(a=>a.key==='restaurant_inspection.create');
 expect(asset.module).toBe('asset_tracking');expect(inspection.module).toBe('asset_tracking');expect(asset.capability_module).not.toBe(inspection.capability_module);expect(asset.key).not.toBe(inspection.key);
});
