import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import 'streamdown/styles.css';
import './styles/index.css';
import App from './App';
import { AnimateUIProvider } from '@animate-ui/react/provider';
import { Tooltip } from '@animate-ui/react/primitives/radix-ui/tooltip';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AnimateUIProvider tempo={0.8} reducedMotion="user">
      <Tooltip.Provider delayDuration={350}>
        <App />
      </Tooltip.Provider>
    </AnimateUIProvider>
  </React.StrictMode>,
);
