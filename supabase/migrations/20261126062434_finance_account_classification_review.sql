-- Canonical nodes are independent of source account codes or provider labels.
create table finance_private.financial_classifications (
  id text primary key,
  parent_id text references finance_private.financial_classifications(id),
  statement text not null check (statement in ('profit_loss','balance_sheet')),
  label text not null,
  sort_order integer not null unique
);
alter table finance_private.financial_classifications enable row level security;
revoke all on finance_private.financial_classifications from public, anon, authenticated, service_role;

insert into finance_private.financial_classifications values
  ('revenue',null,'profit_loss','Revenue',100),
  ('revenue.operating_sales','revenue','profit_loss','Operating sales',101),
  ('revenue.sales_adjustments','revenue','profit_loss','Sales adjustments',102),
  ('cogs',null,'profit_loss','Cost of goods sold',200),
  ('cogs.food','cogs','profit_loss','Food',201),
  ('cogs.beverage','cogs','profit_loss','Beverage',202),
  ('cogs.packaging','cogs','profit_loss','Packaging',203),
  ('cogs.inventory_adjustments','cogs','profit_loss','Inventory adjustments',204),
  ('labour',null,'profit_loss','Labour',300),
  ('labour.salary','labour','profit_loss','Salary',301),
  ('labour.overtime','labour','profit_loss','Overtime',302),
  ('labour.statutory','labour','profit_loss','Statutory',303),
  ('labour.other_labour','labour','profit_loss','Other labour',304),
  ('opex',null,'profit_loss','Operating expenses',400),
  ('opex.occupancy','opex','profit_loss','Occupancy',401),
  ('opex.utilities','opex','profit_loss','Utilities',402),
  ('opex.marketing','opex','profit_loss','Marketing',403),
  ('opex.delivery','opex','profit_loss','Delivery',404),
  ('opex.repairs_maintenance','opex','profit_loss','Repairs and maintenance',405),
  ('opex.software','opex','profit_loss','Software',406),
  ('opex.professional_fees','opex','profit_loss','Professional fees',407),
  ('opex.other_operating_expense','opex','profit_loss','Other operating expenses',408),
  ('other_income',null,'profit_loss','Other income',500),
  ('depreciation_amortisation',null,'profit_loss','Depreciation and amortisation',600),
  ('finance_cost',null,'profit_loss','Finance costs',700),
  ('income_tax',null,'profit_loss','Income tax',800),
  ('assets',null,'balance_sheet','Assets',900),
  ('assets.cash','assets','balance_sheet','Cash and cash equivalents',901),
  ('assets.receivables','assets','balance_sheet','Trade receivables',902),
  ('assets.inventory','assets','balance_sheet','Inventory',903),
  ('assets.current_other','assets','balance_sheet','Other current assets',904),
  ('assets.fixed','assets','balance_sheet','Property, plant and equipment',905),
  ('assets.intangibles','assets','balance_sheet','Intangible assets',906),
  ('assets.noncurrent_other','assets','balance_sheet','Other non-current assets',907),
  ('liabilities',null,'balance_sheet','Liabilities',1000),
  ('liabilities.payables','liabilities','balance_sheet','Trade payables',1001),
  ('liabilities.accruals','liabilities','balance_sheet','Accruals',1002),
  ('liabilities.current_other','liabilities','balance_sheet','Other current liabilities',1003),
  ('liabilities.borrowings','liabilities','balance_sheet','Borrowings',1004),
  ('liabilities.noncurrent_other','liabilities','balance_sheet','Other non-current liabilities',1005),
  ('equity',null,'balance_sheet','Equity',1100),
  ('equity.capital','equity','balance_sheet','Capital',1101),
  ('equity.retained_earnings','equity','balance_sheet','Retained earnings',1102),
  ('equity.reserves','equity','balance_sheet','Reserves',1103);

-- Classifications are append-only reviews pinned to accepted COA evidence.
create table finance_private.account_mapping_reviews (
  id bigint generated always as identity primary key,
  connection_id uuid not null references finance_private.source_connections(id),
  account_key text not null,
  coa_snapshot_id bigint not null references finance_private.source_snapshots(id),
  source_fingerprint bytea not null,
  classification_id text not null references finance_private.financial_classifications(id),
  decision text not null check (decision in ('suggestion','manual')),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default clock_timestamp()
);
create index finance_account_mapping_latest on finance_private.account_mapping_reviews(connection_id,account_key,id desc);
alter table finance_private.account_mapping_reviews enable row level security;
revoke all on finance_private.account_mapping_reviews from public, anon, authenticated, service_role;

