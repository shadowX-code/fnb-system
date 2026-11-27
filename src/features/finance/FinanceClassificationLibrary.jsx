import { useState } from 'react';
import Drawer from '../../components/ui/Drawer.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';

const industries = { restaurant: 'Restaurant', manufacturing: 'Manufacturing', retail: 'Retail' };
const statements = { profit_loss: 'Profit & Loss', balance_sheet: 'Balance Sheet' };
const definitions = {
  revenue: 'Income from ordinary sales or services, including source-defined sales adjustments.',
  'revenue.operating_sales': 'Ordinary trading sales before separately recorded returns and discounts.',
  'revenue.services': 'Fees earned for providing services.',
  'revenue.wholesale': 'Sales through wholesale or distribution channels.',
  'revenue.sales_adjustments': 'Source-recorded adjustments to ordinary sales, such as discounts or returns.',
  'revenue.sales_adjustments.returns': 'Sales reversed because goods or services were returned.',
  'revenue.sales_adjustments.discounts': 'Discounts and rebates recorded as reductions to sales.',
  cogs: 'Costs the source includes in cost of sales, including separately identified production costs.',
  'cogs.direct_materials': 'Materials consumed directly in making goods for sale.',
  'cogs.direct_production_labour': 'Direct production wages already included in source cost of sales.',
  'cogs.manufacturing_overhead': 'Source cost-of-sales accounts for indirect production expenses.',
  'cogs.manufacturing_overhead.depreciation': 'Production depreciation already included in source cost of sales.',
  'cogs.inventory_adjustments': 'Inventory movements and adjustments recorded in cost of sales.',
  'cogs.inventory_adjustments.opening': 'Opening stock recorded as a component of cost of sales.',
  'cogs.inventory_adjustments.closing': 'Closing stock recorded as a component of cost of sales.',
  'cogs.inventory_adjustments.shrinkage': 'Retail inventory losses recorded in cost of sales.',
  'cogs.purchase_returns': 'Source-recorded returns to suppliers that adjust purchase costs.',
  'cogs.inbound_freight': 'Freight to bring goods in when recorded in cost of sales.',
  labour: 'Payroll and related labour expense recorded outside source cost of sales.',
  'labour.statutory': 'Employer statutory payroll costs recorded as expenses.',
  'labour.contract': 'Contract staff costs recorded outside source cost of sales.',
  opex: 'Expenses for running the business outside cost of sales and separately classified labour, depreciation, finance and tax.',
  'opex.delivery.platform_commissions': 'Commissions charged by delivery sales platforms.',
  'opex.merchant_fees': 'Merchant settlement and payment processing fees.',
  other_income: 'Income outside ordinary trading revenue.',
  'other_income.other_recoveries': 'Incidental collections or cost recoveries recorded as other income.',
  other_expense: 'Expenses outside the company’s ordinary operations.',
  depreciation_amortisation: 'Expense for allocating the cost of long-lived assets over time, outside source cost of sales.',
  'depreciation_amortisation.depreciation': 'Period depreciation expense outside source cost of sales.',
  'depreciation_amortisation.amortisation': 'Period amortisation expense outside source cost of sales.',
  finance_cost: 'Interest and other costs of financing recorded as expenses.',
  'finance_cost.lease_interest': 'The interest portion of lease expense.',
  income_tax: 'Current and deferred income tax expense recorded in the period.',
  assets: 'Asset balances recorded by the source.',
  'assets.current': 'Assets classified as current by the source.',
  'assets.noncurrent': 'Assets classified as non-current by the source.',
  'assets.cash': 'Cash and balances recorded as cash equivalents in the source.',
  'assets.receivables': 'Amounts due from customers on ordinary trade.',
  'assets.receivables_allowance': 'Loss allowance associated with trade receivables.',
  'assets.inventory': 'Inventory balances at the reporting date.',
  'assets.inventory.work_in_progress': 'Costs carried in partly completed inventory.',
  'assets.fixed': 'Property, plant and equipment recorded as asset balances.',
  'assets.intangibles': 'Intangible asset balances such as goodwill and licences.',
  'assets.accumulated_depreciation': 'Cumulative depreciation against fixed assets on the balance sheet.',
  'assets.accumulated_amortisation': 'Cumulative amortisation against intangible assets on the balance sheet.',
  'assets.right_of_use': 'Assets recognised for the right to use leased property or equipment.',
  'assets.current_prepayments': 'Payments for future goods or services classified as current assets.',
  'assets.current_deposits': 'Recoverable deposits classified as current assets.',
  'assets.current_deposits_prepayments': 'Deposits and prepayments combined in a single current-asset account.',
  'assets.current_related_party': 'Amounts receivable from related parties classified as current.',
  'assets.noncurrent_related_party': 'Amounts receivable from related parties classified as non-current.',
  liabilities: 'Obligations recorded by the source.',
  'liabilities.current': 'Liabilities classified as current by the source.',
  'liabilities.noncurrent': 'Liabilities classified as non-current by the source.',
  'liabilities.payables': 'Amounts owed to suppliers on ordinary trade.',
  'liabilities.accruals': 'Expenses incurred with settlement or invoicing still outstanding.',
  'liabilities.current_borrowings': 'Borrowing balances and portions classified as current.',
  'liabilities.borrowings': 'Borrowing balances and portions classified as non-current.',
  'liabilities.statutory_payables': 'Amounts owed to payroll and statutory authorities.',
  'liabilities.indirect_tax_payable': 'Sales, service or other indirect tax obligations.',
  'liabilities.deferred_tax': 'Future income tax obligations recognised as deferred tax.',
  'liabilities.current_lease': 'Lease obligations classified as current by the source.',
  'liabilities.noncurrent_lease': 'Lease obligations classified as non-current by the source.',
  equity: 'Owners’ residual interest recorded in the balance sheet.',
  'equity.capital': 'Capital contributed by the owners.',
  'equity.retained_earnings': 'Accumulated earnings retained in the business.',
  'equity.treasury_shares': 'The entity’s own shares held in treasury.',
  'equity.owner_drawings': 'Withdrawals and distributions recorded against owners’ equity.',
  'revenue.operating_sales.dine_in': 'Sales of food and drinks consumed on premises.',
  'revenue.operating_sales.takeaway': 'Direct sales fulfilled for takeaway or collection.',
  'revenue.operating_sales.delivery_platform': 'Trading revenue attributed to third-party delivery platforms.',
  'revenue.operating_sales.manufactured_goods': 'Sales of goods manufactured by the business.',
  'revenue.operating_sales.in_store': 'Retail sales transacted at a physical store.',
  'revenue.operating_sales.online_retail': 'Retail sales transacted through online channels.',
  'cogs.food': 'Food inputs charged to restaurant cost of sales.',
  'cogs.beverage': 'Drink and beverage inputs charged to restaurant cost of sales.',
  'cogs.packaging': 'Packaging costs recorded in source cost of sales.',
  'cogs.manufacturing_overhead.utilities': 'Factory energy and utilities included in production cost of sales.',
  'cogs.manufacturing_overhead.indirect_labour': 'Indirect workforce cost included in production cost of sales.',
  'cogs.manufacturing_overhead.outsourced_processing': 'Third-party production or processing charges included in cost of sales.',
  'cogs.merchandise': 'The cost of retail merchandise sold.',
  'labour.salary': 'Base wages and salaries recorded outside cost of sales.',
  'labour.overtime': 'Overtime compensation recorded outside cost of sales.',
  'labour.other_labour': 'Other staff-related expense outside cost of sales.',
  'labour.benefits': 'Employee benefits and allowances recorded as labour expense.',
  'opex.occupancy': 'Operating costs for occupying business premises.',
  'opex.utilities': 'Utilities recorded as operating expenses outside production cost of sales.',
  'opex.marketing': 'Spending on advertising, promotion and customer acquisition.',
  'opex.delivery': 'Delivery costs recorded as operating expenses.',
  'opex.repairs_maintenance': 'Costs for maintaining and repairing existing assets.',
  'opex.software': 'Software and technology subscription costs.',
  'opex.professional_fees': 'Fees for legal, accounting, advisory and similar services.',
  'opex.other_operating_expense': 'Other costs of ordinary operations without a separate classification.',
  'opex.equipment_rental': 'Rental of equipment recorded as operating expense.',
  'opex.office_admin': 'General office supplies and administration expenses.',
  'opex.insurance': 'Insurance premiums recorded as operating expenses.',
  'opex.licences': 'Operating licences, permits and similar compliance fees.',
  'opex.store_supplies': 'Retail store consumables recorded as operating expenses.',
  'other_income.interest': 'Interest received or earned and recorded as other income.',
  'other_income.disposal_gain': 'Gain recognised on disposing of an asset.',
  'other_expense.disposal_loss': 'Loss recognised on disposing of an asset.',
  'other_expense.impairment': 'Impairment loss recorded outside ordinary operations.',
  'finance_cost.interest': 'Interest charged on financing balances.',
  'income_tax.current': 'Current income tax charge on the period’s taxable results.',
  'income_tax.deferred': 'Period change in income tax expense from temporary differences.',
  'assets.current_other': 'Current assets without a separate analytical classification.',
  'assets.noncurrent_other': 'Non-current assets without a separate analytical classification.',
  'assets.noncurrent_deposits': 'Recoverable deposits classified as non-current assets.',
  'assets.noncurrent_prepayments': 'Payments for future goods or services classified as non-current assets.',
  'assets.current_tax_receivable': 'Tax refunds or overpayments recoverable as current assets.',
  'assets.deferred_tax': 'Recognised deferred tax benefits from eligible temporary differences or losses.',
  'assets.inventory.raw_materials': 'Unprocessed materials held for production.',
  'assets.inventory.finished_goods': 'Completed products held for sale.',
  'assets.inventory.merchandise': 'Stock acquired for retail resale.',
  'liabilities.current_other': 'Current obligations without a separate analytical classification.',
  'liabilities.noncurrent_other': 'Non-current obligations without a separate analytical classification.',
  'liabilities.current_related_party': 'Amounts owed to related parties classified as current.',
  'liabilities.noncurrent_related_party': 'Amounts owed to related parties classified as non-current.',
  'liabilities.current_tax_payable': 'Outstanding current income tax liability.',
  'liabilities.current_deposits': 'Deposits and advances received from customers and classified as current.',
  'liabilities.noncurrent_deposits': 'Deposits received that the source classifies as non-current.',
  'equity.share_premium': 'Contributed capital recorded above the nominal value of shares.',
  'equity.reserves': 'Equity reserves separately recorded from contributed capital and retained earnings.',
};

