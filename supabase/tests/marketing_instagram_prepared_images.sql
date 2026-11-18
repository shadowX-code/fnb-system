-- Canonical Staging only. Synthetic rows and all evidence roll back.
begin;

do $test$
declare u uuid; actor uuid; org uuid; brand uuid; source_id uuid := gen_random_uuid(); first_asset jsonb; second_asset jsonb; result jsonb; failed boolean := false;
begin
 select b.id,b.organization_id,e.auth_user_id,e.id into brand,org,u,actor from brands b cross join employees e
 where b.name like 'QA%' and e.auth_user_id is not null
 and marketing_private.actor_allowed(e.id,b.organization_id,b.id,'marketing_content.upload') limit 1;
 if brand is null then raise exception 'Staging QA Brand and authorized actor required.';end if;
 if has_function_privilege('authenticated','public.marketing_prepare_image(text,uuid,uuid,uuid,uuid,jsonb)','execute') then raise exception 'browser authority exposed';end if;
 insert into marketing_assets(id,organization_id,brand_id,filename,mime_type,size_bytes,object_path,created_by,state,storage_policy,source_kind,sha256)
 values(source_id,org,brand,'QA PNG.png','image/png',100,'rollback-test/'||source_id,actor,'ready','temporary','device',repeat('a',64));
 first_asset := public.marketing_prepare_image('prepare',u,org,brand,source_id,jsonb_build_object('source_sha256',repeat('a',64),'output_sha256',repeat('b',64),'size_bytes',200));
 second_asset := public.marketing_prepare_image('prepare',u,org,brand,source_id,jsonb_build_object('source_sha256',repeat('a',64),'output_sha256',repeat('b',64),'size_bytes',200));
 failed:=false;
 begin perform public.marketing_drive_asset(u,(first_asset->>'id')::uuid);exception when others then failed:=true;end;
 if not failed then raise exception 'ordinary upload path accepted prepared asset';end if;
 failed:=false;
 begin perform public.marketing_drive_server('finalize',u,org,brand,jsonb_build_object('id',first_asset->>'id','sha256',repeat('b',64)));exception when others then failed:=true;end;
 if not failed then raise exception 'ordinary finalization accepted prepared asset';end if;
 if first_asset->>'id' is distinct from second_asset->>'id' or first_asset->>'state'<>'pending' then raise exception 'dedup/state failed';end if;
 result:=public.marketing_prepare_image('lookup',u,org,brand,source_id,jsonb_build_object('source_sha256',repeat('a',64)));
 if result<>'null'::jsonb then raise exception 'unverified media exposed';end if;
 begin perform public.marketing_prepare_image('source',gen_random_uuid(),org,brand,source_id);exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'unauthorized source accepted';end if;
 failed:=false;
 begin perform public.marketing_prepare_image('source',u,org,gen_random_uuid(),source_id);exception when others then failed:=true;end;
 if not failed then raise exception 'cross Brand accepted';end if;
 failed:=false;
 begin perform public.marketing_prepare_image('finalize',u,org,brand,source_id,jsonb_build_object('source_sha256',repeat('a',64),'prepared_id',first_asset->>'id','output_sha256',repeat('c',64)));exception when others then failed:=true;end;
 if not failed then raise exception 'mismatched digest accepted';end if;
 insert into storage.objects(bucket_id,name,metadata) values('marketing-media',first_asset->>'object_path','{"size":200,"mimetype":"image/jpeg"}');
 result:=public.marketing_prepare_image('finalize',u,org,brand,source_id,jsonb_build_object('source_sha256',repeat('a',64),'prepared_id',first_asset->>'id','output_sha256',repeat('b',64)));
 if result->>'state'<>'ready' or result->>'sha256'<>repeat('b',64) then raise exception 'finalize failed';end if;
 second_asset:=public.marketing_prepare_image('lookup',u,org,brand,source_id,jsonb_build_object('source_sha256',repeat('a',64)));
 if second_asset->>'id' is distinct from first_asset->>'id' then raise exception 'ready reuse failed';end if;
 if (select state from marketing_assets where id=source_id)<>'ready' then raise exception 'source changed';end if;
end;$test$;
select 'PASS: permission/scope, pending readiness, idempotency, byte-hash acknowledgement, original preservation' as verification;
rollback;