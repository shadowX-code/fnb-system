-- New presentation copy; never rewrite accepted versions or historical snapshots.
insert into public.recruitment_consent_copy_versions(version,copy,status) values
('feedx-interview-v1-concise',jsonb_build_object(
 'title','About this interview',
 'body',jsonb_build_array('This interview is conducted using an automated interviewer and will be recorded for recruitment review.'),
 'consent','I consent to the recording of my camera, microphone and interview responses for recruitment review.'
),'approved');
