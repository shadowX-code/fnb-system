-- Staging only: read existing Supreme observations through the canonical Owner scope.
-- No attribution, queue or provider writes. Transaction-local claims roll back.
begin;
select set_config('request.jwt.claims',(select jsonb_build_object('sub',e.auth_user_id,'role','authenticated')::text from marketing_connections c join employees e on e.id=c.connected_by where c.channel='ad_account' and c.provider_account_id='1547787575646373'),true);
do $$declare c marketing_connections;s marketing_private.ads_snapshots;r jsonb;expected jsonb;b uuid;f date;t date;begin
 select * into c from marketing_connections where channel='ad_account' and provider_account_id='1547787575646373';
 assert c.id is not null,'Staging fixture account unavailable';
 select * into s from marketing_private.ads_snapshots where connection_id=c.id and generation=c.credential_generation order by observed_at desc limit 1;
 for b in select null::uuid union all select brand_id from marketing_connections where organization_id=c.organization_id and channel='facebook' and brand_id is not null limit 2 loop
  for f,t in select s.date_from,s.date_to union all select current_date-364,current_date loop
   r:=public.marketing_ads_read(c.organization_id,b,f,t);
   expected:=marketing_private.ads_project(c.organization_id,c.provider_account_id,s.payload,b,true);
   assert (select a#>'{payload,configs}' from jsonb_array_elements(r->'catalogs')a where a->>'connection_id'=c.id::text)=expected->'configs','Catalog scope changed';
   assert (select a#>'{payload,account}' from jsonb_array_elements(r->'catalogs')a where a->>'connection_id'=c.id::text)=expected->'account','Catalog account changed';
   assert (select a#>'{payload,insights}' from jsonb_array_elements(r->'catalogs')a where a->>'connection_id'=c.id::text)='{}'::jsonb,'Catalog invented metric evidence';
   assert r->>'external_execution_enabled'='false','Execution changed';
   if b is null and f=s.date_from and t=s.date_to then
    assert r#>'{reports,0,payload,insights,account}'=s.payload#>'{insights,account}','Original account observations changed';
   end if;
  end loop;
 end loop;
 assert not has_function_privilege('anon','public.marketing_ads_read(uuid,uuid,date,date)','execute'),'Anonymous read exposed';
end;$$;
rollback;
