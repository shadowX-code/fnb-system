import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import ConfigurationLinks from '../../components/navigation/ConfigurationLinks.jsx';
const settings = [
  {id:'roles',name:'Roles & Permissions',detail:'Shared Admin roles, grants and access scopes.',permission:'roles.view'},
  {id:'external_agents',name:'AI Integrations',detail:'External agent connections, explicitly granted capabilities and activity history.',permission:'roles.view'},
];
export default function SystemSettingsPage({auth,ui}) {
  return <WorkspacePage title="System Settings" description="Shared access and integrations across FeedX workspaces." density="compact"><ConfigurationLinks auth={auth} ui={ui} rows={settings}/></WorkspacePage>;
}
