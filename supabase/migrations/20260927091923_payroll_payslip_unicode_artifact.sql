-- Full TrueType embedding avoids invalid CJK subset glyphs. Private artifacts only.
alter table public.payroll_payslip_artifacts drop constraint payroll_payslip_artifacts_size_bytes_check;
alter table public.payroll_payslip_artifacts add constraint payroll_payslip_artifacts_size_bytes_check check(size_bytes between 1 and 16777216);
update storage.buckets set file_size_limit=16777216 where id='payroll-payslips' and public=false;
alter table public.payroll_payslip_jobs alter column renderer_version set default 'a4_v3';
