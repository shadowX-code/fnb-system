-- Shift template display ordering for Duty Roster settings.

alter table public.shift_templates
  add column if not exists sort_order integer not null default 0;

with ranked as (
  select
    id,
    row_number() over (
      partition by outlet_id
      order by
        case code
          when 'MORNING' then 1
          when 'MID' then 2
          when 'CLOSING' then 3
          when 'FULL' then 4
          when 'OFF' then 5
          when 'AL' then 6
          when 'MC' then 7
          else 99
        end,
        name
    ) as next_order
  from public.shift_templates
  where sort_order = 0
)
update public.shift_templates template
set sort_order = ranked.next_order
from ranked
where template.id = ranked.id;

create index if not exists shift_templates_outlet_sort_order_idx
on public.shift_templates (outlet_id, sort_order);
