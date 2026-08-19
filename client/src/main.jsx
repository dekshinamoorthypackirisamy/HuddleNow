import React from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import './polyfills';
import App from './App';
import './styles/global.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/responsive.css';
import './styles/themes.css';

const mountPoint = document.getElementById('root');

// Create an overlay element to display errors without modifying the React mount node.
const getErrorOverlay = () => {
  const existing = document.getElementById('app-error-overlay');
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = 'app-error-overlay';
  el.style.position = 'fixed';
  el.style.zIndex = 9999;
  el.style.left = '12px';
  el.style.right = '12px';
  el.style.top = '12px';
  el.style.background = 'rgba(255,255,255,0.98)';
  el.style.color = '#900';
  el.style.border = '1px solid #900';
  el.style.padding = '12px';
  el.style.fontFamily = 'monospace';
  el.style.whiteSpace = 'pre-wrap';
  el.style.display = 'none';
  document.body.appendChild(el);
  return el;
};

const errorOverlay = getErrorOverlay();

const showError = (text) => {
  try {
    errorOverlay.textContent = String(text);
    errorOverlay.style.display = 'block';
  } catch (e) {
    // ignore
  }
};

const hideError = () => {
  try {
    errorOverlay.style.display = 'none';
    errorOverlay.textContent = '';
  } catch (e) {}
};

// Global error handlers to surface runtime issues in the console and overlay.
window.addEventListener('error', (ev) => {
  console.error('Uncaught error', ev.error || ev.message);
  showError(`Uncaught error: ${String(ev.error || ev.message)}`);
});
window.addEventListener('unhandledrejection', (ev) => {
  console.error('Unhandled promise rejection', ev.reason);
  showError(`Unhandled rejection: ${String(ev.reason)}`);
});

try {
  console.debug('Mounting React app to #root');
  ReactDOM.createRoot(mountPoint).render(
    <React.StrictMode>
      <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || 'demo-client-id'}>
        <App />
      </GoogleOAuthProvider>
    </React.StrictMode>
  );
  console.debug('React app mounted');
  hideError();
} catch (err) {
  console.error('Error during initial render', err);
  showError(`Render error: ${String(err)}`);
}
