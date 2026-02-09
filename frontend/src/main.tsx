import React from 'react';
import ReactDOM from 'react-dom/client';
import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { msalConfig, isAzureConfigured } from './lib/msalConfig';
import App from './App';
import './index.css';

// Inicializa MSAL
const msalInstance = new PublicClientApplication(msalConfig);

// Wrapper condicional para MSAL
function AppWrapper() {
  if (isAzureConfigured) {
    return (
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    );
  }

  // Modo dev sem Azure AD
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppWrapper />
  </React.StrictMode>
);
