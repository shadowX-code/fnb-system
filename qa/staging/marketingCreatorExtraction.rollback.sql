begin;
do $$
declare r jsonb;again jsonb;request uuid:=gen_random_uuid();post uuid;ticket uuid;blocked boolean:=false;
 org uuid:='ec42a08a-0f59-4b7b-a48e-b2faacf9eaf1';brand uuid:='88718f61-2915-42ef-b62f-5e6e2fe5b3eb';
 payload jsonb:=jsonb_build_object('url','https://www.tiktok.com/@feedx_qa/video/999999999999999999','caption','Disposable extraction authority test','published_date','2025-07-01','published_at','','public_observation',jsonb_build_object('platform','tiktok','post_id','999999999999999999','captured_at',now(),'date_precision','date','metrics',jsonb_build_object('likes',0),'thumbnail_url','https://p16.tiktokcdn.com/fixture.jpg'));
begin
 if has_function_privilege('anon','public.marketing_creator_inspection_access(uuid,uuid,boolean,uuid)','execute') then raise exception 'Anonymous inspection authority exposed';end if;
 perform set_config('request.jwt.claims','{"sub":"b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd","role":"authenticated"}',true);
 ticket:=public.marketing_creator_inspection_access(org,brand,true);
 begin perform public.marketing_creator_inspection_access(org,brand,true);exception when others then blocked:=true;end;
 if not blocked then raise exception 'Concurrent inspection was not rejected';end if;
 perform public.marketing_creator_inspection_access(org,brand,false,ticket);
 r:=public.marketing_creator_command(request,org,brand,'save_post',null,0,payload);post:=(r->>'id')::uuid;
 again:=public.marketing_creator_command(request,org,brand,'save_post',null,0,payload);
 if r<>again then raise exception 'Retry changed post';end if;
 if (select published_at is not null or published_date is distinct from '2025-07-01'::date or metadata_source<>'public_staff_confirmed' from public.marketing_creator_posts where id=post) then raise exception 'Date/provenance was lost';end if;
 if (select count(*)<>1 from public.marketing_creator_metric_snapshots where post_id=post) then raise exception 'Duplicate metric snapshot';end if;
 if (select metrics->>'likes'<>'0' or metrics?'views' from public.marketing_creator_metric_snapshots where post_id=post) then raise exception 'Unknown/zero conflated';end if;
 blocked:=false;
 perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000099","role":"authenticated"}',true);
 begin perform public.marketing_creator_inspection_access(org,brand,true);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Unknown member inspected a Brand';end if;
end;$$;
rollback;
