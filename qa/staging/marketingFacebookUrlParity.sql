-- Read-only parser checks; no provider call.
do $$
declare f record; v jsonb;
begin
 for f in select * from (values
 ('https://www.facebook.com/posts/12345','https://www.facebook.com/posts/12345','12345'),
 ('https://www.facebook.com/videos/12345','https://www.facebook.com/videos/12345','12345'),
 ('https://m.facebook.com/brand/posts/caption/122171025848804842/?mibextid=tracking','https://www.facebook.com/brand/posts/122171025848804842','122171025848804842'),
 ('https://web.facebook.com/brand/videos/12345/','https://www.facebook.com/brand/videos/12345','12345'),
 ('https://www.facebook.com/reel/12345/','https://www.facebook.com/reel/12345','12345'),
 ('https://www.facebook.com/watch/?v=12345&tracking=x','https://www.facebook.com/watch/?v=12345','12345'),
 ('https://www.facebook.com/photo.php?fbid=12345&set=other','https://www.facebook.com/photo/?fbid=12345','12345'),
 ('https://www.facebook.com/photo/?fbid=12345','https://www.facebook.com/photo/?fbid=12345','12345'),
 ('https://www.facebook.com/permalink.php?story_fbid=12345&id=999','https://www.facebook.com/story.php?story_fbid=12345&id=999','12345'),
 ('https://www.facebook.com/story.php?story_fbid=12345&id=999','https://www.facebook.com/story.php?story_fbid=12345&id=999','12345'),
 ('https://fb.watch/AbCd_12/','https://fb.watch/AbCd_12/','fb.watch:AbCd_12'),
 ('https://www.facebook.com/share/v/AbCd_12/','https://www.facebook.com/share/v/AbCd_12/','share:AbCd_12'))x(url,canonical,key) loop
   v:=marketing_private.creator_url(f.url); assert v->>'post_key'=f.key, 'Browser/database identity mismatch';
  assert v->>'canonical_url'=f.canonical,'Browser/database canonical mismatch';v:=marketing_private.creator_url(f.canonical);
  assert v->>'post_key'=f.key,'Canonical roundtrip mismatch';
 end loop;
end;$$;
select 'PASS: 12 Facebook variants agree across extraction and database parsers; no provider access' verification;
