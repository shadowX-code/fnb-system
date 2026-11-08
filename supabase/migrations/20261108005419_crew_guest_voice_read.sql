-- The encrypted inbox stays private. Only the Google gateway can read this projection.
create function public.crew_guest_voice_cache(p_token text, p_outlet uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_outlet uuid := public.crew_selected_outlet(p_token,p_outlet);
begin
  return (
    select case
      when c.status = 'expired' then jsonb_build_object('status','expired')
      when c.status is distinct from 'connected' then jsonb_build_object('status','disconnected')
      when m.outlet_id is null then jsonb_build_object('status','unmapped')
      when cache.status is distinct from 'complete' or cache.expires_at <= now()
        or cache.expires_at is null or cache.sealed_reviews is null
        then jsonb_build_object('status','awaiting_sync')
      else jsonb_build_object(
        'status','ready','generation',c.generation,'revision',m.revision,
        'location',m.location_resource_name,'sealed_reviews',cache.sealed_reviews,
        'fetched_at',cache.fetched_at,'expires_at',cache.expires_at)
      end
    from (select v_outlet as outlet_id) scope
    left join google_business_private.connection c on c.id=true
    left join public.crew_google_outlet_locations m on m.outlet_id=scope.outlet_id
    left join google_business_private.inbox_cache cache on cache.location_resource_name=m.location_resource_name
      and cache.generation=c.generation and cache.mapping_revision=m.revision
  );
end;
$$;

revoke all on function public.crew_guest_voice_cache(text,uuid) from public, anon, authenticated;
grant execute on function public.crew_guest_voice_cache(text,uuid) to service_role;
