-- Structural snapshot of only the canonical columns consumed by the isolated PostgreSQL test.
create role anon; create role authenticated;
create table public.factory_equipment (id uuid,equipment_code text,name text,category_id uuid,current_location_id uuid,status text,notes text,created_by uuid,created_at timestamp with time zone,updated_at timestamp with time zone);
create table public.factory_finished_good_batch_balances (id uuid,finished_good_id uuid,production_id uuid,source_type text,source_reference_id uuid,source_reference_no text,batch_no text,manufacturing_date date,expiry_date date,storage_location_id uuid,storage_location text,storage_location_type text,opening_qty numeric,current_balance numeric,remarks text,created_at timestamp with time zone,updated_at timestamp with time zone,origin_batch_balance_id uuid);
create table public.factory_mesti_calibration_records (id uuid,logical_requirement_id uuid,requirement_id uuid,equipment_id uuid,scheduled_due_date date,calibrated_date date,result text,status text,equipment_snapshot jsonb,provider_name text,reference_no text,notes text,recorded_by uuid,recorded_at timestamp with time zone,verified_by uuid,verified_at timestamp with time zone,created_at timestamp with time zone,updated_at timestamp with time zone);
create table public.factory_mesti_calibration_requirements (id uuid,logical_requirement_id uuid,equipment_id uuid,calibration_type text,interval_months integer,effective_from date,effective_until date,status text,version_no integer,superseded_by uuid,created_by uuid,created_at timestamp with time zone,updated_at timestamp with time zone);
create table public.factory_mesti_cleaning_occurrences (id uuid,requirement_id uuid,due_date date,status text,requirement_snapshot jsonb,completed_by uuid,completed_at timestamp with time zone,completion_result text,completion_note text,verified_by uuid,verified_at timestamp with time zone,verification_result text,verification_note text,created_at timestamp with time zone,updated_at timestamp with time zone,location_id uuid,logical_requirement_id uuid);
create table public.factory_mesti_cleaning_requirement_locations (requirement_id uuid,location_id uuid);
create table public.factory_mesti_cleaning_requirements (id uuid,task_name text,recurrence_type text,recurrence_weekdays integer[],status text,effective_from date,version_no integer,superseded_by uuid,created_by uuid,created_at timestamp with time zone,updated_at timestamp with time zone,logical_requirement_id uuid,effective_until date,cleaning_method text,cleaning_method_reference jsonb);
create table public.factory_mesti_equipment_cleaning_occurrences (id uuid,requirement_id uuid,logical_requirement_id uuid,equipment_id uuid,due_date date,status text,requirement_snapshot jsonb,completed_by uuid,completed_at timestamp with time zone,completion_result text,completion_note text,verified_by uuid,verified_at timestamp with time zone,verification_result text,verification_note text,created_at timestamp with time zone,updated_at timestamp with time zone,source_type text,production_id uuid);
create table public.factory_mesti_equipment_cleaning_requirement_equipment (requirement_id uuid,equipment_id uuid);
create table public.factory_mesti_equipment_cleaning_requirements (id uuid,logical_requirement_id uuid,task_name text,recurrence_type text,recurrence_weekdays integer[],status text,effective_from date,effective_until date,version_no integer,superseded_by uuid,created_by uuid,created_at timestamp with time zone,updated_at timestamp with time zone,cleaning_method text,cleaning_method_reference jsonb);
create table public.factory_mesti_health_declarations (id uuid,declaration_type text,declared_at timestamp with time zone,health_status text,symptoms text[],notes text,employee_id uuid,employee_snapshot jsonb,work_action text,action_notes text,reviewed_by uuid,reviewed_at timestamp with time zone,visitor_name text,visitor_company text,visitor_purpose text,visitor_host text,visitor_contact text,entry_decision text,created_by uuid,request_id uuid,created_at timestamp with time zone,updated_at timestamp with time zone,other_symptom_detail text,voided_at timestamp with time zone,voided_by uuid,void_reason text);
create table public.factory_mesti_operator_hygiene_entries (id uuid,session_id uuid,employee_id uuid,employee_snapshot jsonb,clothing_result text,hygiene_result text,overall_result text,issue text,action_taken text,notes text,created_at timestamp with time zone,updated_at timestamp with time zone);
create table public.factory_mesti_operator_hygiene_sessions (id uuid,inspection_date date,status text,submitted_by uuid,submitted_at timestamp with time zone,verified_by uuid,verified_at timestamp with time zone,created_by uuid,created_at timestamp with time zone,updated_at timestamp with time zone);
create table public.factory_mesti_waste_disposal_events (id uuid,session_id uuid,location_id uuid,location_snapshot jsonb,disposed_at timestamp with time zone,completed_by uuid,remarks text,created_at timestamp with time zone);
create table public.factory_mesti_waste_disposal_requirements (id uuid,logical_requirement_id uuid,location_id uuid,frequency text,required_count integer,effective_from date,effective_until date,status text,version_no integer,superseded_by uuid,created_by uuid,created_at timestamp with time zone,updated_at timestamp with time zone,recurrence_weekdays integer[]);
create table public.factory_mesti_waste_disposal_sessions (id uuid,disposal_date date,status text,submitted_by uuid,submitted_at timestamp with time zone,verified_by uuid,verified_at timestamp with time zone,created_by uuid,created_at timestamp with time zone,updated_at timestamp with time zone);
create table public.factory_production_qc_results (id uuid,job_order_id uuid,production_id uuid,production_step_execution_id uuid,sop_qc_check_id uuid,sequence_no integer,qc_type text,qc_name text,instructions text,is_required boolean,checklist_result text,remarks text,checked_by uuid,checked_by_name text,checked_at timestamp with time zone,created_at timestamp with time zone,updated_at timestamp with time zone);
create table public.factory_production_sop_equipment (sop_id uuid,equipment_id uuid);
create table public.factory_production_sop_step_qc_checks (id uuid,sop_step_id uuid,sequence_no integer,qc_type text,checklist_template_id uuid,qc_name text,instructions text,is_required boolean,created_at timestamp with time zone,updated_at timestamp with time zone);
create table public.factory_production_sop_steps (id uuid,sop_id uuid,step_no integer,instruction text,expected_duration_minutes integer,safety_note text,created_at timestamp with time zone,updated_at timestamp with time zone,process_name text,description text,control_point text,materials text,equipment text,estimated_time_minutes integer,is_qc_checkpoint boolean,qc_label text,remarks text,qc_measurement_type text,qc_target_value text,qc_minimum numeric,qc_maximum numeric,qc_uom text,qc_required_before_completion boolean);
create table public.factory_production_sops (id uuid,sop_code text,title text,product_name text,status text,notes text,created_by uuid,created_at timestamp with time zone,updated_at timestamp with time zone,version text,effective_date date,equipment text,finished_good_id uuid,estimated_minutes integer,remarks text,recipe_id uuid,recipe_version text);
create table public.factory_productions (id uuid,job_order_id uuid,production_no text,product_name text,produced_quantity numeric,uom text,production_date date,status text,notes text,created_by uuid,created_at timestamp with time zone,updated_at timestamp with time zone,batch_no text,operator_id uuid,operator_name text,start_time time without time zone,end_time time without time zone,actual_produced_qty numeric,good_output_qty numeric,wastage_qty numeric,qc_status text,completed_at timestamp with time zone,production_sop_id uuid,sop_version text,finished_good_id uuid,actual_pack_qty numeric,actual_output_qty numeric,end_date date,expiry_date date,storage_location_id uuid,shelf_life_days_snapshot integer,expiry_override_reason text,manufacturing_date date,completion_request_id uuid,completion_payload_fingerprint text,verification_status text,verified_by uuid,verified_at timestamp with time zone);
create table public.factory_storage_locations (id uuid,location_name text,location_code text,location_type text,status text,remarks text,created_by uuid,created_at timestamp with time zone,updated_at timestamp with time zone,is_storage_location boolean);
create table public.permissions (id uuid,code text,module text,description text,created_at timestamp with time zone,requires_restaurant_outlet_scope boolean);
create table public.role_permissions (role_id uuid,permission_id uuid);
create table public.roles (id uuid,name text,description text,is_system_role boolean,is_active boolean,created_at timestamp with time zone,updated_at timestamp with time zone,outlet_access_type text);
alter table roles add primary key(id); alter table permissions add primary key(id); alter table permissions add unique(code); alter table permissions alter id set default gen_random_uuid();
create schema extensions;
create function extensions.digest(text,text) returns bytea language sql immutable as $$ select sha256(convert_to($1,'UTF8')) $$;
CREATE OR REPLACE FUNCTION public.factory_mesti_calibration_due_date(p_anchor date, p_interval integer)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
AS $function$ select (p_anchor + make_interval(months=>p_interval))::date $function$;

CREATE OR REPLACE FUNCTION public.factory_mesti_cleaning_occurrence_snapshot(p_requirement factory_mesti_cleaning_requirements, p_location factory_storage_locations)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'requirement_id', p_requirement.id,
    'logical_requirement_id', p_requirement.logical_requirement_id,
    'task_name', p_requirement.task_name,
    'cleaning_method', p_requirement.cleaning_method,
    'cleaning_method_reference', p_requirement.cleaning_method_reference,
    'recurrence_type', p_requirement.recurrence_type,
    'recurrence_weekdays', p_requirement.recurrence_weekdays,
    'effective_from', p_requirement.effective_from,
    'effective_until', p_requirement.effective_until,
    'version_no', p_requirement.version_no,
    'location_id', p_location.id,
    'location_name', p_location.location_name,
    'location_code', p_location.location_code,
    'location_type', p_location.location_type
  )
$function$;

CREATE OR REPLACE FUNCTION public.factory_mesti_recurrence_due(p_type text, p_weekdays integer[], p_due_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when p_type='daily' then true
    when p_type='weekly' then extract(isodow from p_due_date)::integer = any(coalesce(p_weekdays, '{}'::integer[]))
    else false
  end
$function$;
