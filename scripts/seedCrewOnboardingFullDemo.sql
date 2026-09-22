-- FeedX Crew Onboarding full Demo / QA dataset.
--
-- STAGING ONLY. This is deliberately a script, never a migration. Draft rows
-- are written through the same authenticated RLS path as the Admin UI.
-- Publish/version transitions, Crew Access and Crew progress use the existing
-- controlled authorities. Published history and assignment snapshots are not
-- rewritten.

begin;

create temporary table qa_sop_spec (
  title text primary key,
  category text not null,
  acknowledgement boolean not null,
  sections jsonb not null
) on commit drop;

insert into qa_sop_spec(title, category, acknowledgement, sections) values
('Welcome & Goodbye Standard', 'Service', true, '[
  {"title":"Welcome within five seconds","body":"Acknowledge every guest within five seconds, even when you are assisting someone else.","key":true},
  {"title":"Warm presence","body":"Smile, maintain natural eye contact and use open body language.","key":false},
  {"title":"Appropriate greeting","body":"Use a greeting that suits the time of day and the guest interaction.","key":false},
  {"title":"Thank the guest","body":"Thank every guest sincerely before they leave.","key":false},
  {"title":"Goodbye and return invitation","body":"Say goodbye and invite the guest to visit Friends Corner again.","key":true}
]'::jsonb),
('Personal Grooming Standard', 'Service', true, '[
  {"title":"Clean uniform","body":"Begin every shift in a clean, complete and well-fitted uniform.","key":true},
  {"title":"Hair and appearance","body":"Keep hair neat and secured where the role requires it.","key":false},
  {"title":"Name tag","body":"Wear the approved name tag where guests can read it.","key":false},
  {"title":"Personal hygiene","body":"Maintain clean hands, fresh breath and appropriate personal hygiene throughout the shift.","key":true},
  {"title":"Proper shoes","body":"Wear clean, closed and slip-resistant shoes suitable for restaurant work.","key":false}
]'::jsonb),
('Workstation Cleanliness', 'Cleaning', true, '[
  {"title":"Assigned area","body":"Keep the assigned workstation clean, organised and ready for the next task.","key":true},
  {"title":"Used items","body":"Clear used items promptly and send them to the correct cleaning area.","key":false},
  {"title":"Table and floor checks","body":"Check tables, chairs and floor condition throughout service.","key":false},
  {"title":"Safe cleaning","body":"Use the approved chemical, cloth and procedure for each surface.","key":false},
  {"title":"End-of-shift cleanliness","body":"Leave the workstation clean, stocked and ready for handover.","key":true}
]'::jsonb),
('Opening & Closing Basic Standard', 'Opening & Closing', true, '[
  {"title":"Opening safety check","body":"Check access points, lighting, equipment condition and emergency routes before service.","key":true},
  {"title":"Opening readiness","body":"Confirm the dining area, service stations and essential supplies are ready.","key":false},
  {"title":"Closing responsibilities","body":"Clean, switch off and secure each assigned area using the closing checklist.","key":false},
  {"title":"Cash and equipment handover","body":"Hand over cash, keys and equipment only to the authorised next person.","key":false},
  {"title":"Final handover","body":"Report incomplete work, exceptions and safety concerns before leaving.","key":true}
]'::jsonb);

create temporary table qa_module_spec (
  module_key text primary key,
  sort_order integer not null,
  title text not null,
  description text not null,
  required boolean not null
) on commit drop;

insert into qa_module_spec values
('m1',1,'Welcome & Workplace','Meet Friends Corner, the team and the standards that shape every shift.',true),
('m2',2,'Customer Arrival & Greeting','Create a warm first impression and a consistent farewell.',true),
('m3',3,'Taking Orders','Capture every order accurately and confirm special requests.',true),
('m4',4,'Serving & Table Service','Serve safely, stay aware and help guests with confidence.',true),
('m5',5,'Cleaning & Hygiene','Follow personal and workstation hygiene standards.',true),
('m6',6,'Take Away & Packaging','Pack, verify and hand over takeaway orders correctly.',true),
('m7',7,'Opening & Closing','Prepare, close and hand over the outlet responsibly.',true),
('m8',8,'Role Readiness','Bring the complete onboarding standard into the first shift.',true);

create temporary table qa_lesson_spec (
  lesson_key text primary key,
  module_key text not null,
  sort_order integer not null,
  title text not null,
  required boolean not null,
  estimated_minutes integer not null
) on commit drop;

insert into qa_lesson_spec values
('m1_l1','m1',1,'Welcome to Friends Corner',true,5),
('m1_l2','m1',2,'Workplace Orientation',true,8),
('m1_l3','m1',3,'Meet the Team',false,3),
('m2_l1','m2',1,'First 5 Seconds',true,8),
('m2_l2','m2',2,'Thank You & Goodbye',true,6),
('m3_l1','m3',1,'Taking an Accurate Order',true,10),
('m3_l2','m3',2,'Special Requests',false,5),
('m3_l3','m3',3,'Confirm the Order',true,6),
('m4_l1','m4',1,'Serving Food Correctly',true,8),
('m4_l2','m4',2,'Table Awareness',true,8),
('m4_l3','m4',3,'Guest Assistance',false,5),
('m5_l1','m5',1,'Personal Grooming',true,8),
('m5_l2','m5',2,'Workstation Cleanliness',true,10),
('m5_l3','m5',3,'When to Clean',false,5),
('m6_l1','m6',1,'Packaging Basics',true,8),
('m6_l2','m6',2,'Order Verification',true,7),
('m6_l3','m6',3,'Special Packaging Notes',false,5),
('m7_l1','m7',1,'Opening Readiness',true,8),
('m7_l2','m7',2,'Closing Responsibilities',true,8),
('m7_l3','m7',3,'Handover',true,6),
('m8_l1','m8',1,'Final Readiness Review',true,15),
('m8_l2','m8',2,'Before Your First Shift',true,5);

