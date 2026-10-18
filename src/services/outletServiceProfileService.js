import {supabase} from '../lib/supabase';
import {throwSupabaseError} from './supabaseError.js';
async function rpc(name,args){const {data,error}=await supabase.rpc(name,args);throwSupabaseError(`outlets.${name}`,error);return data;}
export const outletServiceProfileService={
 read:outlet=>rpc('outlet_service_profile_read',{p_outlet:outlet}),
 save:(request,outlet,revision,data)=>rpc('outlet_service_profile_save',{p_request:request,p_outlet:outlet,p_revision:revision,p_data:data}),
};
export const WEEKDAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export const emptyOutletServices=()=>({timezone:'Asia/Kuala_Lumpur',phone:'',email:'',website:'',weekly_hours:WEEKDAYS.map((_,day)=>({day,status:'unknown',periods:[]})),special_hours:[],service_policies:''});
export function describeHours(day){if(!day||day.status==='unknown')return 'Not confirmed';if(day.status==='closed')return 'Closed';return day.periods.map(p=>`${p.opens}–${p.closes}${p.overnight?' (next day)':''}`).join(', ');}
