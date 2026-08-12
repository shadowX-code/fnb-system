-- Growth writes are controlled by narrowly scoped SECURITY DEFINER authorities.
-- Remove project default DML table privileges so authenticated callers cannot
-- bypass those validation and history boundaries even if a policy changes.
revoke insert, update, delete, truncate, references, trigger
on table
  public.crew_skills,
  public.crew_skill_positions,
  public.crew_skill_outlets,
  public.crew_skill_requirements,
  public.crew_practical_assessments,
  public.crew_skill_certifications
from authenticated;

grant select
on table
  public.crew_skills,
  public.crew_skill_positions,
  public.crew_skill_outlets,
  public.crew_skill_requirements,
  public.crew_practical_assessments,
  public.crew_skill_certifications
to authenticated;
