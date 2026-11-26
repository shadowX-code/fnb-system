-- Classifications are analytical destinations. Source semantics are resolved separately.
alter table finance_private.financial_classifications
  add column industry text check (industry in ('restaurant', 'manufacturing', 'retail')),
  add column selectable boolean not null default true,
  add column source_scopes text[];

update finance_private.financial_classifications
set source_scopes = string_to_array(case
  when id = 'revenue' then 'revenue,sales_adjustments'
  when id = 'revenue.sales_adjustments' then 'sales_adjustments'
  when id like 'revenue.%' then 'revenue'
  when id = 'cogs' or id like 'cogs.%' then 'cost_of_sales'
  when id = 'other_income' then 'other_income'
  when id = 'income_tax' then 'income_tax'
  when statement = 'profit_loss' then 'expense'
  when id = 'assets' then 'current_asset,fixed_asset,noncurrent_asset'
  when id = 'assets.fixed' then 'fixed_asset'
  when id in ('assets.intangibles', 'assets.noncurrent_other') then 'noncurrent_asset'
  when id like 'assets.%' then 'current_asset'
  when id = 'liabilities' then 'current_liability,noncurrent_liability'
  when id in ('liabilities.borrowings', 'liabilities.noncurrent_other') then 'noncurrent_liability'
  when id like 'liabilities.%' then 'current_liability'
  when id = 'equity' then 'capital,retained_equity'
  when id = 'equity.capital' then 'capital'
  else 'retained_equity' end, ',');