create temporary table qa_block_spec (
  lesson_key text not null,
  sort_order integer not null,
  block_type text not null,
  body text,
  body_html text,
  sop_title text,
  acknowledgement boolean,
  primary key(lesson_key, sort_order)
) on commit drop;

insert into qa_block_spec values
('m1_l1',1,'text','Welcome to Friends Corner. Teamwork, cleanliness and putting the guest first shape every shift.','<p>Welcome to Friends Corner. <strong>Teamwork</strong>, <em>care</em> and <mark>Guest First</mark> shape every shift.</p><ul><li>Teamwork</li><li>Cleanliness</li><li>Guest First</li></ul>',null,null),
('m1_l1',2,'key_point','Ask when unsure. Never guess an operational standard.','<p><strong>Ask when unsure.</strong> Never guess an operational standard.</p>',null,null),
('m1_l2',1,'text','Complete the orientation in order: Staff Area, Dining Area, Kitchen Boundary and Emergency Exit.','<p>Walk the outlet with your trainer in this order:</p><ol><li>Staff Area</li><li>Dining Area</li><li>Kitchen Boundary</li><li>Emergency Exit</li></ol>',null,null),
('m1_l2',2,'key_point','Know the emergency exit before service begins.','<p>Know the emergency exit before service begins.</p>',null,null),
('m1_l3',1,'text','Introduce yourself to the shift leader and the people working beside you.','<p>Introduce yourself to the shift leader and the people working beside you. Review the <a href="https://feedx.app">FeedX service mindset</a> with your trainer.</p>',null,null),
('m2_l1',1,'text','Acknowledge every guest quickly with a smile, eye contact and an appropriate greeting.','<p><strong>Acknowledge</strong> every guest <mark>within five seconds</mark>. Use a <em>natural</em> smile, eye contact and an appropriate greeting.</p>',null,null),
('m2_l1',2,'key_point','The guest should know you have seen them, even when you are busy.','<p>The guest should know you have seen them, even when you are busy.</p>',null,null),
('m2_l1',3,'sop_reference',null,null,'Welcome & Goodbye Standard',true),
('m2_l2',1,'text','Close every interaction with a sincere thank you and a clear goodbye.','<p>Close every interaction with a <strong>sincere thank you</strong> and invite the guest to return.</p>',null,null),
('m2_l2',2,'sop_reference',null,null,'Welcome & Goodbye Standard',true),
('m3_l1',1,'text','Listen, record, repeat and confirm the complete order before sending it.','<p>Use this workflow:</p><ol><li>Listen without interrupting.</li><li>Record each item.</li><li>Repeat special requests.</li><li>Confirm the complete order.</li></ol>',null,null),
('m3_l1',2,'key_point','Never assume a modifier or allergy request. Confirm it.','<p><strong>Never assume</strong> a modifier or allergy request. Confirm it.</p>',null,null),
('m3_l2',1,'text','Record special requests in the approved field and repeat them to the guest.','<p>Record special requests in the approved field. <mark>Escalate allergy questions</mark> to the responsible leader.</p>',null,null),
('m3_l3',1,'text','Read the order back and confirm dine-in or takeaway before final submission.','<p>Read the order back and confirm:</p><ul><li>Items and quantity</li><li>Modifiers</li><li>Dine-in or takeaway</li></ul>',null,null),
('m4_l1',1,'text','Match the item to the correct table and guest before placing it safely.','<p>Match the item to the correct table and guest. Carry plates safely and announce the item clearly.</p><ul><li>Correct table</li><li>Correct item</li><li>Safe placement</li></ul>',null,null),
('m4_l1',2,'key_point','Pause and verify whenever the table or item is unclear.','<p>Pause and verify whenever the table or item is unclear.</p>',null,null),
('m4_l2',1,'text','Scan tables regularly for water, clearing, comfort and assistance needs.','<p>Scan tables regularly for <strong>water</strong>, clearing, comfort and assistance needs without interrupting guests.</p>',null,null),
('m4_l3',1,'text','Listen fully, own the next step and involve a leader when needed.','<p>Listen fully, own the next step and involve a leader when needed.</p>',null,null),
('m5_l1',1,'text','Arrive clean, correctly dressed and ready for food-service work.','<p>Arrive <strong>clean</strong>, correctly dressed and ready for food-service work.</p>',null,null),
('m5_l1',2,'sop_reference',null,null,'Personal Grooming Standard',true),
('m5_l2',1,'text','Clean as you go and leave every area ready for the next task.','<p><strong>Clean as you go.</strong> Remove used items promptly and keep floors and tables safe.</p>',null,null),
('m5_l2',2,'key_point','Use only the approved cleaning method for the surface.','<p>Use only the approved cleaning method for the surface.</p>',null,null),
('m5_l2',3,'sop_reference',null,null,'Workstation Cleanliness',true),
('m5_l3',1,'text','Clean after spills, between tasks, during quiet checks and at shift end.','<p>Clean:</p><ul><li>Immediately after spills</li><li>Between incompatible tasks</li><li>During quiet checks</li><li>At shift end</li></ul>',null,null),
('m6_l1',1,'text','Choose the correct container, separate hot and cold items and seal securely.','<p>Packaging basics:</p><ul><li>Correct container</li><li>Hot and cold separated</li><li>Secure seal</li><li>Clear label</li></ul>',null,null),
('m6_l1',2,'key_point','The package must protect food quality until handover.','<p>The package must protect food quality until handover.</p>',null,null),
('m6_l2',1,'text','Match the receipt, items, quantity, modifiers and customer name before handover.','<p>Use a final numbered check:</p><ol><li>Receipt</li><li>Items and quantity</li><li>Modifiers</li><li>Customer name</li></ol>',null,null),
('m6_l3',1,'text','Flag sauces, cutlery, fragile items and unusual handling notes clearly.','<p>Flag sauces, cutlery, fragile items and unusual handling notes clearly.</p>',null,null),
('m7_l1',1,'text','Complete safety, equipment, dining-area and supply checks before opening.','<p>Complete the opening checks before service and report every exception.</p>',null,null),
('m7_l1',2,'sop_reference',null,null,'Opening & Closing Basic Standard',true),
('m7_l2',1,'text','Close assigned areas using the approved checklist and secure equipment.','<p>Clean, switch off and secure assigned areas. Do not mark a check complete until it is true.</p>',null,null),
('m7_l3',1,'text','Tell the next person what is complete, what remains and what needs attention.','<p>A good handover states:</p><ul><li>What is complete</li><li>What remains</li><li>Exceptions</li><li>Immediate risks</li></ul>',null,null),
('m8_l1',1,'text','Review greeting, ordering, service, grooming, cleaning, packaging and shift readiness.','<p>Review the complete service flow: <strong>greeting</strong>, ordering, serving, cleaning, packaging and shift readiness.</p>',null,null),
('m8_l2',1,'text','Clock in before work, check your assignment and ask the shift leader when uncertain.','<p>Before the first shift:</p><ol><li>Arrive ready.</li><li>Clock In.</li><li>Check your assignment.</li><li>Ask when uncertain.</li></ol>',null,null),
('m8_l2',2,'key_point','You are ready to start, but always follow the latest SOP.','<p>You are ready to start, but always follow the latest SOP.</p>',null,null);

