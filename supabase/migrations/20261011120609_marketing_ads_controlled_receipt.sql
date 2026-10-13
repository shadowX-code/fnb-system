create function public.marketing_ads_change_finish(p_request uuid,p_lease uuid,p_outcome text,p_receipt jsonb default null,p_error text default null) returns void language plpgsql security definer set search_path=public as $$
declare r marketing_private.ads_changes; campaign text; req uuid:=gen_random_uuid();
begin
 select * into r from marketing_private.ads_changes where id=p_request and lease=p_lease and state='executing' for update;
 if r.id is null then raise exception 'Execution lease changed';end if;
 if p_outcome not in ('succeeded','failed','reconciling','stale') or (p_receipt is not null and length(p_receipt::text)>30000) then raise exception 'Invalid execution outcome';end if;
 if p_outcome='succeeded' then
 perform public.marketing_ads_change_material(p_request,p_lease);
 if p_receipt is null or p_receipt->>'account_id' is distinct from r.account_id or p_receipt->>'fingerprint' is distinct from r.fingerprint or p_receipt->>'reconciled' is distinct from 'true' then raise exception 'Exact reconciled receipt required';end if;
 if r.operation='create' then
 campaign:=p_receipt->>'campaign_id';
 if coalesce(campaign,'') !~ '^[0-9]{1,30}$' or r.provider_state->>'campaign_id' is distinct from campaign then raise exception 'Campaign receipt unavailable';end if;
 if exists(select 1 from marketing_private.ads_campaign_brands where organization_id=r.organization_id and account_id=r.account_id and campaign_id=campaign) then raise exception 'Campaign already attributed';end if;
 insert into marketing_private.ads_campaign_brands values(r.organization_id,r.account_id,campaign,r.brand_id,1,r.executor,now());
 insert into marketing_private.ads_attribution_events values(req,r.organization_id,r.account_id,campaign,null,r.brand_id,1,r.executor,now());
 end if;
 -- Reconciliation is distinct from reporting: queue the existing durable read authority.
 insert into marketing_private.ads_sync_jobs(connection_id,generation,actor_employee_id,date_from,date_to) values(r.connection_id,r.generation,r.executor,current_date-29,current_date) on conflict do nothing;
 end if;
 update marketing_private.ads_changes set state=p_outcome,receipt=p_receipt,error_code=left(p_error,100),lease=null,lease_until=null,updated_at=now() where id=r.id;
 insert into marketing_private.ads_change_events(change_id,revision,event,evidence) values(r.id,r.revision,p_outcome,jsonb_build_object('receipt',p_receipt,'error',left(p_error,100)));
end;$$;

revoke all on function public.marketing_ads_change_finish(uuid,uuid,text,jsonb,text) from public,anon,authenticated; grant execute on function public.marketing_ads_change_finish(uuid,uuid,text,jsonb,text) to service_role;