insert into finance_private.financial_classifications(id,parent_id,statement,label,sort_order,industry,selectable,source_scopes)
select id,parent,statement,label,position,industry,selectable,string_to_array(scopes, ',')
from (values
  ('revenue.services','revenue','profit_loss','Services',103,null,true,'revenue'),
  ('revenue.wholesale','revenue','profit_loss','Wholesale and distribution',104,null,true,'revenue'),
  ('revenue.sales_adjustments.returns','revenue.sales_adjustments','profit_loss','Sales returns',105,null,true,'sales_adjustments'),
  ('revenue.sales_adjustments.discounts','revenue.sales_adjustments','profit_loss','Sales discounts',106,null,true,'sales_adjustments'),
  ('revenue.operating_sales.dine_in','revenue.operating_sales','profit_loss','Dine-in sales',107,'restaurant',true,'revenue'),
  ('revenue.operating_sales.takeaway','revenue.operating_sales','profit_loss','Takeaway sales',108,'restaurant',true,'revenue'),
  ('revenue.operating_sales.delivery_platform','revenue.operating_sales','profit_loss','Delivery platform sales',109,'restaurant',true,'revenue'),
  ('revenue.operating_sales.manufactured_goods','revenue.operating_sales','profit_loss','Manufactured goods sales',110,'manufacturing',true,'revenue'),
  ('revenue.operating_sales.in_store','revenue.operating_sales','profit_loss','In-store retail sales',111,'retail',true,'revenue'),
  ('revenue.operating_sales.online_retail','revenue.operating_sales','profit_loss','Online retail sales',112,'retail',true,'revenue'),

  ('cogs.direct_materials','cogs','profit_loss','Direct materials',205,null,true,'cost_of_sales'),
  ('cogs.direct_production_labour','cogs','profit_loss','Direct production labour',206,null,true,'cost_of_sales'),
  ('cogs.manufacturing_overhead','cogs','profit_loss','Manufacturing overhead',207,null,true,'cost_of_sales'),
  ('cogs.manufacturing_overhead.utilities','cogs.manufacturing_overhead','profit_loss','Factory utilities',208,'manufacturing',true,'cost_of_sales'),
  ('cogs.manufacturing_overhead.indirect_labour','cogs.manufacturing_overhead','profit_loss','Indirect production labour',209,'manufacturing',true,'cost_of_sales'),
  ('cogs.manufacturing_overhead.depreciation','cogs.manufacturing_overhead','profit_loss','Production depreciation',210,null,true,'cost_of_sales'),
  ('cogs.manufacturing_overhead.outsourced_processing','cogs.manufacturing_overhead','profit_loss','Outsourced processing',211,'manufacturing',true,'cost_of_sales'),
  ('cogs.merchandise','cogs','profit_loss','Merchandise cost',212,'retail',true,'cost_of_sales'),
  ('cogs.inventory_adjustments.opening','cogs.inventory_adjustments','profit_loss','Opening stock adjustment',213,null,true,'cost_of_sales'),
  ('cogs.inventory_adjustments.closing','cogs.inventory_adjustments','profit_loss','Closing stock adjustment',214,null,true,'cost_of_sales'),
  ('cogs.inventory_adjustments.shrinkage','cogs.inventory_adjustments','profit_loss','Retail shrinkage',215,'retail',true,'cost_of_sales'),
  ('cogs.purchase_returns','cogs','profit_loss','Purchase returns',216,null,true,'cost_of_sales'),
  ('cogs.inbound_freight','cogs','profit_loss','Inbound freight',217,null,true,'cost_of_sales'),

  ('labour.benefits','labour','profit_loss','Employee benefits and allowances',305,null,true,'expense'),
  ('labour.contract','labour','profit_loss','Contract labour',306,null,true,'expense'),
  ('opex.equipment_rental','opex','profit_loss','Equipment rental',409,null,true,'expense'),
  ('opex.office_admin','opex','profit_loss','Office and administration',410,null,true,'expense'),
  ('opex.insurance','opex','profit_loss','Insurance',411,null,true,'expense'),
  ('opex.licences','opex','profit_loss','Licences and permits',412,null,true,'expense'),
  ('opex.delivery.platform_commissions','opex.delivery','profit_loss','Delivery platform commissions',413,'restaurant',true,'expense'),
  ('opex.merchant_fees','opex','profit_loss','Merchant and payment processing fees',414,null,true,'expense'),
  ('opex.store_supplies','opex','profit_loss','Store operating supplies',415,'retail',true,'expense'),

  ('other_income.interest','other_income','profit_loss','Interest income',501,null,true,'other_income'),
  ('other_income.disposal_gain','other_income','profit_loss','Gain on asset disposal',502,null,true,'other_income'),
  ('other_income.other_recoveries','other_income','profit_loss','Recoveries and sundry income',503,null,true,'other_income'),
  ('other_expense',null,'profit_loss','Other non-operating expenses',520,null,true,'expense'),
  ('other_expense.disposal_loss','other_expense','profit_loss','Loss on asset disposal',521,null,true,'expense'),
  ('other_expense.impairment','other_expense','profit_loss','Non-operating impairment',522,null,true,'expense'),
  ('depreciation_amortisation.depreciation','depreciation_amortisation','profit_loss','Depreciation expense',601,null,true,'expense'),
  ('depreciation_amortisation.amortisation','depreciation_amortisation','profit_loss','Amortisation expense',602,null,true,'expense'),
  ('finance_cost.interest','finance_cost','profit_loss','Interest expense',701,null,true,'expense'),
  ('finance_cost.lease_interest','finance_cost','profit_loss','Lease interest',702,null,true,'expense'),
  ('income_tax.current','income_tax','profit_loss','Current income tax expense',801,null,true,'income_tax'),
  ('income_tax.deferred','income_tax','profit_loss','Deferred income tax expense',802,null,true,'income_tax'),

  ('assets.current','assets','balance_sheet','Current assets',920,null,false,'current_asset'),
  ('assets.noncurrent','assets','balance_sheet','Non-current assets',921,null,false,'fixed_asset,noncurrent_asset'),
  ('assets.current_prepayments','assets.current','balance_sheet','Current prepayments',922,null,true,'current_asset'),
  ('assets.current_deposits','assets.current','balance_sheet','Current deposits',923,null,true,'current_asset'),
  ('assets.current_deposits_prepayments','assets.current','balance_sheet','Current deposits and prepayments',924,null,true,'current_asset'),
  ('assets.current_related_party','assets.current','balance_sheet','Current related-party receivables',925,null,true,'current_asset'),
  ('assets.noncurrent_related_party','assets.noncurrent','balance_sheet','Non-current related-party receivables',926,null,true,'noncurrent_asset'),
  ('assets.noncurrent_deposits','assets.noncurrent','balance_sheet','Non-current deposits',927,null,true,'noncurrent_asset'),
  ('assets.noncurrent_prepayments','assets.noncurrent','balance_sheet','Non-current prepayments',928,null,true,'noncurrent_asset'),
  ('assets.accumulated_depreciation','assets.noncurrent','balance_sheet','Accumulated depreciation',929,null,true,'fixed_asset'),
  ('assets.accumulated_amortisation','assets.noncurrent','balance_sheet','Accumulated amortisation',930,null,true,'noncurrent_asset'),
  ('assets.right_of_use','assets.noncurrent','balance_sheet','Right-of-use assets',931,null,true,'fixed_asset'),
  ('assets.receivables_allowance','assets.current','balance_sheet','Receivables loss allowance',932,null,true,'current_asset'),
  ('assets.current_tax_receivable','assets.current','balance_sheet','Current tax receivable',933,null,true,'current_asset'),
  ('assets.deferred_tax','assets.noncurrent','balance_sheet','Deferred tax assets',934,null,true,'noncurrent_asset'),
  ('assets.inventory.raw_materials','assets.inventory','balance_sheet','Raw materials inventory',935,'manufacturing',true,'current_asset'),
  ('assets.inventory.work_in_progress','assets.inventory','balance_sheet','Work-in-progress inventory',936,'manufacturing',true,'current_asset'),
  ('assets.inventory.finished_goods','assets.inventory','balance_sheet','Finished goods inventory',937,'manufacturing',true,'current_asset'),
  ('assets.inventory.merchandise','assets.inventory','balance_sheet','Retail merchandise inventory',938,'retail',true,'current_asset'),

  ('liabilities.current','liabilities','balance_sheet','Current liabilities',1020,null,false,'current_liability'),
  ('liabilities.noncurrent','liabilities','balance_sheet','Non-current liabilities',1021,null,false,'noncurrent_liability'),
  ('liabilities.current_borrowings','liabilities.current','balance_sheet','Current borrowings',1022,null,true,'current_liability'),
  ('liabilities.current_lease','liabilities.current','balance_sheet','Current lease liabilities',1023,null,true,'current_liability'),
  ('liabilities.noncurrent_lease','liabilities.noncurrent','balance_sheet','Non-current lease liabilities',1024,null,true,'noncurrent_liability'),
  ('liabilities.current_related_party','liabilities.current','balance_sheet','Current related-party payables',1025,null,true,'current_liability'),
  ('liabilities.noncurrent_related_party','liabilities.noncurrent','balance_sheet','Non-current related-party payables',1026,null,true,'noncurrent_liability'),
  ('liabilities.statutory_payables','liabilities.current','balance_sheet','Payroll statutory liabilities',1027,null,true,'current_liability'),
  ('liabilities.current_tax_payable','liabilities.current','balance_sheet','Current income tax payable',1028,null,true,'current_liability'),
  ('liabilities.indirect_tax_payable','liabilities.current','balance_sheet','Indirect tax payable',1029,null,true,'current_liability'),
  ('liabilities.deferred_tax','liabilities.noncurrent','balance_sheet','Deferred tax liabilities',1030,null,true,'noncurrent_liability'),
  ('liabilities.current_deposits','liabilities.current','balance_sheet','Customer deposits and advances',1031,null,true,'current_liability'),
  ('liabilities.noncurrent_deposits','liabilities.noncurrent','balance_sheet','Non-current deposits received',1032,null,true,'noncurrent_liability'),
  ('equity.share_premium','equity.capital','balance_sheet','Share premium',1104,null,true,'capital'),
  ('equity.treasury_shares','equity.capital','balance_sheet','Treasury shares',1105,null,true,'capital'),
  ('equity.owner_drawings','equity','balance_sheet','Owner drawings and distributions',1106,null,true,'capital,retained_equity')
) as nodes(id,parent,statement,label,position,industry,selectable,scopes);

