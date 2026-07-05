// Histórico de novas funcionalidades do app.
//
// Sempre que lançar uma nova feature, adicione uma entrada NO TOPO da lista.
// A primeira entrada (a mais recente) é usada na tela de Configurações para
// mostrar a data/hora da "última atualização de novas funções".
//
// `date` deve estar em ISO 8601 (ex.: '2026-06-17T14:30:00-03:00') para que
// o fuso e o horário sejam preservados ao formatar.

export type ChangelogEntry = {
  /** Data/hora do lançamento, em ISO 8601. */
  date: string;
  /** Rótulo curto da versão ou marco (opcional). */
  version?: string;
  /** Título resumido do que mudou. */
  title: string;
  /** Lista de itens/novidades dessa atualização. */
  items: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-07-05T02:00:00-03:00',
    title: 'Atualização do app pelas Configurações',
    items: [
      'Novo cartão "Atualização" nas Configurações: toque em "Verificar atualização" para ver se há uma versão mais recente publicada.',
      'No app instalado (APK), quando há versão nova ele baixa e abre o instalador direto — sem precisar procurar o arquivo. Na primeira vez o Android pede para autorizar "instalar apps desconhecidos".',
      'Cada nova versão é publicada automaticamente a cada atualização do app; no navegador, ele continua se atualizando sozinho ao recarregar.',
    ],
  },
  {
    date: '2026-06-19T15:00:00-03:00',
    title: 'Reordenar subtarefas arrastando',
    items: [
      'Agora dá para segurar uma subtarefa pelo "punho" (⋮⋮) e arrastá-la para cima ou para baixo para reorganizar a ordem.',
      'A nova ordem fica guardada e é respeitada sempre que a tarefa é aberta.',
    ],
  },
  {
    date: '2026-06-17T12:00:00-03:00',
    version: 'v0.0.1',
    title: 'Histórico de novidades nas Configurações',
    items: [
      'Novo cartão "Novidades" na tela de Configurações mostrando a data e o horário da última atualização de funções.',
      'Ao tocar no carimbo de data, abre um log completo das features lançadas em cada atualização.',
    ],
  },
  {
    date: '2026-06-10T10:00:00-03:00',
    title: 'Subtarefas mais poderosas',
    items: [
      'Barra de progresso das subtarefas direto no card da tarefa.',
      'Botão de ligação para criar dependência entre subtarefas.',
      'Adição de subtarefa inline pelo título, sem sair da tela.',
      'A IA agora gera subtarefas automaticamente a partir do título e das notas.',
    ],
  },
  {
    date: '2026-06-01T10:00:00-03:00',
    title: 'Projetos e produtividade',
    items: [
      'Barra de progresso preenchendo o card do projeto.',
      'Exportar e importar todos os dados em JSON (backup/escape hatch).',
    ],
  },
];

/** A entrada mais recente do changelog (a primeira da lista). */
export function getLatestChangelogEntry(): ChangelogEntry | null {
  return CHANGELOG[0] ?? null;
}

/** Formata a data ISO para data + horário legíveis em pt-BR. */
export function formatChangelogDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
