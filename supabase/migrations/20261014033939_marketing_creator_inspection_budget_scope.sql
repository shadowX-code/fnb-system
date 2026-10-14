-- Keep usage in its tenant instead of moving a member's counter when they switch tenants.
alter table marketing_private.creator_inspection_meter drop constraint creator_inspection_meter_pkey,
 add constraint creator_inspection_meter_pkey primary key(actor,organization_id);
do $$declare body text;begin
 body:=pg_get_functiondef('public.marketing_creator_inspection_access(uuid,uuid,boolean,uuid)'::regprocedure);
 if position('where creator_inspection_meter.actor=actor for update' in body)=0 then raise exception 'Inspection meter contract changed.';end if;
 body:=replace(body,'perform pg_advisory_xact_lock(hashtextextended(''creator-inspect:''||p_org,0));',
 'perform pg_advisory_xact_lock(hashtextextended(''creator-inspect-actor:''||actor,0));perform pg_advisory_xact_lock(hashtextextended(''creator-inspect:''||p_org,0));');
 body:=replace(body,'where creator_inspection_meter.actor=actor for update','where creator_inspection_meter.actor=actor and organization_id=p_org for update');
 body:=replace(body,'if v.lease_until>clock_timestamp() then','if exists(select 1 from marketing_private.creator_inspection_meter where creator_inspection_meter.actor=actor and lease_until>clock_timestamp()) then');
 body:=replace(body,'(v.day=current_date and v.requests>=30)','(select coalesce(sum(requests),0) from marketing_private.creator_inspection_meter where creator_inspection_meter.actor=actor and day=current_date)>=30');
 execute body;
end;$$;