update finance_private.financial_classifications set parent_id='assets.current'
where id in ('assets.cash','assets.receivables','assets.inventory','assets.current_other');
update finance_private.financial_classifications set parent_id='assets.noncurrent'
where id in ('assets.fixed','assets.intangibles','assets.noncurrent_other');
update finance_private.financial_classifications set parent_id='liabilities.current'
where id in ('liabilities.payables','liabilities.accruals','liabilities.current_other');
update finance_private.financial_classifications set parent_id='liabilities.noncurrent'
where id in ('liabilities.borrowings','liabilities.noncurrent_other');
update finance_private.financial_classifications set industry='restaurant' where id in ('cogs.food','cogs.beverage');

alter table finance_private.financial_classifications alter column source_scopes set not null,
  add constraint classification_has_source_scope check (cardinality(source_scopes) > 0);

-- The AutoCount adapter resolves source accounting type. No names or code ranges
-- establish source nature, posting eligibility, normal balance, contra status or maturity.
create function finance_private.account_mapping_source_scope(p_provider text,p_type text)
returns text language sql immutable set search_path = '' as $$
  select case when p_provider='autocount' then case p_type
    when 'SL' then 'revenue' when 'SA' then 'sales_adjustments'
    when 'CO' then 'cost_of_sales' when 'EP' then 'expense'
    when 'OI' then 'other_income' when 'TX' then 'income_tax'
    when 'CA' then 'current_asset' when 'FA' then 'fixed_asset' when 'OA' then 'noncurrent_asset'
    when 'CL' then 'current_liability' when 'LL' then 'noncurrent_liability' when 'LT' then 'noncurrent_liability'
    when 'CP' then 'capital' when 'RE' then 'retained_equity'
  end end;
