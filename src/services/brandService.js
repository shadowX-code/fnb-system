import {supabase} from '../lib/supabase';
import {throwSupabaseError} from './supabaseError.js';
async function rpc(name,args){const {data,error}=await supabase.rpc(name,args);throwSupabaseError(`platform.${name}`,error);return data;}
export const brandService={
 read:()=>rpc('platform_brands_read',{}),
 outletBrands:()=>rpc('platform_outlet_brands_read',{}),
 command:(command,org,payload)=>rpc('platform_organization_command',{p_command:command,p_org:org,p_payload:payload}),
};
export function mappingChanges(before=[],after=[]){return {added:after.filter(id=>!before.includes(id)),removed:before.filter(id=>!after.includes(id))};}
