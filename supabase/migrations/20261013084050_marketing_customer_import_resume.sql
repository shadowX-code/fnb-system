-- Resume only exact interrupted uploads; changed customer approvals require a new validated import.
create index customer_import_history on marketing_private.customer_import_jobs(brand_id,created_at desc);
create or replace function public.platform_customer_import_job(p_org uuid,p_brand uuid,p_action text,p_job uuid default null,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,p_brand,'platform_customers.manage');j marketing_private.customer_import_jobs;r jsonb;v jsonb;i integer;fp text;phone text;source_name text:=trim(p_payload->>'source');
begin
 if p_brand is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2000000 then raise exception 'Invalid import context or batch.';end if;
 if p_action='mapping_read' then
  return jsonb_build_object('mapping',(select to_jsonb(m)-'brand_id' from marketing_private.customer_import_mappings m where m.brand_id=p_brand and m.source=source_name));
 elsif p_action='mapping_save' then
  if length(source_name) not between 1 and 80 or source_name is null or jsonb_typeof(p_payload->'headers') is distinct from 'array' or jsonb_array_length(p_payload->'headers') not between 1 and 100 or jsonb_typeof(p_payload->'mapping') is distinct from 'object' then raise exception 'Select a POS source and valid field mapping.';end if;
  if not(p_payload->'mapping' ?& array['name','phone']) or p_payload->'mapping'->>'name'='' or p_payload->'mapping'->>'phone'='' then raise exception 'Map Name and Phone.';end if;
  for r in select jsonb_build_object('key',key,'value',value) from jsonb_each_text(p_payload->'mapping') loop
   if r->>'key' not in('name','phone','email','gender','birthday','total_visit','avg_spent','total_spent','last_visit','member_since','tags','brand','outlet_id','language') or (r->>'value'<>'' and not(p_payload->'headers' ? (r->>'value'))) then raise exception 'Mapping contains an unsupported field or unavailable source column.';end if;
  end loop;
  if (select count(*) from jsonb_each_text(p_payload->'mapping') where value<>'')<>(select count(distinct value) from jsonb_each_text(p_payload->'mapping') where value<>'') then raise exception 'Each source column can map to only one field.';end if;
  insert into marketing_private.customer_import_mappings values(p_brand,source_name,p_payload->'headers',p_payload->'mapping',now()) on conflict(brand_id,source) do update set headers=excluded.headers,mapping=excluded.mapping,updated_at=now();return jsonb_build_object('saved',true);
 elsif p_action='history' then
  return jsonb_build_object('jobs',coalesce((select jsonb_agg(to_jsonb(x)) from(select id,source,snapshot_date,file_name,total,state,processed,error,created_at,completed_at from marketing_private.customer_import_jobs where brand_id=p_brand and organization_id=p_org order by created_at desc limit 50)x),'[]'));
 elsif p_action='begin' then
  if p_job is null or source_name is null or length(source_name) not between 1 and 80 or length(coalesce(p_payload->>'file_name','')) not between 1 and 160 or (p_payload->>'total')::integer not between 1 and 10000 or marketing_private.customer_import_date(p_payload->>'snapshot_date') is null or marketing_private.customer_import_date(p_payload->>'snapshot_date')>current_date or length(coalesce(p_payload->>'file_digest',''))<>64 then raise exception 'Use a source, snapshot date and file with 1–10,000 rows.';end if;
  fp:=md5(jsonb_build_array(p_org,p_brand,p_payload)::text);
  insert into marketing_private.customer_import_jobs(id,organization_id,brand_id,actor_employee_id,actor_auth_id,source,snapshot_date,file_name,total,fingerprint) values(p_job,p_org,p_brand,actor,auth.uid(),source_name,marketing_private.customer_import_date(p_payload->>'snapshot_date'),p_payload->>'file_name',(p_payload->>'total')::integer,fp) on conflict(id) do nothing;
  select * into j from marketing_private.customer_import_jobs where id=p_job;
  if j.actor_employee_id<>actor or j.fingerprint<>fp then raise exception 'Import request changed. Start a new import.';end if;
 end if;
 if p_action in('upload','confirm','retry') then
  select * into j from marketing_private.customer_import_jobs where id=p_job and organization_id=p_org and brand_id=p_brand for update;
 else select * into j from marketing_private.customer_import_jobs where id=p_job and organization_id=p_org and brand_id=p_brand;end if;
 if j.id is null then raise exception 'Import unavailable for this Brand.';end if;
 if p_action in('upload','confirm','retry') and j.actor_employee_id<>actor then raise exception 'Only the confirming importer can resume this job.';end if;
 if p_action='upload' then
  if jsonb_typeof(p_payload->'rows') is distinct from 'array' or jsonb_array_length(p_payload->'rows') not between 1 and 250 or (p_payload->>'start')::integer<1 or (p_payload->>'start')::integer+jsonb_array_length(p_payload->'rows')-1>j.total then raise exception 'Use bounded import batches of up to 250 rows.';end if;
  i:=(p_payload->>'start')::integer;
  for r in select value from jsonb_array_elements(p_payload->'rows') loop
   v:=r->'input'||jsonb_build_object('_source',j.source,'_snapshot_date',j.snapshot_date);fp:=md5(jsonb_build_array(v,r->'decision')::text);
   if exists(select 1 from marketing_private.customer_import_rows where job_id=j.id and row_number=i and fingerprint<>fp) then raise exception 'Uploaded batch changed. Start a new import.';end if;
   if j.state='uploading' then
    phone:=null;begin phone:=marketing_private.my_phone(v->>'phone');exception when raise_exception then null;end;
    if jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(r->'decision') is distinct from 'object' then raise exception 'Invalid row approval.';end if;
    insert into marketing_private.customer_import_rows values(j.id,i,v,r->'decision',fp,phone,null) on conflict do nothing;
   end if;i:=i+1;
  end loop;
 elsif p_action='confirm' then
  if j.state='uploading' then
   if (select count(*) from marketing_private.customer_import_rows where job_id=j.id)<>j.total then raise exception 'Upload is incomplete. Resume the same file.';end if;
   update marketing_private.customer_import_jobs set state='queued',checked_at=now() where id=j.id;
  end if;
 elsif p_action='retry' then
  if j.state<>'attention' or j.attempts>=3 then raise exception 'This import cannot be retried automatically. Review its results.';end if;
  update marketing_private.customer_import_jobs set state='queued',error=null,checked_at=now() where id=j.id;
 elsif p_action not in('begin','read') then raise exception 'Unsupported import action.';end if;
 select * into j from marketing_private.customer_import_jobs where id=p_job;
 return jsonb_build_object('id',j.id,'source',j.source,'snapshot_date',j.snapshot_date,'file_name',j.file_name,'state',j.state,'total',j.total,'processed',j.processed,'attempts',j.attempts,'error',j.error,'error_code',j.error_code,'completed_at',j.completed_at,
 'approvals',case when j.state='uploading' then coalesce((select jsonb_object_agg(row_number,decision) from marketing_private.customer_import_rows where job_id=j.id),'{}') else null end,
 'uploaded',(select count(*) from marketing_private.customer_import_rows where job_id=j.id),
 'counts',coalesce((select jsonb_object_agg(status,n) from(select outcome->>'status' status,count(*) n from marketing_private.customer_import_rows where job_id=j.id and outcome is not null group by 1)x),'{}'),
 'rows',coalesce((select jsonb_agg(outcome order by row_number) from(select row_number,outcome from marketing_private.customer_import_rows where job_id=j.id and outcome is not null and row_number>coalesce((p_payload->>'after')::integer,0) order by row_number limit 250)x),'[]'));
end;$$;

