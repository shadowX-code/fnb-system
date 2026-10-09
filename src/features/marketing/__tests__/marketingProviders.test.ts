import { describe,it,expect,vi } from 'vitest';
import { executeMarketingPublish,MARKETING_CAPABILITIES } from '../../../../supabase/functions/_shared/marketingProviders';
const intent={jobId:'job',revision:1,channel:'facebook' as const,accountId:'page',caption:'approved caption',format:'text',mediaUrls:[]};
const capability={environment:'production',authorized:true,expiresAt:'2026-11-01T00:00:00Z',allowedFormats:['text']};
const now=new Date('2026-10-10T00:00:00Z');
describe('server provider execution gates',()=>{
  it('declares no operational integration and never sends without production authorization',async()=>{
    expect(Object.values(MARKETING_CAPABILITIES).every(v=>v===false)).toBe(true);
    expect(await executeMarketingPublish(null,intent,now)).toMatchObject({outcome:'permanent_failure'});
    for(const override of [{environment:'test'},{authorized:false},{expiresAt:'2026-01-01'},{expiresAt:'invalid'}]){
      const provider={capability:vi.fn().mockResolvedValue({...capability,...override}),publish:vi.fn()};
      expect(await executeMarketingPublish(provider as any,intent,now)).toMatchObject({errorCode:'provider_not_authorized'});
      expect(provider.publish).not.toHaveBeenCalled();
    }
  });
  it('treats timeout and missing receipt as uncertain, preventing blind retries',async()=>{
    const provider={capability:vi.fn().mockResolvedValue(capability),publish:vi.fn().mockRejectedValue(new Error('timeout'))};
    expect(await executeMarketingPublish(provider as any,intent,now)).toEqual({outcome:'uncertain',errorCode:'provider_response_uncertain'});
    expect(provider.publish).toHaveBeenCalledTimes(1);
    provider.publish.mockResolvedValue({outcome:'published'});
    expect(await executeMarketingPublish(provider as any,intent,now)).toMatchObject({outcome:'uncertain'});
  });
});
