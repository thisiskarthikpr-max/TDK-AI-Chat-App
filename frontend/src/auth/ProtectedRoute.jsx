import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <main className="auth-loading" aria-live="polite"><span className="loading-mark" />Restoring your session…</main>;
  }
  return user ? <Outlet /> : <Navigate to="/login" state={{ from: location.pathname }} replace />;
}
