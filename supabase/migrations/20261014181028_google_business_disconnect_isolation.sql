-- Coordinate existing connection transitions; ordinary disconnect never revokes the Google project grant.
create function public.crew_google_business_disconnect(p_action text,p_user uuid,p_outlet uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c google_business_private.connection;result jsonb;
begin
 if not google_business_private.allowed(p_user,p_outlet,true) then raise exception using errcode='42501',message='Connection management permission is required.';end if;
 select * into c from google_business_private.connection where id=true for update;
 if p_action in ('local','revoke_begin') then
  if c.generation is distinct from (p_data->>'generation')::integer then raise exception 'Connection changed. Refresh Settings before disconnecting.';end if;
  if p_action='revoke_begin' and (p_data->>'confirmed' is distinct from 'true' or p_data->>'scopeAcknowledged' is distinct from 'google_project') then raise exception 'Confirm Google-wide revocation and its effect on all FeedX environments.';end if;
  result:=public.crew_google_business_server('disconnect_begin',p_user,p_outlet);
  if (result->>'disconnected')::boolean is true then return jsonb_build_object('ok',true,'disconnected',true);end if;
  if p_action='local' then
   perform public.crew_google_business_server('disconnect_finish',p_user,p_outlet,jsonb_build_object('generation',result->'generation'));
   insert into google_business_private.events(action,actor,outlet_id,details) values('disconnect_local',p_user,p_outlet,jsonb_build_object('generation',result->'generation','google_revoked',false));
   return jsonb_build_object('ok',true);
  end if;
  insert into google_business_private.events(action,actor,outlet_id,details) values('google_revoke_requested',p_user,p_outlet,jsonb_build_object('generation',result->'generation','scope','google_project'));
  return result;
 elsif p_action='revoke_finish' then
  perform public.crew_google_business_server('disconnect_finish',p_user,p_outlet,p_data);
  insert into google_business_private.events(action,actor,outlet_id,details) values('google_revoke_confirmed',p_user,p_outlet,jsonb_build_object('generation',p_data->'generation','scope','google_project'));
  return jsonb_build_object('ok',true);
 end if;
 raise exception 'Connection action unavailable.';
end;$$;
revoke all on function public.crew_google_business_disconnect(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crew_google_business_disconnect(text,uuid,uuid,jsonb) to service_role;