export default function FinanceClassificationLibrary({ classifications, rows, onClose }) {
  const [search, setSearch] = useState('');
  const children = new Map();
  for (const entry of classifications) {
    if (!children.has(entry.parent_id)) children.set(entry.parent_id, []);
    children.get(entry.parent_id).push(entry);
  }
  const mapped = new Map();
  for (const row of rows) {
    if (row.status === 'confirmed') mapped.set(row.classification, (mapped.get(row.classification) ?? 0) + 1);
  }
  const needle = search.trim().toLowerCase();
  const ordered = [];
  function visit(entry, parent, depth, path) {
    const scope = industries[entry.industry] ?? 'Core';
    const definition = definitions[entry.id] ?? (parent
      ? `Accounts for ${entry.label.toLowerCase()} within ${parent.label.toLowerCase()}.`
      : entry.label);
    const branch = [...path, entry.label];
    const terms = [entry.id, statements[entry.statement], ...branch, scope, definition];
    if (terms.some((term) => term.toLowerCase().includes(needle))) ordered.push({ entry, branch, depth, definition, scope });
    for (const child of children.get(entry.id) ?? []) visit(child, entry, depth + 1, branch);
  }
  for (const root of children.get(null) ?? []) visit(root, null, 0, []);
  return <Drawer title="Classification library" description={`${classifications.length} system-managed categories · Direct confirmed mappings for this Account Book`}
    onClose={onClose} width="lg" bodyClassName="space-y-4">
    <AdminSearchField label="Search classifications" value={search} onChange={setSearch} />
    {!ordered.length && <p className="type-body-sm text-text-secondary">No classifications match this search.</p>}
    {Object.entries(statements).map(([statement, title]) => {
      const entries = ordered.filter(({ entry }) => entry.statement === statement);
      return entries.length > 0 && <section key={statement} aria-label={title}>
        <h3 className="type-section-title font-semibold">{title}</h3>
        <ul className="divide-y divide-border">
          {entries.map(({ entry, branch, depth, definition, scope }) => <li key={entry.id} className="flex items-start justify-between gap-3 py-3"
            style={{ paddingInlineStart: needle ? 0 : Math.min(depth, 3) * 12 }}>
            <div className="min-w-0">
              {needle && depth > 0 && <p className="type-caption text-text-secondary">{branch.slice(0, -1).join(' / ')}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <span className="type-body-sm font-semibold">{entry.label}</span>
                <StatusBadge status="neutral">{scope}</StatusBadge>
              </div>
              <p className="mt-1 type-body-sm text-text-secondary">{definition}</p>
              <p className="mt-0.5 break-words type-caption text-text-secondary">{entry.id}{!entry.selectable ? ' · Group' : ''}</p>
            </div>
            {entry.selectable && <span className="shrink-0 type-caption text-text-secondary"><strong className="tabular-nums text-text-primary">{mapped.get(entry.id) ?? 0}</strong> mapped</span>}
          </li>)}
        </ul>
      </section>;
    })}
  </Drawer>;
}
