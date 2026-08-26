-- Admin-configured Crew accounts are the sole internal handover receiver authority.
create table if not exists public.crew_cash_handover_receivers (
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  configured_by uuid references auth.users(id) on delete set null,
  configured_at timestamptz not null default now(),
  primary key (outlet_id, employee_id)
);
alter table public.crew_cash_handover_receivers enable row level security;
revoke all on public.crew_cash_handover_receivers from public, anon, authenticated;
create table if not exists public.crew_cash_handover_receiver_configs (
  outlet_id uuid primary key references public.outlets(id) on delete cascade,
  version integer not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists public.crew_cash_handover_receiver_config_audit (
  id uuid primary key default gen_random_uuid(), outlet_id uuid not null references public.outlets(id) on delete cascade,
  version integer not null, previous_receiver_ids uuid[] not null default '{}', receiver_ids uuid[] not null default '{}',
  changed_by uuid references auth.users(id) on delete set null, changed_at timestamptz not null default now()
);
alter table public.crew_cash_handover_receiver_configs enable row level security;
alter table public.crew_cash_handover_receiver_config_audit enable row level security;
revoke all on public.crew_cash_handover_receiver_configs, public.crew_cash_handover_receiver_config_audit from public, anon, authenticated;

create or replace function public.crew_cash_receiver_is_eligible(p_outlet_id uuid,p_employee_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.crew_cash_handover_receivers r
    join public.employees e on e.id=r.employee_id
    join public.crew_access ca on ca.employee_id=e.id
    where r.outlet_id=p_outlet_id and r.employee_id=p_employee_id
      and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated')
      and ca.access_state='active' and ca.primary_outlet_id=p_outlet_id
  )
$$;
revoke all on function public.crew_cash_receiver_is_eligible(uuid,uuid) from public,anon,authenticated;

create or replace function public.crew_cash_save_handover_receivers(p_outlet_id uuid,p_employee_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare candidate uuid;
begin
  perform public.crew_cash_assert_admin(p_outlet_id,'crew_cash_deposit.record_collection');
  foreach candidate in array coalesce(p_employee_ids,'{}'::uuid[]) loop
    if not public.crew_cash_receiver_is_eligible(p_outlet_id,candidate)
       and not exists(select 1 from public.employees e join public.crew_access ca on ca.employee_id=e.id where e.id=candidate and e.is_active and ca.access_state='active' and ca.primary_outlet_id=p_outlet_id) then
      raise exception using errcode='22023',message='Cash Handover receivers must be active Crew members in this outlet.';
    end if;
  end loop;
  delete from public.crew_cash_handover_receivers where outlet_id=p_outlet_id and employee_id<>all(coalesce(p_employee_ids,'{}'::uuid[]));
  insert into public.crew_cash_handover_receivers(outlet_id,employee_id,configured_by)
  select p_outlet_id,employee_id,auth.uid() from unnest(coalesce(p_employee_ids,'{}'::uuid[])) employee_id
  on conflict(outlet_id,employee_id) do nothing;
  return jsonb_build_object('receiver_ids',coalesce(p_employee_ids,'{}'::uuid[]));
end;
$$;
revoke all on function public.crew_cash_save_handover_receivers(uuid,uuid[]) from public,anon,authenticated;

create or replace function public.crew_cash_save_handover_receivers(p_outlet_id uuid,p_employee_ids uuid[],p_expected_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_version integer; prior uuid[]; next_ids uuid[]:=coalesce(p_employee_ids,'{}'::uuid[]); candidate uuid;
begin
  perform public.crew_cash_assert_admin(p_outlet_id,'crew_cash_deposit.record_collection');
  insert into public.crew_cash_handover_receiver_configs(outlet_id) values(p_outlet_id) on conflict(outlet_id) do nothing;
  select version into current_version from public.crew_cash_handover_receiver_configs where outlet_id=p_outlet_id for update;
  if p_expected_version is null or p_expected_version<>current_version then raise exception using errcode='40001',message='Receiver configuration changed. Reload before saving.'; end if;
  foreach candidate in array next_ids loop
    if not exists(select 1 from public.employees e join public.crew_access ca on ca.employee_id=e.id where e.id=candidate and e.is_active and coalesce(e.employment_status,'active') not in ('resigned','terminated') and ca.access_state='active' and ca.primary_outlet_id=p_outlet_id) then raise exception using errcode='22023',message='Receiver must be an active Crew member in this outlet.'; end if;
  end loop;
  select coalesce(array_agg(employee_id order by employee_id),'{}'::uuid[]) into prior from public.crew_cash_handover_receivers where outlet_id=p_outlet_id;
  delete from public.crew_cash_handover_receivers where outlet_id=p_outlet_id and not (employee_id=any(next_ids));
  insert into public.crew_cash_handover_receivers(outlet_id,employee_id,configured_by) select p_outlet_id,id,auth.uid() from unnest(next_ids) id on conflict(outlet_id,employee_id) do nothing;
  update public.crew_cash_handover_receiver_configs set version=version+1,updated_by=auth.uid(),updated_at=now() where outlet_id=p_outlet_id returning version into current_version;
  insert into public.crew_cash_handover_receiver_config_audit(outlet_id,version,previous_receiver_ids,receiver_ids,changed_by) values(p_outlet_id,current_version,prior,next_ids,auth.uid());
  return jsonb_build_object('version',current_version,'receiver_ids',next_ids);
end;
$$;
revoke all on function public.crew_cash_save_handover_receivers(uuid,uuid[],integer) from public,anon,authenticated;
grant execute on function public.crew_cash_save_handover_receivers(uuid,uuid[],integer) to authenticated;

-- Keep the established idempotent writer and append-only debit, but narrow internal
-- receiver eligibility to the configured authority and label the evidence as a handover.
create or replace function public.crew_cash_record_collection(p_token text,p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare ctx jsonb; employee uuid; outlet uuid; receiver uuid; amount numeric; request uuid; fingerprint text; row public.crew_cash_collections%rowtype;
begin
 ctx:=public.crew_session_context(p_token); employee:=(ctx->>'employee_id')::uuid; outlet:=(ctx->>'outlet_id')::uuid;
 if not public.crew_cash_employee_has_permission(employee,'crew_cash_deposit.record_collection') then raise exception using errcode='42501',message='You do not have permission to hand over Cash Deposit funds.'; end if;
 receiver:=nullif(p_payload->>'receiver_employee_id','')::uuid; amount:=(p_payload->>'amount')::numeric; request:=nullif(p_payload->>'request_id','')::uuid;
 if request is null then raise exception using errcode='22023',message='request_id is required.'; end if;
 if receiver is null or not public.crew_cash_receiver_is_eligible(outlet,receiver) then raise exception using errcode='42501',message='Receiver is not approved for this outlet.'; end if;
 if amount is null or amount<=0 or amount>public.crew_cash_balance(outlet) then raise exception using errcode='22023',message='Amount must not exceed the Cash Deposit Balance.'; end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('outlet_id',outlet,'receiver_employee_id',receiver,'amount',amount,'purpose',nullif(btrim(p_payload->>'purpose'),''),'note',nullif(btrim(p_payload->>'note'),''))::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtext(outlet::text),hashtext(request::text));
 select * into row from public.crew_cash_collections c where c.outlet_id=outlet and c.request_id=request for update;
 if row.id is not null then if row.request_fingerprint<>fingerprint then raise exception using errcode='22023',message='Idempotency conflict: request_id payload differs.'; end if; return to_jsonb(row); end if;
 insert into public.crew_cash_collections(outlet_id,request_id,request_fingerprint,receiver_type,receiver_employee_id,amount,difference,purpose,note,status,handed_over_by_employee_id)
 values(outlet,request,fingerprint,'internal',receiver,amount,0,nullif(btrim(p_payload->>'purpose'),''),nullif(btrim(p_payload->>'note'),''),'pending_receipt',employee) returning * into row;
 insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,collection_id,activity,receiver_name,occurred_at,recorded_by_employee_id)
 values(outlet,'collection',-row.amount,row.id,'Cash Handover',(select full_name from public.employees where id=receiver),row.submitted_at,employee);
 return to_jsonb(row);
end;
$$;
revoke all on function public.crew_cash_record_collection(text,jsonb) from public,anon,authenticated;
grant execute on function public.crew_cash_record_collection(text,jsonb) to anon,authenticated;

create or replace function public.crew_cash_admin_record_collection(p_outlet_id uuid,p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare receiver uuid; amount numeric; request uuid; fingerprint text; row public.crew_cash_collections%rowtype;
begin
 perform public.crew_cash_assert_admin(p_outlet_id,'crew_cash_deposit.record_collection');
 receiver:=nullif(p_payload->>'receiver_employee_id','')::uuid; amount:=(p_payload->>'amount')::numeric; request:=nullif(p_payload->>'request_id','')::uuid;
 if request is null then raise exception using errcode='22023',message='request_id is required.'; end if;
 if receiver is null or not public.crew_cash_receiver_is_eligible(p_outlet_id,receiver) then raise exception using errcode='42501',message='Receiver is not approved for this outlet.'; end if;
 if amount is null or amount<=0 or amount>public.crew_cash_balance(p_outlet_id) then raise exception using errcode='22023',message='Amount must not exceed the Cash Deposit Balance.'; end if;
 fingerprint:=encode(extensions.digest(jsonb_build_object('outlet_id',p_outlet_id,'receiver_employee_id',receiver,'amount',amount,'purpose',nullif(btrim(p_payload->>'purpose'),''),'note',nullif(btrim(p_payload->>'note'),''))::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtext(p_outlet_id::text),hashtext(request::text));
 select * into row from public.crew_cash_collections c where c.outlet_id=p_outlet_id and c.request_id=request for update;
 if row.id is not null then if row.request_fingerprint<>fingerprint then raise exception using errcode='22023',message='Idempotency conflict: request_id payload differs.'; end if; return to_jsonb(row); end if;
 insert into public.crew_cash_collections(outlet_id,request_id,request_fingerprint,receiver_type,receiver_employee_id,amount,difference,purpose,note,status,handed_over_by_user_id)
 values(p_outlet_id,request,fingerprint,'internal',receiver,amount,0,nullif(btrim(p_payload->>'purpose'),''),nullif(btrim(p_payload->>'note'),''),'pending_receipt',auth.uid()) returning * into row;
 insert into public.crew_cash_ledger_entries(outlet_id,entry_type,signed_amount,collection_id,activity,receiver_name,occurred_at,recorded_by_user_id)
 values(p_outlet_id,'collection',-row.amount,row.id,'Cash Handover',(select full_name from public.employees where id=receiver),row.submitted_at,auth.uid());
 return to_jsonb(row);
end;
$$;
revoke all on function public.crew_cash_admin_record_collection(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crew_cash_admin_record_collection(uuid,jsonb) to authenticated;

alter function public.crew_cash_admin_data(uuid,date,date) rename to crew_cash_admin_data_projection_source;
revoke all on function public.crew_cash_admin_data_projection_source(uuid,date,date) from public,anon,authenticated;
create function public.crew_cash_admin_data(p_outlet_id uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare payload jsonb; receivers jsonb;
begin
  payload:=public.crew_cash_admin_data_projection_source(p_outlet_id,p_from,p_to);
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name),'[]'::jsonb) into receivers
  from public.crew_cash_handover_receivers r join public.employees e on e.id=r.employee_id
  where r.outlet_id=p_outlet_id and public.crew_cash_receiver_is_eligible(p_outlet_id,e.id);
  payload:=jsonb_set(payload,'{eligible_receivers}',receivers,true);
  return jsonb_set(payload,'{receiver_configuration}',coalesce((select jsonb_build_object('version',c.version,'updated_at',c.updated_at) from public.crew_cash_handover_receiver_configs c where c.outlet_id=p_outlet_id),'{}'::jsonb),true);
end;
$$;
revoke all on function public.crew_cash_admin_data(uuid,date,date) from public,anon,authenticated;
grant execute on function public.crew_cash_admin_data(uuid,date,date) to authenticated;

-- Extend the existing compatibility wrapper rather than cloning the audited projection.
create or replace function public.crew_cash_mobile(p_token text,p_business_date date default timezone('Asia/Kuala_Lumpur',now())::date)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare payload jsonb; outlet uuid; employee uuid; receivers jsonb; pending jsonb;
begin
 payload:=public.crew_cash_mobile_projection_source(p_token,p_business_date); outlet:=(payload->'outlet'->>'id')::uuid; employee:=public.crew_session_employee(p_token);
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.full_name,'position',e.position) order by e.full_name),'[]'::jsonb) into receivers
 from public.crew_cash_handover_receivers r join public.employees e on e.id=r.employee_id where r.outlet_id=outlet and public.crew_cash_receiver_is_eligible(outlet,e.id);
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'amount',c.amount,'purpose',c.purpose,'note',c.note,'sender',coalesce(se.full_name,'Admin'),'outlet_name',payload->'outlet'->>'name','submitted_at',c.submitted_at) order by c.submitted_at desc),'[]'::jsonb) into pending
 from public.crew_cash_collections c left join public.employees se on se.id=c.handed_over_by_employee_id where c.receiver_employee_id=employee and c.status='pending_receipt';
 payload:=jsonb_set(payload,'{deposit,available_balance}',to_jsonb(public.crew_cash_balance(outlet)),true);
 payload:=jsonb_set(payload,'{receivers}',receivers,true);
 payload:=jsonb_set(payload,'{pending_receipts}',pending,true);
 return jsonb_set(payload,'{is_cash_handover_receiver}',to_jsonb(public.crew_cash_receiver_is_eligible(outlet,employee) or exists(select 1 from public.crew_cash_collections c where c.outlet_id=outlet and c.receiver_employee_id=employee and c.status='pending_receipt')),true);
end;
$$;
revoke all on function public.crew_cash_mobile(text,date) from public,anon,authenticated;
grant execute on function public.crew_cash_mobile(text,date) to anon,authenticated;
