// Offline only: reconstruct current Production metadata, never accept a remote database URL.
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';import {createHash,randomUUID} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=process.argv[2],runtime=process.argv[3];
if(!dir?.startsWith('/')||!runtime?.startsWith('/'))throw Error('Supply absolute local capture directory and embedded-postgres module file.');
const read=p=>JSON.parse(fs.readFileSync(path.join(dir,p),'utf8')),cat=read('catalog-0.json'),schemas=read('schemas.json');
const functions=fs.readdirSync(dir).filter(n=>/^functions-\d+\.json$/.test(n)).flatMap(read),identities=new Map(read('function-identities.json').map(f=>[f.md5,f.signature]));
const hash=(s,algorithm='sha256')=>createHash(algorithm).update(s).digest('hex'),q=s=>'"'+s.replaceAll('"','""')+'"',table=t=>q(t.schema)+'.'+q(t.name);
const compat='20261025011621_marketing_whatsapp_receive_context_compatibility.sql',lifecycle='20261024185401_marketing_whatsapp_message_lifecycle.sql';
const sql=n=>fs.readFileSync(path.join(root,'supabase/migrations',n),'utf8');
assert.equal(cat.server_version,'17.6');assert.equal(cat.tables.find(t=>t.name==='marketing_conversation_messages').columns.some(c=>c.name==='provider_context'),false);
const {default:EmbeddedPostgres}=await import(pathToFileURL(runtime).href);
const pg=new EmbeddedPostgres({databaseDir:path.join(dir,'pg-'+randomUUID()),user:'postgres',password:randomUUID(),port:56892,persistent:false,postgresFlags:['-h','127.0.0.1','-k',dir],onLog:()=>{},onError:()=>{}});
let c,failure;const results={baseline:cat.ledger,captured_tables:cat.tables.length,captured_functions:functions.length};
try{
 await pg.initialise();await pg.start();c=pg.getPgClient('postgres','127.0.0.1');await c.connect();
 const roles=new Set(['anon','authenticated','service_role',...cat.tables.map(t=>t.owner),...functions.map(f=>f.owner),...schemas.map(s=>s.owner),...cat.grants.map(g=>g.grantee),...functions.flatMap(f=>(f.grants??[]).map(g=>g.grantee)),...schemas.flatMap(s=>(s.grants??[]).map(g=>g.grantee))]);
 for(const role of roles)if(!['postgres','public','pg_database_owner'].includes(role))await c.query('create role '+q(role)+(role==='service_role'?' bypassrls':''));
 for(const s of schemas)if(s.schema!=='public')await c.query('create schema '+q(s.schema));
 await c.query('create extension pgcrypto with schema extensions;set check_function_bodies=off;set search_path=public,extensions;');
 for(const t of cat.enums??[])await c.query(`create type ${table(t)} as enum (${t.labels})`);
 for(const t of cat.tables)await c.query(`create table ${table(t)} (${t.columns.map(a=>q(a.name)+' '+a.type+(a.generated?' generated always as ('+a.default+') stored':a.identity?' generated '+(a.identity==='a'?'always':'by default')+' as identity':'')).join(',')})`);
 for(const f of functions)await c.query(f.ddl);
 for(const t of cat.tables)for(const a of t.columns){if(a.default&&!a.generated&&!a.identity){const seq=a.default.match(/nextval\('([^']+)'::regclass\)/);if(seq)await c.query('create sequence if not exists '+seq[1]);await c.query(`alter table ${table(t)} alter column ${q(a.name)} set default ${a.default}`);}if(a.not_null)await c.query(`alter table ${table(t)} alter column ${q(a.name)} set not null`);}
 for(const type of ['p','u','c','f'])for(const a of cat.constraints.filter(x=>x.type===type))await c.query(`alter table ${table(a)} add constraint ${q(a.conname)} ${a.ddl}`);
 for(const a of cat.indexes)await c.query(a.ddl);
 for(const a of cat.triggers)await c.query(a.ddl);
 for(const t of cat.tables){await c.query(`alter table ${table(t)} owner to ${q(t.owner)};revoke all on ${table(t)} from public,anon,authenticated,service_role`);if(t.rls)await c.query(`alter table ${table(t)} enable row level security`);if(t.force_rls)await c.query(`alter table ${table(t)} force row level security`);}
 for(const p of cat.policies??[]){const cmd={r:'select',a:'insert',w:'update',d:'delete','*':'all'}[p.command];await c.query(`create policy ${q(p.policy)} on ${table(p)} as ${p.permissive?'permissive':'restrictive'} for ${cmd} to ${p.roles}`+(p.qual?' using ('+p.qual+')':'')+(p.check?' with check ('+p.check+')':''));}
 for(const g of cat.grants)await c.query(`grant ${g.privilege} on ${table(g)} to ${g.grantee==='public'?'public':q(g.grantee)}`+(g.grantable?' with grant option':''));
 for(const f of functions){const sig=identities.get(hash(f.ddl,'md5'));assert.ok(sig,'captured function identity');await c.query(`alter function ${sig} owner to ${q(f.owner)};revoke all on function ${sig} from public,anon,authenticated,service_role`);for(const g of f.grants??[])await c.query(`grant execute on function ${sig} to ${g.grantee==='public'?'public':q(g.grantee)}`+(g.grantable?' with grant option':''));}
 for(const s of schemas){await c.query(`alter schema ${q(s.schema)} owner to ${q(s.owner)};revoke all on schema ${q(s.schema)} from public,anon,authenticated,service_role`);for(const g of s.grants??[])await c.query(`grant ${g.privilege} on schema ${q(s.schema)} to ${g.grantee==='public'?'public':q(g.grantee)}`+(g.grantable?' with grant option':''));}
 for(const p of read('permissions.json'))await c.query('insert into permissions(code,module,requires_restaurant_outlet_scope) values($1,$2,$3)',[p.code,p.module,p.requires_restaurant_outlet_scope]);
 for(const d of read('default-acl.json'))for(const g of d.grants)await c.query(`alter default privileges for role ${q(d.owner)}${d.schema?' in schema '+q(d.schema):''} grant ${g.privilege} on ${{r:'tables',S:'sequences',f:'functions'}[d.type]} to ${g.grantee==='public'?'public':q(g.grantee)}`+(g.grantable?' with grant option':''));
 const fingerprint=async()=> (await c.query(`select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) ddl,p.proacl::text acl,pg_get_userbyid(p.proowner) owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','marketing_private','platform_private','auth') and p.prokind='f' order by 1`)).rows;
 const security=async()=> (await c.query("select n.nspname,c.relname,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','marketing_private','auth') order by 1,2")).rows;
 const beforeSecurity=await security();const before=await fingerprint();
 // Validate the captured worker/detail/read bytes against Production, including all preserved branches.
 for(const f of functions){const sig=identities.get(hash(f.ddl,'md5'));assert.ok(before.some(a=>a.ddl===f.ddl),sig+' exact Production definition');}
 results.production_definitions_exact=true;
 await c.query('begin;savepoint original_failure');let missing;
 try{await c.query(sql(lifecycle));}catch(e){missing=e;}assert.equal(missing?.code,'42703');assert.match(missing.message,/provider_context/);await c.query('rollback to savepoint original_failure;release savepoint original_failure');results.original_failure_reproduced=missing.code;
 const fixture=fs.readFileSync(path.join(root,'qa/staging/marketingWhatsAppReceive.rollback.sql'),'utf8');
 const setup=fixture.slice(fixture.indexOf('create temporary table'),fixture.indexOf('set local role authenticated;')).replaceAll('marketing_qa_ids','social_qa_ids');await c.query(setup);
 const ids=Object.fromEntries((await c.query('select key,id from social_qa_ids')).rows.map(x=>[x.key,x.id]));
 const conv=[];
 for(const channel of ['facebook','instagram']){const conn=(await c.query(`insert into marketing_connections(organization_id,brand_id,channel,provider_account_id,status,credential_generation) values($1,$2,$3,$4,'test_authorized',7) returning id`,[ids.org,ids.brand,channel,channel==='facebook'?'5551':'5552'])).rows[0].id;const id=(await c.query(`insert into marketing_conversations(organization_id,brand_id,channel,connection_id,connection_generation,title,participant_key,last_inbound_at) values($1,$2,$3,$4,7,'Synthetic local social','5553',now()) returning id`,[ids.org,ids.brand,channel,conn])).rows[0].id;conv.push(id);await c.query(`insert into marketing_conversation_messages(conversation_id,kind,body,provider_message_id,occurred_at,evidence_source) values($1,'incoming','Existing social original',$2,now(),'signed_webhook'),($1,'echo','Existing mobile reply',$3,now(),'signed_webhook')`,[id,channel+'.incoming',channel+'.echo']);await c.query("insert into marketing_conversation_messages(conversation_id,kind,body,provider_message_id,occurred_at,evidence_source) values($1,'delivery','Existing receipt',$2,now(),'signed_webhook'),($1,'read','Existing read receipt',$3,now(),'signed_webhook')",[id,channel+'.delivery',channel+'.read']);}
 const socialRows=(await c.query('select to_jsonb(m) row from marketing_conversation_messages m order by id')).rows;
 async function socialReads(){await c.query('savepoint social_reads;set local role authenticated');try{const details=[],lists=[];for(const id of conv)details.push((await c.query('select marketing_inbox_detail($1) value',[id])).rows[0].value);for(const channel of ['facebook','instagram'])lists.push((await c.query("select marketing_inbox_read($1,$2,'',$3) value",[ids.org,ids.brand,channel])).rows[0].value);await c.query('reset role;release savepoint social_reads');return {details,lists};}catch(e){await c.query('rollback to savepoint social_reads;reset role;release savepoint social_reads');throw e;}}
 const beforeReads=await socialReads();
 for(const n of [compat,lifecycle]){await c.query(sql(n));console.log('APPLIED LOCAL',n);}
 assert.deepEqual((await c.query("select to_jsonb(m)-'provider_context' row from marketing_conversation_messages m order by id")).rows,socialRows);
 assert.ok(beforeReads.details.every(d=>d.audit_messages.length===2),'FB/IG receipt fixture present');assert.deepEqual(await socialReads(),beforeReads);results.fb_ig_rows_and_reads_unchanged=true;
 assert.equal((await c.query("select count(*)::int n from marketing_conversation_messages where provider_context<>'{}'::jsonb")).rows[0].n,0);
 assert.equal((await c.query("select has_column_privilege('authenticated','public.marketing_conversation_messages','provider_context','select') allowed")).rows[0].allowed,false);
 for(const bad of [null,{payload:'x'.repeat(8193)}]){await c.query('savepoint bounded_context');let error;try{await c.query('update marketing_conversation_messages set provider_context=$1',[bad]);}catch(e){error=e;}assert.ok(error);await c.query('rollback to savepoint bounded_context;release savepoint bounded_context');}results.context_null_and_oversize_rejected=true;
 const after=await fingerprint(),changed=before.filter(f=>after.find(a=>a.signature===f.signature)?.ddl!==f.ddl).map(f=>f.signature);
 assert.equal(changed.length,4);for(const f of before){const a=after.find(a=>a.signature===f.signature);assert.equal(a.acl,f.acl,f.signature+' ACL');assert.equal(a.owner,f.owner,f.signature+' owner');}
 assert.equal((await c.query("select to_regprocedure('marketing_private.inbox_automation_issue(uuid,timestamptz)') is null absent")).rows[0].absent,true);
 results.changed_existing_authorities=changed;results.existing_function_grants_owners_preserved=true;assert.deepEqual(await security(),beforeSecurity);results.table_security_preserved=true;for(const [signature,denial] of [['public.marketing_inbox_send_material(uuid,uuid)','WhatsApp sending is disabled'],['public.marketing_inbox_ai_prepare(uuid,uuid,integer,text)','WhatsApp AI is disabled']])assert.ok((await c.query('select pg_get_functiondef($1::regprocedure) ddl',[signature])).rows[0].ddl.includes(denial));results.whatsapp_execution_gates_preserved=true;results.no_broader_ai_ownership=true;
 await c.query(fixture.replace(/^begin;$/m,'').replace(/^rollback;$/m,''));results.whatsapp_lifecycle_fixture=true;
 await c.query('rollback');
 assert.equal((await c.query("select count(*)::int n from marketing_connections where channel='whatsapp'")).rows[0].n,0);
 assert.equal((await c.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='marketing_conversation_messages' and column_name='provider_context'")).rows[0].n,0);
 results.transaction_rolled_back=true;results.migrations=[compat,lifecycle].map(name=>({name,sha256:hash(sql(name))}));
 fs.writeFileSync(path.join(dir,'receive-rehearsal-result.json'),JSON.stringify(results,null,2)+'\n');console.log('PASS faithful Production-schema receive lifecycle rehearsal',JSON.stringify(results));
}catch(e){failure=e;}finally{await c?.end();await pg.stop();}if(failure)throw failure;
