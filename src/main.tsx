import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/onest/400.css';
import '@fontsource/onest/500.css';
import '@fontsource/onest/600.css';
import '@fontsource/onest/700.css';
import '@fontsource/unbounded/500.css';
import '@fontsource/unbounded/700.css';
import './ui/styles/app.css';
import { App } from './ui/App';
import { buildServices } from './composition-root';

const services = buildServices();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App services={services} />
  </StrictMode>,
);
