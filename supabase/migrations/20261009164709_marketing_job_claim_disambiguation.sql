-- Remove an unused row variable that collided with the connection table alias.
create or replace function public.marketing_claim_job() returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.marketing_jobs;
begin
 -- An expired external request is uncertain. Reconciliation must precede any resend.
 update public.marketing_jobs set state='reconciling',error_code='lease_expired',updated_at=now() where state='leased' and lease_expires_at<now();
 select x.* into j from public.marketing_jobs x join public.marketing_content c on c.id=x.content_id
 join public.marketing_connections connection on connection.brand_id=x.brand_id and connection.channel=x.channel
 where x.state in ('queued','retry','blocked') and x.due_at<=now() and x.attempts<5
 and c.status='scheduled' and c.revision=x.revision and c.approved_revision=x.revision
 and connection.status='production_authorized' and connection.expires_at>now() and connection.capabilities->>'publishing'='true'
 and exists(select 1 from marketing_private.credentials where connection_id=connection.id)
 and marketing_private.job_authorized(x) order by x.due_at,x.id for update of c skip locked limit 1;
 if not found then return null; end if;
 select * into j from public.marketing_jobs where id=j.id for update;
 update public.marketing_jobs set state='leased',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes',error_code=null,updated_at=now() where id=j.id returning * into j;
 return to_jsonb(j)||jsonb_build_object('payload',(select payload from public.marketing_content_revisions where content_id=j.content_id and revision=j.revision));
end; $$;
