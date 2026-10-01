import React from 'react';
import { createRoot } from 'react-dom/client';
import { EchoUI } from './ui';

/** Mount the heavyweight visual interface on demand. */
export function initUI(): void {
  if (document.getElementById('echo-extension-root')) return;
  const container = document.createElement('div');
  container.id = 'echo-extension-root';
  Object.assign(container.style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    zIndex: '2147483647', pointerEvents: 'none',
  });
  document.body.appendChild(container);
  createRoot(container).render(<div style={{ pointerEvents: 'auto' }}><EchoUI /></div>);
}

initUI();
