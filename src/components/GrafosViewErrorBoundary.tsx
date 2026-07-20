import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  fallbackTitle: string;
  children: ReactNode;
};

type State = {
  error: Error | null;
};

// Não existia nenhum Error Boundary no projeto — o `Suspense` ao redor dos
// imports `lazy()` das visualizações (ver GrafosView.tsx) só cobre o
// estado de carregamento, não uma exceção lançada durante a renderização.
// Sem isso, um bug de runtime em qualquer visualização (ex.: forma
// inesperada de dados vindos do Drive real do usuário, mais variado do que
// os casos cobertos pelos testes unitários) derrubava a árvore React
// inteira — o app inteiro "fecha"/fica em branco por causa de um problema
// isolado numa única aba. Precisa ser um `class` component: é a única API
// de Error Boundary que o React oferece hoje, não dá pra fazer com hooks.
export class GrafosViewErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erro na visualização da aba Grafos:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grafos-view-error">
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
