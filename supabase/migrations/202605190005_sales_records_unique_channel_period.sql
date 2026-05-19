-- Month Closing sales channel count repair.
-- Ensures one sales row per outlet/month/year/channel_id and removes older
-- duplicates before enforcing the database uniqueness rule.

do $$
declare
  duplicate_groups integer := 0;
  duplicate_rows integer := 0;
begin
  if to_regclass('public.sales_records') is null then
    raise notice 'sales_records table does not exist; skipping sales record uniqueness repair.';
    return;
  end if;

  select count(*)
  into duplicate_groups
  from (
    select outlet_id, year, month, channel_id
    from public.sales_records
    where outlet_id is not null
      and year is not null
      and month is not null
      and channel_id is not null
    group by outlet_id, year, month, channel_id
    having count(*) > 1
  ) duplicated;

  with ranked as (
    select
      id,
      row_number() over (
        partition by outlet_id, year, month, channel_id
        order by
          coalesce(updated_at, created_at, 'epoch'::timestamptz) desc,
          created_at desc nulls last,
          id desc
      ) as row_rank
    from public.sales_records
    where outlet_id is not null
      and year is not null
      and month is not null
      and channel_id is not null
  ),
  removed as (
    delete from public.sales_records records
    using ranked
    where records.id = ranked.id
      and ranked.row_rank > 1
    returning records.id
  )
  select count(*) into duplicate_rows from removed;

  raise notice 'sales_records duplicate groups found: %, duplicate rows cleaned: %', duplicate_groups, duplicate_rows;
end $$;

do $$
begin
  if to_regclass('public.sales_records') is null then
    return;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'sales_records_unique_channel_period'
      and conrelid = 'public.sales_records'::regclass
  ) then
    alter table public.sales_records
      add constraint sales_records_unique_channel_period
      unique (outlet_id, year, month, channel_id);
  end if;
end $$;
