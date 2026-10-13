-- Staging-only claim regression; exact verified Hola grants. No provider calls or persisted approval.
begin;
set local request.jwt.claims='{"role":"service_role"}';
do $$ declare c public.marketing_connections;j uuid;v jsonb;begin
assert marketing_inbox_history_claim() is null,'Empty queue';
for c in select * from public.marketing_connections where brand_id='0aa8ac72-6c63-4eb5-a024-1e942e6dbe4e' and channel in ('facebook','instagram') loop
perform marketing_inbox_history_authorize(c.id,c.credential_generation,repeat('a',64));
insert into marketing_private.inbox_history_jobs(connection_id,generation,approval_id,actor,window_from,window_to,due_at)
select c.id,c.credential_generation,a.approval_id,c.connected_by,now()-interval '1 day',now(),'1900-01-01' from marketing_private.inbox_history_approvals a where a.connection_id=c.id returning id into j;
v:=marketing_inbox_history_claim();
assert (v->>'id')::uuid=j,'Canonical positive claim';
assert marketing_inbox_history_guard(j,(v->>'lease')::uuid),'Current approved lease';
update marketing_private.inbox_history_jobs set state='finished',lease_until=null where id=j;
end loop;end;$$;
rollback;
