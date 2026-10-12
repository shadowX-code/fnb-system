import {supabase} from '../../lib/supabase';
import {throwSupabaseError} from '../../services/supabaseError.js';
async function rpc(name,args){const {data,error}=await supabase.rpc(name,args);throwSupabaseError(`marketing.${name}`,error);return data;}
export const plannerService={
 read:(org,month,brand=null)=>rpc('marketing_planner_read',{p_org:org,p_month:month,p_brand:brand||null}),
 command:({requestId,org,brand,action,id=null,revision=0,payload={}})=>rpc('marketing_planner_command',{p_request:requestId,p_org:org,p_brand:brand||null,p_action:action,p_id:id,p_revision:revision,p_payload:payload}),
 order:(requestId,org,month,tasks)=>rpc('marketing_planner_order',{p_request:requestId,p_org:org,p_month:month,p_tasks:tasks.map(t=>({id:t.id,revision:t.revision}))}),
};