-- Code patterns only refine compatible type/label evidence. AutoCount allows free-format codes.
create function finance_private.suggest_account_classification(
  p_provider text,p_code text,p_type text,p_description text,p_parent_context text
) returns text
language sql immutable set search_path = '' as $$
  with words as (
    select lower(coalesce(p_description,'')) as label, lower(concat_ws(' ',p_description,p_parent_context)) as context
  )
  select case
    when p_provider <> 'autocount' or label ~ '\m(temporary|contra|suspense|clearing|rounding|intercompany|inter.company|service tax|sales tax|service charge)\M' then null
    when p_type='SL' then 'revenue.operating_sales'
    when p_type='SA' then 'revenue.sales_adjustments'
    when p_type='OI' then 'other_income'
    when p_type='CO' then case
      when label ~ '(beginning|opening|ending|closing|end of year)' and label ~ '(stock|inventor)' then 'cogs.inventory_adjustments'
      when context ~ '\m(packaging|packing)\M' then 'cogs.packaging'
      when context ~ '\m(beverage|drinks)\M' then 'cogs.beverage'
      when context ~ '\m(food|ingredients)\M' then 'cogs.food'
      else 'cogs' end
    when p_type='EP' then case
      when label ~ '(depreciation|amortisation|amortization)' then 'depreciation_amortisation'
      when label ~ '(interest on|interest expense|finance cost|loan interest)' then 'finance_cost'
      when context ~ '\m(epf|socso|eis|sip|kwsp|perkeso)\M' then 'labour.statutory'
      when context ~ '\m(overtime)\M' then 'labour.overtime'
      when context ~ '(subcon.*wages|staff allowance|uniform)' then 'labour.other_labour'
      when context ~ '\m(salary|salaries|wage|wages|payroll)\M' then 'labour.salary'
      when context ~ '(rental.*(shop|premise|office)|premises rent|shop rent)' then 'opex.occupancy'
      when context ~ '(electricity|sewerage|water charges|telephone|utility|utilities)' then 'opex.utilities'
      when context ~ '(advertis|marketing|promotion)' then 'opex.marketing'
      when context ~ '(courier|delivery)' then 'opex.delivery'
      when context ~ '(repair|maintenance|upkeep|pest control)' then 'opex.repairs_maintenance'
      when context ~ '\m(software|saas)\M' then 'opex.software'
      when context ~ '(audit fee|legal fee|accounting fee|professional fee|tax agent)' then 'opex.professional_fees'
      when label ~ '\m(allowance|commission|management fee|bank charges|disposable|subscription)\M' then null
      else 'opex' end
    when p_type='TX' and label ~ '(taxation|income tax|corporate tax)' then 'income_tax'
    when p_type='FA' then 'assets.fixed'
    when p_type='OA' then case when context ~ '(goodwill|intangible|patent|trademark)' then 'assets.intangibles' else 'assets.noncurrent_other' end
    when p_type='CA' then case
      when context ~ '(trade debtors|trade receivables)' then 'assets.receivables'
      when label ~ '(petty cash|cash in hand|cash at bank|current account)' or
           (p_code ~ '^31[0-9]-' and context ~ '\m(bank|cash)\M') or context ~ '(cash at bank|cash in hand|petty cash)' then 'assets.cash'
      when context ~ '\m(stock|inventory)\M' then 'assets.inventory'
      else 'assets.current_other' end
    when p_type='CL' then case
      when context ~ '(trade creditors|trade payables)' then 'liabilities.payables'
      when context ~ '\m(accrual|accruals|accrued)\M' then 'liabilities.accruals'
      when label ~ '\m(loan|borrowings)\M' then null
      else 'liabilities.current_other' end
    when p_type in ('LL','LT') then case when label ~ '\m(loan|borrowings)\M' then 'liabilities.borrowings' else 'liabilities.noncurrent_other' end
    when p_type='CP' then 'equity.capital'
    when p_type='RE' then case when label ~ '\m(reserve|reserves)\M' then 'equity.reserves' else 'equity.retained_earnings' end
    end
  from words;
$$;

