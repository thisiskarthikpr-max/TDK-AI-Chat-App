import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';

function ProtectedHome() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <main className="home-shell">
      <header className="home-header">
        <Link className="brand" to="/"><span className="brand-mark">T</span><span>TDK<span className="brand-light"> AI</span></span></Link>
        <button className="logout-button" onClick={handleLogout}>Sign out <span aria-hidden="true">↗</span></button>
      </header>
      <section className="home-welcome">
        <div className="welcome-orbit"><span className="orbit-core">T</span><span className="orbit-dot orbit-dot-a" /><span className="orbit-dot orbit-dot-b" /></div>
        <p className="eyebrow"><span className="eyebrow-dot" />YOUR SPACE IS READY</p>
        <h1>Good to have you<br /><span>back.</span></h1>
        <p className="home-copy">Signed in as <strong>{user.email}</strong>. Your chat workspace will arrive in the next phase.</p>
      </section>
    </main>
  );
}

export default ProtectedHome;
