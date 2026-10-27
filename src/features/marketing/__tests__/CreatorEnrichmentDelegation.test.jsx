import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import CreatorEnrichmentDelegation from '../CreatorEnrichmentDelegation.jsx';
const {service,hasPermission}=vi.hoisted(()=>({service:{enrichmentSettings:vi.fn(),delegateEnrichment:vi.fn()},hasPermission:vi.fn(()=>true)}));
vi.mock('../creatorService.js',()=>({creatorService:service}));
vi.mock('../../../auth/AuthContext.jsx',()=>({useAuth:()=>({user:{id:'user'},hasPermission})}));
const source={id:'connection',account_name:'source',brand:'Source Brand',generation:5};
const dormant={revision:0,active:false,eligible:false,connection_id:null,generation:null,connections:[source]};
beforeEach(()=>{vi.clearAllMocks();hasPermission.mockReturnValue(true);service.enrichmentSettings.mockResolvedValue(dormant)});afterEach(cleanup);
it('keeps loading and source selection read-only until explicit purpose confirmation',async()=>{
 service.delegateEnrichment.mockResolvedValue({...dormant,revision:1,active:true,eligible:true,connection_id:'connection',generation:5});
 render(<CreatorEnrichmentDelegation org="org"/>);await screen.findByText('Not delegated');expect(service.delegateEnrichment).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Instagram connection for public Creator reads'}));fireEvent.click(screen.getByRole('option',{name:'@source · Source Brand · version 5'}));
 fireEvent.click(screen.getByRole('button',{name:'Delegate public reads',exact:true}));expect(service.delegateEnrichment).not.toHaveBeenCalled();expect(screen.getByText(/through @source \(connection version 5\)/)).toBeTruthy();
 fireEvent.click(screen.getAllByRole('button',{name:'Delegate public reads',exact:true}).at(-1));await screen.findByText('Delegated');expect(service.delegateEnrichment).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({org:'org',revision:0,connection:'connection',generation:5,active:true,request:expect.any(String)}));
});
it('revokes independently of source eligibility and preserves cached information',async()=>{
 service.enrichmentSettings.mockResolvedValue({...dormant,revision:3,active:true,eligible:false,connection_id:'connection',generation:4});service.delegateEnrichment.mockResolvedValue({...dormant,revision:4});
 render(<CreatorEnrichmentDelegation org="org"/>);await screen.findByText('Connection changed · paused');fireEvent.click(screen.getByRole('button',{name:'Revoke delegation',exact:true}));expect(screen.getByText(/Existing photos, follower observations and history are retained/)).toBeTruthy();fireEvent.click(screen.getAllByRole('button',{name:'Revoke delegation',exact:true}).at(-1));await screen.findByText('Delegation revoked. Saved Creator information is retained.');expect(service.delegateEnrichment).toHaveBeenCalledWith(expect.objectContaining({active:false,connection:null,generation:null,revision:3}));
});
it('does not expose the management control or query settings to non-admins',()=>{
 hasPermission.mockImplementation(code=>code!=='platform_organizations.manage');const {container}=render(<CreatorEnrichmentDelegation org="org"/>);expect(container.textContent).toBe('');expect(service.enrichmentSettings).not.toHaveBeenCalled();
});
it('retains selection and retry identity after a failed grant',async()=>{
 service.delegateEnrichment.mockRejectedValue(new Error('Connection changed. Reload before continuing.'));render(<CreatorEnrichmentDelegation org="org"/>);await screen.findByText('Not delegated');fireEvent.click(screen.getByRole('button',{name:'Instagram connection for public Creator reads'}));fireEvent.click(screen.getByRole('option',{name:'@source · Source Brand · version 5'}));
 for(let i=0;i<2;i++){fireEvent.click(screen.getByRole('button',{name:'Delegate public reads',exact:true}));fireEvent.click(screen.getAllByRole('button',{name:'Delegate public reads',exact:true}).at(-1));await waitFor(()=>expect(service.delegateEnrichment).toHaveBeenCalledTimes(i+1));await screen.findByRole('alert')}
 expect(service.delegateEnrichment.mock.calls[0][0].request).toBe(service.delegateEnrichment.mock.calls[1][0].request);
});
