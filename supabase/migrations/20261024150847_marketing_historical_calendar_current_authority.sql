-- Receipts retain their historical generation; visibility requires NEW current-account proof.
do $$declare body text;begin
 select pg_get_functiondef('marketing_private.publication_availability_projection(uuid,integer,text,text)'::regprocedure) into body;
 if position('with scoped as materialized' in body)=0 or position('connection_generation=p_generation and not(active and recovered)' in body)=0 then raise exception 'Availability projection baseline differs';end if;
 body:=replace(body,'with scoped as materialized','with current_authority as (select credential_generation effective_generation from public.marketing_connections where id=p_connection and p_generation between 1 and credential_generation and (provider_account_id=p_account or p_account is null and p_generation=credential_generation)), scoped as materialized');
 body:=replace(body,'connection_generation=p_generation and not(active and recovered)','connection_generation=(select effective_generation from current_authority) and not(active and recovered)');
 body:=replace(body,'control.connection_generation=p_generation','control.connection_generation=(select effective_generation from current_authority)');
 body:=replace(body,'current_conn.credential_generation=p_generation','current_conn.credential_generation=(select effective_generation from current_authority)');
 execute body;
end;$$;
