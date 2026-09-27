-- Discovery telemetry is private. Only the trusted Edge checker completes it.
create table public.payroll_holiday_update_checks (
 id uuid primary key default extensions.gen_random_uuid(),
 year integer not null check(year between 2000 and 2200), geography text not null,
 request_id uuid not null unique, actor_employee_id uuid not null references public.employees(id),
 started_at timestamptz not null default now(), completed_at timestamptz,
 result jsonb
);
alter table public.payroll_holiday_update_checks enable row level security;
revoke all on public.payroll_holiday_update_checks from public,anon,authenticated;
create index on public.payroll_holiday_update_checks(year,geography,started_at desc);

create function public.payroll_holiday_update_check_read(p_year integer,p_geography text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); r jsonb;
begin
 select to_jsonb(c)-'actor_employee_id'-'request_id' into r from public.payroll_holiday_update_checks c
 where year=p_year and geography=p_geography order by started_at desc limit 1;
 return r;
end $$;

create function public.payroll_holiday_update_check_begin(p_year integer,p_geography text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); c public.payroll_holiday_update_checks%rowtype;
begin
 if p_year is null or p_year not between 2000 and 2200 or p_request_id is null or
 p_geography is null or p_geography !~ '^(national|MY-(0[1-9]|1[0-6]))$' then raise exception 'Choose a year and geography.'; end if;
 perform pg_advisory_xact_lock(hashtext('holiday-discovery:'||p_year||':'||p_geography));
 select * into c from public.payroll_holiday_update_checks where request_id=p_request_id;
 if found then
  if c.year<>p_year or c.geography<>p_geography or c.actor_employee_id<>a then raise exception 'Check request has changed.'; end if;
  return to_jsonb(c);
 end if;
 if exists(select 1 from public.payroll_holiday_update_checks where year=p_year and geography=p_geography and completed_at is null and started_at>now()-interval '2 minutes') then raise exception 'An official update check is already running. Try again shortly.'; end if;
 insert into public.payroll_holiday_update_checks(year,geography,request_id,actor_employee_id)
 values(p_year,p_geography,p_request_id,a) returning * into c;
 return to_jsonb(c);
end $$;

create function public.payroll_holiday_update_check_finish(p_id uuid,p_result jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>64000
 or p_result->>'status' not in ('no_updates','updates_found','review_pending','incomplete') then raise exception 'Invalid check result.'; end if;
 update public.payroll_holiday_update_checks set completed_at=now(),result=p_result where id=p_id and completed_at is null;
end $$;

-- Content-level lock/reuse; capture still belongs to the existing import authority.
create function public.payroll_holiday_discovered_source_capture(p_year integer,p_url text,p_reference text,p_filename text,p_pdf_base64 text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); h text; c public.payroll_holiday_import_candidates%rowtype; i uuid;
begin
 if p_url !~ '^https://www\.kabinet\.gov\.my/storage/[^?#]+\.pdf$' or length(p_pdf_base64)>7000000 then raise exception 'Discovered source is not allowed.'; end if;
 h:=encode(extensions.digest(decode(p_pdf_base64,'base64'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtext('holiday-source:'||p_year||':'||h));
 select * into c from public.payroll_holiday_import_candidates where year=p_year and not is_qa and status<>'retired' and source_sha256=h order by created_at limit 1;
 if found then return jsonb_build_object('id',c.id,'created',false,'status',c.status); end if;
 i:=public.payroll_holiday_candidate_capture(p_year,p_url,p_reference,p_filename,p_pdf_base64,p_request_id,false);
 return jsonb_build_object('id',i,'created',true,'status','fetched');
end $$;

revoke all on function public.payroll_holiday_update_check_read(integer,text),public.payroll_holiday_update_check_begin(integer,text,uuid),public.payroll_holiday_update_check_finish(uuid,jsonb),public.payroll_holiday_discovered_source_capture(integer,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.payroll_holiday_update_check_read(integer,text),public.payroll_holiday_update_check_begin(integer,text,uuid),public.payroll_holiday_discovered_source_capture(integer,text,text,text,text,uuid) to authenticated;
grant execute on function public.payroll_holiday_update_check_finish(uuid,jsonb) to service_role;
