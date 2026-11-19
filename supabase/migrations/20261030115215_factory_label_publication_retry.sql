-- Fingerprint final approval intent for retry-safe publishing.
alter table public.factory_label_drafts add column publish_request_hash text;
create or replace function public.factory_label_publish(p_draft uuid,p_revision integer,p_request_id uuid,p_approval_note text,p_content_approved boolean) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=public.factory_label_actor('factory_finished_goods.edit'); d public.factory_label_drafts; latest integer; published jsonb; v_published_id uuid; definition jsonb; request_hash text:=md5(jsonb_build_object('revision',p_revision,'approval_note',p_approval_note,'approved',p_content_approved)::text);
begin
 if p_request_id is null or p_content_approved is distinct from true or length(btrim(coalesce(p_approval_note,''))) not between 3 and 1000 then raise exception 'Review the preview and confirm label approval with a reason.'; end if;
 select * into d from public.factory_label_drafts where factory_label_drafts.id=p_draft for update;
 if not found then raise exception 'Save the label draft before publishing.'; end if;
 if d.state='published' and d.publish_request_id=p_request_id then
  if d.publish_request_hash is distinct from request_hash or d.updated_by<>actor then raise exception 'Publication request already used with different approval details.'; end if;
  return to_jsonb(d);
 end if;
 if d.state<>'draft' or d.revision is distinct from p_revision then raise exception 'Draft changed. Review the latest version.'; end if;
 if d.kind='product' then
  published:=public.factory_label_save_config(d.entity_key::uuid,d.payload||jsonb_build_object('content_approved',true,'approval_note',p_approval_note),d.base_version,p_request_id);
  v_published_id:=(published->>'id')::uuid;
 else
  perform pg_advisory_xact_lock(hashtextextended('label-template:'||d.entity_key,0));
  select coalesce(max(version),0) into latest from public.factory_label_templates where template_key=d.entity_key;
  if latest<>d.base_version then raise exception 'Template version changed. Reload before publishing.'; end if;
  definition:=d.payload->'definition';
  perform public.factory_label_validate_layout(definition,(d.payload->>'width_mm')::numeric,(d.payload->>'height_mm')::numeric);
  if length(btrim(coalesce(d.payload->>'name',''))) not between 1 and 120 then raise exception 'A template name is required.'; end if;
  insert into public.factory_label_templates(template_key,version,name,definition,created_by)
  values(d.entity_key,latest+1,btrim(d.payload->>'name'),definition||jsonb_build_object('width_mm',(d.payload->>'width_mm')::numeric,'height_mm',(d.payload->>'height_mm')::numeric),actor) returning factory_label_templates.id into v_published_id;
 end if;
 update public.factory_label_drafts set state='published',published_id=v_published_id,publish_request_id=p_request_id,publish_request_hash=request_hash,updated_by=actor,updated_at=now() where factory_label_drafts.id=p_draft returning * into d;
 insert into public.factory_label_management_events(entity_key,action,detail,actor) values(d.entity_key,'published',jsonb_build_object('kind',d.kind,'draft_id',d.id,'revision',d.revision,'published_id',v_published_id,'approval_note',p_approval_note),actor);
 return to_jsonb(d);
end $$;
