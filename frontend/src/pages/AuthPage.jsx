import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

export function AuthPage({ mode }) {
  const isSignup = mode === 'signup';
  const { user, login, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (isSignup && password !== confirmation) {
      setError('Your passwords do not match.');
      return;
    }

    setPending(true);
    try {
      const credentials = { email, password };
      if (isSignup) await signup(credentials);
      else await login(credentials);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-glow auth-glow-one" />
      <div className="auth-glow auth-glow-two" />
      <Link className="brand" to="/login" aria-label="TDK AI home">
        <span className="brand-mark">T</span><span>TDK<span className="brand-light"> AI</span></span>
      </Link>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="eyebrow"><span className="eyebrow-dot" />YOUR THOUGHT PARTNER</div>
        <h1 id="auth-title">{isSignup ? 'Create your account' : 'Welcome back'}</h1>
        <p className="auth-subtitle">{isSignup ? 'A clear space for your next big idea.' : 'Pick up where your curiosity left off.'}</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} />

          <div className="label-row"><label htmlFor="password">Password</label>{!isSignup && <span>At least 8 characters</span>}</div>
          <input id="password" name="password" type="password" autoComplete={isSignup ? 'new-password' : 'current-password'} placeholder="••••••••••••" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} maxLength={72} />

          {isSignup && <>
            <label htmlFor="confirm-password">Confirm password</label>
            <input id="confirm-password" name="confirm-password" type="password" autoComplete="new-password" placeholder="Enter your password again" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={8} maxLength={72} />
          </>}

          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={pending}>
            {pending ? <><span className="button-spinner" />{isSignup ? 'Creating account…' : 'Signing in…'}</> : <>{isSignup ? 'Create account' : 'Sign in'}<span aria-hidden="true">↗</span></>}
          </button>
        </form>

        <p className="auth-switch">
          {isSignup ? 'Already have an account?' : 'New to TDK AI?'}{' '}
          <Link to={isSignup ? '/login' : '/signup'}>{isSignup ? 'Sign in' : 'Create an account'}</Link>
        </p>
      </section>
      <p className="auth-footnote">Thoughtful conversations, right where you left them.</p>
    </main>
  );
}
