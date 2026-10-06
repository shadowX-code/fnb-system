-- Isolated Staging experiment. No interview/evidence tables or existing cache change.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('recruitment-generated-voices','recruitment-generated-voices',false,10485760,array['application/json','audio/wav']);
-- No anon/authenticated object policy: only the protected manager Edge may read.
