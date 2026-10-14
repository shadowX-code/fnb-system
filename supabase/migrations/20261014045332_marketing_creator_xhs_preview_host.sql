-- Actual provider cover CDN, admitted only through the existing Creator observation authority.
do $$
declare body text;needle text:='xhscdn'||chr(92)||'.com|';replacement text:=needle||'sns-i11'||chr(92)||'.rednotecdn'||chr(92)||'.com|';pattern text;
begin
 body:=pg_get_functiondef('marketing_private.creator_confirm_public(uuid,uuid,uuid,jsonb)'::regprocedure);
 if position(needle in body)=0 then raise exception 'Creator thumbnail contract changed';end if;
 body:=replace(body,needle,replacement);
 pattern:=substring(body from 'u !~ ''([^'']+)''');
 if pattern is null or not ('https://sns-i11.rednotecdn.com/fixture.webp' ~ pattern) or not ('https://img.xhscdn.com/fixture.jpg' ~ pattern) or ('https://sns-i11.rednotecdn.com.evil.test/fixture.webp' ~ pattern) then raise exception 'Creator thumbnail boundary invalid';end if;
 execute body;
end;$$;
