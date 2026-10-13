-- Descriptive Finished Good family metadata; never inventory/SKU authority.
create table public.factory_finished_good_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 60 and name = btrim(name)),
  status text not null default 'active' check (status in ('active','archived')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index factory_finished_good_tags_name on public.factory_finished_good_tags(lower(name));
create table public.factory_product_family_tags (
  product_family_id uuid not null references public.factory_product_families(id) on delete restrict,
  tag_id uuid not null references public.factory_finished_good_tags(id) on delete restrict,
  primary key (product_family_id,tag_id)
);
create index factory_product_family_tags_tag on public.factory_product_family_tags(tag_id);
alter table public.factory_finished_good_tags enable row level security;
alter table public.factory_product_family_tags enable row level security;
create policy factory_finished_good_tags_read on public.factory_finished_good_tags for select to authenticated
  using ((select public.current_user_has_permission('factory_finished_goods.view')));
create policy factory_product_family_tags_read on public.factory_product_family_tags for select to authenticated
  using ((select public.current_user_has_permission('factory_finished_goods.view')));
revoke all on public.factory_finished_good_tags,public.factory_product_family_tags from anon,authenticated;
grant select on public.factory_finished_good_tags,public.factory_product_family_tags to authenticated;

create function public.factory_get_finished_good_tags() returns jsonb
language plpgsql stable security invoker set search_path = public,pg_temp as $$
begin
  if auth.uid() is null or not public.current_user_has_permission('factory_finished_goods.view') then
    raise exception using errcode='42501',message='Missing Finished Goods view permission.';
  end if;
  return jsonb_build_object(
    'tags',coalesce((select jsonb_agg(to_jsonb(t) order by t.name) from (
      select id,name,status,(select count(*) from public.factory_product_family_tags a where a.tag_id=g.id) as usage_count
      from public.factory_finished_good_tags g
    ) t),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(to_jsonb(a)) from public.factory_product_family_tags a),'[]'::jsonb)
  );
end;
$$;

create function public.factory_save_finished_good_tag(p_id uuid,p_name text,p_status text) returns uuid
language plpgsql security definer set search_path = public,pg_temp as $$
declare v_id uuid; v_name text := regexp_replace(btrim(p_name),'\s+',' ','g'); v_before jsonb; v_after jsonb;
begin
  if auth.uid() is null or not (public.current_user_has_permission('factory_finished_goods.edit')
    or (p_id is null and public.current_user_has_permission('factory_finished_goods.create'))) then
    raise exception using errcode='42501',message='Missing Finished Goods tag management permission.';
  end if;
  if v_name is null or length(v_name) not between 1 and 60 or p_status is null or p_status not in ('active','archived') then
    raise exception using errcode='22023',message='Enter a tag name up to 60 characters and a valid status.';
  end if;
  if p_id is null then
    insert into public.factory_finished_good_tags(name,status,created_by) values(v_name,p_status,auth.uid()) returning id into v_id;
  else
    select to_jsonb(t) into v_before from public.factory_finished_good_tags t where id=p_id for update;
    if not found then raise exception 'Tag no longer exists.'; end if;
    if v_before->>'name'=v_name and v_before->>'status'=p_status then return p_id; end if;
    update public.factory_finished_good_tags set name=v_name,status=p_status,updated_at=now() where id=p_id returning id into v_id;
  end if;
  select to_jsonb(t) into v_after from public.factory_finished_good_tags t where id=v_id;
  insert into public.audit_logs(action,module,user_id,user_name,description,metadata)
    values('factory_finished_good_tag_saved','factory',auth.uid(),public.factory_current_active_employee_name(),
      'Finished Good descriptive tag saved.',jsonb_build_object('tag_id',v_id,'before',v_before,'after',v_after));
  return v_id;
exception when unique_violation then raise exception using errcode='22023',message='A tag with this name already exists.';
end;
$$;

create function public.factory_set_product_family_tags(p_family_id uuid,p_tag_ids uuid[]) returns void
language plpgsql security definer set search_path = public,pg_temp as $$
declare v_ids uuid[]; v_before uuid[];
begin
  if auth.uid() is null or not public.current_user_has_permission('factory_finished_goods.edit') then
    raise exception using errcode='42501',message='Missing Finished Goods edit permission.';
  end if;
  select coalesce(array_agg(distinct id order by id),'{}'::uuid[]) into v_ids from unnest(coalesce(p_tag_ids,'{}'::uuid[])) id;
  if cardinality(v_ids)>20 or array_position(v_ids,null) is not null then raise exception 'Select up to 20 valid tags.'; end if;
  perform 1 from public.factory_product_families where id=p_family_id for update;
  if not found then raise exception 'Finished Good no longer exists.'; end if;
  perform 1 from public.factory_finished_good_tags where id=any(v_ids) order by id for update;
  if (select count(*) from public.factory_finished_good_tags where id=any(v_ids))<>cardinality(v_ids) then raise exception 'A selected tag no longer exists.'; end if;
  select coalesce(array_agg(tag_id order by tag_id),'{}'::uuid[]) into v_before from public.factory_product_family_tags where product_family_id=p_family_id;
  if exists(select 1 from public.factory_finished_good_tags where id=any(v_ids) and status='archived' and not(id=any(v_before))) then
    raise exception 'Archived tags cannot be newly assigned.';
  end if;
  if v_before=v_ids then return; end if;
  delete from public.factory_product_family_tags where product_family_id=p_family_id and not(tag_id=any(v_ids));
  insert into public.factory_product_family_tags(product_family_id,tag_id)
    select p_family_id,id from unnest(v_ids) id on conflict do nothing;
  insert into public.audit_logs(action,module,user_id,user_name,description,metadata)
    values('factory_finished_good_tags_assigned','factory',auth.uid(),public.factory_current_active_employee_name(),
      'Finished Good descriptive tag assignments updated.',jsonb_build_object('product_family_id',p_family_id,'before',v_before,'after',v_ids));
end;
$$;
revoke all on function public.factory_get_finished_good_tags(),public.factory_save_finished_good_tag(uuid,text,text),public.factory_set_product_family_tags(uuid,uuid[]) from public,anon;
grant execute on function public.factory_get_finished_good_tags(),public.factory_save_finished_good_tag(uuid,text,text),public.factory_set_product_family_tags(uuid,uuid[]) to authenticated;
