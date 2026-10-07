import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AdminAnalyticalSurface, { AdminAnalyticalContext, AdminEvidenceDisclosure, AdminAnalyticalReadiness } from '../AdminAnalyticalSurface.jsx';
afterEach(cleanup);
it('shares canonical mode navigation, loading, selected context and progressive evidence without domain knowledge',()=>{
 const change=vi.fn(), action=vi.fn();
 const view=render(<AdminAnalyticalSurface label="Analysis view" title="Operations analysis" modes={['Pressure','Trend']} value="Pressure" onChange={change} loading><svg role="img" aria-label="Domain field" /></AdminAnalyticalSurface>);
 expect(screen.getByRole('heading',{name:'Operations analysis'})).toBeTruthy();
 expect(screen.getByRole('tabpanel',{name:'Pressure'}).getAttribute('aria-busy')).toBe('true');
 expect(screen.getByRole('status').textContent).toContain('Loading analysis');
 fireEvent.keyDown(screen.getByRole('tab',{name:'Pressure'}),{key:'ArrowRight'});
 expect(change).toHaveBeenCalledWith('Trend');
 view.rerender(<AdminAnalyticalSurface label="Analysis view" title="Operations analysis" modes={['Pressure','Trend']} value="Trend" onChange={change} readiness={<AdminAnalyticalReadiness title="Evidence pending" action={<button>Review sources</button>}/>}><AdminAnalyticalContext label="Selected driver" actions={['Explain','Compare']} action="Explain" onAction={action} evidence={<AdminEvidenceDisclosure label="Evidence details">Supplied evidence</AdminEvidenceDisclosure>}>Domain explanation</AdminAnalyticalContext></AdminAnalyticalSurface>);
 expect(screen.getByRole('region',{name:'Selected analysis context'}).textContent).toContain('Domain explanation');
 expect(screen.getByText('Evidence details').closest('details').open).toBe(false);
 fireEvent.click(screen.getByRole('tab',{name:'Compare'}));
 expect(action).toHaveBeenCalledWith('Compare');
});
