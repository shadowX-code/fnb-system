const environments = {
 'https://ujkzdaaadnvcfayuldmh.supabase.co':'https://fnb-system-staging.vercel.app',
 'https://oyfobxdoyfuzsodogpgs.supabase.co':'https://os.feedx.my',
};
export function googleBusinessEnvironment(url:string) {
 const origin=environments[url as keyof typeof environments];
 if(!origin)throw new Error('Google Business Profile environment is unavailable.');
 return {supabase:url,origin,redirect:`${url}/functions/v1/google-business/callback`};
}
