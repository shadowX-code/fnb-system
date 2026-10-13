-- Disambiguate local connection material from SQL connection aliases.
create or replace function public.marketing_inbox_history_claim() returns jsonb language plpgsql security definer set search_path=public as $$
declare j marketing_private.inbox_history_jobs; conn_record public.marketing_connections;begin
 update marketing_private.inbox_history_jobs x set state='cancelled',checkpoint='{}',reason='approval_or_grant_expired',lease_until=null,updated_at=now()
 where state in ('queued','retry','leased') and not exists(select 1 from marketing_private.inbox_history_approvals a join public.marketing_connections c on c.id=a.connection_id and c.credential_generation=a.generation and c.status in ('test_authorized','production_authorized') where a.connection_id=x.connection_id and a.approval_id=x.approval_id and a.generation=x.generation and a.expires_at>now());
 update marketing_private.inbox_history_jobs set state='failed',reason='lease_retry_limit',lease_until=null,updated_at=now() where state='leased' and lease_until<now() and attempts>=5;
 select x.* into j from marketing_private.inbox_history_jobs x join public.marketing_connections c on c.id=x.connection_id and c.credential_generation=x.generation
 where x.state in ('queued','retry','leased') and x.due_at<=now() and (x.lease_until is null or x.lease_until<now()) and x.attempts<5 and x.pages<250
 and c.expires_at>now() and c.status in ('test_authorized','production_authorized') and coalesce((marketing_private.inbox_channel(c.id)->>'configuration_verified')::boolean,false) and coalesce((marketing_private.inbox_channel(c.id)->>'receiving_verified')::boolean,false)
 and marketing_private.actor_allowed(x.actor,c.organization_id,c.brand_id,'marketing_inbox.configure')
 order by x.due_at,x.id for update of x skip locked limit 1;
 if not found then return null;end if;
 update marketing_private.inbox_history_jobs set state='leased',lease=gen_random_uuid(),lease_until=now()+interval '3 minutes',attempts=attempts+1,updated_at=now() where id=j.id returning * into j;
 select * into conn_record from public.marketing_connections where id=j.connection_id;
 return to_jsonb(j)||jsonb_build_object('connection',to_jsonb(conn_record),'page_id',(select page_id from marketing_private.inbox_authority where connection_id=conn_record.id and generation=j.generation));
end;$$;
