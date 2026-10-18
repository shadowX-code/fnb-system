/** Advisory hints only. Assignment/status/sending remain canonical Inbox commands. */
export function handoffHints(text='') {
 const humanText=text.replace(/\b(no need|do not want|don't need|don't want|tak perlu)\s+(a\s+)?(human|person|staff|manusia)|不需要人工/gi,'');
 return Object.entries({
  human_request:/(\b(human|real person|staff member|manager|speak to (someone|staff)|talk to (someone|staff)|manusia)\b|人工|真人|找店员|找經理)/i,
  compensation:/(compensat|赔偿|補償|pampasan|ganti rugi)/i,
  special_arrangement:/(special arrangement|private event|special request|特别安排|特殊要求|permintaan khas)/i,
  operational_decision:/(\b(book|reserve|refund|cancel|confirm)\s+(me|us|my|our|a table)|帮我.{0,5}(订|退)|tolong.{0,10}tempah)/i,
 }).filter(([,pattern])=>pattern.test(humanText)).map(([reason])=>reason);
}
export const assistanceLabel=value=>({suggestion_available:'AI Suggestion Available',needs_human_attention:'Needs Human Attention',insufficient_knowledge:'Insufficient Knowledge'}[value]||'Suggestion · review before sending');
