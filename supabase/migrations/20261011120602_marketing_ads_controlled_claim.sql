create function public.marketing_ads_change_claim(p_request uuid,p_auth_user uuid,p_fingerprint text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r marketing_private.ads_changes; actor uuid;
begin
 select id into actor from employees where auth_user_id=p_auth_user;
 select * into r from marketing_private.ads_changes where id=p_request for update;
 if r.id is null or not marketing_private.actor_allowed(actor,r.organization_id,r.brand_id,'marketing_ads.execute') then raise exception using errcode='42501',message='Advertising execution access required';end if;
 if r.state in ('executing','reconciling','succeeded') then return null;end if;
 if r.state<>'approved' or r.fingerprint is distinct from p_fingerprint or r.approval_expires_at<=now() or not marketing_private.ads_change_current(r)
 or not marketing_private.actor_allowed(r.approved_by,r.organization_id,r.brand_id,'marketing_ads.approve') or not marketing_private.actor_allowed(r.reviewed_by,r.organization_id,r.brand_id,'marketing_ads.review')
 or not exists(select 1 from marketing_private.ads_accounts a where a.connection_id=r.connection_id and a.generation=r.generation and a.manage_verified and a.account_status=1) then raise exception 'Advertising authorization or approval unavailable';end if;
 -- Prevent competing FeedX changes to the same account/campaign while provider work is pending.
 perform pg_advisory_xact_lock(hashtextextended('ads_execute:'||r.connection_id,0));
 if exists(select 1 from marketing_private.ads_changes x where x.connection_id=r.connection_id and x.state in ('executing','reconciling')) then raise exception 'Reconcile the pending account operation first';end if;
 update marketing_private.ads_changes set state='executing',executor=actor,lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() where id=r.id returning * into r;
 insert into marketing_private.ads_change_events(change_id,revision,event,actor) values(r.id,r.revision,'execute',actor);
 return to_jsonb(r);
end;$$;

revoke all on function public.marketing_ads_change_claim(uuid,uuid,text) from public,anon,authenticated; grant execute on function public.marketing_ads_change_claim(uuid,uuid,text) to service_role;
