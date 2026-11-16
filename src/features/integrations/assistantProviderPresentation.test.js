import {expect,it} from 'vitest';
import {assistantProviderPresentation} from './assistantProviderPresentation.js';
import {realtimeModel} from '../../../supabase/functions/native-assistant/realtime.js';
import {grokModel} from '../../../supabase/functions/native-assistant/grokVoice.js';
import {inventoryTool} from '../../../supabase/functions/native-assistant/inventory.js';
it('presents the implemented voice models and sole existing business tool contract',()=>{
 expect(assistantProviderPresentation.openai.model).toBe(realtimeModel);
 expect(assistantProviderPresentation.grok.model).toBe(grokModel);
 expect(inventoryTool.name).toBe('read_factory_finished_goods');
});
