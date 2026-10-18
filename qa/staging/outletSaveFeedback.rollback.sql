-- Canonical Staging only: isolated actor/Outlet; all fixture data rolls back.
begin;
create temporary table outlet_save_qa(key text primary key,id uuid);
grant select on outlet_save_qa to authenticated;
do $$declare u uuid:=gen_random_uuid();e uuid:=gen_random_uuid();r uuid:=gen_random_uuid();o uuid:=gen_random_uuid();begin
 insert into auth.users(id,email,aud,role) values(u,'outlet-save-'||u||'@example.invalid','authenticated','authenticated');
 insert into public.roles(id,name,is_active,outlet_access_type) values(r,'qa_outlet_save_'||r,true,'all');
 insert into public.role_permissions(role_id,permission_id) select r,id from public.permissions where code in ('outlets.view','outlets.edit');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 insert into public.employees(id,auth_user_id,full_name,email,role_id,enable_system_login,access_state,is_active,workplace) values(e,u,'QA Outlet Save','outlet-save-'||u||'@example.invalid',r,true,'active',true,'Management');
 insert into public.outlets(id,name,code,location,is_active) values(o,'QA Outlet Save Rollback','QA-'||left(o::text,8),'QA isolated',true);
 insert into outlet_save_qa values('user',u),('role',r),('outlet',o);
end;$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from outlet_save_qa where key='user'),'role','authenticated')::text,true);
do $$declare d jsonb:=jsonb_build_object('timezone','Asia/Kuala_Lumpur','phone','','email','manager@example.com','website','https://example.com','service_policies','QA only','weekly_hours',(select jsonb_agg(jsonb_build_object('day',n,'status','open','periods',jsonb_build_array(jsonb_build_object('opens','10:00','closes','22:00','overnight',false)))) from generate_series(0,6)n),'special_hours',jsonb_build_array(jsonb_build_object('date','2026-12-25','status','closed','periods','[]'::jsonb,'reason','QA closure')));o uuid:=(select id from outlet_save_qa where key='outlet');failed boolean;r jsonb;req uuid:=gen_random_uuid();bad jsonb;begin
 bad:=jsonb_set(d,'{weekly_hours,6,periods,0,closes}','"10:00"');failed:=false;
 begin perform outlet_service_profile_save(req,o,0,bad);exception when raise_exception then assert sqlerrm='Confirm opening/closing times and next-day closing explicitly.';failed:=true;end;assert failed,'Saturday same-day equal times rejected with P0001';
 r:=outlet_service_profile_save(req,o,0,d);assert r->>'revision'='1','Valid weekly schedule and email/date saved';assert r->'data'=d,'Receipt reflects exact persisted values';assert outlet_service_profile_save(req,o,0,d)=r,'Stable request returns one receipt';
 failed:=false;begin perform outlet_service_profile_save(gen_random_uuid(),o,0,d);exception when serialization_failure then failed:=true;end;assert failed,'Stale revision remains blocked';
 d:=jsonb_set(d,'{weekly_hours,6,periods,0}', '{"opens":"18:00","closes":"02:00","overnight":true}');r:=outlet_service_profile_save(gen_random_uuid(),o,1,d);assert r->>'revision'='2','Explicit overnight accepted';
 bad:=jsonb_set(d,'{weekly_hours,6,periods,0,overnight}','false');failed:=false;begin perform outlet_service_profile_save(gen_random_uuid(),o,2,bad);exception when raise_exception then failed:=true;end;assert failed,'Overnight intent cannot be inferred';
 d:=jsonb_set(d,'{weekly_hours,6,periods,0}', '{"opens":"10:00","closes":"10:00","overnight":true}');r:=outlet_service_profile_save(gen_random_uuid(),o,2,d);assert r->>'revision'='3','Explicit 24-hour period accepted';
 bad:=jsonb_set(d,'{weekly_hours,6,periods}', '[{"opens":"10:00","closes":"14:00","overnight":false},{"opens":"13:00","closes":"16:00","overnight":false}]');failed:=false;begin perform outlet_service_profile_save(gen_random_uuid(),o,3,bad);exception when raise_exception then failed:=true;end;assert failed,'Overlapping periods remain blocked';
 assert outlet_service_profile_read(o)->'profile'->>'revision'='3','Canonical read returns committed revision inside fixture';
end;$$;
reset role;
do $$begin assert (select count(*) from outlet_service_profile_history where outlet_id=(select id from outlet_save_qa where key='outlet'))=3,'Only successful revisions produce immutable history';end;$$;
select 'PASS: exact Saturday P0001; valid email/date/weekly save; stable retry; stale revision; explicit overnight/24-hour; overlap; read/history reconciliation' as result;
rollback;
