-- Run inside BEGIN/ROLLBACK on canonical Staging. Synthetic provider IDs; zero network/OAuth requests.
do $$
declare org uuid;brand uuid;other_brand uuid;actor uuid;uid uuid;page marketing_connections;
 conn uuid:=gen_random_uuid();account text:='99'||(floor(random()*1000000000000)::bigint)::text;
 subject text:='990000001';session_id uuid;health jsonb;payload jsonb;before_hash text;result jsonb;projected jsonb;pending_account jsonb;
 period date;state_hash text;config jsonb;r jsonb;source_job uuid:=gen_random_uuid();content uuid:=gen_random_uuid();denied boolean;
begin
 select c.* into page from marketing_connections c where c.channel='facebook' and c.status in ('test_authorized','production_authorized') and c.expires_at>now() limit 1;
 org:=page.organization_id;brand:=page.brand_id;
 select id into other_brand from brands where organization_id=org and id<>brand limit 1;
 select e.id,e.auth_user_id into actor,uid from employees e where e.auth_user_id is not null and marketing_private.ads_org_allowed(e.id,org,'marketing_ads.connect') and marketing_private.actor_allowed(e.id,org,brand,'marketing_ads.execute') limit 1;
 assert actor is not null and page.id is not null and other_brand is not null,'Canonical Staging test authority required';
 perform set_config('request.jwt.claim.sub',uid::text,true);
 insert into marketing_connections(id,organization_id,brand_id,channel,account_slot,provider_account_id,account_name,status,credential_generation,expires_at,connected_by)
 values(conn,org,null,'ad_account',account,account,'Rollback-only Ads grant','test_authorized',1,now()+interval '1 day',actor);
 insert into marketing_private.credentials(connection_id,credential_reference,sealed_token,meta_user_id,expires_at) values(conn,'rollback-only', '{"synthetic":true}',subject,now()+interval '1 day');
 insert into marketing_private.meta_subjects(connection_id,generation,meta_user_id) values(conn,1,subject);
 insert into marketing_private.ads_accounts(connection_id,generation,currency,timezone,account_status,tasks,read_verified,manage_verified,granted_scopes)
 values(conn,1,'MYR','Asia/Singapore',1,'["ADVERTISE"]',true,true,'["ads_read","ads_management"]');
 for i in 0..25 loop
  period:=('2024-01-01'::date+make_interval(months=>i))::date;
  payload:=jsonb_build_object('account',jsonb_build_object('id',account,'currency','MYR','timezone','Asia/Singapore'),'date_from',period,'date_to',(period+interval '1 month -1 day')::date,
   'configs',jsonb_build_object('campaigns',jsonb_build_array(jsonb_build_object('id','990009991','name','Synthetic history','status','PAUSED')),'adsets','[]'::jsonb,'ads','[]'::jsonb),
   'insights',jsonb_build_object('account',jsonb_build_array(jsonb_build_object('metrics',jsonb_build_object('spend',jsonb_build_object('value',10)))),
    'campaign',jsonb_build_array(jsonb_build_object('campaign_id','990009991','metrics',jsonb_build_object('spend',jsonb_build_object('value',10)))),'daily','[]'::jsonb),'warnings','{}'::jsonb);
  insert into marketing_private.ads_snapshots(connection_id,generation,date_from,date_to,observed_at,payload) values(conn,1,period,(period+interval '1 month -1 day')::date,now()-interval '1 day',payload);
 end loop;
 select md5(jsonb_agg(to_jsonb(s) order by date_from)::text) into before_hash from marketing_private.ads_snapshots s where connection_id=conn;
 perform public.marketing_ads_attribute(org,account,'990009991',brand,0,gen_random_uuid());
 health:=jsonb_build_object('id',account,'currency','MYR','timezone','Asia/Singapore','account_status',1,'tasks','["ADVERTISE"]'::jsonb,'read_verified',true,'manage_verified',true,'granted_scopes','["ads_read","ads_management"]'::jsonb);
 for rotation in 1..2 loop
  state_hash:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
  session_id:=public.marketing_ads_management_begin(org,state_hash,'999001');
  result:=public.marketing_meta_consume(state_hash);
  assert result->>'ads_management_config_id'='999001','Callback lost the pinned management configuration';
  perform public.marketing_ads_stage(session_id,subject,'{"synthetic":true}',jsonb_build_array(health));
  if rotation=1 then
   select a into pending_account from jsonb_array_elements(public.marketing_ads_pending(org,null)) s,
    lateral jsonb_array_elements(s->'accounts') a where s->>'id'=session_id::text and a->>'id'=account;
   assert pending_account->>'connected_generation'='1' and pending_account->>'authorization_blocker' is null,'Connected management account unavailable';
   assert exists(select 1 from jsonb_array_elements(public.marketing_ads_pending(org,null)) s where s->>'id'=session_id::text and s->>'authorization_purpose'='management'),'Management purpose lost';
   denied:=false;begin perform public.marketing_ads_bind(session_id,uid,account,null,'{"synthetic":true}',now()+interval '1 day',health||'{"granted_scopes":["ads_read"]}',rotation);exception when others then denied:=true;end;assert denied,'Management login accepted missing scope';
   denied:=false;begin perform public.marketing_ads_bind(session_id,uid,account,null,'{"synthetic":true}',now()+interval '1 day',health||'{"manage_verified":false}',rotation);exception when others then denied:=true;end;assert denied,'Management login accepted missing account tasks';
   update marketing_private.oauth_sessions set meta_user_id='990000002' where id=session_id;
   select a into pending_account from jsonb_array_elements(public.marketing_ads_pending(org,null)) s,
    lateral jsonb_array_elements(s->'accounts') a where s->>'id'=session_id::text and a->>'id'=account;
   assert pending_account->>'authorization_blocker'='ads_management_authorizer_changed','Authorizer mismatch hidden';
   denied:=false;begin perform public.marketing_ads_bind(session_id,uid,account,null,'{"synthetic":true}',now()+interval '1 day',health,rotation);exception when others then denied:=true;end;assert denied,'Management rotation replaced a different authorizer';
   update marketing_private.oauth_sessions set meta_user_id=subject where id=session_id;
   denied:=false;begin perform public.marketing_ads_bind(session_id,uid,account,null,'{"synthetic":true}',now()+interval '1 day',health,rotation+1);exception when others then denied:=true;end;assert denied,'Stale generation accepted';
   denied:=false;begin perform public.marketing_ads_bind(session_id,uid,account||'1',null,'{"synthetic":true}',now()+interval '1 day',health,rotation);exception when others then denied:=true;end;assert denied,'Mismatched Ad Account accepted';
   denied:=false;begin perform public.marketing_ads_bind(session_id,uid,account,other_brand,'{"synthetic":true}',now()+interval '1 day',health,rotation);exception when others then denied:=true;end;assert denied,'Shared account rebound to a Brand';
   assert (select credential_generation from marketing_connections where id=conn)=1,'Failed authorization changed generation';
  end if;
  result:=public.marketing_ads_bind(session_id,uid,account,null,'{"synthetic":true}',now()+interval '1 day',health,rotation);
  assert (result->>'credential_generation')::int=rotation+1;
  assert (select count(*) from marketing_private.ads_visible_snapshots(conn))=26,'Rotation lost or duplicated history';
  if rotation=1 then
   assert before_hash=(select md5(jsonb_agg(to_jsonb(s) order by date_from)::text) from marketing_private.ads_snapshots s where connection_id=conn),'Rotation rewrote observations';
   result:=public.marketing_ads_read(org,null,'2024-01-01','2024-01-31');
   select value into projected from jsonb_array_elements(result->'reports') where value->>'connection_id'=conn::text;
   assert projected->>'observation_generation'='1' and projected->>'authorization_generation'='2','Provenance was rewritten';
   -- A later exact-period observation supersedes presentation only; original rows remain.
   payload:=jsonb_set(projected->'payload','{insights,account,0,metrics,spend,value}','20');
   insert into marketing_private.ads_snapshots values(conn,2,'2024-01-01','2024-01-31',now(),payload);
   assert (select count(*) from marketing_private.ads_visible_snapshots(conn))=26;
   assert (select generation from marketing_private.ads_visible_snapshots(conn) where date_from='2024-01-01')=2;
  end if;
 end loop;
 assert before_hash=(select md5(jsonb_agg(to_jsonb(s) order by date_from)::text) from marketing_private.ads_snapshots s where connection_id=conn and generation=1),'Second rotation changed original 26 observations';
 assert (select count(*) from marketing_private.ads_snapshots where connection_id=conn)=27,'History was deduplicated destructively';
 select value into projected from jsonb_array_elements(public.marketing_ads_read(org,other_brand,'2024-01-01','2024-01-31')->'reports') where value->>'connection_id'=conn::text;
 assert coalesce(jsonb_array_length(projected#>'{payload,configs,campaigns}'),0)=0,'Other Brand campaign leaked';
 denied:=false;begin perform public.marketing_ads_preflight_material(gen_random_uuid(),org,brand,conn,page.provider_account_id,null);exception when insufficient_privilege then denied:=true;end;assert denied,'Unauthorized preflight accepted';
 denied:=false;begin perform public.marketing_ads_preflight_material(uid,org,other_brand,conn,page.provider_account_id,null);exception when others then denied:=true;end;assert denied,'Cross-Brand Page accepted';
 assert not has_function_privilege('authenticated','public.marketing_ads_paused_create_permit(uuid,uuid,text,integer,timestamptz)','EXECUTE');
 assert not has_function_privilege('anon','public.marketing_ads_preflight_material(uuid,uuid,uuid,uuid,text,uuid)','EXECUTE');
 assert not has_function_privilege('authenticated','marketing_private.ads_visible_snapshots(uuid)','EXECUTE');

 insert into marketing_content(id,organization_id,brand_id,created_by,status) values(content,org,brand,actor,'published');
 insert into marketing_content_revisions(content_id,revision,payload,actor_employee_id) values(content,1,jsonb_build_object('title','Rollback source','variants',jsonb_build_array(jsonb_build_object('channel','facebook','format','text','caption','Synthetic source','asset_ids','[]'::jsonb)),'outlet_ids','[]'::jsonb),actor);
 insert into marketing_jobs(id,organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,connection_id,connection_generation,provider_post_id)
 values(source_job,org,brand,content,1,'facebook','succeeded',now(),actor,page.id,page.credential_generation,page.provider_account_id||'_999999999991');
 config:=jsonb_build_object('create_contract_version',3,'creative_source','facebook_post','name','Rollback paused boundary','objective','OUTCOME_AWARENESS','maximum_budget',1000,
  'start_local',to_char((now()+interval '2 days') at time zone 'Asia/Singapore','YYYY-MM-DD"T"HH24:MI'),'end_local',to_char((now()+interval '3 days') at time zone 'Asia/Singapore','YYYY-MM-DD"T"HH24:MI'),
  'age_min',18,'age_max',65,'placements','facebook_feed','page_id',page.provider_account_id,'source_job_id',source_job,'adset_contract_version',2,
  'regional_regulated_categories','["MALAYSIA_UNIVERSAL"]'::jsonb,'regional_regulation_identities','{"universal_beneficiary":"9901","universal_payer":"9902"}'::jsonb,'promoted_object',jsonb_build_object('page_id',page.provider_account_id),
  'audience','{"type":"city","key":"1562208","name":"Ipoh","radius":17}'::jsonb);
 r:=public.marketing_ads_change_prepare(gen_random_uuid(),uid,org,brand,conn,'create',config,null,null);
 assert r->>'paused_create_expires_at' is null;
 r:=public.marketing_ads_change_transition((r->>'id')::uuid,r->>'fingerprint','submit');
 r:=public.marketing_ads_change_transition((r->>'id')::uuid,r->>'fingerprint','review');
 r:=public.marketing_ads_change_transition((r->>'id')::uuid,r->>'fingerprint','approve');
 projected:=public.marketing_ads_execution_preflight((r->>'id')::uuid,uid,r->>'fingerprint');
 assert projected->>'state'='approved' and projected->>'id'=r->>'id' and projected->>'approval_expires_at' is not null and projected->>'approval_current'='true','Execution status is not bound to approval';
 update marketing_private.ads_changes set reviewed_by=null where id=(r->>'id')::uuid;
 assert public.marketing_ads_execution_preflight((r->>'id')::uuid,uid,r->>'fingerprint')->>'approval_current'='false','Missing reviewer authority appeared executable';
 update marketing_private.ads_changes set reviewed_by=(r->>'reviewed_by')::uuid where id=(r->>'id')::uuid;
 denied:=false;begin perform public.marketing_ads_paused_create_permit((r->>'id')::uuid,uid,r->>'fingerprint',3,now()+interval '31 minutes');exception when others then denied:=true;end;assert denied,'Unbounded permit accepted';
 denied:=false;begin perform public.marketing_ads_paused_create_permit((r->>'id')::uuid,uid,r->>'fingerprint',null,now()+interval '10 minutes');exception when others then denied:=true;end;assert denied,'Null expected generation accepted';
 perform public.marketing_ads_paused_create_permit((r->>'id')::uuid,uid,r->>'fingerprint',3,now()+interval '10 minutes');
 denied:=false;begin perform public.marketing_ads_paused_create_permit((r->>'id')::uuid,uid,r->>'fingerprint',3,now()+interval '20 minutes');exception when others then denied:=true;end;assert denied,'Permit renewed';
 projected:=public.marketing_ads_change_claim((r->>'id')::uuid,uid,r->>'fingerprint');assert projected->>'lease' is not null;
 assert public.marketing_ads_change_claim((r->>'id')::uuid,uid,r->>'fingerprint') is null,'Concurrent claim accepted';
 perform public.marketing_ads_paused_create_permit((r->>'id')::uuid,uid,r->>'fingerprint',3,null);
 assert public.marketing_ads_change_material((r->>'id')::uuid,(projected->>'lease')::uuid)#>>'{change,paused_create_expires_at}' is null,'Revocation not visible at send boundary';
 denied:=false;begin perform public.marketing_ads_paused_create_permit((r->>'id')::uuid,uid,r->>'fingerprint',3,now()+interval '10 minutes');exception when others then denied:=true;end;assert denied,'Revoked permit reissued';

 update marketing_private.credentials set meta_user_id='990000002' where connection_id=conn;
 assert (select count(*) from marketing_private.ads_visible_snapshots(conn))=0,'Changed authorizer inherited history';
 update marketing_private.credentials set meta_user_id=subject where connection_id=conn;
 update marketing_private.ads_accounts set read_verified=false where connection_id=conn;
 assert (select count(*) from marketing_private.ads_visible_snapshots(conn))=0,'Unavailable authorization exposed history';
 update marketing_private.ads_accounts set read_verified=true where connection_id=conn;
 delete from marketing_private.meta_subjects where connection_id=conn and generation=1;
 assert (select count(*) from marketing_private.ads_visible_snapshots(conn))=1,'Erased source grant remained visible';
 assert not exists(select 1 from marketing_private.ads_grant_continuity where connection_id=conn and source_generation=1);
 update marketing_connections set status='not_connected' where id=conn;
 assert (select count(*) from marketing_private.ads_visible_snapshots(conn))=0;
 session_id:=public.marketing_ads_management_begin(org,encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),'999001');
 update marketing_private.oauth_sessions set consumed_at=now(),sealed_discovery='{"synthetic":true}',meta_user_id=subject,accounts=jsonb_build_array(health) where id=session_id;
 perform public.marketing_ads_bind(session_id,uid,account,null,'{"synthetic":true}',now()+interval '1 day',health,3);
 assert (select count(*) from marketing_private.ads_visible_snapshots(conn))=0,'Disconnected grant silently resurrected historical access';
end;$$;
select '26-period rotation, management confirmation, newest-period selection, source erasure, Brand isolation, exact authorization and paused-permit checks passed; rollback required' result;
