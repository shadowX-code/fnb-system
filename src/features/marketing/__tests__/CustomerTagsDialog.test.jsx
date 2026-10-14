import {describe,it,expect,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import CustomerTagsDialog from '../CustomerTagsDialog.jsx';
const {service}=vi.hoisted(()=>({service:{read:vi.fn(),customer:vi.fn()}}));
vi.mock('../outreachService.js',()=>({outreachService:service}));
vi.mock('../../../components/forms/SelectField.jsx',()=>({default:({label,value,onChange,options})=><label>{label}<select value={value} onChange={e=>onChange(e.target.value)}><option value="">Select</option>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}));
const tags=[{id:'a',name:'VIP',revision:2,usage_count:3,audience_count:1,impact_token:'evidence'},{id:'b',name:'Regular',revision:1,usage_count:2,audience_count:0}];
beforeEach(()=>{cleanup();vi.clearAllMocks();service.read.mockResolvedValue({tag_catalog:tags});service.customer.mockResolvedValue({id:'b'});});
describe('Brand tag management',()=>{
 it('requires current impact confirmation before merging assigned tags',async()=>{
  const onChanged=vi.fn();render(<CustomerTagsDialog org="o" brand="b" onChanged={onChanged} onClose={()=>{}}/>);
  await screen.findByRole('button',{name:'Merge VIP'});fireEvent.click(screen.getByRole('button',{name:'Merge VIP'}));
  fireEvent.change(screen.getByLabelText('Merge into'),{target:{value:'b'}});
  expect(screen.getByRole('button',{name:'Merge tags'}).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox',{name:'I confirm this impact'}));fireEvent.click(screen.getByRole('button',{name:'Merge tags'}));
  await waitFor(()=>expect(service.customer).toHaveBeenCalled());
  expect(service.customer.mock.calls[0].slice(1)).toEqual(['o','b',{action:'tag_merge',name:'VIP',id:'a',revision:2,impact_token:'evidence',target_id:'b',target_revision:1,confirmed:true}]);expect(onChanged).toHaveBeenCalled();
 });
 it('searches reusable tags and reports current usage',async()=>{
  render(<CustomerTagsDialog org="o" brand="b" onClose={()=>{}}/>);await screen.findByRole('button',{name:'Rename VIP'});
  fireEvent.change(screen.getByRole('searchbox',{name:'Search tags'}),{target:{value:'vip'}});expect(screen.queryByRole('button',{name:'Rename Regular'})).toBeNull();expect(screen.getByText('3')).toBeTruthy();
 });
});
