-- Apply to ujkzdaaadnvcfayuldmh only, after the compatible Edge and SDK frontend are READY.
-- User product decision: authorized Staging testing has no fixed evaluation allowance.
alter table feedx_integrations.assistant_voice_policy_audit alter column actor drop not null;
alter table feedx_integrations.assistant_voice_policy_audit add column source text not null default 'admin';
update feedx_integrations.assistant_voice_policy set enabled=true,per_user_daily_sessions=null,approval_required=false,revision=revision+1 where environment='staging';
-- This is an inactive template in the Staging database, never Production activation.
update feedx_integrations.assistant_voice_policy set per_user_daily_sessions=null,approval_required=false where environment='production' and not enabled;
insert into feedx_integrations.assistant_voice_policy_audit(source,policy) select 'migration:staging-development-policy-2026-11-07',to_jsonb(p) from feedx_integrations.assistant_voice_policy p where environment='staging';
