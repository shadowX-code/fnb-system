-- Staging only. Transaction-scoped fixtures; no Meta requests or persisted business changes.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true);
do $$
declare req uuid:=gen_random_uuid(); org uuid:='ec42a08a-0f59-4b7b-a48e-b2faacf9eaf1'; brand uuid:='0aa8ac72-6c63-4eb5-a024-1e942e6dbe4e'; conn uuid:='050dc072-ddda-4e88-8270-8cce47fa7dfa'; r jsonb; lease uuid; campaign text:='120211987048750774'; denied boolean:=false;
begin
 if has_function_privilege('anon','public.marketing_ads_ai_prepare(uuid,uuid,uuid,uuid,date,date)','EXECUTE') or has_function_privilege('authenticated','public.marketing_ads_ai_claim(uuid,uuid)','EXECUTE') or has_table_privilege('authenticated','marketing_private.ads_ai_runs','SELECT') then raise exception 'Private AI grants leaked';end if;
 -- Supply disposable campaign performance only inside this rollback transaction.
 update marketing_private.ads_snapshots set payload=jsonb_set(payload,'{insights,campaign}',jsonb_build_array(jsonb_build_object('campaign_id',campaign,'currency','MYR','date_start','2026-09-12','date_stop','2026-10-11','metrics',jsonb_build_object('spend',jsonb_build_object('value',10,'state','reported')),'actions','[]'::jsonb))) where connection_id=conn and date_from='2026-09-12' and date_to='2026-10-11';
 r:=public.marketing_ads_ai_prepare(req,org,brand,conn,'2026-09-12','2026-10-11');
 if r->>'state'<>'prepared' then raise exception 'Preparation failed';end if;
 r:=public.marketing_ads_ai_prepare(req,org,brand,conn,'2026-09-12','2026-10-11');
 if (select count(*) from marketing_private.ads_ai_runs where id=req)<>1 then raise exception 'Duplicate request';end if;
 begin perform public.marketing_ads_ai_prepare(req,org,'88a73473-5dc7-471c-b484-fe247cf0f660',conn,'2026-09-12','2026-10-11'); exception when others then denied:=true;end;
 if not denied then raise exception 'Changed intent accepted';end if;
 r:=public.marketing_ads_ai_claim(req,'b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd');lease:=(r->>'lease')::uuid;
 if lease is null or public.marketing_ads_ai_claim(req,'b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd') is not null then raise exception 'Duplicate claim';end if;
 perform public.marketing_ads_ai_finish(req,lease,'{"summary":"Disposable test","recommendations":[]}', 'test-provider',1,2,0.000001,'test only',false);
 if jsonb_array_length(public.marketing_ads_ai_read(org,'88a73473-5dc7-471c-b484-fe247cf0f660'))<>0 then raise exception 'Cross-brand AI leaked';end if;
 update marketing_private.ads_campaign_brands set revision=revision+1 where organization_id=org and campaign_id=campaign;
 r:=public.marketing_ads_ai_prepare(req,org,brand,conn,'2026-09-12','2026-10-11');
 if r->>'state'<>'stale' or r->'proposal'<>'null'::jsonb then raise exception 'Stale retry exposed proposal';end if;
 delete from marketing_private.ads_snapshots where connection_id=conn and date_from='2026-09-12' and date_to='2026-10-11';
 if exists(select 1 from marketing_private.ads_ai_runs where id=req) then raise exception 'Derived erasure cascade failed';end if;
 raise notice 'PASS: grants, generic preparation, exact retry, claim deduplication, cross-brand isolation, stale attribution and derived erasure';
end $$;
rollback;