create function finance_private.account_mapping_rows(
  p_connection_id uuid,p_snapshot_id bigint,p_baseline_id bigint,p_provider text
) returns table (
  account_key text,description text,source_type text,parent_key text,parent_description text,
  role text,issue text,posted boolean,suggestion text,fingerprint bytea,
  classification text,version text,reviewed_at timestamptz,status text
)
language sql stable set search_path = '' as $$
  with recursive accounts as materialized (
    select item->>'key' as code, item->>'description' as label, upper(btrim(item->>'type')) as type,
      nullif(item->>'parent','') as parent, item->>'currency' as currency
    from finance_private.source_snapshots s cross join lateral jsonb_array_elements(s.rows) item
    where s.id=p_snapshot_id and s.connection_id=p_connection_id and s.dataset='COA'
  ), ancestry as (
    select a.code,a.parent,array[a.code] as visited,'[]'::jsonb as details,''::text as labels
    from accounts a
    union all
    select h.code,p.parent,h.visited||p.code,
      h.details||jsonb_build_array(jsonb_build_array(p.code,p.type,lower(regexp_replace(btrim(p.label),'[[:space:]]+',' ','g')))),
      concat_ws(' ',h.labels,case when p.type=a.type then p.label end)
    from ancestry h join accounts p on p.code=h.parent join accounts a on a.code=h.code
    where not p.code=any(h.visited) and cardinality(h.visited)<32
  ), hierarchy as (
    select distinct on (code) code,parent,details,labels from ancestry order by code,cardinality(visited) desc
  ), parents as (
    select distinct parent as code from accounts where parent is not null
  ), latest_gl as (
    select distinct on (s.scope_date) s.rows
    from finance_private.source_snapshots s join finance_private.source_receipts r on r.connection_id=s.connection_id and r.snapshot_id=s.id
    where s.connection_id=p_connection_id and s.dataset='GL'
    order by s.scope_date,r.received_at desc,s.id desc
  ), used as (
    select distinct item->>'account' as code from latest_gl cross join lateral jsonb_array_elements(rows) item
  ), baseline as (
    select item->>'key' as code from finance_private.source_snapshots s cross join lateral jsonb_array_elements(s.rows) item
    where s.id=p_baseline_id and s.connection_id=p_connection_id
  ), tagged as (
    select a.*, p.label as parent_label, h.details, h.labels,
      u.code is not null as posted, b.code is null as new_account,
      case when h.parent is not null then 'hierarchy'
        when g.code is not null and u.code is not null then 'group_postings' end as issue,
      case when h.parent is not null or (g.code is not null and u.code is not null) then 'ambiguous'
        when g.code is not null then 'group' else 'posting' end as role
    from accounts a join hierarchy h on h.code=a.code left join accounts p on p.code=a.parent
    left join parents g on g.code=a.code left join used u on u.code=a.code left join baseline b on b.code=a.code
  ), candidates as (
    select t.*,
      case when t.role='posting' then finance_private.suggest_account_classification(p_provider,t.code,t.type,t.label,t.labels) end as suggestion,
      extensions.digest(jsonb_build_array(t.code,t.type,lower(regexp_replace(btrim(t.label),'[[:space:]]+',' ','g')),
        t.parent,t.currency,t.role,t.details)::text,'sha256') as fingerprint
    from tagged t
  ), reviewed as (
    select distinct on (m.account_key) m.* from finance_private.account_mapping_reviews m
    where m.connection_id=p_connection_id order by m.account_key,m.id desc
  )
  select c.code,c.label,c.type,c.parent,c.parent_label,c.role,c.issue,c.posted,c.suggestion,c.fingerprint,
    m.classification_id,m.id::text,m.reviewed_at,
    case when m.id is not null and m.source_fingerprint<>c.fingerprint then 'changed'
      when c.role='group' then 'group' when c.role='ambiguous' then 'ambiguous'
      when m.id is not null then 'confirmed'
      when c.new_account then 'new' when c.suggestion is null then 'manual_review' else 'suggested' end
  from candidates c left join reviewed m on m.account_key=c.code;
$$;