$$;

-- This is the compatibility boundary for any automated proposal and for new confirmations.
create function finance_private.account_mapping_allowed(p_id text,p_scope text)
returns boolean language sql stable set search_path = '' as $$
  select exists(select 1 from finance_private.financial_classifications f
    where f.id=p_id and f.selectable and p_scope=any(f.source_scopes));
$$;

create function finance_private.account_mapping_core_suggestion(p_id text)
returns text language sql stable set search_path = '' as $$
  with recursive family as (
    select f.id,f.parent_id,f.industry,f.selectable,0 as distance
    from finance_private.financial_classifications f where f.id=p_id
    union all
    select f.id,f.parent_id,f.industry,f.selectable,c.distance+1
    from family c join finance_private.financial_classifications f on f.id=c.parent_id
    where c.distance<12
  )
  select id from family where industry is null and selectable order by distance limit 1;
$$;

-- Positive source type evidence gates descriptions and same-type ancestor context.
-- A single destination is returned. There is no cross-bucket allocation or sign inference.
create or replace function finance_private.suggest_account_classification(
  p_provider text,p_code text,p_type text,p_description text,p_parent_context text
) returns text
language sql stable set search_path = '' as $$
  with words as (
    select finance_private.account_mapping_source_scope(p_provider,p_type) as scope,
      lower(coalesce(p_description,'')) as label,
      lower(concat_ws(' ',p_description,p_parent_context)) as context
  ), candidate as (
    select scope, case
      when label ~ '\m(temporary|suspense|clearing|rounding)\M' then null
      when label ~ '\mcontra\M' then null
      when scope not in ('current_liability','noncurrent_liability') and
        label ~ '\m(service tax|sales tax|service charge|vat|gst|sst)\M' then null
      when scope='revenue' then case
        when label ~ '(foodpanda|shopeefood|grabfood|\mgrab\M|delivery platform)' then 'revenue.operating_sales.delivery_platform'
        when label ~ '\m(dine.in|dinein)\M' then 'revenue.operating_sales.dine_in'
        when label ~ '\m(takeaway|take.away)\M' then 'revenue.operating_sales.takeaway'
        when label ~ '(online retail|e.commerce)' then 'revenue.operating_sales.online_retail'
        when label ~ '(in.store retail|retail store sales)' then 'revenue.operating_sales.in_store'
        when label ~ '(manufactured goods|manufacturing sales)' then 'revenue.operating_sales.manufactured_goods'
        when label ~ '\m(wholesale|distribution)\M' then 'revenue.wholesale'
        when label ~ '\m(service revenue|service income|service sales)\M' then 'revenue.services'
        else 'revenue.operating_sales' end
      when scope='sales_adjustments' then case
        when label ~ '\m(return inward|return inwards|sales returns?)\M' then 'revenue.sales_adjustments.returns'
        when label ~ '\m(discount|discounts|disc)\M' then 'revenue.sales_adjustments.discounts'
        else 'revenue.sales_adjustments' end
      when scope='other_income' then case
        when label ~ '(interest income|interest received)' then 'other_income.interest'
        when label ~ '(gain.*disposal|profit.*disposal)' then 'other_income.disposal_gain'
        when label ~ '(recovery|recoveries|sundry income)' then 'other_income.other_recoveries'
        else 'other_income' end
      when scope='cost_of_sales' then case
        when label ~ '(beginning|opening)' and label ~ '(stock|inventor)' then 'cogs.inventory_adjustments.opening'
        when label ~ '(ending|closing|end of year)' and label ~ '(stock|inventor)' then 'cogs.inventory_adjustments.closing'
        when label ~ '(shrinkage)' and context ~ '\m(retail|merchandise)\M' then 'cogs.inventory_adjustments.shrinkage'
        when label ~ '(stock adjustment|inventory adjustment|inventory write.off|stock write.off|shrinkage)' then 'cogs.inventory_adjustments'
        when label ~ '(purchase.*return|return outward)' then 'cogs.purchase_returns'
        when label ~ '(carriage inward|freight inward|inbound freight)' then 'cogs.inbound_freight'
        when context ~ '\m(factory|production|manufacturing)\M' and label ~ '(depreciation|deprn)' then 'cogs.manufacturing_overhead.depreciation'
        when label ~ '(depreciation|amorti[sz]ation)' then null
        when label ~ '(indirect (factory|production) (labour|labor|wage)|indirect (labour|labor))' then 'cogs.manufacturing_overhead.indirect_labour'
        when label ~ '\mdirect (production |factory )?(labour|labor|wages)\M' then 'cogs.direct_production_labour'
        when context ~ '\m(factory|production|manufacturing)\M' and label ~ '(utilities|electricity|water charges)' then 'cogs.manufacturing_overhead.utilities'
        when label ~ '(outsourced processing|subcontract processing)' then 'cogs.manufacturing_overhead.outsourced_processing'
        when label ~ '(factory overhead|production overhead|manufacturing overhead)' then 'cogs.manufacturing_overhead'
        when label ~ '\m(merchandise)\M' then 'cogs.merchandise'
        when context ~ '\m(packaging|packing)\M' then 'cogs.packaging'
        when label ~ '(raw materials?|direct materials?)' then 'cogs.direct_materials'
        when context ~ '\m(beverage|drinks)\M' then 'cogs.beverage'
        when context ~ '\m(food|ingredients)\M' then 'cogs.food'
        else 'cogs' end
      when scope='expense' then case
        when label ~ '(loss.*disposal)' then 'other_expense.disposal_loss'
        when label ~ '(non.operating impairment)' then 'other_expense.impairment'
        when label ~ '(depreciation|amorti[sz]ation)' and context ~ '\m(factory|production|manufacturing)\M' then null
        when label ~ '(depreciation)' and label ~ '(amorti[sz]ation)' then 'depreciation_amortisation'
        when label ~ '(depreciation)' then 'depreciation_amortisation.depreciation'
        when label ~ '(amorti[sz]ation)' then 'depreciation_amortisation.amortisation'
        when label ~ '(lease interest|interest on lease)' then 'finance_cost.lease_interest'
        when label ~ '(interest on|interest expense|loan interest)' then 'finance_cost.interest'
        when label ~ '(finance cost)' then 'finance_cost'
        when label ~ '(comm[.]? fee|commission)' and label ~ '(foodpanda|shopeefood|grabfood|\mgrab\M|delivery platform)' then 'opex.delivery.platform_commissions'
        when label ~ '(merchant fees?|payment processing fees?)' then 'opex.merchant_fees'
        when context ~ '\m(factory|production|manufacturing)\M' and label ~ '(labour|labor|wage|payroll|salary|overtime|overhead)' then null
        when context ~ '\m(epf|socso|eis|sip|kwsp|perkeso)\M' then 'labour.statutory'
        when context ~ '\m(overtime)\M' then 'labour.overtime'
        when label ~ '(subcon.*wages|contract labour|contract labor)' then 'labour.contract'
        when label ~ '(staff allowance|employee benefits)' then 'labour.benefits'
        when label ~ '\m(uniform)\M' then 'labour.other_labour'
        when context ~ '\m(salary|salaries|wage|wages|payroll)\M' then 'labour.salary'
        when context ~ '(rental.*(shop|premis|office)|premises rent|shop rent)' then 'opex.occupancy'
        when label ~ '(rental.*(machinery|equipment)|equipment rent)' then 'opex.equipment_rental'
        when context ~ '(electricity|sewerage|water charges|telephone|utility|utilities)' then 'opex.utilities'
        when context ~ '(advertis|marketing|promotion)' then 'opex.marketing'
        when context ~ '(courier|delivery)' then 'opex.delivery'
        when context ~ '(repair|maintenance|upkeep|pest control)' then 'opex.repairs_maintenance'
        when context ~ '\m(software|saas)\M' then 'opex.software'
        when context ~ '(audit fee|legal fee|accounting fee|professional fee|tax agent)' then 'opex.professional_fees'
        when label ~ '(stationery|office supplies|postage|printing)' then 'opex.office_admin'
        when label ~ '\m(insurance)\M' then 'opex.insurance'
        when label ~ '\m(licen[sc]e fee|business permit)\M' then 'opex.licences'
        when label ~ '(store operating supplies|retail store supplies)' then 'opex.store_supplies'
        when label ~ '\m(allowance|commission|management fee|bank charges|disposable|subscription)\M' then null
        else 'opex' end
      when scope='income_tax' then case
        when label ~ '(deferred (income )?tax)' then 'income_tax.deferred'
        when label ~ '(current (income )?tax)' then 'income_tax.current'
        when label ~ '(taxation|income tax|corporate tax)' then 'income_tax' end
      when scope='fixed_asset' then case
        when label ~ '(accum.*(depreciation|deprn|dep[.]?\M))' then 'assets.accumulated_depreciation'
        when label ~ '(right.of.use)' then 'assets.right_of_use'
        else 'assets.fixed' end
      when scope='noncurrent_asset' then case
        when label ~ '(accum.*amorti[sz]ation)' then 'assets.accumulated_amortisation'
        when label ~ '(deferred tax asset)' then 'assets.deferred_tax'
        when label ~ '(related.party|intercompany|inter.company)' then 'assets.noncurrent_related_party'
        when label ~ '(prepayment|prepaid)' and label ~ '\mdeposits?\M' then null
        when label ~ '(prepayment|prepaid)' then 'assets.noncurrent_prepayments'
        when label ~ '\mdeposits?\M' then 'assets.noncurrent_deposits'
        when context ~ '(goodwill|intangible|patent|trademark)' then 'assets.intangibles'
        else 'assets.noncurrent_other' end
      when scope='current_asset' then case
        when label ~ '(expected credit loss|doubtful debts?|receivables loss allowance)' then 'assets.receivables_allowance'
        when label ~ '(related.party|intercompany|inter.company)' then 'assets.current_related_party'
        when label ~ '(income tax recoverable|income tax receivable)' then 'assets.current_tax_receivable'
        when label ~ '(prepayment|prepaid)' and label ~ '\mdeposits?\M' then 'assets.current_deposits_prepayments'
        when label ~ '(prepayment|prepaid)' then 'assets.current_prepayments'
        when label ~ '\mdeposits?\M' and label !~ '(fixed deposit|term deposit|bank deposit)' then 'assets.current_deposits'
        when context ~ '(trade debtors|trade receivables)' then 'assets.receivables'
        when label ~ '(petty cash|cash in hand|cash at bank)' or context ~ '(cash at bank|cash in hand|petty cash)' or
          (p_code ~ '^31[0-9]-' and context ~ '\m(bank|cash)\M' and label ~ 'current account') then 'assets.cash'
        when label ~ '(fixed deposit|term deposit|bank deposit|current account)' then null
        when context ~ '\m(stock|inventory)\M' then case
          when label ~ '(raw material)' then 'assets.inventory.raw_materials'
          when label ~ '(work.in.progress|\mwip\M)' then 'assets.inventory.work_in_progress'
          when label ~ '(finished goods)' then 'assets.inventory.finished_goods'
          when label ~ '\mmerchandise\M' then 'assets.inventory.merchandise'
          else 'assets.inventory' end
        else 'assets.current_other' end
      when scope='current_liability' then case
        when label ~ '(related.party|intercompany|inter.company)' then 'liabilities.current_related_party'
        when label ~ '(lease liabilit|lease payable)' then 'liabilities.current_lease'
        when label ~ '\m(epf|socso|eis|sip|kwsp|perkeso|pcb)\M' then 'liabilities.statutory_payables'
        when label ~ '(income tax payable|corporate tax payable)' then 'liabilities.current_tax_payable'
        when label ~ '(service tax|sales tax|vat|gst|sst).*payable' then 'liabilities.indirect_tax_payable'
        when label ~ '(customer deposits?|advance from customers)' then 'liabilities.current_deposits'
        when label ~ '(bank loan|bank overdraft|current portion.*(loan|borrowings))' then 'liabilities.current_borrowings'
        when label ~ '\m(loan|borrowings|sales tax|service tax|service charge|vat|gst|sst)\M' then null
        when context ~ '(trade creditors|trade payables)' then 'liabilities.payables'
        when context ~ '\m(accrual|accruals|accrued)\M' then 'liabilities.accruals'
        else 'liabilities.current_other' end
      when scope='noncurrent_liability' then case
        when label ~ '(related.party|intercompany|inter.company)' then 'liabilities.noncurrent_related_party'
        when label ~ '(deferred tax liabilit)' then 'liabilities.deferred_tax'
        when label ~ '(lease liabilit|lease payable)' then 'liabilities.noncurrent_lease'
        when label ~ '(deposit received|deposits received)' then 'liabilities.noncurrent_deposits'
        when label ~ '\m(loan|borrowings)\M' then 'liabilities.borrowings'
        else 'liabilities.noncurrent_other' end
      when scope='capital' then case
        when label ~ '(share premium)' then 'equity.share_premium'
        when label ~ '(treasury share)' then 'equity.treasury_shares'
        when label ~ '(owner drawings|dividend distribution)' then 'equity.owner_drawings'
        else 'equity.capital' end
      when scope='retained_equity' then case
        when label ~ '\m(reserve|reserves)\M' then 'equity.reserves'
        when label ~ '(owner drawings|dividend distribution)' then 'equity.owner_drawings'
        else 'equity.retained_earnings' end
      end as id
    from words
  )
  select id from candidate where finance_private.account_mapping_allowed(id,scope);
