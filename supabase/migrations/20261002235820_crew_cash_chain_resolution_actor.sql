do $$ begin if md5(pg_get_functiondef('public.crew_cash_capture_review_event()'::regprocedure))<>'dbc89dde700d49a9b014cee6c8caa333' then raise exception 'Cash chain resolution actor baseline drift'; end if; end $$;
CREATE OR REPLACE FUNCTION public.crew_cash_capture_review_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare kind text;
begin
 if tg_op='UPDATE' and old.status='submitted' and not exists(select 1 from public.crew_cash_checkout_review_events where checkout_id=old.id) then
  -- Preserve the pre-existing submission at its recorded time, before any return/approval.
  insert into public.crew_cash_checkout_review_events(checkout_id,event,actor_employee_id,occurred_at,snapshot)
  values(old.id,'submitted',old.checked_out_by_employee_id,coalesce(old.submitted_at,old.created_at),to_jsonb(old));
 end if;
 if tg_op='UPDATE' and old.review_status='rejected' and not exists(select 1 from public.crew_cash_checkout_review_events where checkout_id=old.id) then
  if old.submitted_at is not null then
   insert into public.crew_cash_checkout_review_events(checkout_id,event,actor_employee_id,occurred_at,snapshot)
   values(old.id,'submitted',old.checked_out_by_employee_id,old.submitted_at,to_jsonb(old));
  end if;
  if old.reviewed_by is not null and nullif(btrim(old.review_note),'') is not null then
   insert into public.crew_cash_checkout_review_events(checkout_id,event,actor_user_id,occurred_at,reason,snapshot)
   values(old.id,'returned',old.reviewed_by,coalesce(old.reviewed_at,old.updated_at),old.review_note,to_jsonb(old));
  end if;
 end if;
 if new.status='cancelled' and (tg_op='INSERT' or old.status<>'cancelled') then kind:='cancelled';
 elsif new.status='submitted' and (tg_op='INSERT' or old.status<>'submitted') then
  kind:=case when exists(select 1 from public.crew_cash_checkout_review_events where checkout_id=new.id and event='returned') then 'resubmitted' else 'submitted' end;
 elsif tg_op='UPDATE' and old.status='submitted' and new.status='reconciled' and new.review_status='rejected' then kind:='returned';
 elsif new.status='completed' and (tg_op='INSERT' or old.status<>'completed') then kind:=case when new.review_status='approved' then 'approved' else 'completed' end;
 else return new; end if;
 insert into public.crew_cash_checkout_review_events(checkout_id,event,actor_employee_id,actor_user_id,reason,snapshot)
 values(new.id,kind,case when kind in ('submitted','resubmitted','completed','cancelled') then case when kind='cancelled' then nullif(current_setting('feedx.crew_cash_cancellation_employee',true),'')::uuid else new.checked_out_by_employee_id end end,
 case when kind in ('returned','approved') or kind='cancelled' and nullif(current_setting('feedx.crew_cash_cancellation_employee',true),'') is null then auth.uid() end,case when kind in ('returned','cancelled') then new.review_note end,to_jsonb(new));
 if kind in ('completed','approved','cancelled') then perform public.crew_cash_record_basis_changes(new.outlet_id,new.business_date,case when kind='completed' then new.checked_out_by_employee_id when kind='cancelled' then nullif(current_setting('feedx.crew_cash_cancellation_employee',true),'')::uuid end,case when kind='approved' or kind='cancelled' and nullif(current_setting('feedx.crew_cash_cancellation_employee',true),'') is null then auth.uid() end); end if;
 return new;
end $function$
;
