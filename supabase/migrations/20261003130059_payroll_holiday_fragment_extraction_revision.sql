-- Forward parser revision retains prior source interpretations and reviews.
-- Forward correction: disambiguate the trusted proposal decision variable.
create or replace function public.payroll_holiday_candidate_propose(p_id uuid,p_check_id uuid,p_source_sha256 text,p_rows jsonb,p_metadata jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare c public.payroll_holiday_import_candidates%rowtype; chk public.payroll_holiday_update_checks%rowtype;
 actor_auth uuid; prior_sub text:=current_setting('request.jwt.claim.sub',true); r jsonb; source_row jsonb; output jsonb:='[]'; proposed_decisions jsonb:='{}';
begin
 select * into chk from public.payroll_holiday_update_checks where id=p_check_id;
 select * into c from public.payroll_holiday_import_candidates where id=p_id for update;
 if c.id is null or chk.id is null or chk.completed_at is not null or chk.year<>c.year or c.is_qa or c.source_sha256 is distinct from p_source_sha256 then raise exception 'Proposal does not match the authorized check and captured source.'; end if;
 if c.status<>'fetched' then return; end if;
 if jsonb_typeof(p_metadata) is distinct from 'object' or octet_length(p_metadata::text)>64000 or p_metadata->>'parser' is distinct from 'bkpp_proposal_v2' or coalesce(p_metadata->>'document_role','') not in ('annual','supplement') then raise exception 'Unsupported extraction evidence.'; end if;
 select auth_user_id into actor_auth from public.employees where id=chk.actor_employee_id;
 if actor_auth is null then raise exception 'Check actor is no longer linked to Admin identity.'; end if;
 perform set_config('request.jwt.claim.sub',actor_auth::text,true);
 perform public.payroll_holiday_candidate_parse(p_id,p_rows);
 select * into c from public.payroll_holiday_import_candidates where id=p_id;
 for r in select value from jsonb_array_elements(c.rows) loop
  source_row:=p_rows->((r->>'key')::integer-1);
  if r->>'state'<>'missing' then
   r:=r||jsonb_build_object('classification_review',(r->>'state' <> 'matched' and coalesce((source_row->>'classification_review')::boolean,false)),'review_reason',source_row->>'review_reason');
   r:=jsonb_set(r,'{row}',(r->'row')||jsonb_build_object('source_locator',source_row->>'source_locator','suggested_kind',source_row->>'suggested_kind','uncertainty',source_row->>'uncertainty'));
   if r->>'state'='new' and not coalesce((r->>'classification_review')::boolean,false) then proposed_decisions:=proposed_decisions||jsonb_build_object(r->>'key',jsonb_build_object('action','accept','origin','verified_source_extraction')); end if;
  end if;
  output:=output||jsonb_build_array(r);
 end loop;
 perform set_config('feedx.holiday_candidate_command','yes',true);
 update public.payroll_holiday_import_candidates set rows=output,decisions=proposed_decisions,proposal_metadata=p_metadata,parser_version=p_metadata->>'parser' where id=p_id;
 insert into public.payroll_holiday_import_events(candidate_id,event_type,actor_employee_id,details) values(p_id,'calendar_proposed',chk.actor_employee_id,jsonb_build_object('source_sha256',p_source_sha256,'metadata',p_metadata,'check_id',chk.id,'rows',output,'decisions',proposed_decisions));
 perform set_config('request.jwt.claim.sub',coalesce(prior_sub,''),true);
end $$;


create or replace function public.payroll_holiday_discovered_source_capture(p_year integer,p_url text,p_reference text,p_filename text,p_pdf_base64 text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a uuid:=public.payroll_holiday_settings_actor(); h text; c public.payroll_holiday_import_candidates%rowtype; i uuid;
begin
 if p_url !~ '^https://www\.kabinet\.gov\.my/storage/[^?#]+\.pdf$' or length(p_pdf_base64)>7000000 then raise exception 'Discovered source is not allowed.'; end if;
 h:=encode(extensions.digest(decode(p_pdf_base64,'base64'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtext('holiday-source:'||p_year||':'||h));
 select * into c from public.payroll_holiday_import_candidates where year=p_year and not is_qa and status<>'retired' and source_sha256=h order by created_at desc limit 1;
 if found and (c.status='fetched' or c.parser_version='bkpp_proposal_v2') then return jsonb_build_object('id',c.id,'created',false,'status',c.status); end if;
 i:=public.payroll_holiday_candidate_capture(p_year,p_url,p_reference,p_filename,p_pdf_base64,p_request_id,false);
 if c.id is not null then
  insert into public.payroll_holiday_import_events(candidate_id,event_type,actor_employee_id,details) values(i,'source_reinterpreted',a,jsonb_build_object('previous_candidate_id',c.id,'reason','New verified extraction parser; previous source review and publication remain immutable'));
 end if;
 return jsonb_build_object('id',i,'created',true,'status','fetched');
end $$;

