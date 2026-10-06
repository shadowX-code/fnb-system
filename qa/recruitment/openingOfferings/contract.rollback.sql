begin;
do $$
begin
 perform recruitment_validate_offerings('{"location":"Pengkalan / Pasir Puteh","operating_days":["mon","tue","wed","thu","fri","sat","sun"],"operating_start":"08:00","operating_end":"17:00"}', '[{"id":"part","employment_type":"part_time","compensation_type":"hourly","amount_min":8,"currency":"MYR","minimum_hours_per_shift":0,"minimum_days_per_week":0,"break_threshold_hours":8,"break_minutes":60,"break_paid":false}]');
 begin perform recruitment_validate_offerings('{}','[{"id":"x","employment_type":"part_time","amount_min":8}]');raise exception 'Missing compensation type accepted';exception when sqlstate '22023' then null;end;
 begin perform recruitment_validate_offerings('{"payroll_id":"forbidden"}','[]');raise exception 'Unapproved context accepted';exception when sqlstate '22023' then null;end;
 begin perform recruitment_validate_offerings('{}','[{"id":"x","employment_type":"full_time","compensation_type":"monthly","amount_min":2200,"amount_max":1800,"currency":"MYR"}]');raise exception 'Inverted range accepted';exception when sqlstate '22023' then null;end;
 if has_function_privilege('anon','recruitment_save_opening(jsonb)','EXECUTE') or has_function_privilege('authenticated','recruitment_claim_voice_sample(text,uuid)','EXECUTE') or has_table_privilege('authenticated','recruitment_voice_sample_jobs','SELECT') then raise exception 'Protected boundary exposed';end if;
 if (select public from storage.buckets where id='recruitment-voice-samples') then raise exception 'Voice samples public';end if;
 if not recruitment_claim_voice_sample(repeat('a',64),gen_random_uuid()) then raise exception 'Sample claim failed';end if;
 if recruitment_claim_voice_sample(repeat('a',64),gen_random_uuid()) then raise exception 'Duplicate generation allowed';end if;
 begin update recruitment_interview_configs set employment_offerings='[{"id":"forbidden"}]' where id='b912a40c-0715-4384-be3e-cb30c0a51772';raise exception 'Pinned config mutable';exception when sqlstate '55000' then null;end;
end $$;
select set_config('request.jwt.claims','{"sub":"b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd","role":"authenticated"}',true);
set local role authenticated;
do $$ declare o jsonb; before_pin uuid; after_pin uuid; saved uuid; begin

 o:=(select value from jsonb_array_elements(recruitment_workspace('e553e849-1644-4c91-a7d2-42c3573e26b1')->'openings') where value->>'id'='e553e849-1644-4c91-a7d2-42c3573e26b1');
 saved:=recruitment_save_opening(jsonb_set(o,'{config,employment_offerings}','[{"id":"qa","employment_type":"part_time","compensation_type":"hourly","currency":"MYR","amount_min":8,"break_threshold_hours":8,"break_minutes":60,"break_paid":false}]'));
 if not exists(select 1 from jsonb_array_elements(recruitment_workspace(saved)->'openings') x where x->'config'->'employment_offerings'->0->>'amount_min'='8') then raise exception 'Offering round trip failed';end if;
 -- Inspect evidence through the existing protected review projection below, not direct client access.
end $$;
reset role;
do $$ begin
 if (select config_version_id from recruitment_interview_attempts where id='88af34fa-7af7-4e52-9d5f-a5313d5b3063')<>'b912a40c-0715-4384-be3e-cb30c0a51772'::uuid then raise exception 'Existing attempt pin changed';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 begin perform recruitment_save_opening('{}');raise exception 'Unauthorized authenticated save allowed';exception when insufficient_privilege then null;end;
end $$;
set local role anon;
do $$ begin
 begin perform recruitment_save_opening('{}');raise exception 'Anonymous save allowed';exception when insufficient_privilege then null;end;
end $$;
rollback;
