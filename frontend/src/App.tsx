import { useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import {
  useMsal,
  AuthenticatedTemplate,
  UnauthenticatedTemplate,
} from '@azure/msal-react';
import { loginRequest, isAzureConfigured } from './lib/msalConfig';
import { MinhaFila } from './pages/MinhaFila';
import { Geral } from './pages/Geral';
import { Dashboard } from './pages/Dashboard';

function NavBar({ userEmail }: { userEmail: string }) {
  const { instance } = useMsal();

  const handleLogout = () => {
    if (isAzureConfigured) {
      instance.logoutRedirect();
    }
  };

  return (
    <nav className="bg-white shadow">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <span className="text-xl font-bold text-blue-600">Cockpit</span>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-4">
              <NavLink
                to="/minha-fila"
                className={({ isActive }) =>
                  `inline-flex items-center px-3 py-2 text-sm font-medium ${
                    isActive
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`
                }
              >
                Minha Fila
              </NavLink>
              <NavLink
                to="/geral"
                className={({ isActive }) =>
                  `inline-flex items-center px-3 py-2 text-sm font-medium ${
                    isActive
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`
                }
              >
                Geral
              </NavLink>
              <NavLink
                to="/dashboard"
                className={({ isActive }) =>
                  `inline-flex items-center px-3 py-2 text-sm font-medium ${
                    isActive
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`
                }
              >
                Dashboard
              </NavLink>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{userEmail}</span>
            {isAzureConfigured && (
              <button
                onClick={handleLogout}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Sair
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

function LoginPage() {
  const { instance } = useMsal();

  const handleLogin = () => {
    instance.loginRedirect(loginRequest).catch((e) => {
      console.error('Erro no login:', e);
    });
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-md text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">
          Cockpit - Distribuicao de Notas
        </h1>
        <p className="text-gray-500 mb-6">
          Faca login com sua conta corporativa para continuar
        </p>
        <button
          onClick={handleLogin}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
        >
          Entrar com Microsoft
        </button>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const { accounts } = useMsal();
  const userEmail = accounts[0]?.username || 'dev@empresa.com';

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-100">
        <NavBar userEmail={userEmail} />
        <main className="max-w-7xl mx-auto py-6 px-4">
          <Routes>
            <Route path="/minha-fila" element={<MinhaFila adminEmail={userEmail} />} />
            <Route path="/geral" element={<Geral />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="*" element={<Navigate to="/minha-fila" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

// App para modo dev (sem Azure AD)
function DevApp() {
  const [devEmail, setDevEmail] = useState('admin1@empresa.com');

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-100">
        {/* Dev banner */}
        <div className="bg-yellow-500 text-yellow-900 text-center text-sm py-1">
          Modo Desenvolvimento - Azure AD nao configurado
          <input
            type="email"
            value={devEmail}
            onChange={(e) => setDevEmail(e.target.value)}
            className="ml-4 px-2 py-0.5 text-xs rounded border"
            placeholder="Email do admin"
          />
        </div>
        <NavBar userEmail={devEmail} />
        <main className="max-w-7xl mx-auto py-6 px-4">
          <Routes>
            <Route path="/minha-fila" element={<MinhaFila adminEmail={devEmail} />} />
            <Route path="/geral" element={<Geral />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="*" element={<Navigate to="/minha-fila" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default function App() {
  if (!isAzureConfigured) {
    return <DevApp />;
  }

  return (
    <>
      <AuthenticatedTemplate>
        <AuthenticatedApp />
      </AuthenticatedTemplate>
      <UnauthenticatedTemplate>
        <LoginPage />
      </UnauthenticatedTemplate>
    </>
  );
}
