-- Optional feedback/details; task blocking remains independent from creative status.
alter table public.marketing_creative_tasks drop constraint marketing_creative_tasks_check;
do $$declare body text;begin
 body:=pg_get_functiondef('public.marketing_planner_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure);
 if position('Describe the changes needed.' in body)=0 or position($old$when 'save' then 'edit'$old$ in body)=0 then raise exception 'Planner command contract changed.';end if;
 body:=replace(body,$old$  if p_action='request_revision' and length(trim(coalesce(p_payload->>'feedback','')))=0 then raise exception 'Describe the changes needed.';end if;
$old$,'');
 body:=replace(body,$old$when 'save' then 'edit'$old$,$new$when 'save' then 'edit' when 'block' then 'edit'$new$);
 body:=replace(body,$old$if p_action in ('save','transition','approve','request_revision','delete','handoff') then$old$,$new$if p_action in ('save','block','transition','approve','request_revision','delete','handoff') then$new$);
 body:=replace(body,$old$ elsif p_action='transition' then$old$,$new$ elsif p_action='block' then
  if jsonb_typeof(p_payload->'blocked') is distinct from 'boolean' or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('month','blocked','blocker_reason','blocker_owner')) then raise exception 'Provide only task blocking details.';end if;
  t.blocked:=(p_payload->>'blocked')::boolean;
  t.blocker_reason:=case when t.blocked then coalesce(p_payload->>'blocker_reason',t.blocker_reason) else '' end;
  t.blocker_owner:=case when not t.blocked then null when p_payload?'blocker_owner' then nullif(p_payload->>'blocker_owner','')::uuid else t.blocker_owner end;
  if length(t.blocker_reason)>2000 or not marketing_private.creative_assignee_allowed(p_org,p_brand,t.blocker_owner) then raise exception 'Choose an authorized brand team member and a reason of at most 2000 characters.';end if;
  update public.marketing_creative_tasks set blocked=t.blocked,blocker_reason=t.blocker_reason,blocker_owner=t.blocker_owner,
   approved_revision=case when approved_revision=revision then revision+1 else approved_revision end,
   revision=revision+1,updated_by=actor,updated_at=now() where id=t.id returning * into t;
 elsif p_action='transition' then$new$);
 body:=replace(body,$old$if t.status<>'completed' or t.approved_revision is distinct from t.revision then$old$,$new$if t.status<>'completed' or t.approved_revision is distinct from t.revision or t.blocked then$new$);
 if position($old$elsif p_action='block'$old$ in body)=0 or position('Describe the changes needed.' in body)>0 then raise exception 'Planner patch did not match.';end if;
 execute body;
end;$$;
