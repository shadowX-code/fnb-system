import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.105.4';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import { renderPayslip } from './render.js';

const headers = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type', 'Access-Control-Allow-Methods':'POST, OPTIONS' };
const reply = (data: unknown,status=200) => new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json','Cache-Control':'no-store'}});
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// No payroll data is sent to this public font source. Hash-pinned, fail closed.
let fontBytes: Uint8Array | undefined;
async function unicodeFont(manifest: unknown) {
 if (!/[^\u0000-\u007f]/.test(JSON.stringify(manifest))) return undefined;
 if (!fontBytes) {
  const response=await fetch('https://raw.githubusercontent.com/notofonts/noto-cjk/refs/heads/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf',{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok || Number(response.headers.get('content-length'))>18000000) throw new Error('Font unavailable.');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length>18000000 || hex(await crypto.subtle.digest('SHA-256',bytes))!=='2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b') throw new Error('Font evidence changed.');
  fontBytes=bytes;
 }
 return fontBytes;
}

Deno.serve(async request => {
 if (request.method==='OPTIONS') return new Response('ok',{headers});
 if (request.method!=='POST') return reply({error:'Method not allowed.'},405);
 try {
  const url=Deno.env.get('SUPABASE_URL')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!, key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const caller=createClient(url,anon,{global:{headers:{Authorization:request.headers.get('Authorization') || `Bearer ${anon}`}}});
  const service=createClient(url,key);
  const body=await request.json();
  const crew=body.action==='crew_open';
  const draft=body.action==='admin_draft';
  if (!crew && !draft && body.action!=='admin_open') return reply({error:'Unsupported payslip action.'},400);
  if (!(crew?uuid.test(body.period_id || ''):uuid.test(body.run_id || '') && uuid.test(body.employee_id || ''))) return reply({error:'Payslip unavailable.'},400);
  if (!crew) { const {data,error}=await caller.auth.getUser(); if(error || !data.user) return reply({error:'Admin sign-in required.'},401); }
  if(draft) {
   const {data:manifest,error}=await caller.rpc('payroll_draft_payslip_read',{p_run_id:body.run_id,p_employee_id:body.employee_id});
   if(error || !manifest) return reply({error:error?.message || 'Draft payslip unavailable.'},403);
   const bytes=await renderPayslip(manifest,{PDFDocument,StandardFonts,rgb,fontkit,unicodeFont:await unicodeFont(manifest)});
   // Transient response only. Drafts never enter private immutable artifact storage.
   return new Response(bytes,{headers:{...headers,'Content-Type':'application/pdf','Cache-Control':'no-store','Content-Disposition':'inline; filename="draft-payslip.pdf"'}});
  }
  const rpc=crew?'crew_payroll_payslip_prepare':'payroll_payslip_admin_prepare';
  const args=crew?{p_token:String(body.token || ''),p_period_id:body.period_id}:{p_run_id:body.run_id,p_employee_id:body.employee_id};
  const {data:context,error}=await caller.rpc(rpc,args);
  if (error || !context) return reply({error:error?.message || 'Payslip unavailable.'},403);
  if (!context.ready) {
   const bytes=await renderPayslip(context.manifest,{PDFDocument,StandardFonts,rgb,fontkit,unicodeFont:await unicodeFont(context.manifest)});
   const {error:uploadError}=await service.storage.from(context.bucket).upload(context.object_path,bytes,{contentType:'application/pdf',upsert:false,cacheControl:'private, max-age=0'});
   if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) throw new Error('Payslip could not be stored. Retry safely.');
   // Under a concurrent retry use the bytes actually stored, never overwrite.
   const {data:stored,error:readError}=await service.storage.from(context.bucket).download(context.object_path);
   if (readError || !stored) throw new Error('Stored payslip unavailable. Retry safely.');
   const actual=await stored.arrayBuffer();
   if (hex(await crypto.subtle.digest('SHA-256',bytes))!==hex(await crypto.subtle.digest('SHA-256',actual))) throw new Error('Payslip artifact conflict. Contact Payroll Admin.');
   const {error:finalError}=await service.rpc('payroll_payslip_finalize_service',{p_job_id:context.job_id,p_manifest_sha256:context.manifest_sha256,p_pdf_sha256:hex(await crypto.subtle.digest('SHA-256',actual)),p_size_bytes:actual.byteLength});
   if(finalError) throw new Error('Payslip publication failed. Retry safely.');
  }
  // Revalidate opaque session / current revision after rendering before signing.
  const {data:verified,error:verifyError}=await caller.rpc(rpc,args);
  if(verifyError || !verified?.ready || verified.job_id!==context.job_id) return reply({error:'Payroll or access changed. Refresh your payslips.'},409);
  const filename=`payslip-${context.manifest.period_start.slice(0,7)}.pdf`;
  const [{data:view,error:viewError},{data:download,error:downloadError}]=await Promise.all([
   service.storage.from(context.bucket).createSignedUrl(context.object_path,60),
   service.storage.from(context.bucket).createSignedUrl(context.object_path,60,{download:filename})]);
  if(viewError || downloadError) throw new Error('Private payslip access unavailable.');
  return reply({document_url:view!.signedUrl,download_url:download!.signedUrl,file_name:filename});
 } catch { return reply({error:'Payslip could not be opened. No payroll calculation was changed. Please retry or contact Payroll Admin.'},500); }
});
