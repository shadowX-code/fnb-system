import {businessCapabilities} from '../../../supabase/functions/native-assistant/business.js';
import React from 'react';import {expect,it,vi,afterEach} from 'vitest';import {render,screen,fireEvent,waitFor,cleanup,within} from '@testing-library/react';
vi.mock('../ai-assistant/nativeAssistantService.js',()=>({assistantCall:vi.fn(),assistantErrors:{provider_not_authorized:'Provider not authorized.'}}));
import {assistantCall} from '../ai-assistant/nativeAssistantService.js';import NativeAssistantSettings from './NativeAssistantSettings.jsx';
afterEach(()=>{cleanup();vi.clearAllMocks();});
const openFactory=()=>{const button=screen.queryByRole('button',{name:'Manage Finished Goods'});if(button)fireEvent.click(button);};
const data={config:{model:'gpt-4o-mini',enabled:false,revision:1,provider_revision:1,tested_provider_revision:null},runtime:{capabilities:businessCapabilities({capability_connections:{read_factory_finished_goods:false}},{factory:false}),ready:false,runtime_available:true,connection_ready:false,blocker:'provider_not_authorized',credential_ref:'native-assistant-openai',providers:[{models:['gpt-4o-mini','gpt-4.1-mini']}]}};
it('saves only model metadata, records unavailable test and never accepts a key',async()=>{assistantCall.mockImplementation(async action=>action==='test'?{outcome:'unavailable',code:'provider_not_authorized'}:data);render(<NativeAssistantSettings auth={{user:{id:'one'},hasPermission:()=>true}}/>);await screen.findByText('native-assistant-openai');expect(document.querySelector('input[type=password]')).toBeNull();expect(screen.getByRole('checkbox',{name:'Enable text conversations'}).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Test connection'}));await screen.findByText('Provider not authorized.');fireEvent.click(screen.getByRole('button',{name:'Model',exact:true}));fireEvent.click(await screen.findByRole('option',{name:'gpt-4.1-mini'}));fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));await waitFor(()=>expect(assistantCall).toHaveBeenCalledWith('configure',{provider:'openai',model:'gpt-4.1-mini',credential_ref:'native-assistant-openai',enabled:false,expected_revision:1}));});
it('view-only settings cannot test/save/enable',async()=>{assistantCall.mockResolvedValue(data);render(<NativeAssistantSettings auth={{user:{id:'reader'},hasPermission:()=>false}}/>);await screen.findByText('native-assistant-openai');for(const name of ['Test connection','Save'])expect(screen.getByRole('button',{name,exact:true}).disabled).toBe(true);expect(screen.getByRole('checkbox',{name:'Enable text conversations'}).disabled).toBe(true);});
it('shows safe upstream status/type/endpoint and missing Responses permission without claiming key rotation',async()=>{
 assistantCall.mockImplementation(async action=>{if(action==='test')throw Object.assign(new Error('OpenAI permission rejected'),{diagnostic:{source:'openai',http_status:401,provider_error_code:null,provider_error_type:'invalid_request_error',endpoint:'https://api.openai.com/v1/responses',model:'gpt-4o-mini',missing_permissions:['api.responses.write']}});return data;});
 render(<NativeAssistantSettings auth={{user:{id:'one'},hasPermission:()=>true}}/>);await screen.findByText('native-assistant-openai');fireEvent.click(screen.getByRole('button',{name:'Test connection'}));await screen.findByText('Provider response details');expect(screen.getByText('401')).toBeTruthy();expect(screen.getByText('invalid_request_error')).toBeTruthy();expect(screen.getByText('api.responses.write')).toBeTruthy();expect(screen.getByText('https://api.openai.com/v1/responses')).toBeTruthy();expect(screen.getByRole('checkbox',{name:'Enable text conversations'}).disabled).toBe(true);
});
it('organizes management without triggering provider tests, business reads or document retrieval',async()=>{
 assistantCall.mockResolvedValue(data);render(<NativeAssistantSettings auth={{user:{id:'one'},hasPermission:()=>true}}/>);
 await screen.findByText('native-assistant-openai');
 for(const name of ['Overview','AI Capabilities','Voice & Usage'])expect(screen.getByRole('tab',{name})).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:'AI Capabilities'}));openFactory();expect(screen.queryByText('Managed Knowledge')).toBeNull();expect(screen.queryByRole('button',{name:'Test Connection'})).toBeNull();
 expect(screen.getByText(/Existing permissions and data scope apply/)).toBeTruthy();
 expect(assistantCall.mock.calls.every(([action])=>action==='configuration')).toBe(true);
 expect(screen.queryByRole('button',{name:'Test Connection'})).toBeNull();
});
it.each([[true,'Enabled'],[false,/Your account cannot use this operation/]])('uses server tool access, not the settings role, to present capability availability (%s)',async(tools,label)=>{
 assistantCall.mockResolvedValue({...data,can_edit:false,config:{...data.config,capability_connections:{read_factory_finished_goods:true}},runtime:{...data.runtime,tools,capabilities:businessCapabilities({capability_connections:{read_factory_finished_goods:true}},{factory:tools})}});
 render(<NativeAssistantSettings auth={{user:{id:'reader'},hasPermission:()=>false}}/>);await screen.findByText('native-assistant-openai');
 fireEvent.click(screen.getByRole('tab',{name:'AI Capabilities'}));openFactory();expect(screen.getAllByText(label).length).toBeGreaterThan(0);expect(screen.queryByRole('button',{name:'Test Connection'})).toBeNull();
});
it('respects server edit denial even when local settings permission allows edits',async()=>{
 assistantCall.mockResolvedValue({...data,can_edit:false});render(<NativeAssistantSettings auth={{user:{id:'one'},hasPermission:()=>true}}/>);await screen.findByText('native-assistant-openai');
 expect(screen.getByRole('button',{name:'Test connection'}).disabled).toBe(true);
});
it('keeps pending text edits while inspecting other sections',async()=>{
 assistantCall.mockResolvedValue(data);render(<NativeAssistantSettings auth={{user:{id:'one'},hasPermission:()=>true}}/>);await screen.findByText('native-assistant-openai');
 fireEvent.click(screen.getByRole('button',{name:'Model',exact:true}));fireEvent.click(await screen.findByRole('option',{name:'gpt-4.1-mini'}));
 fireEvent.click(screen.getByRole('tab',{name:'AI Capabilities'}));openFactory();fireEvent.click(screen.getByRole('button',{name:'Close drawer',exact:true}));fireEvent.click(screen.getByRole('tab',{name:'Overview'}));
 expect(screen.getByRole('button',{name:'Model',exact:true}).textContent).toContain('gpt-4.1-mini');expect(screen.getByRole('button',{name:'Save',exact:true}).disabled).toBe(false);
 expect(assistantCall.mock.calls).toEqual([['configuration']]);
});

