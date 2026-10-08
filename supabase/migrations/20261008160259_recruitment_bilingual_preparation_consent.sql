-- Append-only presentation version. Accepted snapshots and purposes stay fixed.
insert into public.recruitment_consent_copy_versions(version,copy,status) values
('feedx-interview-v1-bilingual',jsonb_build_object(
 'title','About this interview','body','[]'::jsonb,
 'consent','I understand this interview is conducted using an automated interviewer, and I consent to the recording of my camera, microphone and interview responses for recruitment review.',
 'translations',jsonb_build_object('zh',jsonb_build_object(
   'title','关于本次面试','body','[]'::jsonb,
   'consent','我了解本次面试由自动面试官进行，并同意录制我的摄像头画面、麦克风声音及面试回答，供招聘团队审核。'
 ))
),'approved');