$$;

revoke all on function finance_private.account_mapping_source_scope(text,text),
  finance_private.account_mapping_allowed(text,text), finance_private.account_mapping_core_suggestion(text)
  from public,anon,authenticated,service_role;

create or replace function public.finance_account_mapping_review(
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
  incompatible_count integer;
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
      select r.*,item->>'expectedVersion' as expected_version,item->>'classificationId' as target
      from jsonb_array_elements(p_decisions) item
      left join finance_private.account_mapping_rows(source.id,snapshot.id,baseline_id,source.provider) r on r.account_key=item->>'accountKey'
    )
    select
      count(*) filter (where account_key is null or role<>'posting' or
        (not (status='confirmed' and classification=target) and version is distinct from expected_version)),
      count(*) filter (where account_key is not null and role='posting'
        and not (status='confirmed' and classification is not distinct from target)
        and not finance_private.account_mapping_allowed(target,finance_private.account_mapping_source_scope(source.provider,source_type)))
    into invalid_count,incompatible_count from selected;
    if invalid_count>0 then raise sqlstate 'PT409' using message='Accounts or reviews changed. Refresh before confirming.'; end if;
    if incompatible_count>0 then raise sqlstate 'PT422' using message='Classification is incompatible with the accepted source type'; end if;

    insert into finance_private.account_mapping_reviews(connection_id,account_key,coa_snapshot_id,source_fingerprint,classification_id,decision,reviewed_by)
    select source.id,r.account_key,snapshot.id,r.fingerprint,item->>'classificationId',
      case when item->>'classificationId' in (r.suggestion,finance_private.account_mapping_core_suggestion(r.suggestion))
        then 'suggestion' else 'manual' end,auth.uid()
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
  ,case when not p_summary_only then coalesce(jsonb_agg((to_jsonb(review)-'fingerprint') || jsonb_build_object(
      'source_scope',finance_private.account_mapping_source_scope(source.provider,source_type),
      'core_suggestion',finance_private.account_mapping_core_suggestion(suggestion)
    ) order by account_key collate "C"),'[]'::jsonb) end
  into summary,rows from review;
  return jsonb_build_object('connectionId',source.id,'snapshotId',snapshot.id::text,'snapshotAt',snapshot.accepted_at,'summary',summary,
    'rows',rows,'classifications',case when not p_summary_only then
      (select jsonb_agg(to_jsonb(f) order by f.sort_order) from finance_private.financial_classifications f) end);
end;
$$;
