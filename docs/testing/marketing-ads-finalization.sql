-- Staging-only, synthetic evidence; all writes and claims roll back. No Meta calls.
begin;
set local statement_timeout='8s';
select set_config('request.jwt.claims',(select jsonb_build_object('sub',e.auth_user_id,'role','authenticated')::text from marketing_connections c join employees e on e.id=c.connected_by where c.channel='ad_account' and c.provider_account_id='1547787575646373'),true);
create temporary table finalization_qa_result(result jsonb) on commit drop;
do $$
declare c marketing_connections;j uuid:=gen_random_uuid();l uuid:=gen_random_uuid();r jsonb;packed jsonb;projected jsonb;v_progress jsonb;dayrows jsonb;campaignrows jsonb;configs jsonb;common text:='Meta ad-set attribution settings; conversion-time reporting. Modeled/estimated conversions may be included; not verified FeedX sales.';
 base jsonb;f date:='2023-09-16';t date:='2026-10-16';total numeric;pad integer;observed timestamptz;digest text;old_count integer;new_count integer;existing_snapshot boolean;resumed uuid;b uuid;bad jsonb;
begin
 select * into c from marketing_connections where channel='ad_account' and provider_account_id='1547787575646373';
 assert c.id is not null,'Staging fixture unavailable';
 select exists(select 1 from marketing_private.ads_snapshots where connection_id=c.id and generation=c.credential_generation and date_from=f and date_to=t) into existing_snapshot;
 select count(*) into old_count from marketing_private.ads_snapshots where connection_id=c.id;
 base:=jsonb_build_object('account_id',c.provider_account_id,'currency','MYR','metrics',jsonb_build_object('spend',jsonb_build_object('value',1.23,'state','reported'),'reach',jsonb_build_object('value',null,'state','unavailable'),'clicks',jsonb_build_object('value',0,'state','reported'),'impressions',jsonb_build_object('value',42,'state','reported'),'ctr',jsonb_build_object('value',0,'state','reported'),'cpc',jsonb_build_object('value',null,'state','unavailable'),'cpm',jsonb_build_object('value',29.285714,'state','reported')),'attribution',common,'action_values',null,
 'actions',(select jsonb_agg(jsonb_build_object('type','onsite_conversion.messaging_conversation_started_'||n,'value',n)) from generate_series(1,8)n),
 'cost_per_action_type',(select jsonb_agg(jsonb_build_object('type','onsite_conversion.messaging_conversation_started_'||n,'value',1.23/n)) from generate_series(1,8)n));
 select jsonb_agg(jsonb_set(base||jsonb_build_object('date_start',(f+n)::text,'date_stop',(f+n)::text),'{metrics,spend,value}',to_jsonb(case when n%13=0 then 0 else 1.23 end)) order by n),sum(case when n%13=0 then 0 else 1.23 end) into dayrows,total from generate_series(0,1069)n;
 select jsonb_agg(jsonb_set(base||jsonb_build_object('campaign_id','qa-'||n,'date_start',f::text,'date_stop',t::text),'{metrics,spend,value}',to_jsonb(case when n=36 then total-35*1.23 else 1.23 end)) order by n) into campaignrows from generate_series(1,36)n;
 select jsonb_build_object('campaigns',jsonb_agg(jsonb_build_object('id','qa-'||n,'name','Synthetic campaign '||n)),'adsets','[]'::jsonb,'ads','[]'::jsonb) into configs from generate_series(1,36)n;
 r:=jsonb_build_object('account',jsonb_build_object('id',c.provider_account_id,'currency','MYR','timezone','Asia/Singapore','account_status',9,'tasks','[]'::jsonb,'granted_scopes',jsonb_build_array('ads_read')),'date_from',f::text,'date_to',t::text,'source','Meta Marketing API','history',jsonb_build_object('method','exact_period_aggregates','completed_at',now()),'configs',configs,'insights',jsonb_build_object('daily',dayrows,'campaign',campaignrows,'account',jsonb_build_array(jsonb_set(base||jsonb_build_object('date_start',f::text,'date_stop',t::text),'{metrics,spend,value}',to_jsonb(total)))),'warnings','{}'::jsonb);
 -- Add realistic creative text spread over the existing 500-row configuration cap,
 -- so the expanded envelope exceeds 3 MB while the losslessly packed report fits.
 pad:=greatest(0,(3075000-octet_length(r::text))/500-110);
 r:=jsonb_set(r,'{configs,ads}',(select jsonb_agg(jsonb_build_object('id','qa-ad-'||n,'campaign_id','qa-1','creative',jsonb_build_object('object_story_spec',jsonb_build_object('message',repeat('x',pad))))) from generate_series(1,500)n));
 packed:=marketing_private.ads_pack_report(r);
 assert octet_length(r::text)>3000000,'Fixture must reproduce the old rejection';
 assert octet_length(packed::text)<3000000,'Packed fixture exceeds retained storage guard';
 assert marketing_private.ads_unpack_report(packed)=r,'Lossy provenance or metric compaction';
 assert marketing_private.ads_pack_report(packed)=packed,'Packing is not idempotent';
 bad:=jsonb_set(packed,'{insights,daily,0,attribution}','"Explicit provider provenance override"');
 assert marketing_private.ads_pack_report(bad)=bad,'Packed fast path changed an explicit provenance override';
 assert marketing_private.ads_unpack_report(bad)#>>'{insights,daily,0,attribution}'='Explicit provider provenance override','Override lost on expansion';
 assert marketing_private.ads_unpack_report(r)=r,'Legacy report changed';
 assert marketing_private.ads_pack_report('{"insights":{"daily":[{"metrics":{"spend":{"value":null}}}]}}')='{"insights":{"daily":[{"metrics":{"spend":{"value":null}}}]}}'::jsonb,'Missing provenance invented';
 insert into marketing_private.ads_sync_jobs(id,connection_id,generation,actor_employee_id,date_from,date_to,state,lease,lease_until,attempts)
 values(j,c.id,c.credential_generation,c.connected_by,f,t,'leased',l,now()+interval '5 minutes',1);
 v_progress:=jsonb_build_object('step',8,'requests',37,'report',r);
 perform public.marketing_ads_checkpoint(j,l,v_progress);
 select q.progress into v_progress from marketing_private.ads_sync_jobs q where q.id=j;
 assert v_progress->>'step'='8' and v_progress->'report'=packed,'Completed evidence not durable';
 -- Simulate failed finalization and exhaustion, then resume through the existing
 -- authorized request authority, preserving job identity and provider evidence.
 update marketing_private.ads_sync_jobs set state='leased',lease=l,lease_until=now()+interval '5 minutes',attempts=4 where id=j;
 perform public.marketing_ads_finish(j,l,null,'ads_report_finalization_failed');
 assert (select state='failed' and progress->'report'=packed from marketing_private.ads_sync_jobs where id=j),'Failed finalization erased complete evidence';
 resumed:=public.marketing_ads_request_sync(c.id,f,t);
 assert resumed=j,'Retry created duplicate provider work';
 update marketing_private.ads_sync_jobs set state='leased',lease=l,lease_until=now()+interval '5 minutes',attempts=1 where id=j;
 -- Reject changed/incomplete evidence rather than publishing a partial report.
 begin perform public.marketing_ads_finish(j,l,jsonb_set(packed,'{date_to}','"2026-10-15"'),null);raise exception 'Changed evidence accepted';exception when raise_exception then if sqlerrm<>'Complete reporting checkpoint required.' then raise;end if;end;
 -- A database failure rolls the whole finalization back; its checkpoint survives.
 begin
  perform public.marketing_ads_finish(j,l,packed,null);
  raise serialization_failure;
 exception when serialization_failure then null;
 end;
 assert (select state='leased' and progress->>'step'='8' from marketing_private.ads_sync_jobs where id=j),'Finalization failure lost checkpoint';
 perform public.marketing_ads_finish(j,l,packed,null);
 select observed_at,md5(payload::text) into observed,digest from marketing_private.ads_snapshots where connection_id=c.id and generation=c.credential_generation and date_from=f and date_to=t;
 perform public.marketing_ads_finish(j,l,packed,null);
 assert exists(select 1 from marketing_private.ads_snapshots where connection_id=c.id and generation=c.credential_generation and date_from=f and date_to=t and observed_at=observed and md5(payload::text)=digest),'Duplicate acknowledgment changed observation';
 assert (select sum((v#>>'{metrics,spend,value}')::numeric) from jsonb_array_elements(packed#>'{insights,daily}')v)=total,'Daily spend changed';
 assert (select sum((v#>>'{metrics,spend,value}')::numeric) from jsonb_array_elements(packed#>'{insights,campaign}')v)=total,'Campaign spend changed';
 projected:=marketing_private.ads_project(c.organization_id,c.provider_account_id,packed,null,true);
 assert projected#>'{insights,daily}'=r#>'{insights,daily}' and projected#>'{insights,campaign}'=r#>'{insights,campaign}','Read projection changed original values/provenance/order';
 select id into b from brands where organization_id=c.organization_id limit 1;
 if b is not null then
  projected:=marketing_private.ads_project(c.organization_id,c.provider_account_id,packed,b,true);
  assert projected#>'{insights,daily}'='[]'::jsonb and projected#>'{insights,campaign}'='[]'::jsonb,'Unassigned evidence leaked to Brand';
 end if;
 -- Irreducible oversize progress still fails, without advancing its checkpoint.
 update marketing_private.ads_sync_jobs set state='leased',lease=l,lease_until=now()+interval '5 minutes',progress='{}',attempts=1 where id=j;
 bad:=jsonb_set(v_progress,'{report,configs,padding}',to_jsonb(repeat('z',500000)));
 begin perform public.marketing_ads_checkpoint(j,l,bad);raise exception 'Storage budget bypassed';exception when program_limit_exceeded then null;end;
 begin perform marketing_private.ads_pack_report(jsonb_build_object('padding',repeat('z',6000001)));raise exception 'Envelope budget bypassed';exception when program_limit_exceeded then null;end;
 assert not has_function_privilege('anon','public.marketing_ads_checkpoint(uuid,uuid,jsonb)','execute'),'Anonymous checkpoint allowed';
 assert not has_function_privilege('authenticated','public.marketing_ads_finish(uuid,uuid,jsonb,text)','execute'),'Client finalization allowed';
 assert not has_function_privilege('authenticated','marketing_private.ads_pack_report(jsonb)','execute'),'Private packer exposed';
 select count(*) into new_count from marketing_private.ads_snapshots where connection_id=c.id;
 assert new_count=old_count+(not existing_snapshot)::int,'Snapshot count changed unexpectedly';
 insert into finalization_qa_result values(jsonb_build_object('expanded_bytes',octet_length(r::text),'packed_bytes',octet_length(packed::text),'campaign_rows',36,'daily_rows',1070,'spend',total,'lossless_roundtrip',true,'retry_reused_job',true,'duplicate_ack_stable',true,'brand_isolation',true,'resource_guards',true,'all_writes_rolled_back',true));
end;$$;
select result from finalization_qa_result;
rollback;
