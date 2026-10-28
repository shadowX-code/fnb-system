import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import CreatorEditor,{AccountEditor} from '../CreatorEditors.jsx';
import {creatorService} from '../creatorService.js';
vi.mock('../creatorService.js',()=>({creatorService:{profile:vi.fn(),directory:vi.fn().mockResolvedValue({accounts:[],creators:[]})}}));
const props={org:'workspace',creator:{id:'c',name:'Creator'},onClose:vi.fn(),onSave:vi.fn()};
const result=(handle,followers=5)=>({metadata_status:'public_extracted',handle,provider_id:'123',display_name:'Creator '+handle,followers,profile_url:`https://www.instagram.com/${handle}/`,source:'Meta Instagram Business Discovery',captured_at:'2026-10-28T00:00:00Z',avatar_kind:'profile_picture',avatar_url:`https://scontent.cdninstagram.com/${handle}.jpg`,enrichment_receipt:'proof-'+handle});
afterEach(()=>{cleanup();vi.clearAllMocks()});
it('pastes a username, debounces one read, previews name/avatar/followers and saves canonical URL with one server receipt',async()=>{
 creatorService.profile.mockResolvedValue(result('example',0));render(<AccountEditor {...props}/>);
 fireEvent.paste(screen.getByLabelText('Profile URL'),{clipboardData:{getData:()=> '@EXAMPLE'}});
 expect(creatorService.profile).not.toHaveBeenCalled();await screen.findByRole('img',{name:'Public profile'});expect(screen.getByText('0')).toBeTruthy();expect(screen.getByText('Creator example')).toBeTruthy();expect(creatorService.profile).toHaveBeenCalledTimes(1);expect(screen.queryByRole('button',{name:'Refresh public profile'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({handle:'example',profile_url:'https://www.instagram.com/example/',profile_enrichment_receipt:'proof-example'}));expect(props.onSave.mock.calls[0][0]).not.toHaveProperty('followers');
});
it('isolates prior identity immediately and rejects its late preview while the new URL remains editable',async()=>{
 let oldResolve,newResolve;creatorService.profile.mockImplementation((_o,_b,url)=>new Promise(r=>{if(url.includes('/old/'))oldResolve=r;else newResolve=r}));render(<AccountEditor {...props}/>);
 fireEvent.change(screen.getByLabelText('Profile URL'),{target:{value:'@old'}});await waitFor(()=>expect(oldResolve).toBeTypeOf('function'));
 expect(screen.getByLabelText('Profile URL').disabled).toBe(false);fireEvent.change(screen.getByLabelText('Profile URL'),{target:{value:'@new'}});await waitFor(()=>expect(newResolve).toBeTypeOf('function'));
 oldResolve(result('old',999));await Promise.resolve();expect(screen.queryByText('999')).toBeNull();newResolve(result('new',7));await screen.findByText('7');expect(screen.getByRole('img').getAttribute('src')).toContain('/new.jpg');expect(screen.queryByText('Creator old')).toBeNull();
});
it('keeps an unsupported profile saveable with its exact explanation and no stale old avatar/followers',async()=>{
 creatorService.profile.mockResolvedValue({metadata_status:'unavailable',unavailable:{profile:'Meta cannot expose this profile with current access.'}});
 render(<AccountEditor {...props} record={{id:'a',platform:'instagram',handle:'old',profile_url:'https://www.instagram.com/old/',display_name:'Old name',followers:500,followers_source:'meta',public_observation:{avatar_url:'https://scontent.cdninstagram.com/old.jpg'}}}/>);
 fireEvent.change(screen.getByLabelText('Profile URL'),{target:{value:'@unsupported'}});expect(screen.queryByRole('img')).toBeNull();expect(screen.queryByText('500')).toBeNull();await screen.findByText('Meta cannot expose this profile with current access.');fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({handle:'unsupported',external_id:'',display_name:''}));expect(props.onSave.mock.calls[0][0]).not.toHaveProperty('profile_enrichment_receipt');
});
it('does not extract on reopening a saved identity and retains manual Refresh Profile',async()=>{
 render(<AccountEditor {...props} record={{id:'a',platform:'instagram',handle:'saved',profile_url:'https://www.instagram.com/saved/'}}/>);await new Promise(r=>setTimeout(r,500));expect(creatorService.profile).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Refresh Profile'})).toBeTruthy();
});

it('does not apply an old row response after that row is removed and another unsaved profile takes its place',async()=>{
 let oldResolve;creatorService.directory.mockResolvedValue({creators:[],accounts:[],options:[]});
 creatorService.profile.mockImplementation((_org,_brand,url)=>url.includes('/oldrow/')?new Promise(r=>{oldResolve=r}):Promise.resolve(result('nextrow',8)));
 render(<CreatorEditor {...props} data={{accounts:[],creators:[],options:[]}} seed={{profiles:[{platform:'instagram',profile_url:'',handle:''},{platform:'instagram',profile_url:'',handle:''}]}}/>);
 fireEvent.change(screen.getAllByLabelText('Profile URL')[0],{target:{value:'@oldrow'}});await waitFor(()=>expect(oldResolve).toBeTypeOf('function'));
 fireEvent.change(screen.getAllByLabelText('Profile URL')[1],{target:{value:'@nextrow'}});await screen.findByText('8');fireEvent.click(screen.getAllByRole('button',{name:'Remove',exact:true})[0]);
 oldResolve(result('oldrow',999));await Promise.resolve();await waitFor(()=>expect(screen.queryByText('999')).toBeNull());expect(screen.getByLabelText('Profile URL').value).toContain('nextrow');
});

it('saves one authorized unavailable-result receipt so reopen does not immediately queue a duplicate lookup',async()=>{
 creatorService.profile.mockResolvedValue({metadata_status:'unavailable',enrichment_receipt:'failed-proof',unavailable:{profile:'Meta cannot expose this profile.'}});render(<AccountEditor {...props}/>);
 fireEvent.change(screen.getByLabelText('Profile URL'),{target:{value:'@unavailable'}});await screen.findByText('Meta cannot expose this profile.');fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));
 expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({handle:'unavailable',profile_enrichment_receipt:'failed-proof'}));expect(props.onSave.mock.calls[0][0]).not.toHaveProperty('public_observation');expect(props.onSave.mock.calls[0][0]).not.toHaveProperty('followers');
 fireEvent.change(screen.getByLabelText('Profile URL'),{target:{value:'@different'}});fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));expect(props.onSave.mock.lastCall[0]).not.toHaveProperty('profile_enrichment_receipt');
});
