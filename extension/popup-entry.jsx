import React from 'react';
import { createRoot } from 'react-dom/client';
import TaskRecorderPanel from './TaskRecorderPanel.jsx';

const mount = document.getElementById('task-recorder-root');
if (mount) {
  createRoot(mount).render(<TaskRecorderPanel />);
}
