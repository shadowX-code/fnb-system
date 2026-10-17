-- Retained /me/accounts evidence belongs to one service-owned OAuth epoch.
-- Business ownership visibility is independent of Page task authorization.
create function marketing_private.oauth_accounts_generation_verified(p_connection uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(
  select 1 from public.marketing_connections c
  join marketing_private.credentials s on s.connection_id=c.id
  join marketing_private.meta_subjects m on m.connection_id=c.id
  where c.id=p_connection and c.status in ('test_authorized','production_authorized') and c.expires_at>now()
   and s.sealed_token is not null and m.generation=c.credential_generation
   and m.connected_at=c.connected_at and m.meta_user_id=s.meta_user_id);
$$;
revoke all on function marketing_private.oauth_accounts_generation_verified(uuid) from public,anon,authenticated;
grant execute on function marketing_private.oauth_accounts_generation_verified(uuid) to service_role;

-- Extend existing service projections, retaining their full actor, Brand,
-- send-window, generation and receipt guards.
do $$
declare sig text; definition text; needle text; replacement text;
begin
 foreach sig in array array[
  'public.marketing_meta_diagnostic_material(uuid,uuid)',
  'public.marketing_meta_connection_material(uuid)',
  'public.marketing_inbox_send_material(uuid,uuid)'
 ] loop
  definition:=pg_get_functiondef(sig::regprocedure);
  needle:=case when sig='public.marketing_meta_connection_material(uuid)' then
   '''meta_user_id'',secret.meta_user_id)' else '''meta_user_id'',s.meta_user_id)' end;
  replacement:=replace(needle,')',',''oauth_accounts_generation_verified'',marketing_private.oauth_accounts_generation_verified('||
   case when sig='public.marketing_inbox_send_material(uuid,uuid)' then 'conn.id' else 'c.id' end||'))');
  if position(needle in definition)=0 or position('oauth_accounts_generation_verified' in definition)>0 then
   raise exception 'Unexpected Meta material contract: %',sig;
  end if;
  execute replace(definition,needle,replacement);
 end loop;
end;$$;
