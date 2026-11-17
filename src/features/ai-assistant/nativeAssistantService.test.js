import { afterEach, expect, it, vi } from 'vitest';
import { assistantCall } from './nativeAssistantService.js';

vi.mock('../../lib/supabase.ts', () => ({
 supabase: {auth: {getSession: async () => ({data:{session:{access_token:'fixture'}}})}},
}));
afterEach(() => vi.unstubAllGlobals());

it('delivers sanitized validation feedback to the SDK as an in-band tool result', async () => {
 const feedback = {
  error:'tool_arguments_invalid', operation:'read_employee_directory', no_evidence:true,
  not_business_evidence:true, parameters:{properties:{mode:{enum:['summary','list','detail']}}},
 };
 vi.stubGlobal('fetch', async () => Response.json(feedback));
 await expect(assistantCall('realtime_tool')).resolves.toEqual(feedback);
 await expect(assistantCall('history')).rejects.toMatchObject({code:'tool_arguments_invalid'});
 vi.stubGlobal('fetch', async () => Response.json(feedback,{status:400}));
 await expect(assistantCall('realtime_tool')).rejects.toMatchObject({code:'tool_arguments_invalid'});
});

it('keeps actual authorization failures as typed errors with operation diagnostics', async () => {
 const diagnostic={operation:'read_employee_directory',operation_label:'Employee headcount and directory',stage:'dispatch'};
 vi.stubGlobal('fetch', async () => Response.json({error:'business_read_denied',diagnostic},{status:403}));
 await expect(assistantCall('realtime_tool')).rejects.toMatchObject({code:'business_read_denied',diagnostic});
});
