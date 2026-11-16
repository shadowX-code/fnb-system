import React from 'react';
import {createRoot} from 'react-dom/client';
import NativeAssistantSettings from '../../src/features/integrations/NativeAssistantSettings.jsx';
import PageHeader from '../../src/components/layout/PageHeader.jsx';
import '../../src/styles/index.css';
if(location.hostname!=='127.0.0.1'||!import.meta.env.DEV)throw new Error('Local renderer fixtures only');
document.documentElement.dataset.resolvedTheme='light';
createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-6xl p-4 sm:p-6"><p className="mb-3 text-xs text-text-secondary">Local responsive QA · fixture data · no live services</p><PageHeader title="AI Integrations" subtitle="Native Assistant management"/><NativeAssistantSettings auth={{user:{id:'fixture-user'},hasPermission:()=>true}}/></main>);
