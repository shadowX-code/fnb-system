-- Lossless interning, not a larger stored-report allowance. Both raw envelopes
-- and expanded projections are capped at 6 MB; packed progress/reports at 3 MB.
-- At most 10,000 rows can inherit an attribution string of at most 256 bytes.
create function marketing_private.ads_pack_report(p_report jsonb) returns jsonb
language plpgsql immutable set search_path=public as $$
declare k text;v jsonb;common jsonb:=p_report->'insight_attribution';n integer;
begin
 if p_report is null then return null;end if;
 if jsonb_typeof(p_report)<>'object' or octet_length(p_report::text)>6000000 then raise exception using errcode='54000',message='Invalid advertising evidence.';end if;
 select coalesce(sum(jsonb_array_length(value)),0) into n from jsonb_each(coalesce(p_report->'insights','{}'));
 if n>10000 then raise exception using errcode='54000',message='Invalid advertising evidence.';end if;
 if common is null then
  -- Legacy rows without attribution must not acquire invented provenance.
  if exists(select 1 from jsonb_each(coalesce(p_report->'insights','{}')) l cross join lateral jsonb_array_elements(l.value) r where not r ? 'attribution') then return p_report;end if;
  select r->'attribution' into common from jsonb_each(coalesce(p_report->'insights','{}')) l cross join lateral jsonb_array_elements(l.value) r where jsonb_typeof(r->'attribution')='string' limit 1;
 end if;
 if common is null then return p_report;end if;
 if jsonb_typeof(common)<>'string' or octet_length(common::text)>256 then raise exception 'Invalid advertising attribution.';end if;
 p_report:=p_report||jsonb_build_object('insight_attribution',common);
 for k,v in select * from jsonb_each(coalesce(p_report->'insights','{}')) loop
  p_report:=jsonb_set(p_report,array['insights',k],(select coalesce(jsonb_agg(case when r->'attribution'=common then r-'attribution' else r end order by ord),'[]') from jsonb_array_elements(v) with ordinality entries(r,ord)));
 end loop;
 return p_report;
end;$$;

create function marketing_private.ads_unpack_report(p_report jsonb) returns jsonb
language plpgsql immutable set search_path=public as $$
declare k text;v jsonb;common jsonb:=p_report->'insight_attribution';n integer;
begin
 if common is null then return p_report;end if;
 if octet_length(p_report::text)>3000000 or jsonb_typeof(common)<>'string' or octet_length(common::text)>256 then raise exception using errcode='54000',message='Invalid advertising evidence.';end if;
 select coalesce(sum(jsonb_array_length(value)),0) into n from jsonb_each(p_report->'insights');
 if n>10000 then raise exception using errcode='54000',message='Invalid advertising evidence.';end if;
 for k,v in select * from jsonb_each(p_report->'insights') loop
  p_report:=jsonb_set(p_report,array['insights',k],(select coalesce(jsonb_agg(case when r ? 'attribution' then r else r||jsonb_build_object('attribution',common) end order by ord),'[]') from jsonb_array_elements(v) with ordinality entries(r,ord)));
 end loop;
 p_report:=p_report-'insight_attribution';
 if octet_length(p_report::text)>6000000 then raise exception using errcode='54000',message='Invalid advertising evidence.';end if;
 return p_report;
end;$$;
revoke all on function marketing_private.ads_pack_report(jsonb),marketing_private.ads_unpack_report(jsonb) from public,anon,authenticated,service_role;

