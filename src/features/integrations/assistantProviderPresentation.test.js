import {getModuleById} from '../../../config/modules.ts';
import {businessCapabilities,createBusinessDispatcher} from '../../../supabase/functions/native-assistant/business.js';
import {expect,it} from 'vitest';
import {assistantProviderPresentation} from './assistantProviderPresentation.js';
import {realtimeModel} from '../../../supabase/functions/native-assistant/realtime.js';
import {grokModel} from '../../../supabase/functions/native-assistant/grokVoice.js';
import {inventoryTool} from '../../../supabase/functions/_shared/factory/finishedGoodsRead.js';
it('presents the implemented voice models and sole existing business tool contract',()=>{
 expect(assistantProviderPresentation.openai.model).toBe(realtimeModel);
 expect(assistantProviderPresentation.grok.model).toBe(grokModel);
 expect(inventoryTool.name).toBe('read_factory_finished_goods');
});

it('all operation and knowledge ownership IDs resolve to canonical module metadata',()=>{
 for(const capability of businessCapabilities({},{}))expect(getModuleById(capability.module_id)).toBeTruthy();
 const guide=createBusinessDispatcher({config:{enabled:true},access:{admin:true}}).guidance_sources[0];
 expect(getModuleById(guide.module_id)).toBeTruthy();
 expect(businessCapabilities({},{}).filter(capability=>capability.knowledge).every(capability=>getModuleById(capability.module_id))).toBe(true);
});
