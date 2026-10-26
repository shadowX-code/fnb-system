-- Canonical Staging only: ujkzdaaadnvcfayuldmh. Synthetic fixtures; always rolls back. Never run on Production.
begin;
select set_config('request.jwt.claim.sub','b6ee4db2-0f37-4b3e-a3ee-fa804ec5e6cd',true),set_config('request.jwt.claim.role','authenticated',true);
do $$
declare org uuid:='ec42a08a-0f59-4b7b-a48e-b2faacf9eaf1';actor uuid:='9f44daf9-9f87-4129-bc71-55c082cf8782';brand uuid:=gen_random_uuid();connection uuid:=gen_random_uuid();cid uuid:=gen_random_uuid();other uuid:=gen_random_uuid();request uuid:=gen_random_uuid();v jsonb;m jsonb;claim jsonb;body jsonb;ver int;draft_count int;convo_count int;
begin
 insert into brands(id,organization_id,name) values(brand,org,'QA Inbox operations — rollback only');
 insert into marketing_inbox_policies(brand_id,ai_allowed,automation_mode,ai_reply_mode,updated_by) values(brand,true,'suggest','suggest_only',actor);
 insert into marketing_connections(id,organization_id,brand_id,channel,provider_account_id) values(connection,org,brand,'facebook','qa-'||connection);
 insert into marketing_conversations(id,organization_id,brand_id,channel,connection_id,connection_generation,participant_key,title,created_by,assigned_to) values(cid,org,brand,'facebook',connection,1,'qa-'||cid,'QA simulated attention',actor,actor),(other,org,brand,'facebook',connection,1,'qa-'||other,'QA waiting for customer',actor,null);
 insert into marketing_conversation_messages(conversation_id,kind,body,actor_employee_id,occurred_at) values(cid,'incoming','What is your brand name?',actor,now()),(other,'incoming','Waiting fixture',actor,now());
 update marketing_conversations set status='pending' where id=other;
 v:=marketing_inbox_read(org,brand,'','','',1,20,'',false,'needs_reply');assert (v->>'total')::int=1 and v->'rows'->0->>'id'=cid::text,'Needs Reply is not actionable inbound';
 assert v->'view_counts'->>'all'='2' and v->'view_counts'->>'mine'='1','View counts do not share filters';
 v:=marketing_inbox_read(org,brand,'pending','','',1,20,'',false,'all');assert v->'view_counts'->>'all'='1' and v->'view_counts'->>'needs_reply'='0','Status scope lost in counts';
 v:=marketing_inbox_read(org,brand,'','','',1,20,'',false,'mine');assert v->>'total'='1','My assignment view';
 update marketing_conversations set escalation_reasons=array['human_request'] where id=cid;
 v:=marketing_inbox_read(org,brand,'','','',1,20,'',false,'ai_handoff');assert v->>'total'='1','Handoff filter';
 select version into ver from marketing_conversations where id=cid;
 v:=marketing_inbox_command(request,org,brand,cid,ver,'remind',jsonb_build_object('remind_at',now()+interval '1 hour'));
 assert (select version=ver from marketing_conversations where id=cid),'Reminder changed conversation revision';
 assert (select remind_at is not null from marketing_inbox_reads where conversation_id=cid and employee_id=actor),'Reminder missing';
 perform marketing_inbox_mark_read(cid,(select max(sequence) from marketing_conversation_messages where conversation_id=cid));
 assert (select remind_at is not null from marketing_inbox_reads where conversation_id=cid and employee_id=actor),'Read erased reminder';
 assert marketing_inbox_command(request,org,brand,cid,ver,'remind',jsonb_build_object('remind_at',now()+interval '1 hour'))=v,'Reminder retry is not idempotent';
 begin perform marketing_inbox_command(gen_random_uuid(),org,brand,cid,ver,'remind',jsonb_build_object('remind_at',now()));raise exception 'Past reminder accepted';exception when raise_exception then if sqlerrm='Past reminder accepted' then raise;end if;end;
 begin perform marketing_inbox_read(org,gen_random_uuid());raise exception 'Foreign Brand accepted';exception when others then if sqlerrm='Foreign Brand accepted' then raise;end if;end;
 assert not has_function_privilege('authenticated','marketing_private.inbox_ai_material_for(uuid,uuid,text,jsonb,jsonb)','execute'),'Private facts exposed';
 assert not has_function_privilege('authenticated','public.marketing_inbox_test_claim(uuid,uuid)','execute'),'Test claim exposed';
 assert not has_function_privilege('authenticated','public.marketing_inbox_test_finish(uuid,uuid,jsonb,text,integer,integer,boolean)','execute'),'Test finish exposed';
 select count(*) into convo_count from marketing_conversations;select count(*) into draft_count from marketing_reply_drafts;
 v:=marketing_inbox_test_prepare(gen_random_uuid(),org,brand,'ai_first','[{"kind":"incoming","text":"What is your brand name?"}]');assert v->>'state'='prepared','Test preparation';
 select request_id into request from marketing_private.inbox_ai_tests where actor_employee_id=actor and brand_id=brand;
 assert marketing_inbox_test_prepare(request,org,brand,'ai_first','[{"kind":"incoming","text":"What is your brand name?"}]')->>'state'='prepared','Prepare retry';
 assert marketing_inbox_test_prepare(gen_random_uuid(),org,brand,'ai_first','[{"kind":"incoming","text":"Another question"}]')->>'state'='generating','Overlap not blocked';
 perform set_config('request.jwt.claim.role','service_role',true);
 claim:=marketing_inbox_test_claim(request,actor);assert claim->>'simulation'='true' and claim->>'kind'='reply','Shared test material';
 assert marketing_inbox_test_claim(request,actor) is null,'Double claim';
 body:='{"text":"A staff member needs to check this.","language":"EN","intent":"unknown","human_required":true,"reference_keys":[],"matched_faq_ids":[],"unresolved_questions":["Brand identity"],"handoff_reasons":[],"classification":"insufficient_knowledge","latency_ms":0,"match_source":"fallback"}';
 v:=marketing_inbox_test_finish(request,(claim->>'lease')::uuid,body,'unavailable',0,0);
 assert v->>'state'='completed' and v->'result'->'decision'->>'kind'='handoff','Simulation safety decision';
 assert v->'result'->>'delivery_checked'='false' and v->'result'->>'estimated_cost_usd'='0','Simulation telemetry';
 assert marketing_inbox_test_finish(request,(claim->>'lease')::uuid,body,'unavailable',0,0)=v,'Finish retry';
 assert (select count(*)=convo_count from marketing_conversations) and (select count(*)=draft_count from marketing_reply_drafts),'Playground created delivery/customer records';
 perform set_config('request.jwt.claim.role','authenticated',true);
 assert marketing_inbox_test_prepare(gen_random_uuid(),org,brand,'ai_first','[{"kind":"incoming","text":"What is your brand name?"}]')->>'cached'='true','Safe matching cache';

 request:=gen_random_uuid();v:=marketing_inbox_test_prepare(request,org,brand,'suggest_only','[{"kind":"incoming","text":"What is this Brand called?"}]');
 perform set_config('request.jwt.claim.role','service_role',true);claim:=marketing_inbox_test_claim(request,actor);
 insert into marketing_knowledge(brand_id,profile,revision,updated_by,confirmed_revision,confirmed_keys) values(brand,'{"identity":{"text":"QA Fixture Brand","provenance":"verified_brand_fact"}}',1,actor,1,array['identity']);
 v:=marketing_inbox_test_finish(request,(claim->>'lease')::uuid,body,'gpt-5-mini',3,4);assert v->>'state'='superseded','Stale knowledge was accepted';
 assert (select input_tokens=3 and output_tokens=4 from marketing_private.inbox_ai_tests where request_id=request),'Superseded test lost usage';
 perform set_config('request.jwt.claim.role','authenticated',true);
 update marketing_inbox_policies set ai_allowed=false where brand_id=brand;
 begin perform marketing_inbox_test_prepare(gen_random_uuid(),org,brand,'suggest_only','[{"kind":"incoming","text":"Hello"}]');raise exception 'Consent bypass';exception when others then if sqlerrm='Consent bypass' then raise;end if;end;
