-- Canonical Staging-only authenticated rollback rehearsal. No business rows persist.
begin;
select set_config('request.jwt.claims','{"sub":"b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd","role":"authenticated"}',true);
create temporary table qa_customer_scope(org uuid,brand uuid);
do $$declare o uuid:=gen_random_uuid();b uuid:=gen_random_uuid();begin
 insert into public.organizations(id,name) values(o,'Disposable CRM optional-name rehearsal');
 insert into public.brands(id,organization_id,name) values(b,o,'Disposable CRM Brand');
 insert into public.organization_memberships values(o,(select id from public.employees where auth_user_id=auth.uid()));
 insert into qa_customer_scope values(o,b);
end;$$;
grant select on qa_customer_scope to authenticated;
set local role authenticated;
do $$declare o uuid:=(select org from qa_customer_scope);b uuid:=(select brand from qa_customer_scope);cid uuid;v jsonb;r jsonb;request uuid:=gen_random_uuid();payload jsonb;input jsonb:='[{"phone":"0199877665","email":"qa@example.invalid","gender":"other","birthday":"2000-01-01","total_visit":"0","avg_spent":"0","total_spent":"0","_source":"Disposable POS","_snapshot_date":"2026-10-13"}]';denied boolean:=false;begin
 perform public.platform_customer_import_job(o,b,'mapping_save',null,'{"source":"Disposable POS","headers":["Phone"],"mapping":{"phone":"Phone","name":""}}');
 v:=public.platform_customer_import_preview(o,b,input);if v->'rows'->0->>'classification'<>'new' or v->'rows'->0->'values' ? 'name' then raise exception 'Phone-only preview failed';end if;
 r:=public.platform_customer_import_commit(request,o,b,input,'{"1":{"selected":true,"snapshot":"new","fields":[]}}');if r->'rows'->0->>'status'<>'created' then raise exception 'Phone-only import failed: %',r;end if;
 if r<>public.platform_customer_import_commit(request,o,b,input,'{"1":{"selected":true,"snapshot":"new","fields":[]}}') then raise exception 'Retry changed';end if;
 v:=public.marketing_customers_read(o,b);cid:=(v->'customers'->0->>'id')::uuid;
 if v->'customers'->0->'display_name'<>'null' or v->'customers'->0->>'email'<>'qa@example.invalid' or v->'customers'->0->'pos_snapshot'->'metrics'->>'total_visit'<>'0' or v->'summary'->>'not_subscribed'<>'1' then raise exception 'Read/provenance/consent failed';end if;
 if public.platform_customer_import_preview(o,b,input)->'rows'->0->>'classification'<>'unchanged' then raise exception 'Repeat import wrote again';end if;
 payload:=jsonb_build_object('customer_id',cid,'name','Named QA','phone','0199877665','edit',true,'confirm_name',true,'revision',v->'customers'->0->'revision','snapshot',v->'customers'->0->>'snapshot','email','','gender','','birthday','');
 perform public.platform_customer_command(gen_random_uuid(),o,b,payload);
 v:=public.marketing_customers_read(o,b);
 if v->'customers'->0->'email'<>'null' or v->'customers'->0->'gender'<>'null' or v->'customers'->0->'birthday'<>'null' then raise exception 'Manual clearing failed';end if;
 v:=public.platform_customer_import_preview(o,b,'[{"phone":"0199877665","name":" "}]');
 if v->'rows'->0->>'classification'<>'unchanged' or v->'rows'->0->'differences' ? 'name' then raise exception 'Blank import erased name';end if;
 v:=public.marketing_customers_read(o,b);payload:=payload||jsonb_build_object('name','','revision',v->'customers'->0->'revision','snapshot',v->'customers'->0->>'snapshot');perform public.platform_customer_command(gen_random_uuid(),o,b,payload);
 if public.marketing_customers_read(o,b)->'customers'->0->'display_name'<>'null' then raise exception 'Manual absent name failed';end if;
 begin perform public.platform_customer_command(gen_random_uuid(),o,b,jsonb_build_object('phone','0199877665'));exception when raise_exception then denied:=true;end;if not denied then raise exception 'Duplicate identity allowed';end if;
 if public.platform_customer_import_preview(o,b,'[{"phone":"bad"}]')->'rows'->0->>'classification'<>'invalid' then raise exception 'Invalid phone accepted';end if;
end;$$;
rollback;
select 'PASS: optional-name import/manual edit, retry, blank preservation, POS provenance, consent and duplicate guards; all fixtures rolled back' result;
