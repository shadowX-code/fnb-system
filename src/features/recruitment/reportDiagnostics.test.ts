import {it,expect} from 'vitest';
import {classifyReportFailure as classify} from '../../../supabase/functions/recruitment-report/diagnostics.ts';
it('classifies provider, parsing, citation, rubric and persistence failures without storing raw text',()=>{
 expect(classify('provider',Error('sensitive text'),429)).toBe('provider_rate_limited');
 expect(classify('response_parsing',new SyntaxError('candidate data'))).toBe('response_parsing_failed');
 expect(classify('validation',Error('Foreign or non-candidate citation'))).toBe('citation_validation_failed');
 expect(classify('validation',Error('Unsupported rubric assessment'))).toBe('rubric_validation_failed');
 expect(classify('persistence',Error('sensitive text'))).toBe('persistence_failed');
 expect(classify('validation',Error('candidate data'))).toBe('report_validation_failed');
 expect(classify('provider',new DOMException('timeout','TimeoutError'))).toBe('provider_timeout');
});
