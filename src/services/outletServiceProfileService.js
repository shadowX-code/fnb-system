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

/** Copy draft regular hours only; source periods and special-date evidence remain independent. */
export function copyWeeklyHours(weekly,sourceDay,targetDays){
 const source=weekly.find(day=>day.day===sourceDay);if(!source)return weekly;
 return weekly.map(day=>targetDays.includes(day.day)&&day.day!==sourceDay?{...day,status:source.status,periods:structuredClone(source.periods)}:day);
}
export function outletServiceMissing(outlet){
 const data=outlet.service_profile?.data;
 return [!outlet.address?.trim()&&'Address',!(data?.phone?.trim()||data?.email?.trim()||data?.website?.trim())&&'Contact details',(!data?.weekly_hours||data.weekly_hours.length!==7||data.weekly_hours.some(day=>day.status==='unknown'))&&'Regular hours',!data?.timezone&&'Timezone',!data?.service_policies?.trim()&&'Service policies'].filter(Boolean);
}
