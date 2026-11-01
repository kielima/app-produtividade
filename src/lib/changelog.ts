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
    date: '2026-11-01T19:00:00-03:00',
    title: 'Anexos na tarefa',
    items: [
      'Fotos e PDFs agora ficam na própria tarefa, numa seção "📎 Anexos" logo acima dos comentários, com miniaturas das fotos.',
      'O envio começa assim que você escolhe o arquivo (ou cola uma imagem na seção), com prévia enquanto sobe.',
      'Comentários voltaram a ser só texto.',
    ],
  },
  {
    date: '2026-11-01T18:00:00-03:00',
    title: 'Responsáveis, repositórios e secretário',
    items: [
      'Nova aba Configurações → Recursos: cadastre pessoas (nome, foto e o que cada uma pode fazer) para delegar tarefas. O Claude já vem cadastrado.',
      'Toda tarefa agora tem um Responsável, no lugar do antigo "Modo". O avatar do responsável aparece no card, e o filtro de tarefas filtra por responsável. Tarefas que estavam em Chat/Code/Cowork/Design/Colaborar/Escrever/Pesquisar foram atribuídas ao Claude; as Manuais, a você; as de "Delegar" ficaram sem responsável.',
      'Projetos ganharam o campo "Repositórios do GitHub": vincule um ou mais repositórios (o mesmo repositório pode ir para mais de um projeto). Todos os seus repositórios já foram vinculados, e os que não tinham projeto ganharam um.',
      'Anotações agora têm comentários — é onde o secretário automático deixa perguntas e sugestões.',
      'Corrigido: anexar foto ou PDF num comentário de tarefa não fazia nada. Agora a foto aparece antes de enviar, fotos grandes são reduzidas automaticamente e, se algo falhar, o motivo aparece na tela.',
    ],
  },
  {
    date: '2026-10-19T12:00:00-03:00',
    title: 'Meu dia',
    items: [
      'Nova aba "Meu dia": a lista das tarefas que você escolheu fazer, num só lugar.',
      'Em qualquer tela que mostra uma tarefa (cards e página da tarefa) há agora um botão ☀️ para adicioná-la ao Meu dia — e o mesmo botão a remove.',
      'Na aba Meu dia, segure uma tarefa e arraste para cima ou para baixo para escolher a ordem. A ordem fica salva e acompanha você entre dispositivos.',
      'Tarefas concluídas continuam na lista até você tocar em "Limpar concluídas".',
    ],
  },
  {
    date: '2026-08-13T12:00:00-03:00',
    title: 'Um só tipo de subtarefa',
    items: [
      'O app tinha dois sistemas de subtarefa: a lista simples de riscar (antiga, que já não aparecia em lugar nenhum) e as tarefas-filhas, com página, prazo, score e dependências próprios.',
      'Tudo o que estava na lista antiga virou tarefa-filha de verdade, mantendo o texto, o "concluído", a ordem e o encadeamento entre uma subtarefa e a anterior.',
      'Nas anotações, a lista de riscar continua igual — só passou a se chamar "itens", para não confundir com as subtarefas das tarefas.',
    ],
  },
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