end;$$;

-- Automatic scheduling/ownership fixtures remain inside this rollback; no worker/provider is invoked.
do $$
declare conn marketing_connections;c marketing_conversations;p marketing_inbox_policies;actor uuid:='9f44daf9-9f87-4129-bc71-55c082cf8782';m1 uuid:=gen_random_uuid();m2 uuid:=gen_random_uuid();m3 uuid:=gen_random_uuid();t marketing_private.inbox_automatic_turns;v jsonb;n int;
begin
 select x.* into strict conn from marketing_connections x where x.brand_id='88718f61-2915-42ef-b62f-5e6e2fe5b3eb' and channel='facebook' limit 1;
 update marketing_connections set inbox_automation_owner='feedx',inbox_automation_generation=credential_generation,inbox_automation_confirmed_at=now()-interval '1 minute',expires_at=now()+interval '1 day',status='test_authorized' where id=conn.id;
 update marketing_private.inbox_authority set generation=conn.credential_generation,send_verified=true,webhook_verified=true,verified_at=now() where connection_id=conn.id;
 insert into marketing_conversations(organization_id,brand_id,channel,connection_id,connection_generation,participant_key,title,takeover,last_inbound_at,created_by) values(conn.organization_id,conn.brand_id,conn.channel,conn.id,conn.credential_generation,'qa-burst-'||gen_random_uuid(),'QA burst — rollback',false,now(),actor) returning * into c;
 update marketing_inbox_policies set ai_allowed=true,ai_reply_mode='safe_auto',automation_mode='suggest',ai_authorized_by=actor,ai_enabled_at=now()-interval '1 minute',ai_conversation_ids=array[c.id],ai_availability='always' where brand_id=c.brand_id;
 insert into marketing_conversation_messages(id,conversation_id,kind,body,evidence_source,provider_message_id,occurred_at) values(m1,c.id,'incoming','What is your brand name?','signed_webhook','qa-'||m1,now());
 select * into t from marketing_private.inbox_automatic_turns where message_id=m1;
 assert t.id is not null and t.not_before>now()+interval '7 seconds','Debounce did not wait';
 perform set_config('request.jwt.claim.role','service_role',true);
 assert marketing_inbox_auto_claim() is null,'Quiet window ignored';
 insert into marketing_conversation_messages(id,conversation_id,kind,body,evidence_source,provider_message_id,occurred_at) values(m2,c.id,'incoming','And which Brand?','signed_webhook','qa-'||m2,now());
 assert (select state='superseded' from marketing_private.inbox_automatic_turns where message_id=m1),'Old turn not superseded';
 select * into t from marketing_private.inbox_automatic_turns where message_id=m2;
 assert marketing_private.inbox_current_question(c.id)=E'What is your brand name?\nAnd which Brand?','Burst questions not combined';
 assert t.not_before<=t.batch_started_at+interval '30 seconds','Burst window unbounded';
 update marketing_private.inbox_automatic_turns set not_before=now()-interval '1 second' where id=t.id;
 v:=marketing_inbox_auto_claim();assert v->>'turn_id'=t.id::text,'Latest ready turn not claimed: '||coalesce(v::text,'null')||' '||(select to_jsonb(x)::text from marketing_private.inbox_automatic_turns x where x.id=t.id);
 assert v->>'current_question'=E'What is your brand name?\nAnd which Brand?','AI material lost burst';
 assert marketing_inbox_auto_claim() is null,'Concurrent/repeated claim generated twice';
 insert into marketing_conversation_messages(id,conversation_id,kind,body,evidence_source,provider_message_id,occurred_at) values(m3,c.id,'incoming','One more question','signed_webhook','qa-'||m3,now());
 assert (select state='superseded' from marketing_private.inbox_automatic_turns where id=t.id),'In-flight decision not superseded';
 update marketing_conversations set takeover=true,version=version+1 where id=c.id;
 assert not exists(select 1 from marketing_private.inbox_automatic_turns where conversation_id=c.id and state in('queued','generating','prepared')),'Takeover left automatic work eligible';
 assert not exists(select 1 from marketing_reply_outbox o join marketing_reply_drafts d on d.id=o.draft_id where d.conversation_id=c.id),'Fixture generated an outbound reply';
