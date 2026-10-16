-- Staging-only transaction fixture using the existing authorized Supreme connection. No provider requests.
begin;

do $$declare c public.marketing_connections; job uuid; lease_id uuid:=gen_random_uuid(); r jsonb; denied boolean; begin
 select * into c from public.marketing_connections where provider_account_id='1547787575646373' and channel='ad_account';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select auth_user_id from public.employees where id=c.connected_by),'role','authenticated')::text,true);
 job:=public.marketing_ads_request_sync(c.id,current_date-364,current_date);
 assert job=public.marketing_ads_request_sync(c.id,current_date-364,current_date),'Duplicate historical request';
 assert (select count(*) from marketing_private.ads_sync_jobs where id=job)=1,'Duplicate job created';
 denied:=false;begin perform public.marketing_ads_request_sync(c.id,current_date-1500,current_date);exception when others then denied:=true;end;
 assert denied,'Unbounded history accepted';
 update marketing_private.ads_sync_jobs set state='leased',lease=lease_id,lease_until=now()+interval '5 minutes',attempts=1 where id=job;
 perform public.marketing_ads_checkpoint(job,lease_id,'{"step":3,"requests":3,"report":{"configs":{"campaigns":[{"id":"PRIVATE_PARTIAL_SENTINEL"}]}}}');
 assert (select state='queued' and attempts=0 and progress->>'requests'='3' from marketing_private.ads_sync_jobs where id=job),'Checkpoint not resumable';
 r:=public.marketing_ads_read(c.organization_id,null,current_date-364,current_date);
 assert position('PRIVATE_PARTIAL_SENTINEL' in r::text)=0,'Partial job leaked into read model';
 assert jsonb_array_length(r->'catalogs')>0,'Configuration catalog missing for unsynced range';
 assert jsonb_array_length(r->'reports')=0,'Unsynced range fabricated report';
 assert jsonb_array_length(r->'coverage')>0,'Coverage absent';
 assert not has_function_privilege('authenticated','public.marketing_ads_checkpoint(uuid,uuid,jsonb)','EXECUTE'),'Client checkpoint exposed';
 assert not has_function_privilege('anon','public.marketing_ads_read(uuid,uuid,date,date)','EXECUTE'),'Anonymous Ads exposed';
 denied:=false;begin perform public.marketing_ads_checkpoint(job,lease_id,'{"step":3,"requests":4}');exception when others then denied:=true;end;
 assert denied,'Stale checkpoint lease accepted';
 update marketing_private.ads_sync_jobs set state='cancelled' where id=job;
 assert (select progress='{}'::jsonb from marketing_private.ads_sync_jobs where id=job),'Cancelled partial evidence retained';
end;$$;

rollback;