-- Pack old and new worker payloads at the owning storage authority. Keep the
-- existing checkpoint byte ceiling and require report/period/account identity.
do $$declare f text;needle text;begin
 select pg_get_functiondef('public.marketing_ads_checkpoint(uuid,uuid,jsonb)'::regprocedure) into f;
 needle:=' if jsonb_typeof(p_progress)';
 if position(needle in f)=0 then raise exception 'Checkpoint contract changed';end if;
 f:=replace(f,needle,' if octet_length(p_progress::text)>6000000 then raise exception using errcode=''54000'',message=''Invalid reporting progress'';end if;
 p_progress:=jsonb_set(p_progress,''{report}'',marketing_private.ads_pack_report(p_progress->''report''));
 if p_progress#>>''{report,account,id}'' is distinct from (select provider_account_id from marketing_connections where id=j.connection_id)
 or p_progress#>>''{report,date_from}'' is distinct from j.date_from::text or p_progress#>>''{report,date_to}'' is distinct from j.date_to::text then raise exception ''Reporting identity changed'';end if;
 if jsonb_typeof(p_progress)');
 f:=replace(f,'or octet_length(p_progress::text)>3000000','');
 f:=replace(f,' -- Only persisted forward progress',' if octet_length(p_progress::text)>3000000 then raise exception using errcode=''54000'',message=''Invalid reporting progress'';end if;'||chr(10)||' -- Only persisted forward progress');
 execute f;
 select pg_get_functiondef('marketing_private.ads_project(uuid,text,jsonb,uuid,boolean)'::regprocedure) into f;
 if position('begin'||chr(10)||'select coalesce(jsonb_agg' in f)=0 then raise exception 'Projection contract changed';end if;
 f:=replace(f,'begin'||chr(10)||'select coalesce(jsonb_agg','begin'||chr(10)||'p_payload:=marketing_private.ads_unpack_report(p_payload);'||chr(10)||'select coalesce(jsonb_agg');execute f;

 select pg_get_functiondef('public.marketing_ads_finish(uuid,uuid,jsonb,text)'::regprocedure) into f;
 needle:=' select * into j from marketing_private.ads_sync_jobs where id=p_job and lease=p_lease and state=''leased'' for update;';
 if position(needle in f)=0 or position('length(p_report::text)>3000000' in f)=0 then raise exception 'Finalization contract changed';end if;
 f:=replace(f,needle,' select * into j from marketing_private.ads_sync_jobs where id=p_job for update;
 -- A repeated acknowledgment never rewrites a completed observation.
 if j.state=''succeeded'' then return;end if;
 if j.lease is distinct from p_lease or j.state<>''leased'' then raise exception ''Synchronization lease changed.'';end if;');
 f:=replace(f,' if p_report is null or',
 ' p_report:=marketing_private.ads_pack_report(p_report);
 if j.date_to-j.date_from>93 and (coalesce((j.progress->>''step'')::int,-1)<>8 or p_report is distinct from j.progress->''report'') then raise exception ''Complete reporting checkpoint required.'';end if;
 if p_report is null or p_report->>''date_from'' is distinct from j.date_from::text or p_report->>''date_to'' is distinct from j.date_to::text or');
 f:=replace(f,' or length(p_report::text)>3000000','');
 f:=replace(f,' insert into marketing_private.ads_snapshots',' if octet_length(p_report::text)>3000000 then raise exception using errcode=''54000'',message=''Invalid advertising evidence.'';end if;'||chr(10)||' insert into marketing_private.ads_snapshots');
 f:=replace(f,'''ad_account_access_unverified'') then ''failed''','''ad_account_access_unverified'',''ads_history_evidence_limit'') then ''failed''');execute f;
end $$;

-- Preserve only completed, still-authorized evidence on exhausted finalization
-- retries. Partial/denied/revoked work retains its existing erasure behavior.
create or replace function marketing_private.ads_progress_cleanup() returns trigger
language plpgsql set search_path=public as $$ begin
 if new.state in ('succeeded','cancelled') or (new.state='failed' and
 (coalesce((new.progress->>'step')::int,-1)<>8 or new.error_code in ('meta_permission_or_token_invalid','ads_read_not_granted','ad_account_identity_mismatch','ad_authorizer_changed','ad_account_access_unverified'))) then new.progress:='{}'::jsonb;end if;
 return new;
end;$$;

-- Explicit authorized retry through the existing request authority can resume a
-- failed complete checkpoint. It creates neither a new job nor provider work.
do $$declare f text;needle text;begin
 select pg_get_functiondef('public.marketing_ads_request_sync(uuid,date,date)'::regprocedure) into f;
 needle:=' insert into marketing_private.ads_sync_jobs(connection_id,generation,actor_employee_id,date_from,date_to)';
 if position(needle in f)=0 then raise exception 'Reporting request contract changed';end if;
 f:=replace(f,needle,' select id into job from marketing_private.ads_sync_jobs where connection_id=c.id and generation=c.credential_generation and date_from=p_from and date_to=p_to and state=''failed'' and progress->>''step''=''8'' and progress ? ''report'' order by created_at desc limit 1 for update;
 if job is not null then
  update marketing_private.ads_sync_jobs set actor_employee_id=actor,state=''queued'',attempts=0,error_code=null,retry_at=null,lease=null,lease_until=null where id=job;
  return job;
 end if;
 insert into marketing_private.ads_sync_jobs(connection_id,generation,actor_employee_id,date_from,date_to)');
 execute f;
end $$;
