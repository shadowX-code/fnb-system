-- Bind the aggregate to its local SRF column, never the outer identity name.
create or replace function public.external_agents_authorize_management(p_identity_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not feedx_integrations.can_manage(p_identity_id) then raise exception using errcode='42501',message='Role Settings edit authority is required.';end if;
 return (select jsonb_build_object('endpoint',a.endpoint,'permission',a.permission_code,
  'tools',coalesce((select jsonb_agg(jsonb_build_object('name',t.value)) from jsonb_array_elements_text(feedx_integrations.discovery(m.id)->'tools') as t(value)),'[]'))
  from feedx_integrations.machine_identities m join feedx_integrations.adapters a on a.key=m.adapter_key where m.id=p_identity_id);
end $$;
revoke all on function public.external_agents_authorize_management(uuid) from public,anon;
grant execute on function public.external_agents_authorize_management(uuid) to authenticated;
