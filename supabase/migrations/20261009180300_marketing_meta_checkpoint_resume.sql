-- A lost write response remains uncertain. A completed checkpoint can safely
-- resume known uploads/container IDs without repeating a completed operation.
create or replace function public.marketing_claim_job() returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.marketing_jobs;
begin
 update public.marketing_jobs set state=case when provider_state ? 'pending' then 'reconciling' else 'retry' end,error_code=case when provider_state ? 'pending' then 'lease_expired_uncertain' else 'checkpoint_resuming' end,updated_at=now() where state='leased' and lease_expires_at<now();
 select x.* into j from public.marketing_jobs x join public.marketing_content c on c.id=x.content_id
 join public.marketing_connections conn on conn.id=x.connection_id and conn.credential_generation=x.connection_generation
 where x.state in ('queued','retry') and x.due_at<=now() and x.failures<5
 and c.status='scheduled' and c.revision=x.revision and c.approved_revision=x.revision
 and conn.status in ('test_authorized','production_authorized') and conn.expires_at>now()
 and conn.capabilities->>'publishing'='true' and conn.capabilities->>'execution_enabled'='true'
 and exists(select 1 from marketing_private.credentials where connection_id=conn.id)
 and marketing_private.job_authorized(x) order by x.due_at,x.id for update of c skip locked limit 1;
 if not found then return null;end if;
 select * into j from public.marketing_jobs where id=j.id for update;
 update public.marketing_jobs set state='leased',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '3 minutes',error_code=null,updated_at=now() where id=j.id returning * into j;
 return to_jsonb(j)||jsonb_build_object('payload',(select payload from public.marketing_content_revisions where content_id=j.content_id and revision=j.revision));
end;$$;
