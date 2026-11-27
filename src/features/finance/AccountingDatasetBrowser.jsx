import { useEffect, useId, useRef, useState } from 'react';
import Modal from '../../components/feedback/Modal.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import MonthPickerField from '../../components/forms/MonthPickerField.jsx';
import FeedXDateRangePicker from '../../components/ui/FeedXDateRangePicker.jsx';
import { operationalDateKey } from '../../lib/dateTime.js';
import { currentFinanceMonth } from './presentation.js';
import { monthlyPeriod } from './foundation.js';
import { readAcceptedGl, readAccountingDataset } from './dataSources.js';

export const accountingDatasets = { COA: 'Chart of accounts', GL: 'General ledger', Department: 'Departments', Project: 'Projects' };
const fields = {
  COA: [['key', 'Account'], ['description', 'Description'], ['parent', 'Parent account'], ['type', 'Source type'], ['currency', 'Currency']],
  Department: [['key', 'Department'], ['description', 'Description'], ['parent', 'Parent department'], ['active', 'Active at source']],
  Project: [['key', 'Project'], ['description', 'Description'], ['parent', 'Parent project'], ['active', 'Active at source']],
};
const datasets = Object.entries(accountingDatasets).map(([value, label]) => ({ value, label: value === 'COA' || value === 'GL' ? value : label }));
const postingPeriods = [{ value: 'all', label: 'All dates' }, { value: 'month', label: 'By month' }, { value: 'range', label: 'Date range' }];
const amountBases = [{ value: 'original', label: 'Original currency' }, { value: 'home', label: 'Book home currency' }];
const amountFormat = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 20 });
const amount = (value) => value == null || value === '' ? '—' : amountFormat.format(value);

