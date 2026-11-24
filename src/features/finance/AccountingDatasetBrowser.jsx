import { useEffect, useId, useRef, useState } from 'react';
import Modal from '../../components/feedback/Modal.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import { readAccountingDataset } from './dataSources.js';

export const accountingDatasets = { COA: 'Chart of accounts', GL: 'General ledger', Department: 'Departments', Project: 'Projects' };
const fields = {
  COA: [['key', 'Account'], ['description', 'Description'], ['parent', 'Parent account'], ['type', 'Source type'], ['currency', 'Currency']],
  GL: [['key', 'Journal line'], ['account', 'Account'], ['department', 'Department'], ['project', 'Project'], ['currency', 'Currency'],
    ['debit', 'Debit'], ['credit', 'Credit'], ['homeDebit', 'Home debit'], ['homeCredit', 'Home credit']],
  Department: [['key', 'Department'], ['description', 'Description'], ['parent', 'Parent department'], ['active', 'Active at source']],
  Project: [['key', 'Project'], ['description', 'Description'], ['parent', 'Parent project'], ['active', 'Active at source']],
};
const datasets = Object.entries(accountingDatasets).map(([value, label]) => ({ value, label: value === 'COA' || value === 'GL' ? value : label }));

export function glCoverageText(coverage, { includeRows = false } = {}) {
  const accepted = coverage?.acceptedDays
    ? `${coverage.firstDate} to ${coverage.throughDate} · ${coverage.acceptedDays} accepted days · ${coverage.emptyDays} with no postings`
    : 'No accepted GL days yet';
  const gap = coverage?.remainingDays > 0
    ? `Backfill · ${coverage.remainingDays} ${coverage.remainingDays === 1 ? 'day' : 'days'} pending · Next ${coverage.nextMissingDate}`
    : coverage?.contiguousThrough
      ? `Complete through ${coverage.contiguousThrough}`
      : coverage?.missingDays > 0 ? `${coverage.missingDays} days missing within accepted span` : '';
  const rows = includeRows && coverage?.acceptedDays ? `${coverage.acceptedRows.toLocaleString('en-MY')} accepted GL rows across all dates` : '';
  return [accepted, gap, rows].filter(Boolean).join(' · ');
}

function DatasetTable({ connection, dataset, timestamp, onReviewMapping }) {
  const [filters, setFilters] = useState(() => ({ search: '', date: dataset === 'GL' ? connection.glCoverage?.latestPostingDate ?? '' : '' }));
  const [input, setInput] = useState(filters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const snapshot = useRef(null);
  const date = filters.date;
  const search = filters.search;
  useEffect(() => {
    let active = true;
    const pin = snapshot.current?.date === date ? snapshot.current.id : null;
    readAccountingDataset({ connectionId: connection.connection.id, dataset, search, scopeDate: date, snapshotId: pin, page, pageSize })
      .then((data) => {
        if (!active) return;
        snapshot.current = { date, id: data.snapshotId };
        setResult(data);
      }).catch((failure) => {
        if (active) setError(['PT403', 'PT404'].includes(failure.code) ? 'This source or snapshot is unavailable.' : 'Accepted records could not be loaded.');
      });
    return () => { active = false; };
  }, [connection.connection.id, dataset, search, date, page, pageSize, attempt]);

  function applyFilters(event) {
    event.preventDefault();
    const nextSearch = input.search.trim();
    if (input.date === date && nextSearch === search && page === 1) return;
    setResult(null);
    setError('');
    setPage(1);
    setFilters({ date: input.date, search: nextSearch });
  }

  const columns = fields[dataset].map(([key, header]) => ({
    key, header, align: /debit|credit/i.test(key) ? 'right' : undefined,
    render: (row) => typeof row[key] === 'boolean' ? (row[key] ? 'Yes' : 'No') : (row[key] ?? '—'),
  }));
  return <div className="grid min-w-0 gap-3">
    {dataset === 'GL' && <p className="type-caption text-text-secondary">{glCoverageText(connection.glCoverage, { includeRows: true })}.</p>}
    <form aria-label="Find accepted records" className="flex flex-wrap items-end gap-2" onSubmit={applyFilters}>
      {dataset === 'GL' && <label className="grid gap-1 type-caption">Posting date
        <input type="date" className="control" value={input.date} onChange={(event) => setInput({ ...input, date: event.target.value })} />
      </label>}
      <AdminSearchField label="Search records" value={input.search} maxLength={128} onChange={(value) => setInput({ ...input, search: value })} />
      <button type="submit" className="btn-secondary">Apply</button>
    </form>
    <AsyncDataSurface loading={!result && !error} error={error} hasData={Boolean(result)} onRetry={() => { setError(''); setAttempt((value) => value + 1); }}>
      {result && <>
        <p className="type-caption text-text-secondary" aria-live="polite">
          {result.snapshotId ? `Accepted snapshot ${timestamp(result.snapshotAt)} · ${result.acceptedRows.toLocaleString('en-MY')} records` : 'No accepted snapshot for this selection'}
          {result.scopeDate ? ` · Posting date ${result.scopeDate}` : ''}
        </p>
        {result.rows.length ? <>
          <DataTable columns={columns} rows={result.rows} getRowKey={(row) => row.key} density="compact" minWidth={dataset === 'GL' ? 880 : 530} />
          <AdminPagination compact page={page} total={result.filteredRows} pageSize={pageSize}
            onPageChange={(value) => { setResult(null); setPage(value); }}
            onPageSizeChange={(value) => { setResult(null); setPage(1); setPageSize(value); }} />
        </> : result.snapshotId && <p className="type-body-sm text-text-secondary" role="status">
          {result.acceptedRows > 0 ? 'No records match this search.' : dataset === 'GL' ? 'The accepted extraction found no postings for this date.' : 'The accepted snapshot contains no source records.'}
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
        <h3 className="type-body-sm font-semibold">{accountingDatasets[dataset]}</h3>
        <DatasetTable key={dataset} connection={connection} dataset={dataset} timestamp={timestamp} onReviewMapping={onReviewMapping} />
      </section>
    </div>
  </Modal>;
}
