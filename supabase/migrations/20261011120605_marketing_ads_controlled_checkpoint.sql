create function public.marketing_ads_change_material(p_request uuid,p_lease uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare r marketing_private.ads_changes; result jsonb;
begin
 select * into r from marketing_private.ads_changes where id=p_request and lease=p_lease and lease_until>now() and state='executing';
 if r.id is null or not marketing_private.ads_change_current(r) or r.approval_expires_at<=now() or not marketing_private.actor_allowed(r.executor,r.organization_id,r.brand_id,'marketing_ads.execute') or not marketing_private.actor_allowed(r.approved_by,r.organization_id,r.brand_id,'marketing_ads.approve') or not marketing_private.actor_allowed(r.reviewed_by,r.organization_id,r.brand_id,'marketing_ads.review') then raise exception 'Advertising authority changed';end if;
 select jsonb_build_object('change',to_jsonb(r),'connection',to_jsonb(c)||jsonb_build_object('sealed_token',s.sealed_token,'meta_user_id',s.meta_user_id)) into result from marketing_connections c join marketing_private.credentials s on s.connection_id=c.id where c.id=r.connection_id;
 return result;
end;$$;
create function public.marketing_ads_change_checkpoint(p_request uuid,p_lease uuid,p_state jsonb) returns void language plpgsql security definer set search_path=public as $$
declare r marketing_private.ads_changes;
begin
 perform public.marketing_ads_change_material(p_request,p_lease);
 if p_state is null or length(p_state::text)>10000 then raise exception 'Invalid checkpoint';end if;
 update marketing_private.ads_changes set provider_state=p_state,updated_at=now() where id=p_request returning * into r;
 insert into marketing_private.ads_change_events(change_id,revision,event,evidence) values(r.id,r.revision,'checkpoint',p_state);
end;$$;

revoke all on function public.marketing_ads_change_material(uuid,uuid),public.marketing_ads_change_checkpoint(uuid,uuid,jsonb) from public,anon,authenticated; grant execute on function public.marketing_ads_change_material(uuid,uuid),public.marketing_ads_change_checkpoint(uuid,uuid,jsonb) to service_role;
