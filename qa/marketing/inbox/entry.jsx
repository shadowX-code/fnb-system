import React from 'react';
import {createRoot} from 'react-dom/client';
import MarketingInboxPage from '../../../src/features/marketing/MarketingInboxPage.jsx';
import '../../../src/styles/index.css';
if(location.hostname!=='127.0.0.1'||!import.meta.env.DEV)throw new Error('Local renderer fixtures only');
document.documentElement.dataset.resolvedTheme='light';
createRoot(document.getElementById('root')).render(<MarketingInboxPage/>);
