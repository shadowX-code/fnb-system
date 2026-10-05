-- An explicitly rebased review still requires a new decision. Ordinary clean
-- Monthly evidence may resolve automatically; pending corrections may not.
do $$ declare d text; begin
 d:=pg_get_functiondef('public.payroll_time_requirement(jsonb,jsonb)'::regprocedure);
 if position('if p_time->>''status'' in (''approved_manual'',''non_payable'')' in d)=0 then
  raise exception 'Unexpected time-requirement contract'; end if;
 d:=replace(d,'if p_time->>''status'' in (''approved_manual'',''non_payable'') and not coalesce(matched,false) then',
 'if (p_time->>''status'' in (''approved_manual'',''non_payable'') and not coalesce(matched,false))
   or (p_time->>''status''=''review_required'' and nullif(btrim(p_time->>''decision_reason''),'''') is not null) then');
 execute d;
end $$;
