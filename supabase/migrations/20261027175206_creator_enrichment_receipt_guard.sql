-- Only exact, current server-issued receipts may pass the existing follower evidence guard.
create function marketing_private.creator_enrichment_followers_receipt(p_old public.marketing_creator_accounts,p_new public.marketing_creator_accounts)
returns boolean language plpgsql security definer set search_path=public as $$
declare r marketing_private.creator_enrichment_requests;
begin
 if p_new.platform<>'instagram' or p_new.id is distinct from p_old.id or p_new.organization_id is distinct from p_old.organization_id
 or (p_new.followers_attempted_at,p_new.followers_lease,p_new.followers_lease_until) is distinct from (p_old.followers_attempted_at,p_old.followers_lease,p_old.followers_lease_until)
 or p_new.followers is null or p_new.followers_source is distinct from 'meta_instagram_business_discovery'
 or p_new.followers_captured_at is null or p_new.followers_captured_at<coalesce(p_old.followers_captured_at,'-infinity'::timestamptz) then return false;end if;
 select * into r from marketing_private.creator_enrichment_requests q where q.organization_id=p_new.organization_id and q.account_id=p_new.id and q.actor=marketing_private.actor()
 and q.state='ready' and q.consumed and not q.worker and q.expires_at>clock_timestamp()
 and q.handle=p_new.handle and (q.observation->>'followers')::bigint=p_new.followers and (q.observation->>'captured_at')::timestamptz=p_new.followers_captured_at
 order by q.created_at desc limit 1;
 if r.id is null then return false;end if;
 perform marketing_private.creator_enrichment_lock(r.organization_id,r.connection_id,r.generation,r.delegation_epoch);
 perform 1 from marketing_private.creator_enrichment_requests where id=r.id and state='ready' and consumed and expires_at>clock_timestamp() for share;
 return found;
end;$$;
revoke all on function marketing_private.creator_enrichment_followers_receipt(public.marketing_creator_accounts,public.marketing_creator_accounts) from public,anon,authenticated;
do $patch$
declare original text;body text;needle text;binding text;
begin
 select pg_get_functiondef('public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure) into original;
 binding:='  update marketing_private.creator_enrichment_requests set account_id=a.id where id=(p_payload->>''profile_enrichment_receipt'')::uuid;';
 needle:='  update public.marketing_creator_accounts ca set';
 if strpos(original,binding)=0 or strpos(original,needle)=0 then raise exception 'Profile receipt follower boundary changed.';end if;
 body:=replace(original,binding,'');body:=replace(body,needle,binding||chr(10)||needle);execute body;
 select pg_get_functiondef('marketing_private.creator_followers_guard()'::regprocedure) into original;
 needle:=$old$  elsif (new.followers,new.followers_captured_at,new.followers_source,new.followers_attempted_at,new.followers_lease,new.followers_lease_until) is distinct from (old.followers,old.followers_captured_at,old.followers_source,old.followers_attempted_at,old.followers_lease,old.followers_lease_until) then
   raise exception using errcode='42501',message='Followers are system-sourced only.';
$old$;
 if strpos(original,needle)=0 then raise exception 'Follower evidence guard changed.';end if;
 body:=replace(original,needle,$new$  elsif (new.followers,new.followers_captured_at,new.followers_source,new.followers_attempted_at,new.followers_lease,new.followers_lease_until) is distinct from (old.followers,old.followers_captured_at,old.followers_source,old.followers_attempted_at,old.followers_lease,old.followers_lease_until) then
   if not marketing_private.creator_enrichment_followers_receipt(old,new) then raise exception using errcode='42501',message='Followers are system-sourced only.';end if;
$new$);execute body;
end;$patch$;