create temporary table qa_quiz_spec (
  quiz_key text primary key,
  lesson_key text not null,
  title text not null,
  passing_score integer not null,
  required boolean not null
) on commit drop;

insert into qa_quiz_spec values
('q_greeting','m2_l1','Greeting Basics',80,true),
('q_orders','m3_l1','Accurate Order Check',80,true),
('q_table','m4_l2','Table Awareness Check',80,true),
('q_clean','m5_l2','Cleaning & Hygiene Check',80,true),
('q_pack','m6_l2','Takeaway Verification Check',80,true),
('q_final','m8_l1','Final Readiness Check',80,true);

create temporary table qa_question_spec (
  question_key text primary key,
  quiz_key text not null,
  sort_order integer not null,
  prompt text not null,
  question_type text not null
) on commit drop;

insert into qa_question_spec values
('g1','q_greeting',1,'When should a guest be acknowledged?','single_choice'),
('g2','q_greeting',2,'Which are part of a proper greeting?','multiple_choice'),
('o1','q_orders',1,'What should happen before an order is submitted?','single_choice'),
('o2','q_orders',2,'Which details must be confirmed?','multiple_choice'),
('o3','q_orders',3,'What should you do with an allergy request?','single_choice'),
('t1','q_table',1,'What should you scan tables for?','multiple_choice'),
('t2','q_table',2,'What should you do when an item or table is unclear?','single_choice'),
('t3','q_table',3,'When should used items be cleared?','single_choice'),
('c1','q_clean',1,'Which uniform is ready for a shift?','single_choice'),
('c2','q_clean',2,'Which grooming items are required?','multiple_choice'),
('c3','q_clean',3,'When should a spill be cleaned?','single_choice'),
('c4','q_clean',4,'Which areas need routine condition checks?','multiple_choice'),
('c5','q_clean',5,'How should an assigned area be left at shift end?','single_choice'),
('p1','q_pack',1,'What should be checked against the receipt?','multiple_choice'),
('p2','q_pack',2,'How should hot and cold items be packed?','single_choice'),
('p3','q_pack',3,'When is a takeaway order ready for handover?','single_choice'),
('f1','q_final',1,'When should a guest be acknowledged?','single_choice'),
('f2','q_final',2,'Which actions support an accurate order?','multiple_choice'),
('f3','q_final',3,'Which grooming item is required?','single_choice'),
('f4','q_final',4,'What should happen after a spill?','single_choice'),
('f5','q_final',5,'Which packaging checks are required?','multiple_choice'),
('f6','q_final',6,'What must happen before starting work?','single_choice'),
('f7','q_final',7,'What belongs in a handover?','multiple_choice'),
('f8','q_final',8,'What should you do when unsure about an operational standard?','single_choice');

