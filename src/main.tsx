import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installWebDesk } from './web/desk';
import './style.css';
// The desktop preload defines window.desk; a browser talks to the web server.
if (!window.desk) installWebDesk();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
