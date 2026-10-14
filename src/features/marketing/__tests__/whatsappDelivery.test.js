import {describe,it,expect} from 'vitest';
import {normalizeMalaysianPhone,whatsappDeliveryAdapters} from '../whatsappDelivery.js';
describe('manual WhatsApp delivery boundary',()=>{
 it.each(['012-345 6789','+60 12 345 6789','0060123456789'])('normalizes %s without assuming consent',v=>expect(normalizeMalaysianPhone(v)).toBe('+60123456789'));
 it.each(['+6512345678','abc0123456789','012345','+0123456789'])('rejects invalid/foreign phone %s',v=>expect(()=>normalizeMalaysianPhone(v)).toThrow());
 it('uses exact approved personalized text in the official link',()=>expect(whatsappDeliveryAdapters.whatsapp_manual.openLink({state:'opened',phone:'+60123456789',caption:'Hi 李, A&B?'})).toBe('https://wa.me/60123456789?text=Hi%20%E6%9D%8E%2C%20A%26B%3F'));
 it('cannot claim delivery or expose a Cloud sending operation',()=>{expect(whatsappDeliveryAdapters.whatsapp_manual.verifiedDelivery).toBe(false);expect(whatsappDeliveryAdapters.whatsapp_cloud.available).toBe(false);expect(whatsappDeliveryAdapters.whatsapp_cloud.send).toBeUndefined();expect(()=>whatsappDeliveryAdapters.whatsapp_manual.openLink({state:'pending'})).toThrow();});
});
