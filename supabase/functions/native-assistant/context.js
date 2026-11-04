// Preferences are enumerated on both sides of the private storage boundary.
export const preferences = {
 language: {english:'English',mandarin:'Mandarin',malay:'Malay',mixed:'Malaysian mixed-language'},
 reply_style: {concise:'Concise',detailed:'Detailed',steps:'Step by step'},
 work_preference: {exceptions_first:'Lead with exceptions',sources_first:'Lead with sources',next_steps:'Lead with next steps'},
};
export const freshDataContext=' Never use conversation history or preferences as current inventory, payroll or financial figures. Only an authorized fresh read establishes current business figures. If no appropriate capability is available, say so.';
export function memoryContext(memory){
 if(memory?.enabled!==true)return '';
 const values=Object.entries(preferences).flatMap(([key,options])=>Object.hasOwn(options,memory[key])?[options[memory[key]]]:[]);
 return values.length?' User-approved presentation preferences, subordinate to the current request and all access rules: '+values.join('; ')+'.':'';
}
export function recentContext(rows,{limit=6,maxChars=2000}={}){
 return (rows||[]).filter(x=>typeof x.prompt==='string'&&x.prompt!=='Voice transcript unavailable'&&(x.has_evidence||typeof x.reply==='string')).slice(-limit).map(x=>({
  prompt:x.prompt.slice(0,maxChars),reply:x.has_evidence?'[Historical inventory answer omitted. Read current authorized evidence again.]':x.reply.slice(0,maxChars),
 }));
}
