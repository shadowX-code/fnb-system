import {cleaningRequirementRead,productionRecordRead,recipeVersionRead} from './operationalRecordReads.js';
import {directoryRead} from '../assistant/directoryRead.js';
import {factoryRawMovementRead} from './movementReads.js';
import {factorySopKnowledge} from './sopKnowledge.js';
import {rawMaterialRead} from './rawMaterialRead.js';
// Fixed projections of the owning Admin service queries, under human RLS; no privileged client.
export const factoryCatalogueReads=[
 factoryRawMovementRead,
 productionRecordRead,
 directoryRead({id:'read_factory_equipment',module_id:'factory_equipment',label:'factory equipment',permission:'factory_equipment.view',
  source:'/factory/master-data/equipment',scope:'Factory equipment catalogue under current human permission and RLS.',table:'factory_equipment',
  fields:['id','equipment_code','name','status','category_id','current_location_id','updated_at']}),
 directoryRead({id:'read_factory_suppliers',module_id:'factory_suppliers',label:'Factory suppliers',permission:'factory_suppliers.view',
  source:'/factory/master-data/suppliers',scope:'Factory shared directory under current human permission and RLS.',table:'factory_suppliers',
  name:'supplier_name',code:'supplier_code',statusValues:['active','archived'],fields:['id','supplier_code','supplier_name','status','updated_at']}),
 directoryRead({id:'read_factory_customers',module_id:'factory_customers',label:'Factory customers',permission:'factory_customers.view',
  source:'/factory/master-data/customers',scope:'Factory shared directory under current human permission and RLS.',table:'factory_customers',
  name:'customer_name',code:'customer_code',statusValues:['active','archived'],fields:['id','customer_code','customer_name','customer_type','status','updated_at']}),
 directoryRead({id:'read_factory_locations',module_id:'factory_storage_locations',label:'Factory locations',permission:'factory_storage_locations.view',
  source:'/factory/master-data/storage-locations',scope:'Factory shared directory under current human permission and RLS.',table:'factory_storage_locations',
  name:'location_name',code:'location_code',statusValues:['active','archived'],fields:['id','location_code','location_name','location_type','is_storage_location','status','updated_at']}),
 rawMaterialRead,
 recipeVersionRead,
 factorySopKnowledge,
 cleaningRequirementRead,
];
