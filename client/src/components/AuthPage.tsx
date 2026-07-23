import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { MessageCircle } from 'lucide-react';

type AuthMode = 'password' | 'sms';

export default function AuthPage() {
  const { login, register, requestPhoneCode, verifyPhoneCode } = useAuth();
  const [mode, setMode] = useState<AuthMode>('password');
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [retryAfterSec, setRetryAfterSec] = useState(0);
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (retryAfterSec <= 0) return;
    const timer = window.setTimeout(() => setRetryAfterSec((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [retryAfterSec]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isLogin) {
        await login(username, password);
      } else {
        await register(username, displayName || username, password);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await requestPhoneCode(phone);
      setRetryAfterSec(response.retryAfterSec || 60);
      setDebugCode(response.debugCode || null);
      setStep('code');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await verifyPhoneCode(phone, code, displayName);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const canResend = retryAfterSec <= 0 && !loading;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <MessageCircle size={40} />
          </div>
          <h1>MakTalk</h1>
          <p className="auth-subtitle">Мессенджер с видеозвонками</p>
        </div>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === 'password' ? 'active' : ''}`}
            onClick={() => {
              setMode('password');
              setError('');
            }}
          >
            По логину и паролю
          </button>
          <button
            className={`auth-tab ${mode === 'sms' ? 'active' : ''}`}
            onClick={() => {
              setMode('sms');
              setError('');
            }}
          >
            Вход по SMS
          </button>
        </div>

        {mode === 'password' ? (
          <>
            <div className="auth-tabs">
              <button
                className={`auth-tab ${isLogin ? 'active' : ''}`}
                onClick={() => {
                  setIsLogin(true);
                  setError('');
                }}
              >
                Вход
              </button>
              <button
                className={`auth-tab ${!isLogin ? 'active' : ''}`}
                onClick={() => {
                  setIsLogin(false);
                  setError('');
                }}
              >
                Регистрация
              </button>
            </div>
            <form onSubmit={handlePasswordSubmit} className="auth-form">
              <div className="input-group">
                <input
                  type="text"
                  placeholder="Имя пользователя"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>

              {!isLogin && (
                <div className="input-group">
                  <input
                    type="text"
                    placeholder="Отображаемое имя"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    autoComplete="name"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
              )}

              <div className="input-group">
                <input
                  type="password"
                  placeholder="Пароль"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                />
              </div>

              {error && <div className="auth-error">{error}</div>}

              <button type="submit" className="auth-submit" disabled={loading}>
                {loading ? 'Подождите...' : isLogin ? 'Войти' : 'Создать аккаунт'}
              </button>
            </form>
          </>
        ) : (
          <form onSubmit={step === 'phone' ? handleRequestCode : handleVerifyCode} className="auth-form">
            <div className="input-group">
              <input
                type="tel"
                placeholder="+7 (999) 123-45-67"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoComplete="tel"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={step === 'code'}
              />
            </div>

            <div className="input-group">
              <input
                type="text"
                placeholder="Ваше имя (для нового аккаунта)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            {step === 'code' && (
              <div className="input-group">
                <input
                  type="text"
                  placeholder="Код из SMS"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                />
              </div>
            )}

            {error && <div className="auth-error">{error}</div>}
            {debugCode && (
              <div className="auth-error" style={{ background: 'rgba(67,170,139,0.12)', borderColor: 'rgba(67,170,139,0.35)', color: '#43AA8B' }}>
                Тестовый код: <b>{debugCode}</b>
              </div>
            )}

            {step === 'phone' ? (
              <button type="submit" className="auth-submit" disabled={loading}>
                {loading ? 'Отправка...' : 'Получить SMS-код'}
              </button>
            ) : (
              <>
                <button type="submit" className="auth-submit" disabled={loading || code.length < 4}>
                  {loading ? 'Проверка...' : 'Войти'}
                </button>
                <button
                  type="button"
                  className="auth-submit"
                  disabled={!canResend}
                  onClick={async () => {
                    setError('');
                    setLoading(true);
                    try {
                      const response = await requestPhoneCode(phone);
                      setRetryAfterSec(response.retryAfterSec || 60);
                      setDebugCode(response.debugCode || null);
                    } catch (err: any) {
                      setError(err.message);
                    } finally {
                      setLoading(false);
                    }
                  }}
                  style={{ background: '#2A2D5E' }}
                >
                  {canResend ? 'Отправить код снова' : `Повторить через ${retryAfterSec} c`}
                </button>
                <button
                  type="button"
                  className="auth-submit"
                  style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.12)' }}
                  onClick={() => {
                    setStep('phone');
                    setCode('');
                    setError('');
                  }}
                >
                  Изменить номер
                </button>
              </>
            )}

          </form>
        )}
      </div>
    </div>
  );
}
