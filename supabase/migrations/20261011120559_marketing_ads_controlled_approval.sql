create function public.marketing_ads_change_transition(p_request uuid,p_fingerprint text,p_action text) returns jsonb language plpgsql security definer set search_path=public as $$
declare r marketing_private.ads_changes; actor uuid; permission text;
begin
 select * into r from marketing_private.ads_changes where id=p_request for update;
 if r.id is null then raise exception 'Proposal unavailable';end if;
 permission:=case p_action when 'submit' then 'marketing_ads.manage' when 'review' then 'marketing_ads.review' when 'approve' then 'marketing_ads.approve' when 'cancel' then 'marketing_ads.manage' end;
 if permission is null then raise exception 'Unsupported proposal action';end if;
 actor:=marketing_private.require_access(r.organization_id,r.brand_id,permission);
 if r.fingerprint is distinct from p_fingerprint then raise exception 'Revision changed';end if;
 if p_action<>'cancel' and not marketing_private.ads_change_current(r) then raise exception 'Authorization, attribution or Meta configuration changed. Prepare a new revision.';end if;
 if p_action='submit' and r.state='draft' then r.state:='review';
 elsif p_action='review' and r.state='review' then r.reviewed_by:=actor;
 elsif p_action='approve' and r.state='review' and r.reviewed_by is not null then r.state:='approved';r.approved_by:=actor;r.approved_at:=now();r.approval_expires_at:=now()+interval '24 hours';
 elsif p_action='cancel' and r.state in ('draft','review','approved','failed','stale') then r.state:='cancelled';
 elsif (p_action='submit' and r.state='review') or (p_action='review' and r.reviewed_by=actor) or (p_action='approve' and r.state='approved' and r.approved_by=actor) or (p_action='cancel' and r.state='cancelled') then return to_jsonb(r)-'lease'-'lease_until';
 else raise exception 'Review the current proposal state';end if;
 update marketing_private.ads_changes set state=r.state,reviewed_by=r.reviewed_by,approved_by=r.approved_by,approved_at=r.approved_at,approval_expires_at=r.approval_expires_at,updated_at=now() where id=r.id returning * into r;
 insert into marketing_private.ads_change_events(change_id,revision,event,actor,evidence) values(r.id,r.revision,p_action,actor,jsonb_build_object('fingerprint',r.fingerprint,'maximum_budget',r.maximum_budget));
 return to_jsonb(r)-'lease'-'lease_until';
end;$$;

-- Only the server with an explicitly configured approved fingerprint may claim execution.

revoke all on function public.marketing_ads_change_transition(uuid,text,text) from public,anon; grant execute on function public.marketing_ads_change_transition(uuid,text,text) to authenticated;
