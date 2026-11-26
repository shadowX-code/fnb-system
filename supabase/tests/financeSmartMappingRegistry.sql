-- Read-only checks for the analytical registry and AutoCount evidence adapter.
do $$
begin
  assert not exists (
    select 1 from finance_private.financial_classifications f
    join finance_private.financial_classifications p on p.id=f.parent_id
    where f.statement<>p.statement or not (f.source_scopes <@ p.source_scopes)
      or (p.industry is not null and f.industry is distinct from p.industry)
  ), 'Children must stay inside their parent statement, source scope and industry';
  assert (
    select count(distinct industry)=3 from finance_private.financial_classifications where industry is not null
  ), 'All three industry extensions must be registered';
  assert finance_private.suggest_account_classification('autocount','X','FA','Accum. Deprn. - Equipment',null)
    = 'assets.accumulated_depreciation', 'Fixed asset and accumulated depreciation must have separate destinations';
  assert finance_private.suggest_account_classification('autocount','X','EP','Depreciation',null)
    = 'depreciation_amortisation.depreciation', 'Expense depreciation must stay outside the asset category';
  assert finance_private.suggest_account_classification('autocount','X','CO','Factory depreciation',null)
    = 'cogs.manufacturing_overhead.depreciation', 'Production depreciation already in COGS must have a distinct destination';
  assert finance_private.suggest_account_classification('autocount','X','CO','Direct production labour',null)
    = 'cogs.direct_production_labour', 'Production labour already in COGS must use the COGS branch only';
  assert finance_private.suggest_account_classification('autocount','X','EP','Direct production labour',null) is null,
    'Conflicting production cost evidence must stay in review';
  assert finance_private.suggest_account_classification('autocount','X','CO','Stocks at the end of year',null)
    = 'cogs.inventory_adjustments.closing', 'Closing stock adjustment must stay within COGS';
  assert finance_private.suggest_account_classification('autocount','X','CA','Stock',null)
    = 'assets.inventory', 'Inventory balance must stay within assets';
  assert finance_private.suggest_account_classification('autocount','X','CL','Accruals - EPF',null)
    = 'liabilities.statutory_payables', 'Payroll liabilities must stay outside labour expense';
  assert finance_private.suggest_account_classification('autocount','X','EP','Sales tax - delivery platform',null) is null,
    'An expense label alone cannot establish tax treatment';
  assert finance_private.suggest_account_classification('autocount','X','CA','Loan to example company',null)
    = 'assets.current_other', 'A named counterparty does not establish related-party treatment';
  assert finance_private.suggest_account_classification('autocount','X','??','Cash at bank',null) is null,
    'A name alone cannot establish source compatibility';
  assert finance_private.account_mapping_core_suggestion('revenue.operating_sales.delivery_platform')
    = 'revenue.operating_sales', 'An optional extension must have a core fallback';
  assert not finance_private.account_mapping_allowed('assets.current','current_asset')
    and not finance_private.account_mapping_allowed('assets.accumulated_depreciation','expense')
    and not finance_private.account_mapping_allowed('unregistered','revenue'), 'Reject grouping nodes, cross-scope and unknown destinations';
end $$;
select 'finance_smart_mapping_registry = PASS' as result;