end;$$;
do $$
declare b uuid;actor uuid:='9f44daf9-9f87-4129-bc71-55c082cf8782';c marketing_conversations;r marketing_private.inbox_ai_tests;v jsonb;begin
 select id into b from brands where name='QA Inbox operations — rollback only';update marketing_inbox_policies set ai_allowed=true where brand_id=b;
 perform set_config('request.jwt.claim.role','authenticated',true);
 begin perform marketing_inbox_test_prepare(gen_random_uuid(),'ec42a08a-0f59-4b7b-a48e-b2faacf9eaf1',b,'suggest_only','[{"kind":"incoming","text":"Hello"}]',gen_random_uuid());raise exception 'Foreign Outlet accepted';exception when others then if sqlerrm='Foreign Outlet accepted' then raise;end if;end;
 select * into r from marketing_private.inbox_ai_tests where brand_id=b limit 1;
 insert into marketing_private.inbox_ai_tests(request_id,organization_id,brand_id,actor_employee_id,mode,question,history,outlet_evidence,fingerprint,evidence,evidence_hash,state) select gen_random_uuid(),r.organization_id,r.brand_id,actor,'suggest_only','Quota fixture','[]','{}','quota-fixture','{}','quota-fixture','completed' from generate_series(1,20);
 v:=marketing_inbox_test_context(r.organization_id,b);assert v->>'daily_remaining'='0','Shared quota context';
 begin perform marketing_inbox_test_prepare(gen_random_uuid(),r.organization_id,b,'suggest_only','[{"kind":"incoming","text":"Unique quota test"}]');raise exception 'Test quota bypass';exception when raise_exception then assert sqlerrm='Daily AI request limit reached.','Wrong test quota error: '||sqlerrm;end;
 select * into c from marketing_conversations where brand_id=b limit 1;
 begin perform marketing_private.inbox_ai_prepare_as(actor,gen_random_uuid(),c.id,c.version,'reply');raise exception 'Real request ignored simulation quota';exception when raise_exception then assert sqlerrm='Daily AI request limit reached.','Wrong real quota error: '||sqlerrm;end;
end;$$;
select 'passed: material parity, filtered views, personal reminders, simulation authority/idempotency/consent, bounded batching and takeover' result;
rollback;
