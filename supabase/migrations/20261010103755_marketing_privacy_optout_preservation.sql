-- Minimal protected suppression proof survives erasure; message text does not.
alter table marketing_private.inbox_erased_peers add column opted_out boolean not null default false;
create function marketing_private.inbox_preserve_erased_optout() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.channel<>'internal' then
  insert into marketing_private.inbox_erased_peers(connection_id,generation,peer_hash,erased_at,opted_out)
  values(old.connection_id,old.connection_generation,encode(extensions.digest(old.participant_key,'sha256'),'hex'),now(),old.opted_out)
  on conflict(connection_id,generation,peer_hash) do update set opted_out=inbox_erased_peers.opted_out or excluded.opted_out;
 end if;
 return old;
end;$$;
create trigger inbox_preserve_erased_optout before delete on public.marketing_conversations for each row execute function marketing_private.inbox_preserve_erased_optout();
create function marketing_private.inbox_restore_erased_optout() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.channel<>'internal' and exists(select 1 from marketing_private.inbox_erased_peers t where t.connection_id=new.connection_id and t.generation=new.connection_generation
 and t.peer_hash=encode(extensions.digest(new.participant_key,'sha256'),'hex') and t.opted_out) then
  new.opted_out:=true;new.takeover:=true;
 end if;
 return new;
end;$$;
-- Runs after inbox_generation_guard, so consent is scoped to the verified grant lineage.
create trigger inbox_restore_erased_optout before insert on public.marketing_conversations for each row execute function marketing_private.inbox_restore_erased_optout();
revoke all on function marketing_private.inbox_preserve_erased_optout(),marketing_private.inbox_restore_erased_optout() from public,anon,authenticated,service_role;
