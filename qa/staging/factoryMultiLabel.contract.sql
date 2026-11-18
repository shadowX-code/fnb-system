-- All mutations below are simulated with a fixture bridge and rolled back.
do $$
declare
 actor uuid; p public.factory_productions; running public.factory_job_orders;
 sku_key text; template uuid; basis text; label_key text; draft jsonb; editor jsonb; base integer;
 payload jsonb; product jsonb; batch_label jsonb; carton jsonb; preview jsonb; original jsonb; raster jsonb;
 batch_key text:=gen_random_uuid()::text; carton_key text:=gen_random_uuid()::text;
 batch_request uuid:=gen_random_uuid(); batch_job uuid; carton_job uuid; claim uuid:=gen_random_uuid(); device uuid:=gen_random_uuid();
 batch_choice jsonb; carton_choice jsonb; denied boolean; checks integer:=0;
begin
 begin
  select e.auth_user_id into strict actor from public.employees e join public.roles r on r.id=e.role_id
   where r.name='owner' and lower(e.employment_status)='active' limit 1;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  select * into strict p from public.factory_productions p1 where p1.status='completed'
   and p1.actual_pack_qty between 2 and 10000 and p1.expiry_date>=p1.manufacturing_date and nullif(btrim(p1.batch_no),'') is not null
   and not exists(select 1 from public.factory_label_snapshots s where s.production_id=p1.id)
   order by p1.created_at desc limit 1;
  select * into strict running from public.factory_job_orders where status='in_progress' and finished_good_id is not null limit 1;
  select id into strict template from public.factory_label_templates where template_key='s08-sambal' order by version desc limit 1;
  sku_key:=p.finished_good_id::text;
  payload:=jsonb_build_object('template_id',template,'width_mm',80,'height_mm',90,'net_weight','1 kg',
   'storage_instructions','Freezer','expiry_rule','production','content',jsonb_build_object('product_name','Test label'));
  editor:=public.factory_label_editor('product',sku_key);
  base:=coalesce((editor->'published'->>'version')::integer,0);
  draft:=public.factory_label_save_draft('product',sku_key,payload,coalesce((editor->'draft'->>'revision')::integer,0),base,gen_random_uuid());
  perform public.factory_label_publish((draft->>'id')::uuid,(draft->>'revision')::integer,gen_random_uuid(),'QA default product label',true);
  for label_key,basis in select * from (values (batch_key,'batch'),(carton_key,'verified_cartons')) b loop
   draft:=public.factory_label_save_draft('product',sku_key||':'||label_key,
    payload||jsonb_build_object('label_name',initcap(basis),'quantity_basis',basis),0,0,gen_random_uuid());
   assert jsonb_array_length(public.factory_label_context(p.job_order_id,p.id)->'labels') = (case when basis='batch' then 1 else 2 end),
    'A draft is not operationally selectable';checks:=checks+1;
   perform public.factory_label_publish((draft->>'id')::uuid,1,gen_random_uuid(),'QA additional label',true);
   editor:=public.factory_label_editor('product',sku_key||':'||label_key);
   assert (editor->'published'->>'version')::integer=1 and jsonb_array_length(editor->'history')=1,'Version history crossed label keys';
   checks:=checks+1;
  end loop;
  assert (public.factory_label_editor('product',sku_key)->'published'->>'version')::int=base+1,'Additional labels modified the default version';
  assert jsonb_array_length(public.factory_label_context(p.job_order_id,p.id)->'labels')=3,'Completed batch does not offer three active labels';
  checks:=checks+2;

  if running.finished_good_id<>p.finished_good_id then
   draft:=public.factory_label_save_draft('product',running.finished_good_id::text||':'||batch_key,
    payload||jsonb_build_object('label_name','QA Batch','quantity_basis','batch'),0,0,gen_random_uuid());
   perform public.factory_label_publish((draft->>'id')::uuid,1,gen_random_uuid(),'QA in-progress preview',true);
  end if;
  batch_choice:=jsonb_build_object('label_key',batch_key);
  preview:=public.factory_label_context(running.id,null,batch_choice);
  assert preview->>'preview_only'='true' and preview->'candidate'->'definition' is not null
   and preview->'candidate'->>'quantity_limit' is null,'In-progress preview became printable or has no layout';
  checks:=checks+1;
  perform public.factory_label_device(device,'QA simulated bridge','No physical printer','spooler','Ready','[]');
  denied:=false;begin
   perform public.factory_label_enqueue(gen_random_uuid(),null,device,1,preview->'candidate','{}',batch_choice);
  exception when others then denied:=sqlerrm='A completed Production batch is required.';end;
  assert denied,'An in-progress preview could enqueue';checks:=checks+1;

  product:=public.factory_label_candidate(p.id);
  original:=product - array['label_key','label_name','quantity_basis','quantity_limit','confirmed_cartons','preview_only'];
  insert into public.factory_label_snapshots(production_id,snapshot,created_by)
   values(p.id,original,(select id from public.employees where auth_user_id=actor limit 1));
  batch_label:=public.factory_label_candidate(p.id,batch_choice);
  assert batch_label->>'quantity_limit'='1' and (batch_label->>'packaged_units')::numeric=p.actual_pack_qty,'Batch quantity or evidence is wrong';
  assert public.factory_label_candidate(p.id)=original,'Historical default snapshot JSON was changed';
  checks:=checks+2;

  carton_choice:=jsonb_build_object('label_key',carton_key);
  carton:=public.factory_label_candidate(p.id,carton_choice);
  assert (carton->'missing') ? 'confirmed_cartons' and carton->>'quantity_limit' is null,'Carton quantity was inferred';
  denied:=false;begin
   perform public.factory_label_enqueue(gen_random_uuid(),p.id,device,1,carton,'{}',carton_choice);
  exception when others then denied:=sqlerrm='Confirm missing label information before printing.';end;
  assert denied,'Unverified cartons could enqueue';checks:=checks+2;
  carton_choice:=carton_choice||jsonb_build_object('confirmed',true,'confirmed_cartons',2,'reason','Checked actual packaging evidence');
  carton:=public.factory_label_candidate(p.id,carton_choice);
  assert carton->>'quantity_limit'='2' and carton->>'batch_no'=p.batch_no,'Carton count or batch provenance is wrong';checks:=checks+1;
  raster:=jsonb_build_object('format','mono1','width',639,'height',719,
   'data',encode(decode(repeat('00',80*719),'hex'),'base64'));
  batch_job:=public.factory_label_enqueue(batch_request,p.id,device,1,batch_label,raster,batch_choice);
  assert public.factory_label_enqueue(batch_request,p.id,device,1,batch_label,raster,batch_choice)=batch_job,'Retry duplicated the batch label';checks:=checks+1;
  denied:=false;begin
   perform public.factory_label_enqueue(gen_random_uuid(),p.id,device,1,batch_label,raster,batch_choice);
  exception when others then denied:=sqlerrm like 'Label quantity exceeds%';end;
  assert denied,'Batch allocation did not enforce the one-label rule';checks:=checks+1;
  carton_job:=public.factory_label_enqueue(gen_random_uuid(),p.id,device,2,carton,raster,carton_choice);
  assert (select count(*)=3 from public.factory_label_snapshots where production_id=p.id),'Snapshots did not remain separate';
  assert (public.factory_label_context(p.job_order_id,p.id,batch_choice)->>'allocated')::int=1
   and (public.factory_label_context(p.job_order_id,p.id,carton_choice)->>'allocated')::int=2,'Allocations leaked between labels';
  assert public.factory_label_context(p.job_order_id,p.id,batch_choice)->'history'->0->>'id'=batch_job::text
   and public.factory_label_context(p.job_order_id,p.id,carton_choice)->'history'->0->>'id'=carton_job::text,'History leaked between labels';
  checks:=checks+3;
  perform public.factory_label_resolve(batch_job,'Failed','QA cancelled before bridge pickup',null::integer);
  denied:=false;begin
   perform public.factory_label_enqueue(gen_random_uuid(),p.id,device,1,carton,null,carton_choice,batch_job,'QA foreign label source');
  exception when others then denied:=sqlerrm='Original print belongs to another batch or label.';end;
  assert denied,'Cross-label reprint accepted';checks:=checks+1;
  perform public.factory_label_enqueue(gen_random_uuid(),p.id,device,1,batch_label,null,batch_choice,batch_job,'QA controlled reprint');
  assert (public.factory_label_context(p.job_order_id,p.id,batch_choice)->>'history_total')::int=2,'Controlled reprint missing';
  assert public.factory_label_candidate(p.id,carton_choice-'confirmed_cartons')=carton,'Frozen carton quantity or inputs were modified';
  checks:=checks+2;
  assert not has_function_privilege('authenticated','public.factory_label_save_configuration(text,uuid,jsonb,integer,uuid)','EXECUTE')
   and not has_function_privilege('authenticated','public.factory_label_selected_candidate(uuid,jsonb,text,uuid)','EXECUTE'),'Private authorities exposed';
  checks:=checks+1;
  raise exception using errcode='FX001',message='Rollback label fixtures';
 exception when sqlstate 'FX001' then null;
 end;
 perform set_config('feedx.multi_label_qa',jsonb_build_object('checks',checks,'fixtures_rolled_back',true)::text,true);
end $$;
select current_setting('feedx.multi_label_qa')::jsonb as multi_label_qa;
