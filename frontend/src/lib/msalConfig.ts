import { Configuration, LogLevel } from '@azure/msal-browser';

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID;
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID;
const redirectUri = import.meta.env.VITE_AZURE_REDIRECT_URI || window.location.origin;

if (!clientId || !tenantId) {
  console.warn('Azure AD nao configurado. Usando modo de desenvolvimento.');
}

export const msalConfig: Configuration = {
  auth: {
    clientId: clientId || 'dev-client-id',
    authority: `https://login.microsoftonline.com/${tenantId || 'common'}`,
    redirectUri: redirectUri,
    postLogoutRedirectUri: redirectUri,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        switch (level) {
          case LogLevel.Error:
            console.error(message);
            break;
          case LogLevel.Warning:
            console.warn(message);
            break;
          default:
            break;
        }
      },
    },
  },
};

export const loginRequest = {
  scopes: ['User.Read'],
};

export const isAzureConfigured = Boolean(clientId && tenantId);
