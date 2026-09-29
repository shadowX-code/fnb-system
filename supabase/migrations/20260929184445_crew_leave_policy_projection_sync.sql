-- Reconcile the materialized current-policy projection after cutover
-- observations stop acting as policy transitions. Existing grant rows stay
-- immutable; the established authority appends review evidence as needed.
select public.crew_leave_activate_due_policy_versions();
