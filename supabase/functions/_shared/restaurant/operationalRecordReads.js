import {recordPageRead} from '../assistant/recordPageRead.js';

export const salesInputRead=recordPageRead({outletScope:true,scope:'One authorized Restaurant outlet under current user permission and RLS.',
 id:'read_sales_records',module_id:'sales-input',permission:'sales_input.view',label:'monthly sales input entries',
 table:'sales_records',source:'/restaurant/sales/input',calendarMonth:true,filters:{channel:'channel_name'},
 fields:['id','outlet_id','year','month','channel_id','channel_name','amount','updated_at'],
 description:'An optional channel selects the exact recorded channel label. Amount is the recorded signed MYR entry, not monthly revenue. Reporting owns revenue and Sales Comparison owns gross/net channel breakdowns.'});
export const wasteRead=recordPageRead({outletScope:true,scope:'One authorized Restaurant outlet under current user permission and RLS.',
 id:'read_inventory_waste',module_id:'inventory_waste',permission:'inventory_waste.view',label:'inventory waste records',
 table:'inventory_waste_records',source:'/restaurant/inventory/waste',dateField:'waste_date',filters:{waste_type:'waste_type'},
 fields:['id','outlet_id','inventory_item_id','waste_type','quantity','unit','waste_date','created_at','updated_at'],
 description:'Use optional inclusive waste dates and exact waste type. Quantities use the recorded unit; never sum different items or units.'});
export const orderRead=recordPageRead({outletScope:true,scope:'One authorized Restaurant outlet under current user permission and RLS.',
 id:'read_inventory_orders',module_id:'inventory_orders',permission:'inventory_orders.view',label:'inventory purchase orders',
 table:'inventory_purchase_orders',source:'/restaurant/inventory/purchase-orders',filters:{status:'status',order_number:'business_po_no',source_type:'source_type'},
 fields:['id','po_no','business_po_no','outlet_id','supplier_id','status','source_type','submitted_at','completed_at','created_at','updated_at'],
 description:'Optional exact business order number, status and source type narrow the same order register. Current order states are not payment or receipt evidence.'});
export const groupRead=recordPageRead({outletScope:true,scope:'One authorized Restaurant outlet under current user permission and RLS.',
 id:'read_inventory_check_groups',module_id:'inventory_groups',permission:'inventory_groups.view',label:'stock check groups',
 table:'inventory_stock_check_groups',source:'/restaurant/inventory/groups',filters:{name:'name',shift:'shift',status:'status'},
 fields:['id','outlet_id','name','description','shift','frequency_type','status','last_checked_at','updated_at'],
 description:'Use exact group name, shift or status where supplied; a group definition is not a completed stock count.'});
export const recipeCatalogueRead=recordPageRead({outletScope:true,scope:'One authorized Restaurant outlet under current user permission and RLS.',
 id:'read_inventory_recipe_catalogue',module_id:'inventory_recipes',permission:'inventory_recipes.view',label:'inventory recipe catalogue entries',
 table:'inventory_recipes',source:'/restaurant/inventory/recipes',filters:{name:'recipe_name',code:'recipe_code',category:'menu_category',status:'status'},
 fields:['id','outlet_id','recipe_name','recipe_code','menu_category','serving_size','status','updated_at'],
 description:'Use exact recipe code, name, menu category or status. Serving size is recorded; this register does not establish ingredient cost or sales.'});