it('does not synthesize a callable Factory capability from legacy booleans',async()=>{
 assistantCall.mockResolvedValue({...data,runtime:{...data.runtime,tools:true,capabilities:undefined}});
 render(<NativeAssistantSettings auth={{user:{id:'reader'},hasPermission:()=>true}}/>);await screen.findByText('native-assistant-openai');
 fireEvent.click(screen.getByRole('tab',{name:'AI Capabilities'}));openFactory();expect(screen.queryByRole('button',{name:'Test Connection'})).toBeNull();
 expect(screen.queryByText('Connected')).toBeNull();expect(screen.getByText(/AI access policies are unavailable/)).toBeTruthy();
});

it('nests existing enable/test intents only in the registered Factory READ detail',async()=>{
 assistantCall.mockResolvedValue({...data,config:{...data.config,capability_connections:{read_factory_finished_goods:true}},runtime:{...data.runtime,capabilities:businessCapabilities({capability_connections:{read_factory_finished_goods:true}},{factory:true})}});
 render(<NativeAssistantSettings auth={{user:{id:'one'},hasPermission:()=>true}}/>);await screen.findByText('native-assistant-openai');
 fireEvent.click(screen.getByRole('tab',{name:'AI Capabilities'}));openFactory();
 const read=within(screen.getByRole('dialog',{name:'Finished Goods'}));
 fireEvent.click(read.getByRole('button',{name:/Disable AI Access:/}));
 await waitFor(()=>expect(assistantCall).toHaveBeenCalledWith('capability_connection',{operation:'read_factory_finished_goods',expected_revision:1,enabled:false}));
 expect(screen.queryByRole('button',{name:'Test Connection'})).toBeNull();
 expect(screen.queryByText(/285|Other module coverage/)).toBeNull();
 expect(screen.getByLabelText('Registered capability coverage').textContent).toBe('1 enabled READ · 0 of 2 ACTION policies ready');
});

it('opens the canonical ACTION owner and presents two separately controlled operations',async()=>{
 assistantCall.mockResolvedValue(data);
 render(<NativeAssistantSettings auth={{user:{id:'admin'},hasPermission:()=>true}}/>);
 await screen.findByText('native-assistant-openai');
 fireEvent.click(screen.getByRole('tab',{name:'AI Capabilities'}));
 fireEvent.click(screen.getByRole('button',{name:'Content Management actions'}));
 const drawer=within(screen.getByRole('dialog',{name:'Content Management'}));
 const actions=within(drawer.getByRole('region',{name:'AI Actions'}));
 for(const name of ['Prepare text-only content draft','Prepare inactive caption template']){
  expect(actions.getByRole('heading',{name})).toBeTruthy();
  expect(actions.getByRole('button',{name:`Enable AI Access: ${name}`})).toBeTruthy();
  expect(actions.getByRole('button',{name:`Enable execution authorization: ${name}`})).toBeTruthy();
 }
 expect(actions.getAllByText('Disabled')).toHaveLength(4);
 expect(assistantCall.mock.calls).toEqual([['configuration']]);
});
