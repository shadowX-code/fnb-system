-- Keep essential post routes/context while deduplicating the platform post identity.
create or replace function marketing_private.creator_url(p_url text) returns jsonb language plpgsql immutable set search_path=public as $$
declare u text:=trim(p_url);host text;path text;m text[];platform text;key text;canonical text;author text:='';
begin
 if length(u)>1500 or u !~ '^https?://' or u ~ '[[:space:]\\]' then raise exception 'Paste a valid public social post URL.';end if;
 host:=lower(substring(u from '^https?://([^/?#]+)'));path:=regexp_replace(u,'^https?://[^/]+','');path:=split_part(path,'#',1);
 if host in ('instagram.com','www.instagram.com') then
  m:=regexp_match(path,'^/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)/?(?:\?.*)?$');if m is null then raise exception 'Use an Instagram post or Reel link.';end if;
  platform:='instagram';key:=m[1];canonical:='https://www.instagram.com/'||case when path ~ '^/reels?/' then 'reel' when path ~ '^/tv/' then 'tv' else 'p' end||'/'||key||'/';
 elsif host in ('facebook.com','www.facebook.com','m.facebook.com','web.facebook.com') then
  m:=regexp_match(path,'^/([^/?]+)/(posts|videos)/(?:(?:[^/?]+/)?)([0-9A-Za-z_-]+)/?(?:\?.*)?$');
  if m is not null then key:=m[3];canonical:='https://www.facebook.com/'||m[1]||'/'||m[2]||'/'||key;
  else m:=regexp_match(path,'^/(?:[^/?]+/)?reel/([0-9A-Za-z_-]+)/?(?:\?.*)?$');
   if m is not null then key:=m[1];canonical:='https://www.facebook.com/reel/'||key;
   elsif path ~ '^/watch/?\?' and path ~ '[?&]v=[0-9]+' then
    key:=(regexp_match(path,'[?&]v=([0-9]+)(?:&|$)'))[1];canonical:='https://www.facebook.com/watch/?v='||key;
   elsif path ~ '^/(photo(?:\.php)?/?|story\.php|permalink\.php)\?' then
    if path ~ '^/photo' then
     key:=(regexp_match(path,'[?&]fbid=([0-9]+)(?:&|$)'))[1];canonical:='https://www.facebook.com/photo/?fbid='||key;
    else
     key:=(regexp_match(path,'[?&]story_fbid=([0-9]+)(?:&|$)'))[1];canonical:='https://www.facebook.com/story.php?story_fbid='||key||coalesce('&id='||(regexp_match(path,'[?&]id=([0-9]+)(?:&|$)'))[1],'');
    end if;
   else
    m:=regexp_match(path,'^/share/(?:[prv]/)?([A-Za-z0-9_-]+)/?(?:\?.*)?$');
    if m is null then raise exception 'Use a Facebook post, photo, video or share link.';end if;
    key:='share:'||m[1];canonical:='https://www.facebook.com'||split_part(path,'?',1);
   end if;
  end if;
  if key is null then raise exception 'Use a Facebook post, photo, video or share link.';end if;
  platform:='facebook';
 elsif host='fb.watch' then
  m:=regexp_match(path,'^/([A-Za-z0-9_-]+)/?(?:\?.*)?$');if m is null then raise exception 'Use a Facebook video share link.';end if;
  platform:='facebook';key:='share:'||m[1];canonical:='https://fb.watch/'||m[1]||'/';
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
