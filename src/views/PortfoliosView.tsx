import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ProjectCard } from '../components/ProjectCard';
import { usePortfolios } from '../lib/usePortfolios';
import type { UserData } from '../lib/useUserData';
import { createPortfolio, deletePortfolio, updatePortfolio } from '../repositories/portfoliosRepo';
import type { Portfolio, Project, ProjectStatus } from '../types';

// Ordem dos componentes dentro de um portfólio: o que está andando primeiro.
const ORDEM_STATUS: Record<ProjectStatus, number> = {
  'Em andamento': 0,
  'Em planejamento': 1,
  'A iniciar': 2,
  Pausado: 3,
  'Concluído': 4,
  Cancelado: 5,
};

function encerrado(p: Project): boolean {
  return p.status === 'Concluído' || p.status === 'Cancelado';
}

function ordenar(lista: Project[]): Project[] {
  return [...lista].sort(
    (a, b) =>
      (ORDEM_STATUS[a.status] ?? 9) - (ORDEM_STATUS[b.status] ?? 9) ||
      a.name.localeCompare(b.name, 'pt-BR'),
  );
}

function formatarData(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function PortfolioForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: { nome: string; objetivo: string };
  onSave: (v: { nome: string; objetivo: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [nome, setNome] = useState(initial.nome);
  const [objetivo, setObjetivo] = useState(initial.objetivo);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  return (
    <div className="resource-form portfolio-form">
      <label className="resource-form-campo">
        <span>Nome</span>
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Acadêmico & Pesquisa" autoFocus />
      </label>
      <label className="resource-form-campo">
        <span>Objetivo estratégico</span>
        <textarea
          value={objetivo}
          onChange={(e) => setObjetivo(e.target.value)}
          rows={3}
          placeholder="O que este portfólio busca alcançar — é o critério que o secretário usa para priorizar."
        />
      </label>
      {erro && <p className="error">{erro}</p>}
      <div className="settings-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={salvando || !nome.trim()}
          onClick={async () => {
            setSalvando(true);
            setErro(null);
            try {
              await onSave({ nome, objetivo });
            } catch (e) {
              setErro(e instanceof Error ? e.message : 'Não foi possível salvar.');
            } finally {
              setSalvando(false);
            }
          }}
        >
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={salvando}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function Componentes({
  projetos,
  contagem,
}: {
  projetos: Project[];
  contagem: Record<string, { total: number; done: number }>;
}) {
  const [verEncerrados, setVerEncerrados] = useState(false);
  const ativos = ordenar(projetos.filter((p) => !encerrado(p)));
  const encerrados = ordenar(projetos.filter(encerrado));
  return (
    <>
      {ativos.length === 0 && <p className="muted">Nenhum projeto ou processo ativo.</p>}
      <div className="portfolio-componentes">
        {ativos.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            taskCount={contagem[p.id]?.total ?? 0}
            doneTaskCount={contagem[p.id]?.done ?? 0}
          />
        ))}
      </div>
      {encerrados.length > 0 && (
        <>
          <button type="button" className="btn-link" onClick={() => setVerEncerrados((v) => !v)}>
            {verEncerrados ? '▾' : '▸'} {encerrados.length} concluído(s)/cancelado(s)
          </button>
          {verEncerrados && (
            <div className="portfolio-componentes">
              {encerrados.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  taskCount={contagem[p.id]?.total ?? 0}
                  doneTaskCount={contagem[p.id]?.done ?? 0}
                />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

/**
 * Aba Portfólios: projetos e processos agrupados por portfólio (PMI), com o
 * objetivo estratégico de cada um e o panorama de gestão escrito pelo
 * secretário agendado. Para mover um projeto de portfólio, use o campo
 * "Portfólio" na página do projeto.
 */
export function PortfoliosView({ uid, data }: { uid: string; data: UserData }) {
  const { portfolios, loaded } = usePortfolios(uid);
  const [editando, setEditando] = useState<string | 'novo' | null>(null);
  const [aberto, setAberto] = useState<Record<string, boolean>>({});

  const contagem = useMemo(() => {
    const m: Record<string, { total: number; done: number }> = {};
    for (const t of data.tasks) {
      if (!t.section) continue;
      const c = (m[t.section] ??= { total: 0, done: 0 });
      c.total += 1;
      if (t.checked) c.done += 1;
    }
    return m;
  }, [data.tasks]);

  const porPortfolio = useMemo(() => {
    const m: Record<string, Project[]> = {};
    const ids = new Set(portfolios.map((p) => p.id));
    for (const p of data.projects) {
      const chave = p.portfolioId && ids.has(p.portfolioId) ? p.portfolioId : '__sem__';
      (m[chave] ??= []).push(p);
    }
    return m;
  }, [data.projects, portfolios]);

  async function remover(p: Portfolio) {
    if (!window.confirm(`Apagar o portfólio "${p.nome}"? Os projetos dele ficam sem portfólio (não são apagados).`)) return;
    try {
      await deletePortfolio(uid, p.id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Não foi possível apagar.');
    }
  }

  if (!loaded || data.loading) return <p className="muted">Carregando…</p>;

  const semPortfolio = porPortfolio['__sem__'] ?? [];

  return (
    <section className="portfolios-view">
      {portfolios.map((pf) => {
        const lista = porPortfolio[pf.id] ?? [];
        const ativos = lista.filter((p) => !encerrado(p));
        const emAndamento = ativos.filter((p) => p.status === 'Em andamento').length;
        const pausados = ativos.filter((p) => p.status === 'Pausado').length;
        const processos = ativos.filter((p) => p.tipo === 'processo').length;
        const gestaoAberta = aberto[pf.id] ?? false;
        return (
          <article key={pf.id} className="settings-card portfolio-card">
            {editando === pf.id ? (
              <PortfolioForm
                initial={{ nome: pf.nome, objetivo: pf.objetivo }}
                onSave={async (v) => {
                  await updatePortfolio(uid, pf.id, v);
                  setEditando(null);
                }}
                onCancel={() => setEditando(null)}
              />
            ) : (
              <>
                <div className="portfolio-cabecalho">
                  <h3>{pf.nome}</h3>
                  <div className="portfolio-acoes">
                    <button type="button" className="btn-link" onClick={() => setEditando(pf.id)}>
                      editar
                    </button>
                    <button type="button" className="btn-link" onClick={() => remover(pf)}>
                      apagar
                    </button>
                  </div>
                </div>
                {pf.objetivo && <p className="portfolio-objetivo">{pf.objetivo}</p>}
                <p className="muted portfolio-numeros">
                  {ativos.length} ativo(s) · {emAndamento} em andamento · {pausados} pausado(s) · {processos} processo(s)
                </p>
              </>
            )}

            {pf.gestao && (
              <div className="portfolio-gestao">
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setAberto((a) => ({ ...a, [pf.id]: !gestaoAberta }))}
                  aria-expanded={gestaoAberta}
                >
                  {gestaoAberta ? '▾' : '▸'} 🤖 Gestão do secretário
                  {pf.gestaoAtualizadaEm && <span className="muted"> · {formatarData(pf.gestaoAtualizadaEm)}</span>}
                </button>
                {gestaoAberta && (
                  <div className="portfolio-gestao-texto">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{pf.gestao}</ReactMarkdown>
                  </div>
                )}
              </div>
            )}

            <Componentes projetos={lista} contagem={contagem} />
          </article>
        );
      })}

      {semPortfolio.length > 0 && (
        <article className="settings-card portfolio-card portfolio-card--sem">
          <div className="portfolio-cabecalho">
            <h3>Sem portfólio</h3>
          </div>
          <p className="muted">
            O secretário distribui estes nos portfólios a cada passada; você também pode escolher na página do projeto.
          </p>
          <Componentes projetos={semPortfolio} contagem={contagem} />
        </article>
      )}

      {editando === 'novo' ? (
        <article className="settings-card">
          <PortfolioForm
            initial={{ nome: '', objetivo: '' }}
            onSave={async (v) => {
              await createPortfolio(uid, { ...v, ordem: portfolios.length });
              setEditando(null);
            }}
            onCancel={() => setEditando(null)}
          />
        </article>
      ) : (
        <div className="settings-actions">
          <button type="button" className="btn-primary" onClick={() => setEditando('novo')}>
            + Novo portfólio
          </button>
        </div>
      )}
    </section>
  );
}
