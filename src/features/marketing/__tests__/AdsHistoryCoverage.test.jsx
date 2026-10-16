import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import AdsHistoryCoverage from '../AdsHistoryCoverage.jsx';
afterEach(cleanup);
it('explains an unsynced period outside the request window and makes no implicit request',()=>{
 const sync=vi.fn();render(<AdsHistoryCoverage data={{coverage:[{connection_id:'a',request_floor:'2023-09-16',ranges:[]}]}} account={{id:'a',name:'Shared',account_id:'123'}} from="2020-01-01" to="2020-12-31" onSync={sync}/>);
 expect(screen.getByText(/starts before the request window/).textContent).toContain('2023-09-16');
 expect(screen.getByRole('button',{name:'Sync selected period'}).disabled).toBe(true);expect(sync).not.toHaveBeenCalled();
});
it('requires an explicit action even when a range is available',()=>{
 const sync=vi.fn();render(<AdsHistoryCoverage data={{coverage:[{connection_id:'a',request_floor:'2023-09-16',ranges:[]}]}} account={{id:'a',name:'Shared',account_id:'123'}} from="2025-10-17" to="2026-10-16" onSync={sync}/>);
 expect(sync).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Sync selected period'}));expect(sync).toHaveBeenCalledOnce();
});

it('does not call provider-denied campaign rows no activity',()=>{
 render(<AdsHistoryCoverage data={{reports:[{connection_id:'a',date_from:'2025-10-17',date_to:'2026-10-16',payload:{warnings:{campaign:'meta_error_100'}}}]}} account={{id:'a',name:'Shared'}} from="2025-10-17" to="2026-10-16"/>);
 expect(screen.getByText(/observed with partial provider availability/)).toBeTruthy();expect(screen.queryByText(/Missing campaign rows mean no activity/)).toBeNull();
});
