import { supabase } from "../../lib/supabase";
import { throwSupabaseError } from "../../services/supabaseError.js";
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  throwSupabaseError(`marketing.${name}`, error);
  return data;
}
export const outreachService = {
  read: (org, brand, campaign = null, page = 1, search = "") =>
    rpc("marketing_outreach_read", {
      p_org: org,
      p_brand: brand,
      p_campaign: campaign,
      p_page: page,
      p_search: search,
    }),
  audiencePreview: (org,brand,criteria) => rpc("marketing_campaign_audience_preview",{p_org:org,p_brand:brand,p_criteria:criteria}),
  customers: (org,brand,filters={},page=1,size=20) => rpc("marketing_customers_read",{p_org:org,p_brand:brand,p_filters:filters,p_page:page,p_size:size}),
  importPreview: async (org,brand,rows,onProgress=()=>{}) => {
    const all=[];
    for(let start=0;start<rows.length;start+=250){
      const result=await rpc("platform_customer_import_preview",{p_org:org,p_brand:brand,p_rows:rows.slice(start,start+250)});
      all.push(...result.rows.map(r=>({...r,row:r.row+start})));onProgress(all.length);
    }
    return {rows:all};
  },
  importJob: (org,brand,action,job=null,payload={}) => rpc("platform_customer_import_job",{p_org:org,p_brand:brand,p_action:action,p_job:job,p_payload:payload}),
  queueImport: async (request,org,brand,rows,decisions,context,onProgress=()=>{}) => {
    let result=await outreachService.importJob(org,brand,'begin',request,context);
    if(result.state==='uploading'){
      for(let start=0;start<rows.length;start+=250){
        result=await outreachService.importJob(org,brand,'upload',request,{start:start+1,rows:rows.slice(start,start+250).map((input,i)=>({input,decision:decisions[start+i+1]}))});onProgress(result.uploaded);
      }
      result=await outreachService.importJob(org,brand,'confirm',request);
    }
    return result;
  },
  importResults: async(org,brand,job) => {
    let result=await outreachService.importJob(org,brand,'read',job),rows=[...result.rows];
    while(rows.length<result.processed){const page=await outreachService.importJob(org,brand,'read',job,{after:rows.at(-1).row});if(!page.rows.length)break;rows.push(...page.rows);}
    return {...result,rows};
  },
  customer: (request, org, brand, payload) =>
    rpc("platform_customer_command", {
      p_request: request,
      p_org: org,
      p_brand: brand,
      p_payload: payload,
    }),
  command: (request, org, brand, action, id, payload = {}) =>
    rpc("marketing_outreach_command", {
      p_request: request,
      p_org: org,
      p_brand: brand,
      p_action: action,
      p_id: id || null,
      p_payload: payload,
    }),
};
