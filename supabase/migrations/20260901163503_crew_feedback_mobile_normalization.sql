create or replace function public.crew_feedback_normalize_mobile()
returns trigger language plpgsql security definer set search_path=public as $$
declare digits text;
begin
 if new.contact_method<>'phone' then return new; end if;
 digits:=regexp_replace(coalesce(new.contact_value,''),'[^0-9+]','','g');
 if left(digits,1)='+' then digits:=substr(digits,2); end if;
 if left(digits,1)='0' then digits:='60'||substr(digits,2); end if;
 if left(digits,2)<>'60' then raise exception using errcode='22023',message='Enter a valid Malaysian mobile number.'; end if;
 digits:=substr(digits,3);
 if digits !~ '^1[0-9]{7,9}$' then raise exception using errcode='22023',message='Enter a valid Malaysian mobile number.'; end if;
 new.contact_value:='+60'||digits;
 return new;
end; $$;
revoke all on function public.crew_feedback_normalize_mobile() from public,anon,authenticated;

drop trigger if exists crew_feedback_follow_up_normalize_mobile on public.crew_feedback_follow_ups;
create trigger crew_feedback_follow_up_normalize_mobile
before insert or update of contact_method,contact_value on public.crew_feedback_follow_ups
for each row execute function public.crew_feedback_normalize_mobile();
