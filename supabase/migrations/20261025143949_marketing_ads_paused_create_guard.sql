-- NULL cannot stand in for an expected generation, and permits require fresh management authority.
do $$declare f text;begin
 select pg_get_functiondef('public.marketing_ads_paused_create_permit(uuid,uuid,text,integer,timestamptz)'::regprocedure) into f;
 if position('r.generation<>p_generation' in f)=0 or position('or r.approval_expires_at<=now()' in f)=0 then raise exception 'Paused creation permit contract changed';end if;
 f:=replace(f,'r.generation<>p_generation','r.generation is distinct from p_generation');
 f:=replace(f,'or r.approval_expires_at<=now()',
  'or r.approval_expires_at is null or not exists(select 1 from marketing_private.ads_accounts h where h.connection_id=r.connection_id and h.generation=r.generation and h.manage_verified and h.account_status=1) or r.approval_expires_at<=now()');
 execute f;
end;$$;
