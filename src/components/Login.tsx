import { useEffect, useRef, useState } from 'react';
import {
  createPinAccount,
  isEmailAlreadyInUse,
  isInvalidCredential,
  isValidPin,
  PIN_LENGTH,
  signInWithPin,
} from '../lib/auth';

type Phase = 'enter' | 'confirm';

export function Login() {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [phase, setPhase] = useState<Phase>('enter');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [phase]);

  function handlePinChange(value: string, setter: (v: string) => void) {
    const digits = value.replace(/\D/g, '').slice(0, PIN_LENGTH);
    setter(digits);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidPin(pin)) {
      setError('PIN precisa ter exatamente 6 dígitos');
      return;
    }

    setLoading(true);
    try {
      if (phase === 'enter') {
        try {
          await signInWithPin(pin);
        } catch (err) {
          if (isInvalidCredential(err)) {
            setPhase('confirm');
            setError(null);
          } else {
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      } else {
        if (pin !== confirmPin) {
          setError('Os PINs não coincidem');
          return;
        }
        try {
          await createPinAccount(pin);
        } catch (err) {
          if (isEmailAlreadyInUse(err)) {
            setError('PIN incorreto — tente novamente');
            setPhase('enter');
            setConfirmPin('');
          } else {
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }

  function handleBack() {
    setPhase('enter');
    setConfirmPin('');
    setError(null);
  }

  return (
    <main className="auth-screen">
      <h1>Produtividade — Kiê</h1>

      {phase === 'enter' ? (
        <form onSubmit={handleSubmit} className="pin-form">
          <label htmlFor="pin-input" className="pin-label">
            Digite seu PIN
          </label>
          <input
            ref={inputRef}
            id="pin-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d{6}"
            maxLength={PIN_LENGTH}
            value={pin}
            onChange={(e) => handlePinChange(e.target.value, setPin)}
            className="pin-input"
            aria-label="PIN de 6 dígitos"
            disabled={loading}
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={loading || !isValidPin(pin)}
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="pin-form">
          <p className="muted">
            Primeiro acesso — confirme o PIN abaixo para criar a conta.
          </p>
          <label htmlFor="pin-confirm" className="pin-label">
            Confirme o PIN
          </label>
          <input
            ref={inputRef}
            id="pin-confirm"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d{6}"
            maxLength={PIN_LENGTH}
            value={confirmPin}
            onChange={(e) => handlePinChange(e.target.value, setConfirmPin)}
            className="pin-input"
            aria-label="confirmação do PIN"
            disabled={loading}
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={loading || !isValidPin(confirmPin)}
          >
            {loading ? 'Criando…' : 'Criar e entrar'}
          </button>
          <button
            type="button"
            onClick={handleBack}
            className="btn-link"
            disabled={loading}
          >
            ← voltar
          </button>
        </form>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
