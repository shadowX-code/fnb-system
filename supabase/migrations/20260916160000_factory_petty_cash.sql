-- Factory Petty Cash: physical-cash ledger only. Posted entries are immutable;
-- balance is always derived from posted signed ledger rows.

insert into public.permissions (code, module, description)
values
  ('factory_petty_cash.view', 'Factory Petty Cash', 'View Factory Petty Cash.'),
  ('factory_petty_cash.create', 'Factory Petty Cash', 'Create, edit and delete Factory Petty Cash drafts.'),
  ('factory_petty_cash.post', 'Factory Petty Cash', 'Post Factory Petty Cash drafts.'),
  ('factory_petty_cash.adjust', 'Factory Petty Cash', 'Create Factory Petty Cash adjustments.'),
  ('factory_petty_cash.reverse', 'Factory Petty Cash', 'Reverse posted Factory Petty Cash transactions.'),
  ('factory_petty_cash.manage', 'Factory Petty Cash', 'Manage Factory Petty Cash categories.'),
  ('factory_petty_cash.export', 'Factory Petty Cash', 'Export Factory Petty Cash records.')
on conflict (code) do update
set module = excluded.module,
    description = excluded.description;

insert into public.role_permissions(role_id, permission_id)
select role.id, permission.id
from public.roles role
join public.permissions permission on permission.code like 'factory_petty_cash.%'
where lower(role.name) in ('owner', 'admin')
on conflict do nothing;

