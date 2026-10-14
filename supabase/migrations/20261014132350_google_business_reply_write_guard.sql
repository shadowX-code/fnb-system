-- Last authority check before the external PUT; do not reuse an applied migration version.
create function public.crew_google_business_reply_guard(p_user uuid,p_outlet uuid,p_id uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c google_business_private.connection;m public.crew_google_outlet_locations;r google_business_private.reply_requests;
begin
 if not google_business_private.reply_allowed(p_user,p_outlet) then raise exception using errcode='42501',message='Reply permission changed. Reload Review Detail.';end if;
 select * into c from google_business_private.connection where id=true for update;
 select * into m from public.crew_google_outlet_locations where outlet_id=p_outlet;
 select * into r from google_business_private.reply_requests where id=p_id for update;
 if not found or r.outlet_id is distinct from p_outlet or r.lease_actor is distinct from p_user or r.actor is distinct from p_user
  or r.status<>'sending' or r.lease is distinct from p_lease or r.lease_until<=now() or c.status<>'connected'
  or r.generation<>c.generation or r.mapping_revision is distinct from m.revision
  or split_part(r.review_name,'/reviews/',1) is distinct from m.location_resource_name then raise exception 'Reply authority changed. Check status before retrying.';end if;
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.crew_google_business_reply_guard(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.crew_google_business_reply_guard(uuid,uuid,uuid,uuid) to service_role;
