import DataTable from '../tables/DataTable.jsx';
import { hasPermission } from '../../utils/accessControl.js';

export default function ConfigurationLinks({auth, ui, rows=[]}) {
  const visible = rows.filter(row => hasPermission(auth,row.permission));
  return <DataTable minWidth={480} density="compact" columns={[
    {key:'name',header:'Configuration'}, {key:'detail',header:'Scope'},
    {key:'action',header:'',align:'right',render:row=><button type="button" className="btn-secondary" aria-label={`Open ${row.name}`} onClick={()=>ui.navigate(row.id)}>Open</button>},
  ]} rows={visible} getRowKey={row=>row.id}/>;
}
