-- Admin localization editing needs the durable unit id; the Crew-safe read model
-- deliberately remains unchanged and continues to expose only rendered values.
create or replace function public.crew_admin_localized_content(p_domain text,p_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare context jsonb; unit_snapshot jsonb;
begin
  context:=public.crew_localization_assert_admin(p_domain,p_version_id,false);
  unit_snapshot:=public.crew_localization_snapshot(p_domain,p_version_id);
  return jsonb_build_object(
    'domain',p_domain,
    'version_id',p_version_id,
    'outlet_id',context->>'outlet_id',
    'version_status',context->>'status',
    'languages',jsonb_build_array('en','zh-CN','ms'),
    'units',coalesce((
      select jsonb_object_agg(u.unit_key,coalesce(unit_snapshot->u.unit_key,'{}'::jsonb)||jsonb_build_object('id',u.id))
      from public.crew_localized_content_units u
      where u.domain=p_domain and u.version_id=p_version_id
    ),'{}'::jsonb)
  );
end; $$;

revoke all on function public.crew_admin_localized_content(text,uuid) from public,anon,authenticated;
grant execute on function public.crew_admin_localized_content(text,uuid) to authenticated;
