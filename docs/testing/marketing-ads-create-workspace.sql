-- Run only inside BEGIN/ROLLBACK against canonical Staging, after the migration.
-- Uses a current Brand/Page only for scope; every new content/asset/ad record is rollback-only.
do $$
declare org uuid; brand uuid; other_brand uuid; actor uuid; auth_user uuid; account public.marketing_connections; page public.marketing_connections;
 req uuid:=gen_random_uuid(); content uuid:=gen_random_uuid(); job uuid:=gen_random_uuid(); asset uuid:=gen_random_uuid(); r jsonb; draft jsonb; config jsonb; normalized jsonb; source jsonb; rejected boolean; count_before bigint;
begin
 select c.* into account from public.marketing_connections c join marketing_private.ads_accounts a on a.connection_id=c.id where c.channel='ad_account' and a.read_verified limit 1;
 org:=account.organization_id;
 select c.* into page from public.marketing_connections c where c.organization_id=org and c.channel='facebook' and c.status in ('test_authorized','production_authorized') and c.expires_at>now() limit 1;
 brand:=page.brand_id;
 select e.id,e.auth_user_id into actor,auth_user from public.employees e where e.auth_user_id is not null and marketing_private.actor_allowed(e.id,org,brand,'marketing_ads.manage') and marketing_private.actor_allowed(e.id,org,brand,'marketing_ads.approve') limit 1;
 if actor is null or page.id is null then raise exception 'Authorized Staging test identity/Page required';end if;
 select id into other_brand from public.brands where organization_id=org and id<>brand limit 1;
 assert not has_function_privilege('authenticated','public.marketing_ads_change_prepare(uuid,uuid,uuid,uuid,uuid,text,jsonb,text,uuid)','EXECUTE');
 assert not has_function_privilege('anon','public.marketing_ads_workspace_material(uuid,uuid,uuid,uuid,uuid,text,boolean)','EXECUTE');
 assert not has_function_privilege('authenticated','marketing_private.ads_workspace_config(uuid,uuid,uuid,jsonb,text)','EXECUTE');
 perform set_config('request.jwt.claim.sub',auth_user::text,true);
 draft:=jsonb_build_object('draft_only',true,'name','QA rollback draft','workspace',jsonb_build_object('creative_source','facebook_post'));
 r:=public.marketing_ads_change_prepare(req,auth_user,org,brand,account.id,'create',draft,null,null);
 assert r->>'state'='draft' and (r->>'maximum_budget')::bigint=0 and marketing_private.ads_change_current(jsonb_populate_record(null::marketing_private.ads_changes,r));
 select count(*) into count_before from marketing_private.ads_changes;
 assert public.marketing_ads_change_prepare(req,auth_user,org,brand,account.id,'create',draft,null,null)->>'id'=req::text;
 assert (select count(*) from marketing_private.ads_changes)=count_before;
 rejected:=false;begin perform public.marketing_ads_change_transition(req,r->>'fingerprint','submit');exception when others then rejected:=true;end;assert rejected,'Incomplete draft entered review';
 rejected:=false;begin perform public.marketing_ads_change_prepare(gen_random_uuid(),gen_random_uuid(),org,brand,account.id,'create',draft,null,null);exception when insufficient_privilege then rejected:=true;end;assert rejected,'Unauthorized draft accepted';
 insert into public.marketing_content(id,organization_id,brand_id,created_by,status) values(content,org,brand,actor,'published');
 insert into public.marketing_content_revisions(content_id,revision,payload,actor_employee_id) values(content,1,jsonb_build_object('title','QA rollback source','variants',jsonb_build_array(jsonb_build_object('channel','facebook','format','text','caption','QA rollback source','asset_ids','[]'::jsonb)),'outlet_ids','[]'::jsonb),actor);
 insert into public.marketing_jobs(id,organization_id,brand_id,content_id,revision,channel,state,due_at,authorized_by,connection_id,connection_generation,provider_post_id)
 values(job,org,brand,content,1,'facebook','succeeded',now(),actor,page.id,page.credential_generation,page.provider_account_id||'_999999999991');
 source:=marketing_private.ads_source_post(org,brand,job);assert source->>'provider_post_id'=page.provider_account_id||'_999999999991';
 assert marketing_private.ads_source_post(org,other_brand,job) is null,'Cross-Brand source exposed';
 config:=jsonb_build_object('create_contract_version',3,'creative_source','facebook_post','name','QA rollback promotion','objective','OUTCOME_AWARENESS','maximum_budget',5000,'start_local','2099-01-01T09:00','end_local','2099-01-02T09:00','age_min',18,'age_max',65,'placements','facebook_feed','page_id',page.provider_account_id,'source_job_id',job,'adset_contract_version',2,'regional_regulated_categories','["MALAYSIA_UNIVERSAL"]'::jsonb,'regional_regulation_identities',jsonb_build_object('universal_beneficiary','1','universal_payer','2'),'promoted_object',jsonb_build_object('page_id',page.provider_account_id),'audience',jsonb_build_object('type','radius','latitude',4.6,'longitude',101.1,'radius',5));
 r:=public.marketing_ads_change_prepare(gen_random_uuid(),auth_user,org,brand,account.id,'create',config,null,req);
 assert r#>>'{configuration,source_post,provider_post_id}'=source->>'provider_post_id';
 assert r#>>'{configuration,start_time}' is not null;
 assert (r#>>'{configuration,start_time}')::timestamptz=('2099-01-01 09:00'::timestamp at time zone (r->>'timezone'));
 assert not(r->'configuration'?'media');
 assert (select state from marketing_private.ads_changes where id=req)='superseded';
 -- Review remains canonical, with no execution claim or provider mutation.
 r:=public.marketing_ads_change_transition((r->>'id')::uuid,r->>'fingerprint','submit');assert r->>'state'='review';
 rejected:=false;begin perform marketing_private.ads_workspace_config(org,other_brand,account.id,config,null);exception when others then rejected:=true;end;assert rejected,'Cross-Brand promotion accepted';
 rejected:=false;begin perform marketing_private.ads_workspace_config(org,brand,account.id,config||'{"placements":"instagram_feed"}',null);exception when others then rejected:=true;end;assert rejected,'Instagram promotion accepted';
 rejected:=false;begin perform marketing_private.ads_workspace_config(org,brand,account.id,config||'{"maximum_budget":0}',null);exception when others then rejected:=true;end;assert rejected,'Zero budget accepted';
 rejected:=false;begin perform marketing_private.ads_workspace_config(org,brand,account.id,jsonb_set(config,'{audience,radius}','81'),null);exception when others then rejected:=true;end;assert rejected,'Unbounded radius accepted';
 rejected:=false;begin perform marketing_private.ads_workspace_config(org,brand,account.id,config||'{"end_local":"2099-06-01T09:00"}',null);exception when others then rejected:=true;end;assert rejected,'Unbounded schedule accepted';
 rejected:=false;begin perform marketing_private.ads_workspace_config(org,brand,account.id,config||'{"regional_regulation_identities":{}}',null);exception when others then rejected:=true;end;assert rejected,'Missing declarations accepted';
 insert into public.marketing_assets(id,organization_id,brand_id,filename,mime_type,size_bytes,object_path,state,created_by)
 values(asset,org,brand,'QA rollback image.jpg','image/jpeg',100,'qa/rollback/image.jpg','ready',actor);
 config:=(config-'source_job_id')||jsonb_build_object('creative_source','new_image','asset_id',asset,'caption','QA caption','headline','QA headline','url','https://example.invalid/qa');
 normalized:=marketing_private.ads_workspace_config(org,brand,account.id,config,repeat('a',64));assert normalized#>>'{media,id}'=asset::text;
 rejected:=false;begin perform marketing_private.ads_workspace_config(org,other_brand,account.id,config,repeat('a',64));exception when others then rejected:=true;end;assert rejected,'Other Brand image accepted';
 -- Pending/accepted provider state on the inherited partial campaign is never changed by these tests.
 assert exists(select 1 from marketing_private.ads_changes where state='reconciling' and operation='create' and provider_state?'campaign_id');
end;$$;
select 'Ads create authority checks passed; rollback required' result;
