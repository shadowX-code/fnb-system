-- Existing campaign configurations retain their historical response snapshots. This only
-- annotates the stable original Sambal question keys so the role-driven read model can
-- include their existing answers without relying on campaign wording.
with normalized as (
  select c.id,
    jsonb_agg(
      case q.question->>'key'
        when 'overall_rating' then q.question || jsonb_build_object('analytics_role', 'overall_rating')
        when 'purchase_intent' then q.question || jsonb_build_object('analytics_role', 'purchase_intent', 'analytics_target_value', coalesce(nullif(q.question->>'analytics_target_value', ''), 'Yes'))
        when 'sambal_spiciness' then q.question || jsonb_build_object('analytics_role', 'taste_spiciness', 'analytics_target_value', coalesce(nullif(q.question->>'analytics_target_value', ''), 'Just right'))
        when 'price_20g' then q.question || jsonb_build_object(
          'analytics_role', 'price_acceptance',
          'options', coalesce((
            select jsonb_agg(
              case option.value->>'value'
                when 'RM0.80' then option.value || jsonb_build_object('amount', 0.8, 'currency', 'MYR', 'display_label', coalesce(option.value->>'display_label', option.value->>'label_en', 'RM0.80'))
                when 'RM1.00' then option.value || jsonb_build_object('amount', 1, 'currency', 'MYR', 'display_label', coalesce(option.value->>'display_label', option.value->>'label_en', 'RM1.00'))
                when 'RM1.50' then option.value || jsonb_build_object('amount', 1.5, 'currency', 'MYR', 'display_label', coalesce(option.value->>'display_label', option.value->>'label_en', 'RM1.50'))
                when 'RM2.00' then option.value || jsonb_build_object('amount', 2, 'currency', 'MYR', 'display_label', coalesce(option.value->>'display_label', option.value->>'label_en', 'RM2.00'))
                when 'RM2.50+' then option.value || jsonb_build_object('amount', 2.5, 'currency', 'MYR', 'display_label', coalesce(option.value->>'display_label', option.value->>'label_en', 'RM2.50+'))
                else option.value
              end order by option.ordinality
            )
            from jsonb_array_elements(coalesce(q.question->'options', '[]'::jsonb)) with ordinality option(value, ordinality)
          ), q.question->'options')
        )
        else q.question
      end
      order by q.ordinality
    ) as questions
  from public.factory_product_feedback_campaigns c
  cross join lateral jsonb_array_elements(c.questions) with ordinality q(question, ordinality)
  where exists (
    select 1 from jsonb_array_elements(c.questions) item
    where item->>'key' in ('overall_rating', 'purchase_intent', 'sambal_spiciness', 'price_20g')
      and coalesce(item->>'analytics_role', '') = ''
  )
  group by c.id
)
update public.factory_product_feedback_campaigns c
set questions = normalized.questions,
    form_version = c.form_version + 1,
    updated_at = now()
from normalized
where c.id = normalized.id;
