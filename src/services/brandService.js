import {supabase} from '../lib/supabase';
import {throwSupabaseError} from './supabaseError.js';
async function rpc(name,args){const {data,error}=await supabase.rpc(name,args);throwSupabaseError(`platform.${name}`,error);return data;}
export const brandService={
 read:()=>rpc('platform_brand_management_read',{}),
 outletBrands:()=>rpc('platform_outlet_brands_read',{}),
 command:(command,scopeBrand,payload)=>rpc('platform_brand_command',{p_command:command,p_scope_brand:scopeBrand||null,p_payload:payload}),
};
export function mappingChanges(before=[],after=[]){return {added:after.filter(id=>!before.includes(id)),removed:before.filter(id=>!after.includes(id))};}
