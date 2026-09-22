-- Avoid a PL/pgSQL variable/record-field ambiguity when iterating jsonb_each.
create or replace function public.crew_cash_count_denominations(p_counts jsonb)
returns numeric language plpgsql immutable security definer set search_path=public as $$
declare total numeric:=0; item record; denomination_value numeric;
begin
 if p_counts is null or jsonb_typeof(p_counts)<>'object' then raise exception using errcode='22023',message='Denomination counts must be an object.'; end if;
 if exists(select 1 from jsonb_object_keys(p_counts) k where k<>all(array['100','50','20','10','5','1','0.50','0.20','0.10','0.05'])) then
  raise exception using errcode='22023',message='Denomination counts contain an unsupported MYR value.';
 end if;
 for item in select entry.key,entry.value #>> '{}' as qty from jsonb_each(p_counts) as entry(key,value) loop
  if item.qty is null or item.qty!~'^\d+$' or item.qty::numeric>100000 then raise exception using errcode='22023',message='Each denomination quantity must be a non-negative whole number.'; end if;
  denomination_value:=item.key::numeric;
  total:=total+(denomination_value*item.qty::numeric);
 end loop;
 return round(total,2);
end; $$;

revoke all on function public.crew_cash_count_denominations(jsonb) from public,anon,authenticated;
