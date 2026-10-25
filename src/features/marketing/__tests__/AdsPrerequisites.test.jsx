import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import AdsPrerequisites from '../AdsPrerequisites.jsx';
import {adsService} from '../adsService.js';
vi.mock('../adsService.js',()=>({adsService:{readOnlyPreflight:vi.fn(),authorize:vi.fn()}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const props={org:'org',brand:'brand-a',connection:'shared',page:'22',source:'job-a',canConnect:true};
const response={generation:2,checks:{account:{management_verified:false},minimum_budget:{status:'unavailable'}},blockers:['ads_management_required','advertiser_payer_verification_required']};
it('explains missing dedicated login and never starts OAuth automatically',()=>{
 render(<AdsPrerequisites {...props}/>);expect(screen.getByRole('button',{name:'Authorize Ads Management'}).disabled).toBe(true);expect(screen.getByText(/Dedicated Ads authorization setup is pending/)).toBeTruthy();expect(adsService.authorize).not.toHaveBeenCalled();expect(adsService.readOnlyPreflight).not.toHaveBeenCalled();
});
it('issues one read-only request, preserves unavailable budget and never claims creation eligibility',async()=>{
 adsService.readOnlyPreflight.mockResolvedValue(response);render(<AdsPrerequisites {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Check Meta access'}));
 await screen.findByRole('status');expect(adsService.readOnlyPreflight).toHaveBeenCalledWith({organizationId:'org',brandId:'brand-a',connectionId:'shared',pageId:'22',sourceJobId:'job-a'});
 expect(screen.getByText(/Draft identity IDs are not proof/)).toBeTruthy();expect(screen.getByText('Not authorized to create or spend')).toBeTruthy();expect(screen.queryByText(/MYR.*0.00/)).toBeNull();expect(adsService.authorize).not.toHaveBeenCalled();
});
it('deduplicates rapid clicks and discards another Brand’s late result',async()=>{
 let finish;adsService.readOnlyPreflight.mockImplementation(()=>new Promise(r=>{finish=r}));const {rerender}=render(<AdsPrerequisites {...props}/>);
 const button=screen.getByRole('button',{name:'Check Meta access'});fireEvent.click(button);fireEvent.click(button);expect(adsService.readOnlyPreflight).toHaveBeenCalledTimes(1);
 rerender(<AdsPrerequisites {...props} brand="brand-b" page="33" source="job-b"/>);finish(response);await waitFor(()=>expect(screen.getByRole('button',{name:'Check Meta access'}).disabled).toBe(false));expect(screen.queryByRole('status')).toBeNull();
});
it('shows errors without claiming success or altering the draft',async()=>{
 adsService.readOnlyPreflight.mockRejectedValue(new Error('Current Brand source post required.'));render(<AdsPrerequisites {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Check Meta access'}));expect(await screen.findByRole('alert')).toHaveProperty('textContent','Current Brand source post required.');expect(screen.queryByRole('status')).toBeNull();
});
