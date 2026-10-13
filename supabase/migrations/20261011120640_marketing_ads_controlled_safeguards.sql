-- Expired in-flight writes are never reclaimed: they could already exist in Meta.
create function public.marketing_ads_change_expire() returns integer language plpgsql security definer set search_path=public as $$
declare n int;
begin
 with changed as (update marketing_private.ads_changes set state='reconciling',error_code='execution_interrupted',lease=null,lease_until=null,updated_at=now() where state='executing' and lease_until<now() returning *)
 insert into marketing_private.ads_change_events(change_id,revision,event,evidence) select id,revision,'reconciling',jsonb_build_object('error','execution_interrupted') from changed;
 get diagnostics n=row_count;return n;
end;$$;
revoke all on function marketing_private.ads_campaign_tree(jsonb,text),marketing_private.ads_change_current(marketing_private.ads_changes) from public,anon,authenticated,service_role;
revoke all on function public.marketing_ads_changes_read(uuid,uuid),public.marketing_ads_change_transition(uuid,text,text) from public,anon;
grant execute on function public.marketing_ads_changes_read(uuid,uuid),public.marketing_ads_change_transition(uuid,text,text) to authenticated;
revoke all on function public.marketing_ads_change_prepare(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,uuid),public.marketing_ads_change_claim(uuid,uuid,text),public.marketing_ads_change_material(uuid,uuid),public.marketing_ads_change_checkpoint(uuid,uuid,jsonb),public.marketing_ads_change_finish(uuid,uuid,text,jsonb,text),public.marketing_ads_change_expire() from public,anon,authenticated;
grant execute on function public.marketing_ads_change_prepare(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,uuid),public.marketing_ads_change_claim(uuid,uuid,text),public.marketing_ads_change_material(uuid,uuid),public.marketing_ads_change_checkpoint(uuid,uuid,jsonb),public.marketing_ads_change_finish(uuid,uuid,text,jsonb,text),public.marketing_ads_change_expire() to service_role;

