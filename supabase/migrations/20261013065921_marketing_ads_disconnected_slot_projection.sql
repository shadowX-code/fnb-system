-- The slot persists after credential removal; clients need it to pin an exact reconnect generation.
do $$ declare original text;patched text;begin
 select pg_get_functiondef('public.marketing_ads_read(uuid,uuid,date,date)'::regprocedure) into original;
 patched:=replace(original,'''account_id'',c.provider_account_id,','''account_id'',c.provider_account_id,''account_slot'',c.account_slot,');
 if patched=original then raise exception 'Ads account projection contract changed';end if;
 execute patched;
end $$;
