-- Recent accepted replies are read evidence, scoped to the current OAuth/mapping basis.
create function public.crew_google_business_reply_projection(p_user uuid,p_outlet uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c google_business_private.connection;m public.crew_google_outlet_locations;rows jsonb;
begin
 if not google_business_private.allowed(p_user,p_outlet) then raise exception using errcode='42501',message='Google Reviews is unavailable for this outlet.';end if;
 select * into c from google_business_private.connection where id=true;
 select * into m from public.crew_google_outlet_locations where outlet_id=p_outlet;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into rows from (
  select distinct on (review_name) id,review_name,sealed_remote,remote_time,content_expires_at
  from google_business_private.reply_requests
  where outlet_id=p_outlet and status='confirmed' and sealed_remote is not null and content_expires_at>now()
   and c.status='connected' and generation=c.generation and mapping_revision=m.revision
   and split_part(review_name,'/reviews/',1)=m.location_resource_name
  order by review_name,remote_time desc,updated_at desc
 ) x;
 return rows;
end;$$;
revoke all on function public.crew_google_business_reply_projection(uuid,uuid) from public,anon,authenticated;
grant execute on function public.crew_google_business_reply_projection(uuid,uuid) to service_role;
