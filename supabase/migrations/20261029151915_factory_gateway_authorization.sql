-- Resource-only connection authority, with the existing credential/role prerequisite.
create function public.factory_agent_authorize(p_token text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare identity_id uuid;
begin
 identity_id:=feedx_integrations.authorize(p_token,'factory_mesti_inspection.view');
 if not exists(select 1 from feedx_integrations.machine_identities where id=identity_id and adapter_key='factory_mesti') then raise exception using errcode='42501',message='Adapter access denied.';end if;
 return feedx_integrations.discovery(identity_id);
end $$;
revoke all on function public.factory_agent_authorize(text) from public,anon,authenticated;
grant execute on function public.factory_agent_authorize(text) to anon;
