import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import ConfigurationLinks from '../../components/navigation/ConfigurationLinks.jsx';

const configuration = [
  {id:'legal-entities',name:'Legal Entities',detail:'Shared employer details and employment document templates.',permission:'legal_entities.view'},
  {id:'departments',name:'Departments',detail:'Employee department master.',permission:'departments.view'},
  {id:'job-positions',name:'Job Positions',detail:'Job titles used by employment and recruitment.',permission:'job_positions.view'},
  {id:'recruitment',name:'Recruitment',detail:'Openings and existing interview configuration.',permission:'recruitment.view'},
  {id:'payroll',name:'Payroll',detail:'Statutory, pay rules, public holidays and pay components in Payroll Settings.',permission:'payroll.view'},
];
export default function HrSettingsPage({auth,ui}) {
  return <WorkspacePage title="Workspace Settings" description="Use existing HR configuration. Changes remain owned by their business module." density="compact">
    <ConfigurationLinks auth={auth} ui={ui} rows={configuration}/>
  </WorkspacePage>;
}
