import {afterEach,it,expect} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import AccessChangeReview from './AccessChangeReview.jsx';
afterEach(cleanup);
const base={before:[],after:[],material_changes:[],blockers:[],remaining_shared_access:[]};
const cap={name:'clean',label:'Cleaning',granted:true,scope:[]};
it('leads a single addition with no empty or unchanged diagnostics',()=>{
 render(<AccessChangeReview plan={{changes:[cap],remaining_access:[cap],effective_diff:base}}/>);
 expect(screen.getByRole('region',{name:'Access added'})).toBeTruthy();
 expect(screen.queryByRole('region',{name:'Access removed'})).toBeNull();
 expect(screen.queryByRole('region',{name:'Affected source requirements'})).toBeNull();
 expect(screen.queryByText('None')).toBeNull();expect(document.querySelector('pre')).toBeNull();
 expect(screen.getByText('Related Access').closest('details').open).toBe(false);
});
it('shows mixed grant changes and material exposure changes to retained modules',()=>{
 render(<AccessChangeReview plan={{changes:[cap,{...cap,name:'old',label:'Old scope',granted:false}],remaining_access:[],effective_diff:{...base,material_changes:[{effect:'added',owner:'Production Overview',label:'Material usage',before:null,after:{grant_name:'overview'}}]}}}/>);
 expect(screen.getByRole('region',{name:'Access removed'})).toBeTruthy();
 expect(screen.getByText('Production Overview · Material usage')).toBeTruthy();
});
it('distinguishes new blockers from affected pre-existing limitations and preserves shared-access warnings',()=>{
 render(<AccessChangeReview plan={{changes:[],remaining_access:[],effective_diff:{...base,blockers:[{kind:'new_blocker',owner:'Overview',label:'Records',missing:[{label:'Production Records'}]},{kind:'pre_existing',owner:'Dashboard',label:'Summary',missing:[{label:'Inventory'}]}],remaining_shared_access:[{removed:'Cleaning',via:'Compliance review records',note:'Redacted findings remain available.'}]}}}/>);
 expect(screen.getByText('New blocker')).toBeTruthy();expect(screen.getByText('Pre-existing limitation').closest('details').open).toBe(false);
 expect(screen.getByRole('region',{name:'Access remaining after revocation'})).toBeTruthy();
});
it('requires the complete server review instead of inventing a client-side diff',()=>{
 render(<AccessChangeReview plan={{changes:[cap]}}/>);expect(screen.getByRole('alert').textContent).toMatch(/review again/);
});

it('names newly exposed audit owners instead of hiding cross-module activity behind diagnostics',()=>{
 render(<AccessChangeReview plan={{changes:[],remaining_access:[],effective_diff:{...base,material_changes:[{effect:'changed',owner:'Audit Trail',label:'Activity',before:{grant_name:'audit',audit_modules:[]},after:{grant_name:'audit',audit_modules:[{id:'equipment',label:'Equipment'}]}}]}}}/>);
 expect(screen.getByText('Activity added: Equipment.')).toBeTruthy();
});
