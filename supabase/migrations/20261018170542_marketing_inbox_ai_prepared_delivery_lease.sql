-- Separate prepared delivery ownership from model generation and the provider write-ahead lease.
alter table marketing_private.inbox_automatic_turns add column delivery_claimed_at timestamptz;
do $m$ declare f text;needle text;begin
 f:=pg_get_functiondef('public.marketing_inbox_auto_claim()'::regprocedure);
 needle:=$n$where q.state='prepared' and o.state='prepared' order by$n$;
 if position(needle in f)=0 then raise exception 'Prepared recovery baseline differs';end if;
 f:=replace(f,needle,$n$where q.state='prepared' and o.state='prepared' and (q.delivery_claimed_at is null or q.delivery_claimed_at<now()-interval '2 minutes') order by$n$);
 needle:=$n$  return jsonb_build_object('delivery_only',true$n$;
 if position(needle in f)=0 then raise exception 'Recovery return baseline differs';end if;
 f:=replace(f,needle,$n$  update marketing_private.inbox_automatic_turns set delivery_claimed_at=now() where id=t.id and state='prepared' and (delivery_claimed_at is null or delivery_claimed_at<now()-interval '2 minutes') returning * into t;
  if not found then continue;end if;
$n$||needle);execute f;
 f:=pg_get_functiondef('public.marketing_inbox_auto_finish(uuid,uuid,jsonb,text,integer,integer,uuid)'::regprocedure);
 needle:=$n$set state='prepared',reason=decision->>'reason',updated_at=now()$n$;
 if position(needle in f)=0 then raise exception 'Prepared finish baseline differs';end if;
 f:=replace(f,needle,$n$set state='prepared',reason=decision->>'reason',updated_at=now(),delivery_claimed_at=now()$n$);execute f;
end;$m$;
