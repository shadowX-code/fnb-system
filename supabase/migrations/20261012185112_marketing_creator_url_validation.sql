-- Exact host validation rejects URL credentials; TikTok @handles are valid path segments.
create or replace function marketing_private.creator_url(p_url text) returns jsonb language plpgsql immutable set search_path=public as $$
declare u text:=trim(p_url);host text;path text;m text[];platform text;key text;canonical text;author text:='';
begin
 if length(u)>1500 or u !~ '^https?://' or u ~ '[[:space:]\\]' then raise exception 'Paste a valid public social post URL.';end if;
 host:=lower(substring(u from '^https?://([^/?#]+)'));path:=regexp_replace(u,'^https?://[^/]+','');path:=split_part(path,'#',1);
 if host in ('instagram.com','www.instagram.com') then
  m:=regexp_match(path,'^/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)/?(?:\?.*)?$');if m is null then raise exception 'Use an Instagram post or Reel link.';end if;
  platform:='instagram';key:=m[1];canonical:='https://www.instagram.com/p/'||key||'/';
 elsif host in ('facebook.com','www.facebook.com','m.facebook.com','web.facebook.com') then
  m:=regexp_match(path,'^/(?:[^/?]+/)?(?:posts|videos|reel)/([0-9A-Za-z_-]+)/?(?:\?.*)?$');
  if m is not null then key:=m[1];canonical:='https://www.facebook.com'||split_part(path,'?',1);
  else m:=regexp_match(path,'[?&](?:fbid|story_fbid)=([0-9]+)');
   if m is not null and path ~ '^/(photo(?:\.php)?|story\.php)\?' then key:=m[1];canonical:='https://www.facebook.com/photo/?fbid='||key;
   else m:=regexp_match(path,'^/share/(?:[prv]/)?([A-Za-z0-9]+)/?(?:\?.*)?$');if m is null then raise exception 'Use a Facebook post, photo, video or share link.';end if;key:='share:'||m[1];canonical:='https://www.facebook.com'||split_part(path,'?',1);end if;
  end if;platform:='facebook';canonical:=regexp_replace(canonical,'(?<!:)/{2,}','/','g');
 elsif host in ('tiktok.com','www.tiktok.com') then
  m:=regexp_match(path,'^/@([^/?]+)/video/([0-9]+)/?(?:\?.*)?$');if m is null then raise exception 'Use a TikTok video link.';end if;
  platform:='tiktok';author:=m[1];key:=m[2];canonical:='https://www.tiktok.com/@'||author||'/video/'||key;
 elsif host in ('vm.tiktok.com','vt.tiktok.com') then
  m:=regexp_match(path,'^/([A-Za-z0-9]+)/?(?:\?.*)?$');if m is null then raise exception 'Use a valid TikTok share link.';end if;
  platform:='tiktok';key:=host||':'||m[1];canonical:='https://'||host||'/'||m[1]||'/';
 elsif host in ('xiaohongshu.com','www.xiaohongshu.com') then
  m:=regexp_match(path,'^/(?:explore|discovery/item)/([A-Fa-f0-9]+)/?(?:\?.*)?$');if m is null then raise exception 'Use a Xiaohongshu post link.';end if;
  platform:='xhs';key:=lower(m[1]);canonical:='https://www.xiaohongshu.com/explore/'||key;
 elsif host in ('xhslink.com','www.xhslink.com') then
  m:=regexp_match(path,'^/(?:a/)?([A-Za-z0-9]+)/?(?:\?.*)?$');if m is null then raise exception 'Use a valid Xiaohongshu share link.';end if;
  platform:='xhs';key:='short:'||m[1];canonical:='https://xhslink.com'||split_part(path,'?',1);
 else raise exception 'Supported platforms: Facebook, Instagram, Xiaohongshu and TikTok.';end if;
 return jsonb_build_object('platform',platform,'post_key',key,'canonical_url',canonical,'author_handle',author,'identity_verified',false,
 'short_link',key like 'share:%' or key like 'short:%' or key like '%tiktok.com:%');
end;$$;
