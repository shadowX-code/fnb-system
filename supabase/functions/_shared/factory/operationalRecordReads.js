import {recordPageRead} from '../assistant/recordPageRead.js';
export {recipeVersionRead} from './productRecipeRead.js';

export const productionRecordRead=recordPageRead({scope:'Factory shared register under current human permission and RLS.',
 id:'read_factory_production_records',module_id:'factory_production',permission:'factory_production.view',label:'Factory production records',
 source:'/factory/production/records',table:'factory_productions',dateField:'production_date',
 fields:['id','job_order_id','product_name','batch_no','status','production_date','manufacturing_date','end_date','good_output_qty','wastage_qty','uom','qc_status','verification_status','completed_at','updated_at'],
 filters:{product_name:'product_name',batch:'batch_no',status:'status',qc_status:'qc_status'},
 description:'Filter production date, exact recorded product name, batch, status or QC status. Production date, manufacturing date and end date are distinct. Outputs and wastage retain row units. Mixed units cannot be summed. For the all-time Factory summary use Production Reports.'});
export const cleaningRequirementRead=recordPageRead({scope:'Factory shared register under current human permission and RLS.',
 id:'read_factory_equipment_cleaning_requirements',module_id:'factory_mesti_equipment_cleaning',permission:'factory_mesti_equipment_cleaning.view',
 label:'Factory equipment cleaning requirements',source:'/factory/mesti/cleaning-equipment',table:'factory_mesti_equipment_cleaning_requirements',
 fields:['id','task_name','status','version_no','effective_from','effective_until','cleaning_method','recurrence_type','updated_at'],
 filters:{name:'task_name',status:'status',recurrence:'recurrence_type'},
 description:'Filter by exact task name, status or recurrence type. Each row retains its effective dates and version. A configured requirement does not demonstrate performed cleaning or compliance.'});
