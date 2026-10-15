import {describe,it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup,within} from '@testing-library/react';
import {MetricGrid,Results} from '../AdsMetrics.jsx';
import AdsCampaigns from '../AdsCampaigns.jsx';
afterEach(cleanup);
// Captured Production reporting totals, 17 Sep–16 Oct; sanitized presentation fixture only.
const metrics={spend:{value:1587.77,state:'reported'},reach:{value:256045,state:'estimated'},impressions:{value:1064691},clicks:{value:10328},ctr:{value:0.970047},cpc:{value:0.153735},cpm:{value:1.491297}};
const accountRow={metrics,currency:'MYR',actions:[{type:'link_click',value:5084},{type:'onsite_conversion.messaging_conversation_started_7d',value:37},{type:'onsite_conversion.total_messaging_connection',value:37},{type:'post_reaction',value:348}],cost_per_action_type:[{type:'link_click',value:0.312307}]};
const report={scope:'organization',account:{currency:'MYR'},configs:{campaigns:[{id:'1',name:'Campaign One',objective:'OUTCOME_TRAFFIC',effective_status:'ACTIVE'},{id:'2',name:'Campaign Two',objective:'OUTCOME_ENGAGEMENT',effective_status:'PAUSED',feedx_brand_id:'brand'}],adsets:[],ads:[]},insights:{campaign:[{...accountRow,campaign_id:'1'}]}};
const props={accounts:[{id:'account',name:'Shared account',health:{currency:'MYR'}}],account:'account',onAccount:vi.fn(),report,brands:[{id:'brand',name:'Hola'}],canReview:true,onReview:vi.fn(),onDetail:vi.fn()};
describe('Ads operational dashboard',()=>{
 it('prioritizes the four metrics without changing actual reporting totals',()=>{
  render(<MetricGrid row={accountRow} previous={{metrics:{spend:{value:1800.12}}}} currency="MYR"/>);
  const primary=screen.getByRole('region',{name:'Advertising performance'});
  expect(within(primary).getByText('MYR 1,587.77')).toBeTruthy();expect(within(primary).getByText('256,045')).toBeTruthy();expect(within(primary).queryByText('Impressions')).toBeNull();
  expect(screen.getByText('1,064,691')).toBeTruthy();expect(screen.getByText('-11.8% vs previous period')).toBeTruthy();
 });
 it('categorizes results without summing overlapping messaging actions',()=>{
  const {container}=render(<Results row={accountRow}/>);
  expect(screen.getByText('Conversations')).toBeTruthy();
  expect(screen.queryByText('74')).toBeNull();expect(screen.getByText('Advanced Details · all Meta actions (4)')).toBeTruthy();
  expect(container.querySelector('details').open).toBe(false);
  expect(container.querySelector('.ads-result-groups').textContent).not.toContain('onsite_conversion.total_messaging_connection');
 });
 it('defaults to six columns, filters Unassigned, and requires explicit attribution review',()=>{
  render(<AdsCampaigns {...props}/>);
  expect(screen.getAllByRole('columnheader').map(n=>n.textContent)).toEqual(['Campaign','Brand','Spend','Results','Cost/Result','Status']);
  fireEvent.click(screen.getByRole('button',{name:'Brand attribution'}));fireEvent.click(screen.getByRole('option',{name:'Unassigned',exact:true}));
  expect(screen.getAllByText('Campaign One').length).toBeGreaterThan(0);expect(screen.queryByText('Campaign Two')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Review Brand attribution'}));expect(props.onReview).toHaveBeenCalledOnce();
  expect(screen.queryByText('Connect shared account')).toBeNull();
 });
 it('offers optional metrics and canonical detail drill-down without changing data',()=>{
  render(<AdsCampaigns {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Columns'}));fireEvent.click(screen.getByLabelText('Impressions'));
  expect(screen.getByRole('columnheader',{name:'Impressions'})).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button',{name:'Campaign One'})[0]);
  expect(props.onDetail).toHaveBeenCalledWith(report.configs.campaigns[0],'campaign',expect.any(Function));
 });
});
