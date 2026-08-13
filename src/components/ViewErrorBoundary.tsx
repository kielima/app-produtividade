import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  fallbackTitle: string;
  // Aparece só no console, para localizar de onde veio a exceção.
  label?: string;
  children: ReactNode;
};

type State = {
  error: Error | null;
};

// O `Suspense` ao redor dos imports `lazy()` das visualizações (ver
// GrafosView.tsx) só cobre o estado de carregamento, não uma exceção lançada
// durante a renderização. Sem um Error Boundary, um bug de runtime em
// qualquer visualização (ex.: forma inesperada de dados reais do usuário,
// mais variados do que os casos cobertos pelos testes unitários) derruba a
// árvore React inteira — o app inteiro "fecha"/fica em branco por causa de um
// problema isolado numa única aba. Precisa ser um `class` component: é a
// única API de Error Boundary que o React oferece hoje, não dá pra fazer com
// hooks.
export class ViewErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `Erro na visualização${this.props.label ? ` (${this.props.label})` : ''}:`,
      error,
      info.componentStack,
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div className="view-error">
          <p className="error">{this.props.fallbackTitle}</p>
          <p className="muted">{this.state.error.message}</p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => this.setState({ error: null })}
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
