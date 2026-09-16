import { Routes, Route, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Toaster } from 'react-hot-toast';
import { RootState } from '@/store';
import Landing from '@/pages/Landing';
import Login from '@/pages/Login';
import IDE from '@/pages/IDE';

function Protected({ children }: { children: JSX.Element }): JSX.Element {
  const { accessToken } = useSelector((s: RootState) => s.auth);
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
