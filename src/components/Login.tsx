import { useEffect, useState } from 'react';
import {
  createPinAccount,
  isEmailAlreadyInUse,
  isInvalidCredential,
  isValidPin,
  PIN_LENGTH,
  signInWithPin,
} from '../lib/auth';
import { PinDots, PinPad } from './PinPad';

type Phase = 'enter' | 'confirm';

export function Login() {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [phase, setPhase] = useState<Phase>('enter');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Limpa erro automaticamente quando o usuário começa a digitar de novo
  useEffect(() => {
    if (error && (phase === 'enter' ? pin : confirmPin).length > 0) {
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, confirmPin]);

  async function handleEnterSubmit() {
    if (!isValidPin(pin)) return;
    setLoading(true);
    try {
      await signInWithPin(pin);
    } catch (err) {
      if (isInvalidCredential(err)) {
        // primeiro acesso ou PIN errado — pede confirmação para criar conta
        setPhase('confirm');
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : String(err));
        setPin('');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmSubmit() {
    if (!isValidPin(confirmPin)) return;
    if (pin !== confirmPin) {
      setError('Os PINs não coincidem');
      setConfirmPin('');
      return;
    }
    setLoading(true);
    try {
      await createPinAccount(pin);
    } catch (err) {
      if (isEmailAlreadyInUse(err)) {
        setError('PIN incorreto — tente novamente');
        setPhase('enter');
        setPin('');
        setConfirmPin('');
      } else {
        setError(err instanceof Error ? err.message : String(err));
        setConfirmPin('');
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

  const activeValue = phase === 'enter' ? pin : confirmPin;
  const activeSetter = phase === 'enter' ? setPin : setConfirmPin;
  const activeSubmit = phase === 'enter' ? handleEnterSubmit : handleConfirmSubmit;

  const prompt =
    phase === 'enter' ? 'Insira seu PIN' : 'Confirme o PIN para criar a conta';

  return (
    <main className="pin-screen">
      <div className="pin-screen-top">
        <div className="pin-app-icon" aria-hidden="true">
          ⚡
        </div>
        <h1 className="pin-app-name">Produtividade</h1>
        <p className="pin-prompt">{prompt}</p>
        <PinDots value={activeValue} length={PIN_LENGTH} />
      </div>

      <div className="pin-screen-bottom">
        <PinPad
          value={activeValue}
          onChange={activeSetter}
          onSubmit={activeSubmit}
          length={PIN_LENGTH}
          disabled={loading}
        />

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {phase === 'confirm' && (
          <button
            type="button"
            onClick={handleBack}
            className="btn-link"
            disabled={loading}
          >
            ← voltar
          </button>
        )}
      </div>
    </main>
  );
}
