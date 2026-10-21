// Offline schema rehearsal only. No remote credentials or database URL are accepted.
import {fileURLToPath,pathToFileURL} from 'node:url';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=process.argv[2],runtime=process.argv[3];
if(!dir?.startsWith('/')||!runtime?.startsWith('/'))throw Error('Supply absolute local schema-capture directory and embedded-postgres module file; no remote URL is accepted.');
const {default:EmbeddedPostgres}=await import(pathToFileURL(runtime).href);
const catalog=JSON.parse(fs.readFileSync(dir+'/catalog-0.json')),functions=fs.readdirSync(dir).filter(x=>/^functions-\d+\.json$/.test(x)).flatMap(x=>JSON.parse(fs.readFileSync(dir+'/'+x)));
const quote=s=>'"'+s.replaceAll('"','""')+'"';const table=t=>quote(t.schema)+'.'+quote(t.name);
const pg=new EmbeddedPostgres({databaseDir:dir+'/pg-scratch-'+Date.now(),user:'postgres',password:'local-synthetic-rehearsal',port:56891,persistent:false,postgresFlags:['-h','127.0.0.1','-k',dir],onLog:()=>{},onError:()=>{}});
let client,failure;
try{
 await pg.initialise();await pg.start();client=pg.getPgClient('postgres','127.0.0.1');await client.connect();
 await client.query("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;create schema marketing_private;create schema platform_private;create extension pgcrypto with schema extensions;set check_function_bodies=off;set search_path=public,extensions;");
 for(const t of catalog.enums) await client.query(`create type ${table(t)} as enum (${t.labels})`);
 for(const t of catalog.tables)await client.query(`create table ${table(t)} (${t.columns.map(c=>quote(c.name)+' '+c.type+(c.generated?' generated always as ('+c.default+') stored':'')).join(',')})`);
 for(const f of functions){try{await client.query(f.ddl)}catch(e){throw Error('baseline function '+f.schema+'.'+f.name+': '+e.message)}}
 for(const t of catalog.triggers) await client.query(t.function_ddl);
 for(const t of catalog.tables)for(const c of t.columns){
  if(c.default&&!c.generated){let seq=c.default.match(/nextval\('([^']+)'::regclass\)/);if(seq)await client.query('create sequence if not exists '+seq[1]);await client.query(`alter table ${table(t)} alter column ${quote(c.name)} set default ${c.default}`)}
  if(c.not_null)await client.query(`alter table ${table(t)} alter column ${quote(c.name)} set not null`);
 }
 for(const c of catalog.constraints)await client.query(`alter table ${table(c)} add constraint ${quote(c.conname)} ${c.ddl}`);
 for(const t of catalog.triggers)await client.query(t.ddl);
 for(const i of catalog.indexes)await client.query(i.ddl);
 const patched=['marketing_inbox_enqueue','marketing_inbox_process_events','marketing_inbox_send_checkpoint','marketing_inbox_signed_events','marketing_inbox_send_material','marketing_inbox_ai_prepare','marketing_inbox_read','marketing_meta_disconnect'];
 const baseline=(await client.query("select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) ddl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','marketing_private')")).rows;
 const compat=fs.readdirSync(root+'/supabase/migrations').find(x=>x.endsWith('_marketing_whatsapp_production_compatibility.sql'));
 const migrations=[compat,'20261021140812_marketing_whatsapp_connector_foundation.sql','20261021150315_marketing_whatsapp_embedded_signup.sql','20261021150808_marketing_whatsapp_signup_recovery.sql','20261021163645_marketing_whatsapp_lifecycle_readiness.sql'];
 await client.query('begin');
 const org=(await client.query("insert into public.organizations(name) values('Synthetic local only') returning id")).rows[0].id;
 const brand=(await client.query("insert into public.brands(organization_id,name) values($1,'Synthetic local only') returning id",[org])).rows[0].id;
 const social=(await client.query("insert into public.marketing_connections(organization_id,brand_id,channel,provider_account_id,status,credential_generation) values($1,$2,'facebook','111','test_authorized',7),($1,$2,'instagram','222','test_authorized',8) returning id",[org,brand])).rows.map(r=>r.id);
 const beforeSocial=(await client.query('select to_jsonb(c) row from public.marketing_connections c where id=any($1) order by id',[social])).rows;

 for(const name of migrations){try{await client.query(fs.readFileSync(root+'/supabase/migrations/'+name,'utf8'));console.log('APPLIED LOCAL',name);if(name===compat)await client.query("update public.marketing_connections set inbox_automation_owner='feedx',inbox_automation_generation=credential_generation where id=any($1)",[social])}catch(e){throw Error('migration '+name+': '+e.message)}}
 const after=(await client.query("select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) ddl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','marketing_private')")).rows;
 const changed=baseline.filter(f=>after.find(a=>a.signature===f.signature)?.ddl!==f.ddl).map(f=>f.signature);
 console.log('Changed existing authorities:',JSON.stringify(changed));
 assert.equal(changed.length,9);
 const preserved=(await client.query("select to_jsonb(c)-array['inbox_automation_owner','inbox_automation_generation','whatsapp_waba_id','whatsapp_onboarding_mode','whatsapp_revision','whatsapp_local_state'] row from public.marketing_connections c where id=any($1) order by id",[social])).rows;
 assert.deepEqual(preserved,beforeSocial);
 assert.equal((await client.query("select count(*)::int n from public.marketing_connections where id=any($1) and inbox_automation_owner='feedx' and inbox_automation_generation=credential_generation",[social])).rows[0].n,2);

 assert.equal((await client.query("select count(*)::int n from public.marketing_connections where channel='whatsapp'")).rows[0].n,0);
 for(const name of ['whatsapp_platform_readiness','whatsapp_pilot_authority','whatsapp_sync_receipts'])assert.equal((await client.query('select count(*)::int n from marketing_private.'+name)).rows[0].n,0);
 assert.match((await client.query("select pg_get_functiondef('public.marketing_inbox_send_material(uuid,uuid)'::regprocedure) ddl")).rows[0].ddl,/WhatsApp sending is disabled/);
 assert.match((await client.query("select pg_get_functiondef('public.marketing_inbox_ai_prepare(uuid,uuid,integer,text)'::regprocedure) ddl")).rows[0].ddl,/WhatsApp AI is disabled/);
 assert.equal((await client.query("select to_regprocedure('marketing_private.inbox_automation_issue(uuid,timestamp with time zone)') is null absent")).rows[0].absent,true);
 const wa=(await client.query(`insert into public.marketing_connections(organization_id,brand_id,channel,provider_account_id,whatsapp_waba_id,whatsapp_onboarding_mode,credential_generation,capabilities) values($1,$2,'whatsapp','333','444','coexistence',1,'{"sending":true,"ai":true}') returning *`,[org,brand])).rows[0];
 assert.equal(wa.capabilities.sending,false);assert.equal(wa.capabilities.ai,false);assert.equal(wa.inbox_automation_owner,'unknown');
 assert.equal((await client.query('select marketing_private.whatsapp_receiving($1) receiving',[wa.id])).rows[0].receiving,false);
 async function rejected(sql,args){await client.query('savepoint denied');let error;try{await client.query(sql,args)}catch(e){error=e}await client.query('rollback to savepoint denied');await client.query('release savepoint denied');assert.ok(error,'expected database denial');return error.message}
 assert.match(await rejected("update public.marketing_connections set provider_account_id='999' where id=$1",[wa.id]),/immutable/);
 assert.match(await rejected('update public.marketing_connections set credential_generation=0 where id=$1',[wa.id]),/decrease/);
 await rejected("insert into public.marketing_connections(organization_id,brand_id,channel,provider_account_id,whatsapp_waba_id,whatsapp_onboarding_mode,credential_generation) values($1,$2,'whatsapp','333','444','coexistence',1)",[org,brand]);
 await client.query("insert into marketing_private.whatsapp_sync_receipts(connection_id,step,event,generation) values($1,'history','claimed',1)",[wa.id]);
 assert.match(await rejected('delete from marketing_private.whatsapp_sync_receipts where connection_id=$1',[wa.id]),/immutable/);
 assert.equal((await client.query("select has_function_privilege('authenticated','marketing_private.whatsapp_step_base(uuid,uuid,integer,text,text,text)','execute') allowed")).rows[0].allowed,false);
 await client.query('rollback');
 fs.writeFileSync(dir+'/local-rehearsal-result.json',JSON.stringify({postgres:'17.6',migrations,changed_existing_authorities:changed,zero_connections:true,zero_approvals:true,fb_ig_records_preserved:true,ownership_fields_preserved:true,identity_generation_uniqueness_receipt_privilege_denials:true,transaction_rolled_back:true},null,2));
 console.log('PASS local Production-schema migration rehearsal; transaction rolled back.');
}catch(e){failure=e}finally{await client?.end();await pg.stop()}
if(failure)throw failure;