function AcceptedGlTable({ connection, timestamp }) {
  const [period, setPeriod] = useState('all');
  const [month, setMonth] = useState(connection.glCoverage?.latestPostingDate?.slice(0, 7) ?? currentFinanceMonth());
  const [range, setRange] = useState({ from: '', to: '' });
  const [account, setAccount] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [basis, setBasis] = useState('original');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(null);
  const [error, setError] = useState('');
  const pin = useRef(null);
  const window = period === 'month' ? monthlyPeriod(month) : null;
  const from = window?.start ?? (period === 'range' ? range.from : '');
  const to = window?.end ?? (period === 'range' ? range.to : '');
  const hasRange = period !== 'range' || Boolean(from && to);
  const connectionId = connection.connection.id;
  const requestKey = JSON.stringify([connectionId, from, to, account, search, page, pageSize, attempt]);
  const result = loaded?.key === requestKey ? loaded.data : null;
  useEffect(() => {
    if (!hasRange) return undefined;
    let current = true;
    setError('');
    Promise.resolve().then(() => readAcceptedGl({ connectionId, from, to, ...pin.current, account, search, page, pageSize }))
      .then((data) => {
        if (!current) return;
        pin.current = { asOf: data.asOf, coaSnapshotId: data.coaSnapshotId };
        setLoaded({ key: requestKey, data });
      }).catch((failure) => {
        if (current) setError(['PT403', 'PT404'].includes(failure.code) ? 'This accounting source is unavailable.' : 'Accepted GL records could not be loaded.');
      });
    return () => { current = false; };
  }, [connectionId, from, to, hasRange, account, search, page, pageSize, requestKey]);

  function changeFilter(setter, value) { setPage(1); setError(''); setter(value); }
  const accountOptions = [{ value: '', label: 'All accounts' }, ...(loaded?.data.accounts ?? []).map(({ code, name }) => ({
    value: code, label: name ? `${code} · ${name}` : code,
  }))];
  if (account && !accountOptions.some((option) => option.value === account)) accountOptions.push({ value: account, label: account });
  const coverage = result?.coverage;
  const columns = [
    { key: 'postingDate', header: 'Posted', className: 'whitespace-nowrap' },
    { key: 'account', header: 'Account', width: 220, render: (row) => <div>
      {row.accountName && <p className="font-medium">{row.accountName}</p>}
      <span className={row.accountName ? 'type-caption text-text-secondary' : 'font-medium'}>{row.account ?? '—'}</span>
    </div> },
    { key: 'key', header: 'Journal line' },
    ...[['reference', 'Reference'], ['description', 'Description'], ['department', 'Department'], ['project', 'Project']]
      .filter(([key]) => result?.columns?.[key]).map(([key, header]) => ({ key, header, render: (row) => row[key] || '—' })),
    ...(basis === 'original' ? [{ key: 'currency', header: 'Currency', render: (row) => row.currency || '—' }] : []),
    ...['Debit', 'Credit'].map((side) => {
      const key = basis === 'home' ? `home${side}` : side.toLowerCase();
      return { key, header: basis === 'home' ? `Home ${side.toLowerCase()}` : side,
        align: 'right', className: 'tabular-nums whitespace-nowrap', render: (row) => amount(row[key]) };
    }),
  ];
  return <div className="grid min-w-0 gap-3">
    <form aria-label="Find accepted GL records" className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); changeFilter(setSearch, query.trim()); }}>
      <SelectField label="Posting period" value={period} options={postingPeriods} onChange={(value) => changeFilter(setPeriod, value)} />
      {period === 'month' && <MonthPickerField label="Posting month" value={month} onChange={(value) => changeFilter(setMonth, value)} />}
      {period === 'range' && <FeedXDateRangePicker label="Posting dates" from={range.from} to={range.to}
        today={operationalDateKey(new Date())}
        onApply={(value) => changeFilter(setRange, value)} />}
      <SelectField label="Account" className="min-w-40 max-w-full sm:max-w-60" searchable value={account} options={accountOptions} onChange={(value) => changeFilter(setAccount, value)} />
      <AdminSearchField label="Search journal lines" value={query} maxLength={128} onChange={setQuery} />
      <button type="submit" className="btn-secondary">Apply search</button>
    </form>
    {!hasRange ? <p className="type-body-sm text-text-secondary">Choose the first and last posting dates.</p>
      : <AsyncDataSurface loading={!result && !error} error={error} hasData={Boolean(result)} onRetry={() => setAttempt((value) => value + 1)}>
        {result && <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="type-body-sm text-text-secondary" aria-live="polite">
              <strong className="text-text-primary">{result.filteredRows.toLocaleString('en-MY')}</strong> {result.filteredRows === result.acceptedRows ? 'accepted lines' : `of ${result.acceptedRows.toLocaleString('en-MY')} accepted lines`}
              {coverage?.acceptedDays > 0 && <> · {coverage.firstDate} – {coverage.throughDate} · {coverage.acceptedDays} accepted days ({coverage.emptyDays} empty)</>}
              {coverage?.missingDays > 0 && <> · {coverage.missingDays} days without coverage</>}
              {connection.glCoverage?.remainingDays > 0 && <> · {connection.glCoverage.remainingDays} backfill days pending</>}
            </p>
            <SelectField ariaLabel="Amount basis" value={basis} options={amountBases} onChange={setBasis} />
          </div>
          {coverage?.latestReceipt && <p className="type-caption text-text-secondary">Latest receipt {timestamp(coverage.latestReceipt)} · Account names from the accepted chart</p>}
          {result.rows.length ? <>
            <DataTable columns={columns} rows={result.rows} getRowKey={(row) => `${row.postingDate}:${row.key}`} density="compact" minWidth={630} />
            <AdminPagination compact page={page} total={result.filteredRows} pageSize={pageSize} onPageChange={setPage}
              onPageSizeChange={(value) => { setPage(1); setPageSize(value); }} />
          </> : <p className="type-body-sm text-text-secondary" role="status">{result.acceptedRows > 0 ? 'No accepted lines match these filters.'
            : coverage?.acceptedDays > 0 ? 'The accepted extraction found no postings in this period.' : 'No accepted GL coverage for this period.'}</p>}
        </>}
      </AsyncDataSurface>}
  </div>;
}

