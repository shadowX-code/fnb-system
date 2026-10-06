import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
const staging="https://ujkzdaaadnvcfayuldmh.supabase.co";
const origin="https://fnb-system-staging.vercel.app";
const bucket="recruitment-generated-voices";
export const conceptA={type:"prompt",name:"FeedX Staging Malaysian Voice A — Warm professional female",model:"auto",prompt:"An original synthetic warm professional Malaysian female interviewer, adult, natural contemporary Malaysian English cadence and natural Bahasa Melayu delivery. Moderate conversational pace, grounded clear voice, calm and welcoming F&B recruitment tone. Not an American or British announcer, not overly cheerful. Subtle Malaysian cadence only, no exaggerated accent, no forced lah/lor/meh, no artificial code-switching. Able to speak Mandarin and Cantonese naturally when requested. Do not imitate a real person.",script_hint:"Welcome to Happiness Kopitiam. We are speaking about the Service Crew role. This interview takes about ten minutes. Could you briefly introduce yourself?"};
Deno.serve(async request=>{
 const headers={"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"};
 const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(Deno.env.get("SUPABASE_URL")!==staging)return json({error:"Staging only."},403);
 if(request.method==="OPTIONS")return new Response("ok",{headers});
 if(request.method!=="POST"||request.headers.get("origin")!==origin)return json({error:"Unavailable."},403);
 const auth=request.headers.get("authorization")||"";
 if(!auth.startsWith("Bearer "))return json({error:"Recruitment manager sign-in required."},401);
 try {
 const caller=createClient(staging,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth},fetch:(i,o)=>fetch(i,{...o,signal:AbortSignal.timeout(5000)})},auth:{persistSession:false}});
 const user=await caller.auth.getUser(auth.slice(7));
 if(user.error||!user.data.user)return json({error:"Recruitment manager sign-in required."},401);
 const allowed=await caller.rpc("current_user_has_permission",{permission_code:"recruitment.manage"});
 if(allowed.error||allowed.data!==true)return json({error:"Recruitment management access required."},403);
 const body=await request.json();
 if(!["status","probe"].includes(body.action))return json({error:"Invalid action."},400);
 const service=createClient(staging,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{global:{fetch:(i,o)=>fetch(i,{...o,signal:AbortSignal.timeout(7000)})},auth:{persistSession:false}});
 const storage=service.storage.from(bucket);
 const stored=await storage.download("capability-v1.json");
 if(!stored.error&&stored.data)return json(await stored.data.text().then(JSON.parse));
 if(stored.error&&!['404','400'].includes(String(stored.error.statusCode)))throw Error("Capability cache unavailable; no provider request made.");
 if(body.action==="status")return json({status:"not_checked"});
 // Persist an exclusive marker first. A lost creation response must never silently
 // retry paid voice creation or manufacture a second identity on reload.
 const claim=await storage.upload("capability-v1.json",JSON.stringify({status:"checking",message:"Capability check started. If it was interrupted, its outcome needs reconciliation before another creation."}),{contentType:"application/json",upsert:false});
 if(claim.error)return json({status:"checking",message:"An existing check owns this experiment. Reload to read its result."});
 const key=Deno.env.get("OPENAI_API_KEY");
 if(!key)throw Error("Staging provider credential unavailable.");
 const started=Date.now();
 const model=await fetch("https://api.openai.com/v1/models/gpt-live-1",{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)});
 const modelResult={model:"gpt-live-1",status:model.status,accessible:model.ok};await model.body?.cancel();
 const response=await fetch("https://api.openai.com/v1/audio/voices",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify(conceptA),signal:AbortSignal.timeout(60000)});
 const value=await response.json();
 const result=response.ok?{status:"available",voice:value,model_access:modelResult,creation_latency_ms:Date.now()-started}:{status:"blocked",provider_status:response.status,provider_code:value.error?.code||null,provider_type:value.error?.type||null,message:String(value.error?.message||"Provider denied prompt-created voices.").replace(/sk-[\w-]+/g,"[redacted]").slice(0,700),model_access:modelResult,creation_latency_ms:Date.now()-started};
 const saved=await storage.upload("capability-v1.json",JSON.stringify(result),{contentType:"application/json",upsert:true});
 if(saved.error)throw Error("Provider check finished but persistent result could not be saved; do not create another voice.");
 return json(result);
 }catch(cause){return json({error:cause instanceof Error?cause.message:"Capability unavailable.",retry_creation:false},503);}
});