create temporary table qa_option_spec (
  question_key text not null,
  sort_order integer not null,
  label text not null,
  is_correct boolean not null,
  primary key(question_key, sort_order)
) on commit drop;

insert into qa_option_spec values
('g1',1,'Within 5 seconds',true),('g1',2,'After taking the order',false),('g1',3,'Only when the guest calls',false),
('g2',1,'Smile',true),('g2',2,'Eye contact',true),('g2',3,'Appropriate greeting',true),('g2',4,'Ignore the guest',false),
('o1',1,'Repeat and confirm the order',true),('o1',2,'Guess missing details',false),('o1',3,'Send it without review',false),
('o2',1,'Items and quantity',true),('o2',2,'Modifiers',true),('o2',3,'Dine-in or takeaway',true),('o2',4,'The guest phone wallpaper',false),
('o3',1,'Confirm it and involve the responsible leader',true),('o3',2,'Make an assumption',false),('o3',3,'Ignore it',false),
('t1',1,'Water needs',true),('t1',2,'Clearing needs',true),('t1',3,'Guest comfort',true),('t1',4,'Only the cashier screen',false),
('t2',1,'Pause and verify',true),('t2',2,'Serve it anywhere',false),('t2',3,'Leave it unattended',false),
('t3',1,'Promptly when the guest is finished',true),('t3',2,'Only at closing',false),('t3',3,'Never',false),
('c1',1,'A clean complete uniform',true),('c1',2,'Any casual clothing',false),('c1',3,'A stained uniform',false),
('c2',1,'Neat hair',true),('c2',2,'Name tag',true),('c2',3,'Personal hygiene',true),('c2',4,'Beach sandals',false),
('c3',1,'Immediately and safely',true),('c3',2,'At the end of the week',false),('c3',3,'Only if a guest complains',false),
('c4',1,'Tables',true),('c4',2,'Floors',true),('c4',3,'Assigned workstation',true),('c4',4,'Only the office',false),
('c5',1,'Clean, stocked and ready for handover',true),('c5',2,'Untidy for the next crew',false),('c5',3,'Locked without a report',false),
('p1',1,'Items',true),('p1',2,'Quantity',true),('p1',3,'Modifiers',true),('p1',4,'Unrelated receipts',false),
('p2',1,'Separated in suitable packaging',true),('p2',2,'Mixed in an open bag',false),('p2',3,'Left uncovered',false),
('p3',1,'After the receipt, contents and name are verified',true),('p3',2,'Before the items are packed',false),('p3',3,'Without a final check',false),
('f1',1,'Within 5 seconds',true),('f1',2,'After payment',false),('f1',3,'Only when called',false),
('f2',1,'Listen',true),('f2',2,'Record',true),('f2',3,'Repeat and confirm',true),('f2',4,'Guess',false),
('f3',1,'Name tag',true),('f3',2,'Personal headphones',false),('f3',3,'Open sandals',false),
('f4',1,'Clean it immediately using the approved method',true),('f4',2,'Walk away',false),('f4',3,'Cover it with a box',false),
('f5',1,'Receipt',true),('f5',2,'Items and quantity',true),('f5',3,'Customer name',true),('f5',4,'A random bag',false),
('f6',1,'Clock In',true),('f6',2,'Skip attendance',false),('f6',3,'Start without checking the assignment',false),
('f7',1,'Completed work',true),('f7',2,'Remaining work',true),('f7',3,'Exceptions and risks',true),('f7',4,'Unrelated gossip',false),
('f8',1,'Ask the responsible person',true),('f8',2,'Guess',false),('f8',3,'Invent a new rule',false);

create temporary table qa_employee_spec (
  state_key text primary key,
  full_name text not null,
  employee_code text not null,
  contact text not null,
  passcode text not null,
  completed_module_limit integer not null
) on commit drop;

insert into qa_employee_spec values
('not_started','QA Crew - Not Started','QA-CREW-NS-01','+601155500201','4829',0),
('in_progress','QA Crew - In Progress','QA-CREW-IP-01','+601155500202','7392',4),
('completed','QA Crew - Completed','QA-CREW-CO-01','+601155500203','6158',8);

create temporary table qa_seed_control (skip boolean not null) on commit drop;
insert into qa_seed_control values(false);

grant select on qa_sop_spec, qa_module_spec, qa_lesson_spec, qa_block_spec,
  qa_quiz_spec, qa_question_spec, qa_option_spec, qa_employee_spec, qa_seed_control
to authenticated;
grant update on qa_seed_control to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"266912cf-0e84-4074-82b5-0fc483080741","role":"authenticated"}',
  true
);

