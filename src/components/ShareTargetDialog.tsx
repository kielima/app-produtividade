// Diálogo apresentado quando o utilizador partilha uma imagem para o app.
// Mostra um spinner enquanto o Gemini transcreve, depois pergunta se quer
// criar uma tarefa ou uma anotação a partir do texto extraído.

export type ShareTargetDialogState =
  | { status: 'loading' }
  | { status: 'choose'; title: string; text: string }
  | { status: 'error'; message: string };

export function ShareTargetDialog({
  state,
  canCreateTask,
  onCreateTask,
  onCreateNote,
  onCancel,
}: {
  state: ShareTargetDialogState;
  canCreateTask: boolean;
  onCreateTask: () => void;
  onCreateNote: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <div
        className="share-dialog-backdrop"
        onClick={state.status === 'loading' ? undefined : onCancel}
        aria-hidden="true"
      />
      <div
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
      >
        {state.status === 'loading' && (
          <>
            <h2 id="share-dialog-title">Transcrevendo imagem…</h2>
            <p className="muted">
              A enviar para o Gemini para extrair o texto.
            </p>
            <div className="share-dialog-spinner" aria-hidden="true" />
          </>
        )}

        {state.status === 'error' && (
          <>
            <h2 id="share-dialog-title">Não foi possível transcrever</h2>
            <p className="error">{state.message}</p>
            <div className="share-dialog-actions">
              <button type="button" onClick={onCancel}>
                Fechar
              </button>
            </div>
          </>
        )}

        {state.status === 'choose' && (
          <>
            <h2 id="share-dialog-title">Texto extraído</h2>
            {state.title && (
              <p className="share-dialog-title-preview">{state.title}</p>
            )}
            <pre className="share-dialog-text">{state.text || '(vazio)'}</pre>
            <p className="muted">Criar como:</p>
            <div className="share-dialog-actions">
              <button
                type="button"
                onClick={onCreateTask}
                disabled={!canCreateTask}
                title={
                  canCreateTask
                    ? undefined
                    : 'Crie um projeto antes para adicionar tarefas'
                }
              >
                Tarefa
              </button>
              <button type="button" onClick={onCreateNote}>
                Anotação
              </button>
              <button
                type="button"
                className="share-dialog-secondary"
                onClick={onCancel}
              >
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
