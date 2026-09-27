-- LINDUNG 24 JAM is a separate voluntary non-employment injury scheme for
-- Malaysian employees. It neither replaces nor changes the ordinary Act 4
-- contribution schedule; do not gate Act 4 on an unmodelled election.
-- Source: https://www.perkeso.gov.my/en/our-services/protection/lindung-24-jam.html
create or replace function public.payroll_statutory_category_issue(
  p_scheme text,p_category text,p_nationality text,p_birthday date,
  p_period_start date,p_period_end date
) returns text language plpgsql immutable set search_path=public as $$
declare v_age_start integer; v_age_end integer;
begin
  if p_nationality is distinct from 'Malaysia' then
    return p_scheme||'_citizenship_category_unverified';
  end if;
  if p_birthday is null or p_birthday>p_period_start then
    return p_scheme||'_birthdate_unverified';
  end if;
  v_age_start:=date_part('year',age(p_period_start,p_birthday))::integer;
  v_age_end:=date_part('year',age(p_period_end,p_birthday))::integer;
  if p_scheme='epf' then
    if v_age_start<14 or v_age_end>=75 then return 'epf_age_category_unsupported'; end if;
    if v_age_start<60 and v_age_end>=60 then return 'epf_mid_period_age_category_change'; end if;
    if (v_age_start<60 and p_category is distinct from 'malaysian_under_60')
      or (v_age_start>=60 and p_category is distinct from 'malaysian_60_to_74') then
      return 'epf_category_mismatch';
    end if;
  elsif p_scheme='socso' then
    if v_age_start<18 or (v_age_start<60 and v_age_end>=60) then return 'socso_age_category_review_required'; end if;
    if v_age_start>=55 and v_age_start<60 then return 'socso_prior_contribution_history_unverified'; end if;
    if (v_age_start<60 and p_category is distinct from 'first_category_base')
      or (v_age_start>=60 and p_category is distinct from 'second_category_base') then
      return 'socso_category_mismatch';
    end if;
  elsif p_scheme='eis' then
    if v_age_start<18 or v_age_end>=60 then return 'eis_age_eligibility_review_required'; end if;
    if v_age_start>=57 then return 'eis_prior_contribution_history_unverified'; end if;
    if p_category is distinct from 'standard' then return 'eis_category_mismatch'; end if;
  else
    return p_scheme||'_category_unsupported';
  end if;
  return null;
end; $$;
revoke all on function public.payroll_statutory_category_issue(text,text,text,date,date,date)
  from public,anon,authenticated;
