import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import MetricCard from '../MetricCard.jsx';

afterEach(cleanup);

describe('shared metric evidence states', () => {
  it('keeps neutral changes neutral and supporting values distinct from the main amount', () => {
    const view = render(<MetricCard presentation="summary" label="Balance" value="RM 100" supportingValue="28 days" delta="+RM 10 vs previous period" deltaTone="neutral" />);
    expect(screen.getByText('+RM 10 vs previous period').className).toContain('text-text-secondary');
    expect(screen.getByText('28 days')).toBeTruthy();
    view.rerender(<MetricCard label="Balance" value="RM 100" delta="+RM 10" deltaTone="negative" />);
    expect(screen.getByText('+RM 10').className).toContain('text-rose-700');
  });
  it('withholds amounts, deltas and trends while loading or awaiting evidence', () => {
    const view = render(<MetricCard label="Amount" value="RM 999" delta="+RM 10" state="loading" />);
    expect(screen.queryByText('RM 999')).toBeNull();
    expect(screen.queryByText('+RM 10')).toBeNull();
    expect(screen.getByLabelText('Loading value').closest('[aria-busy=true]')).toBeTruthy();
    view.rerender(<MetricCard label="Amount" value="RM 999" state="unavailable" />);
    expect(screen.getByLabelText('Evidence not ready')).toBeTruthy();
  });
  it('renders only explicit labeled trends without implying history from unlabeled arrays', () => {
    const view = render(<MetricCard label="Amount" value={100} sparklineData={[80,100]} />);
    expect(screen.queryByRole('img')).toBeNull();
    view.rerender(<MetricCard label="Amount" value={100} sparklineLabel="Monthly amount evidence" sparklineData={[{label:'Sep',value:80},{label:'Oct',value:100}]} />);
    expect(screen.getByRole('img',{name:'Monthly amount evidence'}).textContent).toContain('Sep: 80; Oct: 100');
  });
});
