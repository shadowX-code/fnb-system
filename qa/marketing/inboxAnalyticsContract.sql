-- Local-only disposable PostgreSQL contract test. Never run against a shared database.
\set ON_ERROR_STOP on
begin;
do $$begin
 assert current_database()='inbox_analytics_contract_qa','Local disposable database required';
 assert to_regclass('public.marketing_conversations') is null,'Fresh database required';
end;$$;
create role anon;
create role authenticated;
create schema marketing_private;
create function marketing_private.require_access(o uuid,b uuid,p text) returns uuid language plpgsql as $$begin
 if o<>'00000000-0000-0000-0000-000000000001' or (b is not null and b<>'00000000-0000-0000-0000-000000000002') then raise insufficient_privilege;end if;
 return '00000000-0000-0000-0000-000000000003';end;$$;
create function marketing_private.brand_allowed(o uuid,b uuid) returns boolean language sql as $$select o='00000000-0000-0000-0000-000000000001' and b='00000000-0000-0000-0000-000000000002'$$;
create table public.marketing_conversations(id uuid primary key,organization_id uuid,brand_id uuid,channel text,status text,created_at timestamptz);
create table public.marketing_conversation_messages(conversation_id uuid,kind text,occurred_at timestamptz);
create table public.marketing_inbox_ai_artifacts(conversation_id uuid,kind text,state text);
create table public.marketing_events(action text,details jsonb);
insert into marketing_conversations values
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','facebook','open','2020-01-02'),
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','instagram','resolved','2020-01-02'),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','internal','open','2020-01-02'),
 ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000099','facebook','open','2020-01-02');
insert into marketing_conversation_messages values
 ('00000000-0000-0000-0000-000000000010','incoming','2020-01-02 00:00Z'),('00000000-0000-0000-0000-000000000010','echo','2020-01-02 00:01Z');
\ir ../../supabase/migrations/20261015071330_inbox_analytics_social_scope.sql
create temp table before_metrics as select ch,public.marketing_inbox_analytics('00000000-0000-0000-0000-000000000001',null,ch) result from unnest(array['','social','internal','facebook','instagram']) ch;
create temp table before_definition as select pg_get_functiondef('public.marketing_inbox_analytics(uuid,uuid,text,timestamptz,timestamptz)'::regprocedure) definition,proacl acl from pg_proc where oid='public.marketing_inbox_analytics(uuid,uuid,text,timestamptz,timestamptz)'::regprocedure;
\ir ../../supabase/migrations/20261023063351_marketing_inbox_analytics_whatsapp_channel.sql
do $$declare channel_filter text;r jsonb;failed boolean;begin
 foreach channel_filter in array array['','social','internal','facebook','instagram'] loop
  assert public.marketing_inbox_analytics('00000000-0000-0000-0000-000000000001',null,channel_filter)=(select result from before_metrics b where b.ch=channel_filter),'Existing metrics changed';
 end loop;
 r:=public.marketing_inbox_analytics('00000000-0000-0000-0000-000000000001',null,'whatsapp');
 assert r->>'volume'='0' and r->>'unresolved'='0' and r->>'human_handovers'='0' and r->>'ai_reply_proposals'='0','Zero WhatsApp counts';
 assert r->'first_response_seconds'='null'::jsonb and r->'ai_acceptance_rate'='null'::jsonb and r->'automation_rate'='null'::jsonb,'Unknown rates remain unavailable';
 assert r->>'cohort'='conversations_created_in_period','Reporting cohort retained';
 foreach channel_filter in array array['unsupported',null] loop
  failed:=false;begin perform public.marketing_inbox_analytics('00000000-0000-0000-0000-000000000001',null,channel_filter);exception when raise_exception then failed:=true;end;assert failed,'Invalid channel accepted';
 end loop;
 failed:=false;begin perform public.marketing_inbox_analytics('00000000-0000-0000-0000-000000000001',null,'whatsapp','2020-01-03','2020-01-02');exception when raise_exception then failed:=true;end;assert failed,'Invalid date range accepted';
 failed:=false;begin perform public.marketing_inbox_analytics('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000099','whatsapp');exception when insufficient_privilege then failed:=true;end;assert failed,'Brand guard lost';
 failed:=false;begin perform public.marketing_inbox_analytics('00000000-0000-0000-0000-000000000099',null,'whatsapp');exception when insufficient_privilege then failed:=true;end;assert failed,'Tenant guard lost';
 assert not has_function_privilege('anon','public.marketing_inbox_analytics(uuid,uuid,text,timestamptz,timestamptz)','execute'),'Anonymous allowed';
 assert has_function_privilege('authenticated','public.marketing_inbox_analytics(uuid,uuid,text,timestamptz,timestamptz)','execute'),'Authenticated grant lost';
 assert (select proacl from pg_proc where oid='public.marketing_inbox_analytics(uuid,uuid,text,timestamptz,timestamptz)'::regprocedure)=(select acl from before_definition),'ACL changed';
 assert replace(pg_get_functiondef('public.marketing_inbox_analytics(uuid,uuid,text,timestamptz,timestamptz)'::regprocedure),$s$('','social','internal','facebook','instagram','whatsapp')$s$,$s$('','social','internal','facebook','instagram')$s$)=(select definition from before_definition),'Unreviewed function change';
end;$$;
insert into marketing_conversations values('00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','whatsapp','open','2020-01-02');
do $$begin
 assert public.marketing_inbox_analytics('00000000-0000-0000-0000-000000000001',null,'whatsapp')->>'volume'='1';
 assert public.marketing_inbox_analytics('00000000-0000-0000-0000-000000000001',null,'social')->>'volume'='3';
 assert public.marketing_inbox_analytics('00000000-0000-0000-0000-000000000001',null,'')->>'volume'='4';
 assert public.marketing_inbox_analytics('00000000-0000-0000-0000-000000000001',null,'whatsapp','2020-01-03','2020-01-04')->>'volume'='0';
 assert public.marketing_inbox_analytics('00000000-0000-0000-0000-000000000001',null,'whatsapp','2020-01-02','2020-01-03')->>'volume'='1';
end;$$;
rollback;
\echo Inbox analytics contract PASS
