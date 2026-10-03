-- Submitted is awaiting a Manager decision, including legacy submissions whose
-- exception flags were not required. Preserve their recorded financial evidence.
do $$ begin if md5(pg_get_functiondef('public.crew_cash_review_checkout(uuid,text,text)'::regprocedure))<>'d330f2fabcedda7baa93925293af8535' then raise exception 'Cash submitted review baseline drift'; end if; end $$;
CREATE OR REPLACE FUNCTION public.crew_cash_review_checkout(p_checkout_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.crew_cash_checkouts%rowtype; decision text:=lower(btrim(p_decision));
begin
 select * into c from public.crew_cash_checkouts where id=p_checkout_id;
 if c.id is not null then
  perform public.crew_cash_assert_admin(c.outlet_id,'crew_cash_checkout.review');
  perform pg_advisory_xact_lock(hashtextextended(c.outlet_id::text,0));
  select * into c from public.crew_cash_checkouts where id=p_checkout_id for update;
 end if;
 if c.id is null then raise exception using errcode='P0002',message='Cash Checkout was not found.'; end if;
 perform public.crew_cash_assert_admin(c.outlet_id,'crew_cash_checkout.review');
 if decision='cancel' then
  if c.status in ('completed','cancelled') then raise exception using errcode='22023',message='Only unresolved Cash Checkouts can be cancelled.'; end if;
  if char_length(btrim(coalesce(p_note,''))) not between 3 and 500 then raise exception using errcode='22023',message='A cancellation reason of 3 to 500 characters is required.'; end if;
  perform set_config('feedx.crew_cash_cancellation_employee','',true);
  update public.crew_cash_checkouts set status='cancelled',review_note=btrim(p_note),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where id=c.id returning * into c;
  return to_jsonb(c)||public.crew_cash_checkout_allocation(c.id);
 end if;
 if c.status<>'submitted' then raise exception using errcode='22023',message='This Cash Checkout is not awaiting review.'; end if;
 if decision='approve' then
  perform public.crew_cash_assert_previous_resolved(c.outlet_id,c.business_date);
  if (public.crew_cash_chain_context(c.outlet_id,c.business_date,c.id)->>'basis_review_required')::boolean then
   if char_length(btrim(coalesce(p_note,'')))<3 then raise exception using errcode='22023',message='Record the Manager review of the changed carry basis.'; end if;
   insert into public.crew_cash_checkout_review_events(checkout_id,event,actor_user_id,reason,snapshot) values(c.id,'basis_reviewed',auth.uid(),p_note,jsonb_build_object('checkout',to_jsonb(c),'chain',public.crew_cash_chain_context(c.outlet_id,c.business_date,c.id)));
  end if;
  update public.crew_cash_checkouts set review_status='approved',review_note=nullif(btrim(p_note),''),reviewed_by=auth.uid(),reviewed_at=now(),status='completed',completed_at=now(),updated_at=now() where id=c.id returning * into c;
  perform public.crew_cash_append_checkout_ledger(c.id,auth.uid());
 elsif decision='reject' then
  if char_length(btrim(coalesce(p_note,''))) not between 3 and 500 then raise exception using errcode='22023',message='A return reason of 3 to 500 characters is required.'; end if;
  update public.crew_cash_checkouts set review_status='rejected',review_note=btrim(p_note),reviewed_by=auth.uid(),reviewed_at=now(),status='reconciled',updated_at=now() where id=c.id returning * into c;
 else raise exception using errcode='22023',message='Review decision must be approve or reject.'; end if;
 return to_jsonb(c);
end; $function$
;
