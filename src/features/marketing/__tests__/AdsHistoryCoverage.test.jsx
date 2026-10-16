import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import AdsHistoryCoverage from '../AdsHistoryCoverage.jsx';
afterEach(cleanup);
it('explains an unsynced period outside the request window and makes no implicit request',()=>{
 const sync=vi.fn();render(<AdsHistoryCoverage data={{coverage:[{connection_id:'a',request_floor:'2023-09-16',ranges:[]}]}} account={{id:'a',name:'Shared',account_id:'123'}} from="2020-01-01" to="2020-12-31" onSync={sync}/>);
 expect(screen.getByText(/starts before the request window/).textContent).toContain('2023-09-16');
 expect(screen.queryByRole('button',{name:'Sync selected period'})).toBeNull();expect(sync).not.toHaveBeenCalled();
});
it('removes redundant per-period sync actions',()=>{
 const sync=vi.fn();render(<AdsHistoryCoverage data={{coverage:[{connection_id:'a',request_floor:'2023-09-16',ranges:[]}]}} account={{id:'a',name:'Shared',account_id:'123'}} from="2025-10-17" to="2026-10-16" onSync={sync}/>);
 expect(sync).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Sync selected period'})).toBeNull();
});

it('does not call provider-denied campaign rows no activity',()=>{
 render(<AdsHistoryCoverage data={{reports:[{connection_id:'a',date_from:'2025-10-17',date_to:'2026-10-16',payload:{warnings:{campaign:'meta_error_100'}}}]}} account={{id:'a',name:'Shared'}} from="2025-10-17" to="2026-10-16"/>);
 expect(screen.getByText(/observed with partial provider availability/)).toBeTruthy();expect(screen.queryByText(/Missing campaign rows mean no activity/)).toBeNull();
});

it('explains a contained subperiod without claiming campaign daily coverage or requesting data',()=>{
 const sync=vi.fn();render(<AdsHistoryCoverage data={{coverage:[{connection_id:'a',ranges:[{from:'2025-10-17',to:'2026-10-16',observed_at:'2026-10-16T05:35:04Z'}]}]}} account={{id:'a',name:'Shared',account_id:'123'}} from="2026-04-20" to="2026-07-18" onSync={sync}/>);
 expect(screen.getByText(/A broader report/).textContent).toContain('campaign totals cannot be split');
 expect(screen.getByText(/A broader report/).textContent).toContain('2025-10-17–2026-10-16');
 expect(screen.queryByRole('button',{name:'Sync selected period'})).toBeNull();expect(sync).not.toHaveBeenCalled();
});
it('distinguishes overlapping coverage from a period with no observations',()=>{
 render(<AdsHistoryCoverage data={{coverage:[{connection_id:'a',ranges:[{from:'2026-06-01',to:'2026-08-01'}]}]}} account={{id:'a',name:'Shared'}} from="2026-04-20" to="2026-07-18"/>);
 expect(screen.getByText(/overlap part of this selection/)).toBeTruthy();
});
