begin;
do $test$
declare who uuid; context jsonb; report jsonb; org uuid; brand uuid; sid uuid; outlet uuid; employee uuid; preview jsonb; receipt jsonb; intent uuid; fp text;
begin
 select updated_by into who from feedx_integrations.native_assistant_config where singleton;
 if who is null then raise exception 'qa_actor_missing';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',who,'role','authenticated')::text,true);
 -- Use the existing human authorization checks; no role/grant changes.
 report:=public.reporting_monthly_scope_financials(null,2026,11);
 if report->'financials' is null then raise exception 'report_contract_missing';end if;
 select outlet_id into outlet from public.reporting_scope_outlets(null) limit 1;
 perform public.crew_leave_requests_admin_page(outlet,'2026-11-01','2026-11-30','{}',1,20);
 select id into employee from public.employees where auth_user_id=who;
 perform public.employee_employment_assignment_read(employee,null);
 perform public.factory_mesti_cleaning_methods();
 begin
 perform public.reporting_monthly_scope_financials('00000000-0000-4000-8000-000000000000',2026,11);
 raise exception 'unknown_outlet_allowed';
 exception when insufficient_privilege or no_data_found then null;end;
 context:=public.marketing_context();
 select b.id,b.organization_id into brand,org from public.brands b where b.is_active and marketing_private.brand_allowed(b.organization_id,b.id) limit 1;
 if brand is null then raise exception 'qa_brand_missing';end if;
 perform public.marketing_planner_read(org,'2026-11-01',brand);
 -- A disposable conversation and draft are rolled back with every test write.
 insert into feedx_integrations.native_assistant_sessions(user_id) values(who) returning id into sid;
 begin
 perform public.native_assistant_action('preview',jsonb_build_object('session_id',sid,'operation','prepare_marketing_draft','arguments',jsonb_build_object('organization_id',org,'brand_id',brand,'title','QA rollback only','caption','Isolated test; never published')));
 raise exception 'disabled_action_was_allowed';
 exception when insufficient_privilege then null;end;
 update feedx_integrations.native_assistant_config set capability_connections=jsonb_set(capability_connections,'{prepare_marketing_draft}','true'),ai_action_authorizations='{"prepare_marketing_draft":true}';
 preview:=public.native_assistant_action('preview',jsonb_build_object('session_id',sid,'operation','prepare_marketing_draft','arguments',jsonb_build_object('organization_id',org,'brand_id',brand,'title','QA rollback only','caption','Isolated test; never published')));
 intent:=(preview->>'intent_id')::uuid;
 select fingerprint into fp from feedx_integrations.native_assistant_action_intents where id=intent;
 begin
 perform public.native_assistant_action('confirm',jsonb_build_object('intent_id',intent,'fingerprint',repeat('0',32)));
 raise exception 'wrong_fingerprint_allowed';
 exception when raise_exception then if sqlerrm<>'action_changed' then raise;end if;end;
 update feedx_integrations.native_assistant_action_intents set expires_at=now()-interval '1 second' where id=intent;
 begin
 perform public.native_assistant_action('confirm',jsonb_build_object('intent_id',intent,'fingerprint',fp));
 raise exception 'expired_allowed';
 exception when raise_exception then if sqlerrm<>'action_expired_or_cancelled' then raise;end if;end;
 update feedx_integrations.native_assistant_action_intents set expires_at=now()+interval '10 minutes' where id=intent;
 perform public.native_assistant_action('cancel',jsonb_build_object('intent_id',intent));
 begin
 perform public.native_assistant_action('confirm',jsonb_build_object('intent_id',intent,'fingerprint',fp));
 raise exception 'cancelled_allowed';
 exception when raise_exception then if sqlerrm<>'action_expired_or_cancelled' then raise;end if;end;
 -- Restore only the disposable rollback fixture to verify domain execution.
 update feedx_integrations.native_assistant_action_intents set state='preview' where id=intent;
 update feedx_integrations.native_assistant_config set capability_connections=jsonb_set(capability_connections,'{prepare_marketing_draft}','false');
 begin
 perform public.native_assistant_action('confirm',jsonb_build_object('intent_id',intent,'fingerprint',fp));
 raise exception 'disconnected_allowed';
 exception when insufficient_privilege then null;end;
 update feedx_integrations.native_assistant_config set capability_connections=jsonb_set(capability_connections,'{prepare_marketing_draft}','true');
 receipt:=public.native_assistant_action('confirm',jsonb_build_object('intent_id',intent,'fingerprint',fp));
 if receipt->>'state'<>'executed' then raise exception 'draft_not_created';end if;
 receipt:=public.native_assistant_action('confirm',jsonb_build_object('intent_id',intent,'fingerprint',fp));
 if receipt->>'replayed'<>'true' then raise exception 'duplicate_execution';end if;
end $test$;
select 'authorized financial/planner reads; disabled action denial; draft preview/confirm/idempotency passed; ALL writes rolled back' as result;
rollback;
