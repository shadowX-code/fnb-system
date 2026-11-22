import {readInventory} from '../../supabase/functions/_shared/factory/finishedGoodsRead.js';

// Exercise the Factory read's real snapshot, filters, counts and provenance.
export function finishedGoodsFixture(rows=[]){
 const source=rows.map((row,index)=>({id:String(index+1),product_code:'FG-'+(index+1),status:'active',...row}));
 const caller={
  rpc(name,args){
   const data=name==='current_user_role_id'?'fixture-role':name==='current_user_has_permission'?true:
    args.p_entity==='finished_goods'?source.map(row=>row.id):[];
   return {data,abortSignal:async()=>({data})};
  },
  from:()=>({select:()=>({in:(_key,ids)=>({abortSignal:async()=>({data:source.filter(row=>ids.includes(row.id))})})})}),
 };
 return (args,signal)=>readInventory(caller,args,signal);
}
