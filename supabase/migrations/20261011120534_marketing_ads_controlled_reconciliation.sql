-- Read-only reconciliation can inspect accepted receipts without releasing another write.
create function public.marketing_ads_change_reconcile_claim(p_request uuid,p_auth_user uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r marketing_private.ads_changes; actor uuid;
begin
 select id into actor from employees where auth_user_id=p_auth_user;
 select * into r from marketing_private.ads_changes where id=p_request for update;
 if r.id is null or not marketing_private.actor_allowed(actor,r.organization_id,r.brand_id,'marketing_ads.execute') then raise exception using errcode='42501',message='Advertising reconciliation access required';end if;
 if r.state<>'reconciling' then raise exception 'No uncertain receipt to reconcile';end if;
 if not exists(select 1 from marketing_connections c join marketing_private.credentials s on s.connection_id=c.id where c.id=r.connection_id and c.credential_generation=r.generation and c.expires_at>now() and c.status in ('test_authorized','production_authorized')) or (r.operation<>'create' and not exists(select 1 from marketing_private.ads_campaign_brands m where m.organization_id=r.organization_id and m.account_id=r.account_id and m.campaign_id=r.configuration->>'campaign_id' and m.brand_id=r.brand_id and m.revision=r.attribution_revision)) then raise exception 'Account or campaign scope changed';end if;
 update marketing_private.ads_changes set state='executing',executor=actor,lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',provider_state=provider_state||'{"reconcile_only":true}'::jsonb where id=r.id returning * into r;
 insert into marketing_private.ads_change_events(change_id,revision,event,actor) values(r.id,r.revision,'read_only_reconcile',actor);
 return to_jsonb(r);
end;$$;
-- Read-only receipts do not depend on a still-current pre-write snapshot or permission to spend.
create or replace function public.marketing_ads_change_material(p_request uuid,p_lease uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r marketing_private.ads_changes; result jsonb; readonly boolean;
begin
 select * into r from marketing_private.ads_changes where id=p_request and lease=p_lease and lease_until>now() and state='executing';
 readonly:=coalesce((r.provider_state->>'reconcile_only')::boolean,false);
 if r.id is null or not marketing_private.actor_allowed(r.executor,r.organization_id,r.brand_id,'marketing_ads.execute') then raise exception 'Advertising authority changed';end if;
 if not readonly and (not marketing_private.ads_change_current(r) or r.approval_expires_at<=now() or not marketing_private.actor_allowed(r.approved_by,r.organization_id,r.brand_id,'marketing_ads.approve') or not marketing_private.actor_allowed(r.reviewed_by,r.organization_id,r.brand_id,'marketing_ads.review')) then raise exception 'Advertising approval changed';end if;
 if readonly and r.operation<>'create' and not exists(select 1 from marketing_private.ads_campaign_brands m where m.organization_id=r.organization_id and m.account_id=r.account_id and m.campaign_id=r.configuration->>'campaign_id' and m.brand_id=r.brand_id and m.revision=r.attribution_revision) then raise exception 'Campaign attribution changed';end if;
 select jsonb_build_object('change',to_jsonb(r),'connection',to_jsonb(c)||jsonb_build_object('sealed_token',s.sealed_token,'meta_user_id',s.meta_user_id)) into result from marketing_connections c join marketing_private.credentials s on s.connection_id=c.id where c.id=r.connection_id and c.credential_generation=r.generation and c.provider_account_id=r.account_id and c.organization_id=r.organization_id and c.expires_at>now() and c.status in ('test_authorized','production_authorized');
 if result is null then raise exception 'Ad authorization unavailable';end if;
 return result;
end;$$;
revoke all on function public.marketing_ads_change_reconcile_claim(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketing_ads_change_reconcile_claim(uuid,uuid) to service_role;