do $seed$
declare
  v_admin constant uuid := '266912cf-0e84-4074-82b5-0fc483080741';
  v_owner constant uuid := 'b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd';
  v_outlet constant uuid := 'e804c48d-6343-4bf8-99d7-9893c473948f';
  v_marker constant text := 'FeedX Crew Onboarding Full Demo · Staging only';
  v_published uuid;
  v_draft uuid;
  v_category uuid;
  v_sop uuid;
  v_sop_version uuid;
  v_module uuid;
  v_lesson uuid;
  v_quiz uuid;
  v_question uuid;
  v_employee uuid;
  v_assignment uuid;
  v_token text;
  v_auth jsonb;
  v_result jsonb;
  v_answers jsonb;
  v_welcome_sop uuid;
  v_welcome_v2 uuid;
  spec record;
  nested record;
  module_item record;
  lesson_item record;
  sop_item jsonb;
begin
  if not exists(select 1 from public.outlets where id=v_outlet and name='Friends Corner') then
    raise exception 'Staging guard failed: Friends Corner outlet is unavailable.';
  end if;
  if not public.current_user_has_permission('crew_learning.manage')
     or not public.current_user_has_permission('crew_sop.manage')
     or not public.current_user_can_access_outlet(v_outlet) then
    raise exception 'Staging guard failed: crew_admin_qa permission/outlet scope is unavailable.';
  end if;

  select id into v_published
  from public.crew_journeys
  where outlet_id=v_outlet and is_mandatory_onboarding and status='published' and version=1;
  select id into v_draft
  from public.crew_journeys
  where outlet_id=v_outlet and is_mandatory_onboarding and status='draft'
  order by version desc limit 1;

  -- A fully seeded v1 + v2 state is idempotent. Refuse any other published
  -- history rather than guessing whether it is safe to rewrite.
  if v_published is not null and v_draft is not null
     and (select version from public.crew_journeys where id=v_draft)=2
     and (select description from public.crew_journeys where id=v_published) like '%' || v_marker || '%'
     and (select description from public.crew_journeys where id=v_draft) like '%' || v_marker || '%' then
    update qa_seed_control set skip=true;
    raise notice 'Full Onboarding demo already exists; seed is a no-op.';
    return;
  end if;

  if v_published is not null
     or v_draft is null
     or (select version from public.crew_journeys where id=v_draft) <> 1
     or exists(select 1 from public.crew_journey_assignments where journey_id=v_draft) then
    raise exception 'Refusing to seed: Friends Corner is not the expected unassigned Draft v1 state.';
  end if;

  -- Create/publish outlet SOPs through authenticated draft RLS and the
  -- controlled publish authority.
  for spec in select * from qa_sop_spec order by title loop
    select id into v_category
    from public.crew_sop_categories
    where outlet_id=v_outlet and lower(name)=lower(spec.category);
    if v_category is null then
      insert into public.crew_sop_categories(outlet_id,name,sort_order)
      values(v_outlet,spec.category,
        case spec.category when 'Service' then 10 when 'Cleaning' then 20 else 30 end)
      returning id into v_category;
    end if;

    select id into v_sop
    from public.crew_sops
    where outlet_id=v_outlet and title=spec.title;

    if v_sop is null then
      insert into public.crew_sops(title,category,category_id,summary,status,outlet_id,position)
      values(spec.title,spec.category,v_category,v_marker,'draft',v_outlet,'Onboarding QA Demo')
      returning id into v_sop;
    elsif (select status from public.crew_sops where id=v_sop)='published' then
      if (select summary from public.crew_sops where id=v_sop)<>v_marker then
        raise exception 'Refusing to reuse non-demo published SOP: %',spec.title;
      end if;
      continue;
    elsif (select summary from public.crew_sops where id=v_sop) not in (
      v_marker, 'FeedX Crew Phase B Staging QA seed data'
    ) then
      raise exception 'Refusing to rewrite non-demo SOP draft: %',spec.title;
    else
      update public.crew_sops
      set category=spec.category,category_id=v_category,summary=v_marker,
          position='Onboarding QA Demo',updated_at=now()
      where id=v_sop;
    end if;

    select id into v_sop_version
    from public.crew_sop_versions
    where sop_id=v_sop and status='draft'
    order by version desc limit 1;
    if v_sop_version is null then
      insert into public.crew_sop_versions(
        sop_id,version,status,effective_date,change_summary,require_acknowledgement
      ) values(v_sop,1,'draft',current_date,'Initial Friends Corner QA demo version',spec.acknowledgement)
      returning id into v_sop_version;
    else
      update public.crew_sop_versions
      set effective_date=current_date,
          change_summary='Initial Friends Corner QA demo version',
          require_acknowledgement=spec.acknowledgement
      where id=v_sop_version;
      delete from public.crew_sop_sections where sop_version_id=v_sop_version;
    end if;

    for nested in
      select value,ordinality
      from jsonb_array_elements(spec.sections) with ordinality x(value,ordinality)
      order by ordinality
    loop
      insert into public.crew_sop_sections(
        sop_version_id,title,body,sort_order,key_point
      ) values(
        v_sop_version,nested.value->>'title',nested.value->>'body',
        nested.ordinality,coalesce((nested.value->>'key')::boolean,false)
      );
    end loop;
    perform public.crew_publish_sop_version(v_sop_version);
  end loop;

  -- Replace only the unassigned draft's placeholder content. Cascades remove
  -- draft-only lessons/blocks/quizzes; no published row or assignment exists.
  delete from public.crew_journey_modules where journey_id=v_draft;
  update public.crew_journeys
  set name='New Crew Onboarding',
      description='Essential onboarding journey for new restaurant crew. ' || v_marker,
      estimated_minutes=170,
      sequential_modules=true,
      position='Mandatory for all eligible Crew',
      updated_at=now()
  where id=v_draft;

  for spec in select * from qa_module_spec order by sort_order loop
    insert into public.crew_journey_modules(
      journey_id,title,description,sort_order,estimated_minutes,required,status
    ) values(
      v_draft,spec.title,spec.description,spec.sort_order,
      (select sum(estimated_minutes) from qa_lesson_spec where module_key=spec.module_key),
      spec.required,'draft'
    ) returning id into v_module;

    for nested in
      select * from qa_lesson_spec
      where module_key=spec.module_key order by sort_order
    loop
      insert into public.crew_lessons(
        module_id,title,sort_order,content_type,required,estimated_minutes
      ) values(
        v_module,nested.title,nested.sort_order,'lesson',nested.required,nested.estimated_minutes
      ) returning id into v_lesson;

      for module_item in
        select * from qa_block_spec
        where lesson_key=nested.lesson_key order by sort_order
      loop
        if module_item.block_type='sop_reference' then
          select id into v_sop
          from public.crew_sops
          where outlet_id=v_outlet and title=module_item.sop_title and status='published';
          if v_sop is null then
            raise exception 'Published SOP reference is missing: %',module_item.sop_title;
          end if;
          insert into public.crew_lesson_blocks(lesson_id,block_type,payload,sort_order)
          values(v_lesson,'sop_reference',jsonb_build_object(
            'sop_id',v_sop::text,
            'required_acknowledgement',coalesce(module_item.acknowledgement,false)
          ),module_item.sort_order);
        else
          insert into public.crew_lesson_blocks(lesson_id,block_type,payload,sort_order)
          values(v_lesson,module_item.block_type,jsonb_build_object(
            'body',module_item.body,'body_html',module_item.body_html
          ),module_item.sort_order);
        end if;
      end loop;

      select * into module_item from qa_quiz_spec where lesson_key=nested.lesson_key;
      if found then
        insert into public.crew_quizzes(lesson_id,title,passing_score,status,required)
        values(v_lesson,module_item.title,module_item.passing_score,'draft',module_item.required)
        returning id into v_quiz;
        for lesson_item in
          select * from qa_question_spec
          where quiz_key=module_item.quiz_key order by sort_order
        loop
          insert into public.crew_quiz_questions(
            quiz_id,prompt,question_type,explanation,sort_order
          ) values(
            v_quiz,lesson_item.prompt,lesson_item.question_type,
            'Review the related lesson and SOP before retrying.',lesson_item.sort_order
          ) returning id into v_question;
          insert into public.crew_quiz_options(question_id,label,is_correct,sort_order)
          select v_question,label,is_correct,sort_order
          from qa_option_spec
          where question_key=lesson_item.question_key
          order by sort_order;
        end loop;
      end if;
    end loop;
  end loop;

  if (select count(*) from public.crew_journey_modules where journey_id=v_draft)<>8
     or (select count(*) from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=v_draft)<>22
     or (select count(*) from public.crew_quizzes q join public.crew_lessons l on l.id=q.lesson_id join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=v_draft)<>6 then
    raise exception 'Draft content count verification failed before publish.';
  end if;

  -- Employee profile creation and Crew Access use the existing Owner-scoped
  -- People/Crew authorities. No auth login or service-role frontend state is
  -- created for these mobile-only QA employees.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_owner,'role','authenticated')::text,
    true
  );
  if not public.current_user_has_permission('employees.create')
     or not public.current_user_has_permission('crew_employees.manage') then
    raise exception 'Owner fixture context cannot create/manage QA Crew.';
  end if;

  for spec in select * from qa_employee_spec order by state_key loop
    select id into v_employee
    from public.employees
    where full_name=spec.full_name;
    if v_employee is null then
      insert into public.employees(
        full_name,nickname,nationality,contact,email,employment_status,
        department,position,workplace,employee_code,joined_date,
        enable_system_login,access_state,is_active,audit_summary
      ) values(
        spec.full_name,replace(spec.full_name,'QA Crew - ',''),'Malaysia',spec.contact,null,'active',
        'Operations','Service Crew','Friends Corner',spec.employee_code,current_date,
        false,'no_access',true,v_marker || ' · ' || spec.state_key
      ) returning id into v_employee;
    elsif (select audit_summary from public.employees where id=v_employee)
          <> v_marker || ' · ' || spec.state_key then
      raise exception 'Refusing to reuse non-demo employee: %',spec.full_name;
    end if;

    if not exists(
      select 1 from public.crew_access
      where employee_id=v_employee and access_state='active'
    ) then
      perform public.manage_crew_access(v_employee,'enable',spec.passcode);
    end if;
    if (select primary_outlet_id from public.crew_access where employee_id=v_employee)<>v_outlet then
      raise exception 'QA Crew outlet resolution failed: %',spec.full_name;
    end if;
  end loop;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_admin,'role','authenticated')::text,
    true
  );
  perform public.crew_publish_journey(v_draft);
