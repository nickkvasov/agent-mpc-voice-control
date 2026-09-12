import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
// IMMUNE-U: a missing mount point is an unexpected state, not something to
// paper over with a silent return.
if (root === null) {
  throw new Error('Mount point #root is missing from index.html');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
