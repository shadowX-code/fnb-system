import { expect, it } from 'vitest';
import { canonicalPathForRoute, resolveCanonicalPath } from '../routeOwnership.js';
it('preserves only the safe OAuth outcome on the canonical Google Reviews route',()=>{
 const route=resolveCanonicalPath('/crew/performance/google-reviews','?google_result=connected&code=secret&state=secret');
 expect(route.query).toEqual({google_result:'connected'});
 expect(canonicalPathForRoute('crew_google_reviews',{},route.query)).toBe('/crew/performance/google-reviews?google_result=connected');
});