end;
$seed$;

-- This must be a separate top-level statement from crew_publish_journey. The
-- current published-version resolver is STABLE and cannot observe the publish
-- UPDATE from inside that same lifecycle statement.
select public.crew_sync_onboarding_enrollments(
  'e804c48d-6343-4bf8-99d7-9893c473948f'::uuid
)
where not (select skip from qa_seed_control);

do $progress$
declare
  v_admin constant uuid := '266912cf-0e84-4074-82b5-0fc483080741';
  v_owner constant uuid := 'b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd';
  v_outlet constant uuid := 'e804c48d-6343-4bf8-99d7-9893c473948f';
  v_marker constant text := 'FeedX Crew Onboarding Full Demo · Staging only';
  v_published uuid;
  v_draft uuid;
  v_module uuid;
  v_lesson uuid;
  v_quiz uuid;
  v_question uuid;
  v_employee uuid;
  v_assignment uuid;
  v_token text;
  v_auth jsonb;
  v_result jsonb;
  v_answers jsonb;
  v_welcome_sop uuid;
  v_welcome_v2 uuid;
  spec record;
  module_item record;
  lesson_item record;
  sop_item jsonb;
begin
  if (select skip from qa_seed_control) then
    return;
  end if;
  -- The scoped Learning QA role intentionally has no broad People-table
  -- visibility. Use the existing Owner fixture context to resolve the three
  -- QA employee rows; all learning progress still goes through Crew tokens.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub',v_owner,'role','authenticated')::text,
    true
  );
  select id into v_published
  from public.crew_journeys
  where outlet_id=v_outlet and is_mandatory_onboarding
    and status='published' and version=1;
  if v_published is null then
    raise exception 'Published Friends Corner Onboarding v1 is unavailable after lifecycle transition.';
  end if;

  -- Produce In Progress and Completed states only through Crew mobile
  -- authorities. Optional lessons are intentionally skipped.
  for spec in
    select * from qa_employee_spec
    where completed_module_limit>0
    order by completed_module_limit
  loop
    select e.id into v_employee
    from public.employees e where e.full_name=spec.full_name;
    select a.id into v_assignment
    from public.crew_journey_assignments a
    where a.employee_id=v_employee and a.journey_id=v_published;
    if v_assignment is null
       or (select enrollment_source from public.crew_journey_assignments where id=v_assignment)<>'automatic' then
      raise exception 'Automatic enrollment failed for %',spec.full_name;
    end if;

    select public.crew_authenticate(ca.mobile_number,spec.passcode,'full-demo-seed')
    into v_auth
    from public.crew_access ca where ca.employee_id=v_employee;
    v_token:=v_auth->>'token';

    for module_item in
      select value,ordinality
      from public.crew_journey_assignments a,
           jsonb_array_elements(a.journey_snapshot->'modules') with ordinality x(value,ordinality)
      where a.id=v_assignment and ordinality<=spec.completed_module_limit
      order by ordinality
    loop
      for lesson_item in
        select value,ordinality
        from jsonb_array_elements(module_item.value->'lessons') with ordinality x(value,ordinality)
        where coalesce((value->'lesson'->>'required')::boolean,true)
        order by ordinality
      loop
        for sop_item in
          select value
          from jsonb_array_elements(coalesce(lesson_item.value->'blocks','[]'::jsonb))
          where value->>'block_type'='sop_reference'
            and coalesce((value->'payload'->>'required_acknowledgement')::boolean,false)
        loop
          perform public.crew_acknowledge_sop(
            v_token,(sop_item->'payload'->>'sop_version_id')::uuid,'journey'
          );
        end loop;

        if lesson_item.value->'quiz' is not null
           and jsonb_typeof(lesson_item.value->'quiz')='object' then
          select jsonb_agg(jsonb_build_object(
            'question_id',question->>'id',
            'option_ids',coalesce((
              select jsonb_agg(option->>'id' order by (option->>'sort_order')::int)
              from jsonb_array_elements(question->'options') option
              where coalesce((option->>'is_correct')::boolean,false)
            ),'[]'::jsonb)
          ) order by (question->>'sort_order')::int)
          into v_answers
          from jsonb_array_elements(lesson_item.value->'quiz'->'questions') question;
          v_result:=public.crew_submit_quiz(
            v_token,v_assignment,(lesson_item.value->'quiz'->>'id')::uuid,v_answers
          );
          if not coalesce((v_result->>'passed')::boolean,false) then
            raise exception 'Controlled quiz completion failed for %',spec.full_name;
          end if;
        end if;

        v_result:=public.crew_complete_lesson(
          v_token,v_assignment,(lesson_item.value->'lesson'->>'id')::uuid
        );
        if not coalesce((v_result->>'completed')::boolean,false) then
          raise exception 'Controlled lesson completion failed for %: %',spec.full_name,v_result;
        end if;
      end loop;
    end loop;
  end loop;

  if exists(
    select 1
    from qa_employee_spec employee_spec
    join public.employees e on e.full_name=employee_spec.full_name
    join public.crew_journey_assignments a on a.employee_id=e.id and a.journey_id=v_published
    where (employee_spec.state_key='not_started' and a.status<>'not_started')
       or (employee_spec.state_key='in_progress' and a.status<>'in_progress')
       or (employee_spec.state_key='completed' and a.status<>'completed')
  ) then
    raise exception 'QA Crew assignment state verification failed.';
  end if;

  -- Preserve v1 snapshots, then create visible v2 SOP and Onboarding drafts.
  select id into v_welcome_sop from public.crew_sops
  where outlet_id=v_outlet and title='Welcome & Goodbye Standard';
  v_welcome_v2:=public.crew_new_sop_version(v_welcome_sop);
  update public.crew_sop_versions
  set change_summary='Greeting coaching clarification for Onboarding Draft v2',
      require_acknowledgement=true
  where id=v_welcome_v2;
  update public.crew_sop_sections
  set body='Acknowledge every guest within five seconds and confirm that they know you are ready to help.'
  where sop_version_id=v_welcome_v2 and sort_order=1;
  perform public.crew_publish_sop_version(v_welcome_v2);

  v_draft:=public.crew_new_journey_version(v_published);
  update public.crew_journeys
  set description='Essential onboarding journey for new restaurant crew. ' || v_marker || ' · Draft v2 changes'
  where id=v_draft;

  select id into v_module from public.crew_journey_modules
  where journey_id=v_draft and sort_order=2;
  insert into public.crew_lessons(module_id,title,sort_order,content_type,required,estimated_minutes)
  values(v_module,'Recovering a Delayed Welcome',3,'lesson',false,5)
  returning id into v_lesson;
  insert into public.crew_lesson_blocks(lesson_id,block_type,payload,sort_order)
  values(v_lesson,'text',jsonb_build_object(
    'body','Draft v2: acknowledge the delay, apologise briefly and help the guest now.',
    'body_html','<p><strong>Draft v2:</strong> acknowledge the delay, apologise briefly and help the guest now.</p>'
  ),1);

  update public.crew_lesson_blocks b
  set payload=jsonb_build_object(
    'body','Draft v2: separate cleaning tools by approved surface and task.',
    'body_html','<p><strong>Draft v2:</strong> separate cleaning tools by approved surface and task.</p>'
  )
  from public.crew_lessons l
  join public.crew_journey_modules m on m.id=l.module_id
  where b.lesson_id=l.id and m.journey_id=v_draft and m.sort_order=5
    and l.title='Workstation Cleanliness' and b.block_type='key_point';

  update public.crew_lesson_blocks b
  set payload=jsonb_build_object(
    'body','Draft v2 coaching: make eye contact first, then use the updated greeting example.',
    'body_html','<p><strong>Draft v2 coaching:</strong> make eye contact first, then use the updated greeting example.</p>'
  )
  from public.crew_lessons l
  join public.crew_journey_modules m on m.id=l.module_id
  where b.lesson_id=l.id and m.journey_id=v_draft and m.sort_order=2
    and l.title='First 5 Seconds' and b.block_type='text' and b.sort_order=1;

  select q.id into v_quiz
  from public.crew_quizzes q
  join public.crew_lessons l on l.id=q.lesson_id
  join public.crew_journey_modules m on m.id=l.module_id
  where m.journey_id=v_draft and q.title='Greeting Basics';
  select qq.id into v_question
  from public.crew_quiz_questions qq
  where qq.quiz_id=v_quiz and qq.sort_order=1;
  update public.crew_quiz_options
  set is_correct=(label='After taking the order')
  where question_id=v_question;

  select q.id into v_quiz
  from public.crew_quizzes q
  join public.crew_lessons l on l.id=q.lesson_id
  join public.crew_journey_modules m on m.id=l.module_id
  where m.journey_id=v_draft and q.title='Final Readiness Check';
  insert into public.crew_quiz_questions(
    quiz_id,prompt,question_type,explanation,sort_order
  ) values(
    v_quiz,'Draft v2: which source is authoritative when a standard changes?',
    'single_choice','Review the current published SOP.',9
  ) returning id into v_question;
  insert into public.crew_quiz_options(question_id,label,is_correct,sort_order) values
    (v_question,'The latest published SOP',true,1),
    (v_question,'An old screenshot',false,2),
    (v_question,'A guess',false,3);

  if (select count(*) from public.crew_lessons l join public.crew_journey_modules m on m.id=l.module_id where m.journey_id=v_draft)<>23
     or (select count(*) from public.crew_quiz_questions where quiz_id=v_quiz)<>9 then
    raise exception 'Draft v2 change verification failed.';
  end if;
end;
$progress$;

reset role;
commit;

-- Safe handoff summary. No hashes or answer mappings are returned.
select
  o.name as demo_outlet,
  (select version from public.crew_journeys where outlet_id=o.id and is_mandatory_onboarding and status='published' order by version desc limit 1) as published_version,
  (select version from public.crew_journeys where outlet_id=o.id and is_mandatory_onboarding and status='draft' order by version desc limit 1) as draft_version,
  (select count(*) from public.crew_sops where outlet_id=o.id and status='published' and summary='FeedX Crew Onboarding Full Demo · Staging only') as published_demo_sops,
  (select count(*) from public.employees where audit_summary like 'FeedX Crew Onboarding Full Demo · Staging only%') as qa_crew
from public.outlets o
where o.id='e804c48d-6343-4bf8-99d7-9893c473948f'::uuid;
