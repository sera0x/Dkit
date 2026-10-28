import React, { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { GoogleIcon, GitHubIcon } from '../components/ui/OAuthIcons';
import CodeSlots from '../components/ui/CodeSlots';import './auth.css';

export default function Signup({ onNavigate }) {
  const [step, setStep] = useState('details');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeStatus, setCodeStatus] = useState('idle');
  const submittingRef = useRef(false);
  const [pendingUser, setPendingUser] = useState(null);
  const [pendingToken, setPendingToken] = useState('');
  const [pendingRefresh, setPendingRefresh] = useState('');
  const [error, setError] = useState('');
  const [errorList, setErrorList] = useState([]);
  const [resendMsg, setResendMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [providers, setProviders] = useState({ google: false, github: false });
  const { login } = useAuth();

  useEffect(() => {
    api.oauthProviders().then(setProviders).catch(() => {});
  }, []);

  const goTo = (path) => {
    if (onNavigate) onNavigate(path);
    else window.location.href = path;
  };

  const submitDetails = async (e) => {
    e.preventDefault();
    setError('');
    setErrorList([]);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setSubmitting(true);
    try {
      const data = await api.signup(email, password);
      setPendingUser(data.user);
      setPendingToken(data.token);
      setPendingRefresh(data.refresh_token || '');
      setStep('verify');
    } catch (err) {
      setError(err.message || 'Signup failed');
      setErrorList(err.details || []);
    } finally {
      setSubmitting(false);
    }
  };

  const submitVerify = async (value) => {
    if (submittingRef.current || !/^\d{6}$/.test(value)) return;
    submittingRef.current = true;
    setError('');
    setSubmitting(true);
    try {
      await api.verifyEmail(pendingToken, value);
      login(pendingUser, pendingToken, pendingRefresh);
      goTo('/dashboard');
    } catch (err) {
      submittingRef.current = false;
      setError(err.message || 'Invalid or expired code');
      setCodeStatus('error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCodeChange = (value) => {
    setCode(value);
    if (value === '') setCodeStatus('idle');
  };

  const resend = async () => {
    setError('');
    setResendMsg('');
    try {
      await api.sendVerification(pendingToken);
      setResendMsg('New code sent.');
    } catch (err) {
      setError(err.message || 'Could not resend the code');
    }
  };

  return (
    <section className="auth-section">
      <div className="auth-card">
        <h1>Sign Up</h1>

        {step === 'details' && (
          <form onSubmit={submitDetails}>
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </label>
            <p className="auth-hint">At least 8 characters, with an uppercase letter, a lowercase letter, and a number.</p>
            {error && <p className="auth-error">{error}</p>}
            {errorList.length > 0 && (
              <ul className="auth-error-list">
                {errorList.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            )}
            <button className="cta-button primary" type="submit" disabled={submitting}>
              {submitting ? 'creating account...' : 'Create Account'}
            </button>
            {(providers.google || providers.github) && (
              <>
                <div className="auth-divider">or</div>
                {providers.google && (
                  <a className="oauth-button" href="/api/auth/oauth/google">
                    <GoogleIcon /> Continue with Google
                  </a>
                )}
                {providers.github && (
                  <a className="oauth-button" href="/api/auth/oauth/github">
                    <GitHubIcon /> Continue with GitHub
                  </a>
                )}
              </>
            )}
          </form>
        )}

        {step === 'verify' && (
          <div>
            <p className="auth-hint">
              We sent a code to {email}. Enter it below to finish creating your account.
            </p>
            <div className="auth-codeslots">
              <CodeSlots
                length={6}
                autoFocus
                onComplete={submitVerify}
                onChange={handleCodeChange}
                status={codeStatus}
                disabled={submitting}
                ariaLabel="Verification code"
                accentColor="#39ff88"
                inkColor="#39ff88"
                slotColor="#10130f"
                digitColor="#04130a"
                dangerColor="#ff3b30"
                slotSize={42}
              />
            </div>
            {error && <p className="auth-error">{error}</p>}
            {resendMsg && <p className="auth-hint">{resendMsg}</p>}
            <button type="button" className="auth-link-button" onClick={resend}>
              resend code
            </button>
          </div>
        )}

        <p className="auth-switch">
          Already have an account? <a href="/login" onClick={(e) => { e.preventDefault(); goTo('/login'); }}>Log In</a>
        </p>
      </div>
    </section>
  );
}
