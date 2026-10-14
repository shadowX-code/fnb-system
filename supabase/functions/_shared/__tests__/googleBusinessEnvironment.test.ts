import {describe,it,expect} from 'vitest';
import {googleBusinessEnvironment} from '../googleBusinessEnvironment.ts';
describe('Google server environment isolation',()=>{
 it('keeps the verified Staging callback and origin',()=>expect(googleBusinessEnvironment('https://ujkzdaaadnvcfayuldmh.supabase.co')).toEqual({supabase:'https://ujkzdaaadnvcfayuldmh.supabase.co',origin:'https://fnb-system-staging.vercel.app',redirect:'https://ujkzdaaadnvcfayuldmh.supabase.co/functions/v1/google-business/callback'}));
 it('uses only the Production database, Admin host and callback',()=>expect(googleBusinessEnvironment('https://oyfobxdoyfuzsodogpgs.supabase.co')).toEqual({supabase:'https://oyfobxdoyfuzsodogpgs.supabase.co',origin:'https://os.feedx.my',redirect:'https://oyfobxdoyfuzsodogpgs.supabase.co/functions/v1/google-business/callback'}));
 it('rejects unknown project URLs',()=>expect(()=>googleBusinessEnvironment('https://evil.example')).toThrow('environment'));
});
