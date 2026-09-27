do $$ declare def text; begin
 def:=pg_get_functiondef('public.crew_leave_entitlement_balance(uuid,date)'::regprocedure);
 def:=replace(def,'return jsonb_build_object(',
 'if e.leave_type=''replacement'' and p_as_of>e.period_end then available:=0; end if; return jsonb_build_object(');
 execute def;
end $$;
