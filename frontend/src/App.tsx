import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { Toaster } from 'react-hot-toast';
import { RootState, AppDispatch } from '@/store';
import { setCredentials, setAccessToken } from '@/store/authSlice';
import Landing from '@/pages/Landing';
import Login from '@/pages/Login';
import IDE from '@/pages/IDE';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function Protected({ children }: { children: JSX.Element }): JSX.Element {
  const { accessToken, user } = useSelector((s: RootState) => s.auth);
  const dispatch = useDispatch<AppDispatch>();
  const [checking, setChecking] = useState(!accessToken);

  useEffect(() => {
    if (accessToken) {
      setChecking(false);
      return;
    }
    // try silent refresh via HttpOnly cookie (1 month)
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/refresh`, { method: 'POST', credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data.accessToken) {
            // if backend returns user, use it else keep existing user
            if (data.user) dispatch(setCredentials({ accessToken: data.accessToken, user: data.user }));
            else dispatch(setAccessToken(data.accessToken));
            // preserve user if not returned but already in storage
            if (!data.user && user) dispatch(setCredentials({ accessToken: data.accessToken, user }));
          }
        }
      } catch {}
      setChecking(false);
    })();
  }, []);

  if (checking) return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Restoring session...</div>;
  if (!accessToken) return <Navigate to="/login" replace />;
  return children;
}

export default function App(): JSX.Element {
  return (
    <>
      <Toaster />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/ide" element={<Protected><IDE /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