create function public.finance_account_mapping_review(
  p_connection_id uuid,p_snapshot_id bigint default null,p_decisions jsonb default null,p_summary_only boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  source finance_private.source_connections;
  snapshot record;
  baseline_id bigint;
  rows jsonb;
  summary jsonb;
  invalid_count integer;
  decision_count integer;
begin
  if not finance_private.is_source_owner() then raise sqlstate 'PT403' using message='Owner access required'; end if;
  -- Uploads and source lifecycle changes serialize on this connection row.
  if p_decisions is not null then
    perform 1 from finance_private.source_connections where id=p_connection_id for update;
  end if;
  select c.* into source from finance_private.source_connections c
  join public.legal_entities e on e.id=c.legal_entity_id
  left join finance_private.autocount_books b on b.id=c.autocount_book_id
  left join finance_private.autocount_devices d on d.id=b.device_id
  where c.id=p_connection_id and c.active and c.verified_at is not null and e.is_active
    and c.superseded_by_connection_id is null and (c.autocount_book_id is null or (b.ready and d.active));
  if not found then raise sqlstate 'PT404' using message='Current source unavailable'; end if;

  select s.id,s.accepted_at into snapshot
  from finance_private.source_snapshots s join finance_private.source_receipts r on r.connection_id=s.connection_id and r.snapshot_id=s.id
  where s.connection_id=source.id and s.dataset='COA' order by r.received_at desc,s.id desc limit 1;
  if snapshot.id is null then
    if p_decisions is not null then raise sqlstate 'PT409' using message='Accepted chart of accounts required'; end if;
    return null;
  end if;
  select min(s.id) into baseline_id
  from finance_private.source_snapshots s join finance_private.source_receipts r on r.connection_id=s.connection_id and r.snapshot_id=s.id
  where s.connection_id=source.id and s.dataset='COA';

  if p_decisions is not null then
    if snapshot.id is distinct from p_snapshot_id then raise sqlstate 'PT409' using message='Chart of accounts changed. Refresh the review.'; end if;
    if jsonb_typeof(p_decisions)<>'array' then raise sqlstate 'PT422' using message='Invalid mapping decisions'; end if;
    decision_count:=jsonb_array_length(p_decisions);
    if decision_count not between 1 and 500 then raise sqlstate 'PT422' using message='Select between 1 and 500 accounts'; end if;
    if exists (select 1 from jsonb_array_elements(p_decisions) item
      where jsonb_typeof(item)<>'object' or nullif(item->>'accountKey','') is null or nullif(item->>'classificationId','') is null
        or not (item ? 'expectedVersion')) or
      (select count(distinct item->>'accountKey') from jsonb_array_elements(p_decisions) item)<>decision_count then
      raise sqlstate 'PT422' using message='Invalid or duplicate mapping decisions';
    end if;

    with selected as (
      select r.*,item->>'expectedVersion' as expected_version, f.id as target
      from jsonb_array_elements(p_decisions) item
      left join finance_private.account_mapping_rows(source.id,snapshot.id,baseline_id,source.provider) r on r.account_key=item->>'accountKey'
      left join finance_private.financial_classifications f on f.id=item->>'classificationId'
    )
    select count(*) into invalid_count from selected
    where account_key is null or role<>'posting' or target is null or
      (not (status='confirmed' and classification=target) and version is distinct from expected_version);
    if invalid_count>0 then raise sqlstate 'PT409' using message='Accounts or reviews changed. Refresh before confirming.'; end if;

    insert into finance_private.account_mapping_reviews(connection_id,account_key,coa_snapshot_id,source_fingerprint,classification_id,decision,reviewed_by)
    select source.id,r.account_key,snapshot.id,r.fingerprint,item->>'classificationId',
      case when r.suggestion=item->>'classificationId' then 'suggestion' else 'manual' end,auth.uid()
    from jsonb_array_elements(p_decisions) item
    join finance_private.account_mapping_rows(source.id,snapshot.id,baseline_id,source.provider) r on r.account_key=item->>'accountKey'
    where r.status<>'confirmed' or r.classification<>item->>'classificationId';
  end if;

  with review as materialized (select * from finance_private.account_mapping_rows(source.id,snapshot.id,baseline_id,source.provider))
  select jsonb_build_object(
    'total',count(*),'posting',count(*) filter (where role='posting'),
    'groups',count(*) filter (where role='group'),'ambiguous',count(*) filter (where role='ambiguous'),
    'confirmed',count(*) filter (where status='confirmed'),'unresolved',count(*) filter (where role<>'group' and status<>'confirmed'),
    'suggested',count(*) filter (where suggestion is not null and status<>'confirmed'),
    'changed',count(*) filter (where status='changed'),'new',count(*) filter (where status='new'),
    'removed',(select count(distinct m.account_key) from finance_private.account_mapping_reviews m
      where m.connection_id=source.id and not exists (select 1 from review r where r.account_key=m.account_key)))
  ,case when not p_summary_only then coalesce(jsonb_agg(to_jsonb(review)-'fingerprint' order by account_key collate "C"),'[]'::jsonb) end
  into summary,rows from review;
  return jsonb_build_object('connectionId',source.id,'snapshotId',snapshot.id::text,'snapshotAt',snapshot.accepted_at,'summary',summary,
    'rows',rows,'classifications',case when not p_summary_only then
      (select jsonb_agg(to_jsonb(f) order by f.sort_order) from finance_private.financial_classifications f) end);
end;
$$;

revoke all on function finance_private.suggest_account_classification(text,text,text,text,text),
  finance_private.account_mapping_rows(uuid,bigint,bigint,text),public.finance_account_mapping_review(uuid,bigint,jsonb,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.finance_account_mapping_review(uuid,bigint,jsonb,boolean) to authenticated;
