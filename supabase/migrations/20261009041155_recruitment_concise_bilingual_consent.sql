-- New presentation copy only; historical consent snapshots remain immutable.
insert into public.recruitment_consent_copy_versions(version,copy,status) values
('feedx-interview-v1-bilingual-concise',jsonb_build_object(
 'title','About this interview',
 'body',jsonb_build_array('This interview is conducted using an automated interviewer.'),
 'consent','I understand that this interview will record my video, audio and responses for recruitment review.',
 'translations',jsonb_build_object('zh',jsonb_build_object(
   'title','关于本次面试',
   'body',jsonb_build_array('本次面试由自动面试官进行。'),
   'consent','我了解本次面试将录制视频、声音及回答，供招聘团队审核。'
 ))
),'approved');
