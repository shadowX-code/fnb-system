-- Legal Entities already have canonical People permissions and storage. This
-- migration only extends the existing read contract for the standalone People
-- master-data page; it never changes employee assignments or history.
create or replace function public.legal_entity_list()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_rows jsonb;
begin
  if not public.current_user_has_permission('legal_entities.view') then
    raise exception using errcode='42501',message='Missing permission to view legal entities.';
  end if;

  select coalesce(jsonb_agg(row_data order by is_active desc,entity_name),'[]'::jsonb)
  into v_rows
  from (
    select
      to_jsonb(le) || jsonb_build_object(
        'linked_employee_count', count(e.id),
        'active_linked_employee_count', count(e.id) filter (where e.employment_status='active')
      ) as row_data,
      le.is_active,
      coalesce(le.display_name,le.legal_company_name) as entity_name
    from public.legal_entities le
    left join public.employees e on e.legal_entity_id=le.id
    group by le.id
  ) legal_entities;

  return v_rows;
end; $$;

revoke all on function public.legal_entity_list() from public,anon;
grant execute on function public.legal_entity_list() to authenticated;
