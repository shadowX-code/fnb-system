-- Focused L3 authority verification; transaction fixtures only, zero Meta requests.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$
declare org uuid:='ec42a08a-0f59-4b7b-a48e-b2faacf9eaf1'; brand uuid:='88718f61-2915-42ef-b62f-5e6e2fe5b3eb'; hola uuid:='0aa8ac72-6c63-4eb5-a024-1e942e6dbe4e'; conn uuid:='050dc072-ddda-4e88-8270-8cce47fa7dfa'; auth_user uuid:='b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd'; request uuid:=gen_random_uuid(); request2 uuid:=gen_random_uuid(); config jsonb; r jsonb;r2 jsonb;lease uuid;denied boolean; campaign text:='120211987048750774';unassigned text;
begin
 if has_function_privilege('anon','public.marketing_ads_changes_read(uuid,uuid)','EXECUTE') or has_function_privilege('authenticated','public.marketing_ads_change_prepare(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,uuid)','EXECUTE') or has_function_privilege('authenticated','public.marketing_ads_change_claim(uuid,uuid,text)','EXECUTE') or has_table_privilege('authenticated','marketing_private.ads_changes','SELECT') then raise exception 'Advertising grants leaked';end if;
 config:=jsonb_build_object('name','Disposable authority fixture','objective','OUTCOME_TRAFFIC','maximum_budget',50000,'start_time',now()+interval '2 days','end_time',now()+interval '3 days','age_min',18,'age_max',65,'placements','facebook_feed','asset_id','962e4ae2-292e-484a-8d23-9cfdb8d43479','page_id','622626120924115','caption','Disposable local approval fixture; never sent','headline','Test','url','https://feedx.my/privacy');
 r:=public.marketing_ads_change_prepare(request,auth_user,org,brand,conn,'create',config,repeat('a',64));
 if r->>'state'<>'draft' or (r->>'maximum_budget')::bigint<>50000 then raise exception 'Draft failed';end if;
 r2:=public.marketing_ads_change_prepare(request,auth_user,org,brand,conn,'create',config,repeat('a',64));
 if r2->>'fingerprint'<>r->>'fingerprint' or (select count(*) from marketing_private.ads_changes where id=request)<>1 then raise exception 'Idempotency failed';end if;
 denied:=false;begin perform public.marketing_ads_change_prepare(request,auth_user,org,brand,conn,'create',config||'{"maximum_budget":60000}',repeat('a',64));exception when others then denied:=true;end;if not denied then raise exception 'Changed request reused';end if;
 r:=public.marketing_ads_change_transition(request,r->>'fingerprint','submit');
 denied:=false;begin perform public.marketing_ads_change_transition(request,r->>'fingerprint','approve');exception when others then denied:=true;end;if not denied then raise exception 'Review bypass';end if;
 r:=public.marketing_ads_change_transition(request,r->>'fingerprint','review');r:=public.marketing_ads_change_transition(request,r->>'fingerprint','approve');
 denied:=false;begin perform public.marketing_ads_change_claim(request,auth_user,r->>'fingerprint');exception when others then denied:=true;end;if not denied then raise exception 'Missing ads_management accepted';end if;
 r2:=public.marketing_ads_change_prepare(request2,auth_user,org,brand,conn,'create',config||'{"maximum_budget":60000}',repeat('a',64),request);
 if r2->>'state'<>'draft' or (r2->>'revision')::int<>2 or r2->>'approved_by' is not null or r2->>'fingerprint'=r->>'fingerprint' or (select state from marketing_private.ads_changes where id=request)<>'superseded' then raise exception 'Budget increase reused approval';end if;
 r2:=public.marketing_ads_change_transition(request2,r2->>'fingerprint','submit');r2:=public.marketing_ads_change_transition(request2,r2->>'fingerprint','review');r2:=public.marketing_ads_change_transition(request2,r2->>'fingerprint','approve');
 -- Disposable verified-management fixture allows only DB contract verification. No provider call.
 update marketing_private.ads_accounts set manage_verified=true where connection_id=conn;
 r2:=public.marketing_ads_change_claim(request2,auth_user,r2->>'fingerprint');lease:=(r2->>'lease')::uuid;
 if lease is null or public.marketing_ads_change_claim(request2,auth_user,r2->>'fingerprint') is not null then raise exception 'Duplicate execution claim';end if;
 perform public.marketing_ads_change_checkpoint(request2,lease,'{"pending":"campaign","image_hash":"disposable"}');
 update marketing_private.ads_changes set lease_until=now()-interval '1 second' where id=request2;
 perform public.marketing_ads_change_expire();
 if (select state from marketing_private.ads_changes where id=request2)<>'reconciling' then raise exception 'Interrupted write reclaimed';end if;
 r2:=public.marketing_ads_change_reconcile_claim(request2,auth_user);
 if r2#>>'{provider_state,reconcile_only}'<>'true' then raise exception 'Read-only reconciliation claim missing';end if;
 perform public.marketing_ads_change_finish(request2,(r2->>'lease')::uuid,'reconciling',null,'manual_reconciliation_required');
 -- Attribution and external state protect existing campaigns; unrelated/unassigned brands cannot enter.
 r:=public.marketing_ads_change_prepare(gen_random_uuid(),auth_user,org,hola,conn,'pause',jsonb_build_object('campaign_id',campaign));
 denied:=false;begin perform public.marketing_ads_change_prepare(gen_random_uuid(),auth_user,org,brand,conn,'pause',jsonb_build_object('campaign_id',campaign));exception when sqlstate '42501' then denied:=true;end;if not denied then raise exception 'Other-brand campaign accepted';end if;
 select a->>'id' into unassigned from marketing_private.ads_snapshots s cross join lateral jsonb_array_elements(s.payload#>'{configs,campaigns}') a where s.connection_id=conn and not exists(select 1 from marketing_private.ads_campaign_brands m where m.account_id='1547787575646373' and m.campaign_id=a->>'id' and m.brand_id is not null) limit 1;
 denied:=false;begin perform public.marketing_ads_change_prepare(gen_random_uuid(),auth_user,org,hola,conn,'pause',jsonb_build_object('campaign_id',unassigned));exception when sqlstate '42501' then denied:=true;end;if not denied then raise exception 'Unassigned campaign accepted';end if;
 update marketing_private.ads_campaign_brands set revision=revision+1 where campaign_id=campaign and organization_id=org;
 denied:=false;begin perform public.marketing_ads_change_transition((r->>'id')::uuid,r->>'fingerprint','submit');exception when others then denied:=true;end;if not denied then raise exception 'Changed attribution accepted';end if;
 update marketing_private.ads_campaign_brands set revision=revision-1 where campaign_id=campaign and organization_id=org;
 update marketing_connections set credential_generation=credential_generation+1 where id=conn;
 if (select marketing_private.ads_change_current(x) from marketing_private.ads_changes x where id=(r->>'id')::uuid) then raise exception 'Credential generation stale not detected';end if;
 update marketing_connections set credential_generation=credential_generation-1 where id=conn;
 denied:=false;begin perform public.marketing_ads_change_prepare(gen_random_uuid(),'47415440-c169-4176-a0b3-7583b5c86b66',org,brand,conn,'create',config,repeat('a',64));exception when sqlstate '42501' then denied:=true;end;if not denied then raise exception 'Outside-org access accepted';end if;
 delete from marketing_private.credentials where connection_id=conn;
 if exists(select 1 from marketing_private.ads_changes where connection_id=conn) then raise exception 'Credential erasure cascade failed';end if;
end;$$;
rollback;
