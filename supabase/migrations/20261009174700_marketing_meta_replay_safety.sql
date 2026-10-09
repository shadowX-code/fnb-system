-- Signed Meta removal retries must not erase a later consent grant in the same second.
create table marketing_private.removal_requests(request_hash text primary key,processed_at timestamptz not null default now());
alter table marketing_private.removal_requests enable row level security;
revoke all on marketing_private.removal_requests from public,anon,authenticated;
create function public.marketing_meta_removal_once(p_request_hash text,p_user_id text,p_deletion boolean,p_confirmation_hash text,p_issued_at timestamptz) returns void
language plpgsql security definer set search_path=public as $$
begin
 if coalesce(p_request_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid removal request identity.';end if;
 insert into marketing_private.removal_requests(request_hash) values(p_request_hash) on conflict do nothing;
 if found then perform public.marketing_meta_revoke(p_user_id,p_deletion,p_confirmation_hash,p_issued_at);
 elsif p_deletion then
  if coalesce(p_confirmation_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid confirmation identity.';end if;
  insert into marketing_private.meta_deletions values(p_confirmation_hash,now()) on conflict do nothing;
 end if;
end;$$;
revoke all on function public.marketing_meta_removal_once(text,text,boolean,text,timestamptz) from public,anon,authenticated;
grant execute on function public.marketing_meta_removal_once(text,text,boolean,text,timestamptz) to service_role;
-- No failure can turn an uncertain write into an editable/retryable draft.
create or replace function public.marketing_finish_job(p_job uuid,p_lease uuid,p_outcome text,p_provider_post_id text default null,p_error_code text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.marketing_jobs; c public.marketing_content; next_state text;
begin
 -- Lock content before job, matching authoring/cancellation order to avoid deadlocks.
 select c0.* into c from public.marketing_content c0 join public.marketing_jobs j0 on j0.content_id=c0.id where j0.id=p_job for update of c0;
 select * into j from public.marketing_jobs where id=p_job for update;
 if found and j.lease_token=p_lease and j.state='succeeded' and p_outcome='published' and j.provider_post_id=p_provider_post_id then return to_jsonb(j); end if;
 if not found or j.lease_token is distinct from p_lease or p_lease is null or j.state not in ('leased','reconciling') then raise exception 'Publishing lease is unavailable.'; end if;
 if c.revision<>j.revision or c.approved_revision is distinct from j.revision then raise exception 'Approved publishing revision changed.'; end if;
 if p_outcome='published' and (j.provider_state->>'post_id' is distinct from p_provider_post_id or j.connection_id is null) then raise exception 'Checkpointed provider evidence required.';end if;
 if j.provider_state ? 'pending' and p_outcome<>'published' then p_outcome:='uncertain';end if;
 next_state:=case p_outcome when 'published' then 'succeeded' when 'uncertain' then 'reconciling' when 'retryable_failure' then case when j.failures>=4 then 'failed' else 'retry' end when 'permanent_failure' then 'failed' end;
 if next_state is null or (next_state='succeeded' and length(trim(coalesce(p_provider_post_id,'')))=0) then raise exception 'Verified provider receipt or failure outcome is required.'; end if;
 update public.marketing_jobs set state=next_state,failures=failures+case when p_outcome='retryable_failure' then 1 else 0 end,provider_post_id=case when next_state='succeeded' then p_provider_post_id else null end,
 error_code=case when next_state='succeeded' then null else left(coalesce(p_error_code,'provider_failure'),100) end,
 due_at=case when next_state='retry' then now()+make_interval(secs=>least(3600,30*(2^least(j.attempts,7))::integer)) else due_at end,
 lease_expires_at=null,updated_at=now() where id=p_job returning * into j;
 if not exists(select 1 from public.marketing_jobs where content_id=c.id and revision=c.revision and state<>'succeeded') then
   update public.marketing_content set status='published',updated_at=now() where id=c.id;
 elsif exists(select 1 from public.marketing_jobs where content_id=c.id and revision=c.revision and state='failed') then
   update public.marketing_content set status='failed',updated_at=now() where id=c.id;
 end if;
 insert into public.marketing_events(organization_id,brand_id,content_id,action,details) values(j.organization_id,j.brand_id,j.content_id,'publishing_'||next_state,jsonb_build_object('job_id',j.id,'revision',j.revision,'channel',j.channel,'provider_post_id',j.provider_post_id,'error_code',j.error_code));
 return to_jsonb(j);
end; $$;