function DatasetTable({ connection, dataset, timestamp, onReviewMapping }) {
  const [search, setSearch] = useState('');
  const [input, setInput] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const snapshot = useRef(null);
  useEffect(() => {
    let active = true;
    readAccountingDataset({ connectionId: connection.connection.id, dataset, search, snapshotId: snapshot.current, page, pageSize })
      .then((data) => {
        if (!active) return;
        snapshot.current = data.snapshotId;
        setResult(data);
      }).catch((failure) => {
        if (active) setError(['PT403', 'PT404'].includes(failure.code) ? 'This source or snapshot is unavailable.' : 'Accepted records could not be loaded.');
      });
    return () => { active = false; };
  }, [connection.connection.id, dataset, search, page, pageSize, attempt]);

  function applyFilters(event) {
    event.preventDefault();
    const nextSearch = input.trim();
    if (nextSearch === search && page === 1) return;
    setResult(null);
    setError('');
    setPage(1);
    setSearch(nextSearch);
  }

  const columns = fields[dataset].map(([key, header]) => ({
    key, header,
    render: (row) => typeof row[key] === 'boolean' ? (row[key] ? 'Yes' : 'No') : (row[key] ?? '—'),
  }));
  return <div className="grid min-w-0 gap-3">
    <form aria-label="Find accepted records" className="flex flex-wrap items-end gap-2" onSubmit={applyFilters}>
      <AdminSearchField label="Search records" value={input} maxLength={128} onChange={setInput} />
      <button type="submit" className="btn-secondary">Apply</button>
    </form>
    <AsyncDataSurface loading={!result && !error} error={error} hasData={Boolean(result)} onRetry={() => { setError(''); setAttempt((value) => value + 1); }}>
      {result && <>
        <p className="type-caption text-text-secondary" aria-live="polite">
          {result.snapshotId ? `Accepted snapshot ${timestamp(result.snapshotAt)} · ${result.acceptedRows.toLocaleString('en-MY')} records` : 'No accepted snapshot for this selection'}
        </p>
        {result.rows.length ? <>
          <DataTable columns={columns} rows={result.rows} getRowKey={(row) => row.key} density="compact" minWidth={530} />
          <AdminPagination compact page={page} total={result.filteredRows} pageSize={pageSize}
            onPageChange={(value) => { setResult(null); setPage(value); }}
            onPageSizeChange={(value) => { setResult(null); setPage(1); setPageSize(value); }} />
        </> : result.snapshotId && <p className="type-body-sm text-text-secondary" role="status">
          {result.acceptedRows > 0 ? 'No records match this search.' : 'The accepted snapshot contains no source records.'}
        </p>}
        {dataset === 'COA' && result.snapshotId && <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-secondary" onClick={onReviewMapping}>Review account mapping</button>
          <span className="type-caption text-text-secondary">Source account types still require classification review.</span>
        </div>}
      </>}
    </AsyncDataSurface>
  </div>;
}

export default function AccountingDatasetBrowser({ connection, initialDataset = 'COA', timestamp, onClose, onReviewMapping }) {
  const [dataset, setDataset] = useState(initialDataset);
  const panelId = useId();
  const source = connection.connection.externalTenantId;
  const book = connection.connector.bookId?.slice(0, 8) ?? connection.connection.id.slice(0, 8);
  return <Modal title="Accepted accounting data" description={`${connection.legalEntityLabel} · ${source} · Book ${book}`} size="xl" onClose={onClose}>
    <div className="grid min-w-0 gap-3">
      <AdminSegmentedControl label="Accounting datasets" value={dataset} options={datasets.map((option) => ({ ...option, panelId }))} onChange={setDataset} />
      <section id={panelId} role="tabpanel" aria-label={accountingDatasets[dataset]} className="grid gap-2">
        {dataset === 'GL' ? <AcceptedGlTable connection={connection} timestamp={timestamp} />
          : <DatasetTable key={dataset} connection={connection} dataset={dataset} timestamp={timestamp} onReviewMapping={onReviewMapping} />}
      </section>
    </div>
  </Modal>;
}
