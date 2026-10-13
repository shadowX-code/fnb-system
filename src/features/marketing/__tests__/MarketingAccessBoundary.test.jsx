import {it,expect,vi,afterEach} from 'vitest';
import {useState} from 'react';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import MarketingAccessBoundary from '../MarketingAccessBoundary.jsx';
const {fingerprint}=vi.hoisted(()=>({fingerprint:vi.fn()}));
vi.mock('../marketingService.js',()=>({marketingService:{accessFingerprint:fingerprint}}));
afterEach(()=>{cleanup();vi.clearAllMocks()});
function Record(){const [value,setValue]=useState('previously loaded record');return <input aria-label="Cached record" value={value} onChange={e=>setValue(e.target.value)}/>}
it('remounts cached record views and refreshes canonical role context when server access changes',async()=>{
 fingerprint.mockResolvedValueOnce('scope-a').mockResolvedValue('scope-b');const changed=vi.fn().mockResolvedValue();
 render(<MarketingAccessBoundary userId="member" onAccessChanged={changed}><Record/></MarketingAccessBoundary>);
 const input=await screen.findByRole('textbox');fireEvent.change(input,{target:{value:'stale brand record'}});fireEvent.focus(window);
 await waitFor(()=>expect(changed).toHaveBeenCalledOnce());await waitFor(()=>expect(screen.getByRole('textbox').value).toBe('previously loaded record'));
});
it('fails closed and removes previously fetched data when verification is denied',async()=>{
 fingerprint.mockResolvedValueOnce('scope-a').mockRejectedValue(new Error('Access denied'));
 render(<MarketingAccessBoundary userId="member"><Record/></MarketingAccessBoundary>);await screen.findByRole('textbox');fireEvent.focus(window);
 await screen.findByRole('alert');expect(screen.queryByRole('textbox')).toBeNull();
});
it('does not refresh Role context or discard an editor when unchanged access is verified',async()=>{
 fingerprint.mockResolvedValue('scope-a');const changed=vi.fn();render(<MarketingAccessBoundary userId="member" onAccessChanged={changed}><Record/></MarketingAccessBoundary>);
 fireEvent.change(await screen.findByRole('textbox'),{target:{value:'unsaved draft'}});fireEvent.focus(window);
 await waitFor(()=>expect(fingerprint).toHaveBeenCalledTimes(2));expect(screen.getByRole('textbox').value).toBe('unsaved draft');expect(changed).not.toHaveBeenCalled();
});
