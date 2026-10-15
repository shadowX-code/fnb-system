import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
describe('Production acceptance exception corrections', () => {
  it('adds Social at the canonical analytics boundary without broadening All', () => {
    const sql = read('20261015071330_inbox_analytics_social_scope');
    expect(sql).toContain("('','social','internal','facebook','instagram')");
    expect(sql).toContain("(p_channel='social' and c.channel<>'internal')");
    expect(sql).toContain('marketing_private.brand_allowed(p_org,c.brand_id)');
    expect(sql).toContain("marketing_private.require_access(p_org,p_brand,'marketing_inbox.view')");
  });
  it('changes only the Factory base CTE evaluation boundary', () => {
    const original = read('20260918160000_factory_production_operational_completion');
    const revised = read('20261015071332_factory_dashboard_single_snapshot');
    const body = (sql) => sql.match(/as \$\$([\s\S]*?)\$\$/i)?.[1].trim();
    const prior = original.slice(original.indexOf('create or replace function public.factory_get_dashboard_operational_monthly_analytics('));
    const actual = revised.match(/AS \$function\$([\s\S]*?)\$function\$/)?.[1].trim();
    expect(actual.replace('base as materialized (', 'base as (')).toBe(body(prior));
    expect(revised).not.toMatch(/security definer|alter policy|statement_timeout/i);
  });
});