create table public.factory_petty_cash_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  description text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  sort_order integer not null default 0,
  created_by uuid references public.employees(id) on delete restrict,
  updated_by uuid references public.employees(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.factory_petty_cash_daily_sequences (
  business_date date primary key,
  last_number integer not null check (last_number > 0),
  updated_at timestamptz not null default now()
);

create table public.factory_petty_cash_transactions (
  id uuid primary key default gen_random_uuid(),
  reference_no text not null unique,
  transaction_type text not null check (transaction_type in ('cash_in', 'expense', 'adjustment')),
  adjustment_direction text check (
    (transaction_type = 'adjustment' and adjustment_direction in ('increase', 'decrease'))
    or (transaction_type <> 'adjustment' and adjustment_direction is null)
  ),
  amount numeric(14,2) not null check (amount > 0),
  category_id uuid references public.factory_petty_cash_categories(id) on delete restrict,
  transaction_date date not null,
  description text not null,
  party_name text,
  adjustment_reason text,
  notes text,
  receipt_path text,
  receipt_filename text,
  receipt_mime_type text check (receipt_mime_type is null or receipt_mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  receipt_size_bytes bigint check (receipt_size_bytes is null or (receipt_size_bytes > 0 and receipt_size_bytes <= 10485760)),
  status text not null default 'draft' check (status in ('draft', 'posted')),
  reversal_of_id uuid references public.factory_petty_cash_transactions(id) on delete restrict,
  reversed_by_id uuid references public.factory_petty_cash_transactions(id) on delete restrict,
  created_by uuid not null references public.employees(id) on delete restrict,
  updated_by uuid not null references public.employees(id) on delete restrict,
  posted_by uuid references public.employees(id) on delete restrict,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (transaction_type <> 'expense' or category_id is not null),
  check (transaction_type <> 'adjustment' or nullif(btrim(adjustment_reason), '') is not null),
  check (reversal_of_id is null or status = 'posted'),
  check ((status = 'posted' and posted_by is not null and posted_at is not null) or status = 'draft')
);

create unique index factory_petty_cash_one_reversal_idx
on public.factory_petty_cash_transactions(reversal_of_id)
where reversal_of_id is not null;

create index factory_petty_cash_transactions_ledger_idx
on public.factory_petty_cash_transactions(status, transaction_date, created_at, id);
create index factory_petty_cash_transactions_category_idx
on public.factory_petty_cash_transactions(category_id, transaction_date desc);
create index factory_petty_cash_transactions_type_idx
on public.factory_petty_cash_transactions(transaction_type, transaction_date desc);

insert into public.factory_petty_cash_categories(code, name, sort_order)
values
  ('raw_material', 'Raw Material', 10),
  ('packaging', 'Packaging', 20),
  ('transport', 'Transport', 30),
  ('maintenance', 'Maintenance', 40),
  ('cleaning', 'Cleaning', 50),
  ('office', 'Office', 60),
  ('staff', 'Staff', 70),
  ('miscellaneous', 'Miscellaneous', 80)
on conflict (code) do nothing;

alter table public.factory_petty_cash_categories enable row level security;
alter table public.factory_petty_cash_daily_sequences enable row level security;
alter table public.factory_petty_cash_transactions enable row level security;

revoke all on table public.factory_petty_cash_categories from public, anon, authenticated;
revoke all on table public.factory_petty_cash_daily_sequences from public, anon, authenticated;
revoke all on table public.factory_petty_cash_transactions from public, anon, authenticated;
grant select on table public.factory_petty_cash_categories to authenticated;
grant select on table public.factory_petty_cash_transactions to authenticated;

create policy factory_petty_cash_categories_select
on public.factory_petty_cash_categories for select to authenticated
using (public.current_user_has_permission('factory_petty_cash.view'));

create policy factory_petty_cash_transactions_select
on public.factory_petty_cash_transactions for select to authenticated
using (public.current_user_has_permission('factory_petty_cash.view'));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'factory-petty-cash-receipts', 'factory-petty-cash-receipts', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "factory petty cash receipt viewers"
on storage.objects for select to authenticated
using (
  bucket_id = 'factory-petty-cash-receipts'
  and public.current_user_has_permission('factory_petty_cash.view')
);

create policy "factory petty cash receipt creators"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'factory-petty-cash-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.current_user_has_permission('factory_petty_cash.create')
);

create or replace function public.factory_petty_cash_signed_amount(
  p_type text,
  p_direction text,
  p_amount numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_type = 'cash_in' then abs(coalesce(p_amount, 0))
    when p_type = 'expense' then -abs(coalesce(p_amount, 0))
    when p_type = 'adjustment' and p_direction = 'increase' then abs(coalesce(p_amount, 0))
    when p_type = 'adjustment' and p_direction = 'decrease' then -abs(coalesce(p_amount, 0))
    else 0
  end;
$$;

create or replace function public.factory_next_petty_cash_reference()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_date date := (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
  v_sequence integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('factory_petty_cash:' || v_business_date::text, 0));
  insert into public.factory_petty_cash_daily_sequences(business_date, last_number)
  values (v_business_date, 1)
  on conflict (business_date) do update
  set last_number = public.factory_petty_cash_daily_sequences.last_number + 1,
      updated_at = clock_timestamp()
  returning last_number into v_sequence;
  return 'PC' || to_char(v_business_date, 'YYMMDD') || '-' || lpad(v_sequence::text, 2, '0');
end;
$$;

create or replace function public.factory_petty_cash_audit(
  p_action text,
  p_description text,
  p_transaction_id uuid,
  p_reference text,
  p_before jsonb default null,
  p_after jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs(action, module, user_id, user_name, description, metadata)
  values (
    p_action,
    'factory',
    auth.uid(),
    public.factory_current_active_employee_name(),
    p_description,
    jsonb_strip_nulls(jsonb_build_object(
      'target', p_reference,
      'entity', 'factory_petty_cash_transaction',
      'transaction_id', p_transaction_id,
      'before', p_before,
      'after', p_after
    ))
  );
end;
$$;

create or replace function public.factory_save_petty_cash_draft(p_transaction jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_transaction->>'id', '')::uuid;
  v_actor uuid := public.factory_current_active_employee_id();
  v_existing public.factory_petty_cash_transactions%rowtype;
  v_saved public.factory_petty_cash_transactions%rowtype;
  v_type text := lower(btrim(coalesce(p_transaction->>'transaction_type', '')));
  v_direction text := nullif(lower(btrim(coalesce(p_transaction->>'adjustment_direction', ''))), '');
  v_amount numeric := nullif(p_transaction->>'amount', '')::numeric;
  v_category_id uuid := nullif(p_transaction->>'category_id', '')::uuid;
  v_date date := nullif(p_transaction->>'transaction_date', '')::date;
  v_description text := btrim(coalesce(p_transaction->>'description', ''));
  v_party text := nullif(btrim(coalesce(p_transaction->>'party_name', '')), '');
  v_reason text := nullif(btrim(coalesce(p_transaction->>'adjustment_reason', '')), '');
  v_notes text := nullif(btrim(coalesce(p_transaction->>'notes', '')), '');
  v_receipt_path text := nullif(btrim(coalesce(p_transaction->>'receipt_path', '')), '');
  v_receipt_filename text := nullif(btrim(coalesce(p_transaction->>'receipt_filename', '')), '');
  v_receipt_mime text := nullif(lower(btrim(coalesce(p_transaction->>'receipt_mime_type', ''))), '');
  v_receipt_size bigint := nullif(p_transaction->>'receipt_size_bytes', '')::bigint;
begin
  if auth.uid() is null or not public.current_user_has_permission('factory_petty_cash.create') then
    raise exception using errcode = '42501', message = 'Petty Cash draft permission is required.';
  end if;
  if v_type not in ('cash_in', 'expense', 'adjustment') then
    raise exception using errcode = '22023', message = 'Select a valid Petty Cash transaction type.';
  end if;
  if v_type = 'adjustment' and not public.current_user_has_permission('factory_petty_cash.adjust') then
    raise exception using errcode = '42501', message = 'Petty Cash adjustment permission is required.';
  end if;
  if v_amount is null or v_amount <= 0 then raise exception using errcode = '22023', message = 'Amount must be greater than zero.'; end if;
  if v_date is null then raise exception using errcode = '22023', message = 'Transaction Date is required.'; end if;
  if v_description = '' then raise exception using errcode = '22023', message = 'Description is required.'; end if;
  if v_type = 'expense' and v_category_id is null then raise exception using errcode = '22023', message = 'Category is required for an Expense.'; end if;
  if v_type = 'adjustment' and (v_direction not in ('increase', 'decrease') or v_reason is null) then
    raise exception using errcode = '22023', message = 'Adjustment direction and reason are required.';
  end if;
  if v_type <> 'adjustment' then v_direction := null; v_reason := null; end if;
  if v_type <> 'expense' then v_category_id := null; end if;
  if v_category_id is not null and not exists (
    select 1 from public.factory_petty_cash_categories category where category.id = v_category_id and category.status = 'active'
  ) then raise exception using errcode = '22023', message = 'Select an active Expense Category.'; end if;
  if v_receipt_path is not null and not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'factory-petty-cash-receipts' and object.name = v_receipt_path
  ) then raise exception using errcode = '22023', message = 'The receipt upload did not complete.'; end if;

  if v_id is not null then
    select * into v_existing from public.factory_petty_cash_transactions where id = v_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'Petty Cash transaction was not found.'; end if;
    if v_existing.status <> 'draft' or v_existing.reversal_of_id is not null then
      raise exception using errcode = '22023', message = 'Posted Petty Cash transactions are immutable.';
    end if;
    update public.factory_petty_cash_transactions
    set transaction_type = v_type,
        adjustment_direction = v_direction,
        amount = round(v_amount, 2),
        category_id = v_category_id,
        transaction_date = v_date,
        description = v_description,
        party_name = v_party,
        adjustment_reason = v_reason,
        notes = v_notes,
        receipt_path = v_receipt_path,
        receipt_filename = v_receipt_filename,
        receipt_mime_type = v_receipt_mime,
        receipt_size_bytes = v_receipt_size,
        updated_by = v_actor,
        updated_at = clock_timestamp()
    where id = v_id
    returning * into v_saved;
    perform public.factory_petty_cash_audit('factory_petty_cash_draft_updated', 'Factory Petty Cash draft updated.', v_saved.id, v_saved.reference_no, to_jsonb(v_existing), to_jsonb(v_saved));
  else
    insert into public.factory_petty_cash_transactions(
      reference_no, transaction_type, adjustment_direction, amount, category_id, transaction_date,
      description, party_name, adjustment_reason, notes, receipt_path, receipt_filename,
      receipt_mime_type, receipt_size_bytes, created_by, updated_by
    ) values (
      public.factory_next_petty_cash_reference(), v_type, v_direction, round(v_amount, 2), v_category_id, v_date,
      v_description, v_party, v_reason, v_notes, v_receipt_path, v_receipt_filename,
      v_receipt_mime, v_receipt_size, v_actor, v_actor
    ) returning * into v_saved;
    perform public.factory_petty_cash_audit('factory_petty_cash_draft_created', 'Factory Petty Cash draft created.', v_saved.id, v_saved.reference_no, null, to_jsonb(v_saved));
  end if;
  return to_jsonb(v_saved);
end;
$$;

create or replace function public.factory_post_petty_cash_transaction(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.factory_current_active_employee_id();
  v_before public.factory_petty_cash_transactions%rowtype;
  v_saved public.factory_petty_cash_transactions%rowtype;
begin
  if auth.uid() is null or not public.current_user_has_permission('factory_petty_cash.post') then
    raise exception using errcode = '42501', message = 'Petty Cash posting permission is required.';
  end if;
  select * into v_before from public.factory_petty_cash_transactions where id = p_transaction_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Petty Cash transaction was not found.'; end if;
  if v_before.status <> 'draft' then raise exception using errcode = '22023', message = 'Only a Draft Petty Cash transaction can be posted.'; end if;
  if v_before.transaction_type = 'adjustment' and not public.current_user_has_permission('factory_petty_cash.adjust') then
    raise exception using errcode = '42501', message = 'Petty Cash adjustment permission is required.';
  end if;
  if v_before.transaction_type = 'expense' and not exists (
    select 1
    from public.factory_petty_cash_categories category
    where category.id = v_before.category_id
      and category.status = 'active'
  ) then
    raise exception using errcode = '22023', message = 'The Expense Category is inactive. Update the Draft before posting.';
  end if;
  update public.factory_petty_cash_transactions
  set status = 'posted', posted_by = v_actor, posted_at = clock_timestamp(), updated_by = v_actor, updated_at = clock_timestamp()
  where id = p_transaction_id
  returning * into v_saved;
  perform public.factory_petty_cash_audit('factory_petty_cash_posted', 'Factory Petty Cash transaction posted.', v_saved.id, v_saved.reference_no, to_jsonb(v_before), to_jsonb(v_saved));
  return to_jsonb(v_saved);
end;
$$;

create or replace function public.factory_delete_petty_cash_draft(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_existing public.factory_petty_cash_transactions%rowtype;
begin
  perform public.factory_current_active_employee_id();
  if auth.uid() is null or not public.current_user_has_permission('factory_petty_cash.create') then
    raise exception using errcode = '42501', message = 'Petty Cash draft permission is required.';
  end if;
  select * into v_existing from public.factory_petty_cash_transactions where id = p_transaction_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Petty Cash transaction was not found.'; end if;
  if v_existing.status <> 'draft' or v_existing.reversal_of_id is not null then
    raise exception using errcode = '22023', message = 'Only a Draft Petty Cash transaction can be deleted.';
  end if;
  delete from public.factory_petty_cash_transactions where id = p_transaction_id;
  perform public.factory_petty_cash_audit('factory_petty_cash_draft_deleted', 'Factory Petty Cash draft deleted.', v_existing.id, v_existing.reference_no, to_jsonb(v_existing), null);
  return jsonb_build_object('deleted', true, 'id', v_existing.id, 'reference_no', v_existing.reference_no);
end;
$$;

create or replace function public.factory_reverse_petty_cash_transaction(p_transaction_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.factory_current_active_employee_id();
  v_original public.factory_petty_cash_transactions%rowtype;
  v_reversal public.factory_petty_cash_transactions%rowtype;
  v_direction text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null or not public.current_user_has_permission('factory_petty_cash.reverse') then
    raise exception using errcode = '42501', message = 'Petty Cash reverse permission is required.';
  end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'A reversal reason is required.'; end if;
  select * into v_original from public.factory_petty_cash_transactions where id = p_transaction_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Petty Cash transaction was not found.'; end if;
  if v_original.status <> 'posted' or v_original.reversal_of_id is not null then
    raise exception using errcode = '22023', message = 'Only an original Posted transaction can be reversed.';
  end if;
  if v_original.reversed_by_id is not null or exists (select 1 from public.factory_petty_cash_transactions where reversal_of_id = v_original.id) then
    raise exception using errcode = '23505', message = 'This Petty Cash transaction has already been reversed.';
  end if;
  v_direction := case when public.factory_petty_cash_signed_amount(v_original.transaction_type, v_original.adjustment_direction, v_original.amount) > 0 then 'decrease' else 'increase' end;
  insert into public.factory_petty_cash_transactions(
    reference_no, transaction_type, adjustment_direction, amount, transaction_date, description,
    adjustment_reason, notes, status, reversal_of_id, created_by, updated_by, posted_by, posted_at
  ) values (
    public.factory_next_petty_cash_reference(), 'adjustment', v_direction, v_original.amount,
    (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date,
    'Reversal of ' || v_original.reference_no, v_reason, v_reason, 'posted', v_original.id,
    v_actor, v_actor, v_actor, clock_timestamp()
  ) returning * into v_reversal;
  update public.factory_petty_cash_transactions
  set reversed_by_id = v_reversal.id, updated_by = v_actor, updated_at = clock_timestamp()
  where id = v_original.id;
  perform public.factory_petty_cash_audit('factory_petty_cash_reversed', 'Factory Petty Cash transaction reversed.', v_reversal.id, v_reversal.reference_no, to_jsonb(v_original), to_jsonb(v_reversal));
  return to_jsonb(v_reversal);
end;
$$;

create or replace function public.factory_save_petty_cash_category(p_category jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.factory_current_active_employee_id();
  v_id uuid := nullif(p_category->>'id', '')::uuid;
  v_name text := btrim(coalesce(p_category->>'name', ''));
  v_code text := lower(regexp_replace(btrim(coalesce(p_category->>'code', '')), '[^a-zA-Z0-9]+', '_', 'g'));
  v_description text := nullif(btrim(coalesce(p_category->>'description', '')), '');
  v_status text := lower(btrim(coalesce(p_category->>'status', 'active')));
  v_row public.factory_petty_cash_categories%rowtype;
begin
  if auth.uid() is null or not public.current_user_has_permission('factory_petty_cash.manage') then
    raise exception using errcode = '42501', message = 'Petty Cash category management permission is required.';
  end if;
  if v_name = '' then raise exception using errcode = '22023', message = 'Category name is required.'; end if;
  if v_code = '' then v_code := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '_', 'g')); end if;
  if v_status not in ('active', 'inactive') then raise exception using errcode = '22023', message = 'Select a valid category status.'; end if;
  if v_id is null then
    insert into public.factory_petty_cash_categories(code, name, description, status, sort_order, created_by, updated_by)
    values (v_code, v_name, v_description, v_status, coalesce((select max(sort_order) + 10 from public.factory_petty_cash_categories), 10), v_actor, v_actor)
    returning * into v_row;
  else
    update public.factory_petty_cash_categories
    set name = v_name, description = v_description, status = v_status, updated_by = v_actor, updated_at = clock_timestamp()
    where id = v_id returning * into v_row;
    if not found then raise exception using errcode = 'P0002', message = 'Petty Cash category was not found.'; end if;
  end if;
  insert into public.audit_logs(action, module, user_id, user_name, description, metadata)
  values ('factory_petty_cash_category_saved', 'factory', auth.uid(), public.factory_current_active_employee_name(), 'Factory Petty Cash category saved.', jsonb_build_object('target', v_row.name, 'category_id', v_row.id, 'after', to_jsonb(v_row)));
  return to_jsonb(v_row);
end;
$$;

create or replace function public.factory_petty_cash_admin_data(
  p_filters jsonb default '{}'::jsonb,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := case when p_page_size in (20, 50, 100) then p_page_size else 20 end;
  v_offset integer;
  v_date_from date := nullif(p_filters->>'dateFrom', '')::date;
  v_date_to date := nullif(p_filters->>'dateTo', '')::date;
  v_type text := nullif(lower(btrim(coalesce(p_filters->>'type', ''))), '');
  v_category uuid := nullif(p_filters->>'category', '')::uuid;
  v_search text := nullif(lower(btrim(coalesce(p_filters->>'search', ''))), '');
  v_month_start date := date_trunc('month', clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
  v_month_end date := (date_trunc('month', clock_timestamp() at time zone 'Asia/Kuala_Lumpur') + interval '1 month')::date;
  v_rows jsonb;
  v_categories jsonb;
  v_total bigint;
  v_summary jsonb;
begin
  if auth.uid() is null or not public.current_user_has_permission('factory_petty_cash.view') then
    raise exception using errcode = '42501', message = 'Petty Cash view permission is required.';
  end if;
  v_offset := (v_page - 1) * v_page_size;
  with ledger as (
    select tx.id,
      sum(public.factory_petty_cash_signed_amount(tx.transaction_type, tx.adjustment_direction, tx.amount))
        over (order by tx.transaction_date, tx.created_at, tx.id) as balance_after
    from public.factory_petty_cash_transactions tx
    where tx.status = 'posted'
  ), rows as (
    select tx.*, ledger.balance_after,
      category.name as category_name, category.status as category_status,
      coalesce(nullif(creator.nickname, ''), nullif(creator.full_name, ''), creator.email, '—') as created_by_name,
      coalesce(nullif(poster.nickname, ''), nullif(poster.full_name, ''), poster.email, '—') as posted_by_name,
      original.reference_no as reversal_of_reference,
      reversed.reference_no as reversed_by_reference
    from public.factory_petty_cash_transactions tx
    left join ledger on ledger.id = tx.id
    left join public.factory_petty_cash_categories category on category.id = tx.category_id
    left join public.employees creator on creator.id = tx.created_by
    left join public.employees poster on poster.id = tx.posted_by
    left join public.factory_petty_cash_transactions original on original.id = tx.reversal_of_id
    left join public.factory_petty_cash_transactions reversed on reversed.id = tx.reversed_by_id
    where (v_date_from is null or tx.transaction_date >= v_date_from)
      and (v_date_to is null or tx.transaction_date <= v_date_to)
      and (v_type is null or tx.transaction_type = v_type)
      and (v_category is null or tx.category_id = v_category)
      and (v_search is null or lower(concat_ws(' ', tx.reference_no, tx.description, tx.party_name, tx.notes, category.name)) like '%' || v_search || '%')
  ), counted as (select count(*) as total from rows), paged as (
    select * from rows order by transaction_date desc, created_at desc, id desc limit v_page_size offset v_offset
  )
  select
    coalesce((select total from counted), 0),
    coalesce((select jsonb_agg(to_jsonb(paged) order by transaction_date desc, created_at desc, id desc) from paged), '[]'::jsonb)
  into v_total, v_rows;

  select coalesce(jsonb_agg(to_jsonb(category) order by category.sort_order, category.name), '[]'::jsonb)
  into v_categories from public.factory_petty_cash_categories category;

  select jsonb_build_object(
    'current_balance', coalesce(sum(public.factory_petty_cash_signed_amount(transaction_type, adjustment_direction, amount)) filter (where status = 'posted'), 0),
    'cash_in_month', coalesce(sum(amount) filter (where status = 'posted' and transaction_type = 'cash_in' and transaction_date >= v_month_start and transaction_date < v_month_end), 0),
    'expenses_month', coalesce(sum(amount) filter (where status = 'posted' and transaction_type = 'expense' and transaction_date >= v_month_start and transaction_date < v_month_end), 0),
    'transactions_month', count(*) filter (where status = 'posted' and transaction_date >= v_month_start and transaction_date < v_month_end)
  ) into v_summary from public.factory_petty_cash_transactions;

  return jsonb_build_object('rows', v_rows, 'categories', v_categories, 'summary', v_summary, 'total_count', v_total, 'page', v_page, 'page_size', v_page_size);
end;
$$;

create or replace function public.factory_petty_cash_protect_posted()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.status = 'posted' then
    raise exception using errcode = '22023', message = 'Posted Petty Cash transactions are immutable.';
  end if;
  if tg_op = 'UPDATE' and old.status = 'posted' and (
    new.reference_no is distinct from old.reference_no
    or new.transaction_type is distinct from old.transaction_type
    or new.adjustment_direction is distinct from old.adjustment_direction
    or new.amount is distinct from old.amount
    or new.category_id is distinct from old.category_id
    or new.transaction_date is distinct from old.transaction_date
    or new.description is distinct from old.description
    or new.party_name is distinct from old.party_name
    or new.adjustment_reason is distinct from old.adjustment_reason
    or new.notes is distinct from old.notes
    or new.receipt_path is distinct from old.receipt_path
    or new.receipt_filename is distinct from old.receipt_filename
    or new.receipt_mime_type is distinct from old.receipt_mime_type
    or new.receipt_size_bytes is distinct from old.receipt_size_bytes
    or new.status is distinct from old.status
    or new.reversal_of_id is distinct from old.reversal_of_id
    or new.created_by is distinct from old.created_by
    or new.posted_by is distinct from old.posted_by
    or new.posted_at is distinct from old.posted_at
  ) then
    raise exception using errcode = '22023', message = 'Posted Petty Cash transactions are immutable.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger factory_petty_cash_protect_posted_trigger
before update or delete on public.factory_petty_cash_transactions
for each row execute function public.factory_petty_cash_protect_posted();

revoke execute on function public.factory_petty_cash_signed_amount(text, text, numeric) from public, anon;
revoke execute on function public.factory_next_petty_cash_reference() from public, anon, authenticated;
revoke execute on function public.factory_petty_cash_audit(text, text, uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.factory_save_petty_cash_draft(jsonb) from public, anon;
revoke execute on function public.factory_post_petty_cash_transaction(uuid) from public, anon;
revoke execute on function public.factory_delete_petty_cash_draft(uuid) from public, anon;
revoke execute on function public.factory_reverse_petty_cash_transaction(uuid, text) from public, anon;
revoke execute on function public.factory_save_petty_cash_category(jsonb) from public, anon;
revoke execute on function public.factory_petty_cash_admin_data(jsonb, integer, integer) from public, anon;
revoke execute on function public.factory_petty_cash_protect_posted() from public, anon, authenticated;
grant execute on function public.factory_save_petty_cash_draft(jsonb) to authenticated;
grant execute on function public.factory_post_petty_cash_transaction(uuid) to authenticated;
grant execute on function public.factory_delete_petty_cash_draft(uuid) to authenticated;
grant execute on function public.factory_reverse_petty_cash_transaction(uuid, text) to authenticated;
grant execute on function public.factory_save_petty_cash_category(jsonb) to authenticated;
grant execute on function public.factory_petty_cash_admin_data(jsonb, integer, integer) to authenticated;

notify pgrst, 'reload schema';
