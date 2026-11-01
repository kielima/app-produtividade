import { useRef, useState } from 'react';
import { ResourceAvatar } from './ResourceAvatar';
import { fotoParaAvatar } from '../lib/imagens';
import { useResources } from '../lib/resources';
import {
  createResource,
  deleteResource,
  updateResource,
  type ResourceInput,
} from '../repositories/resourcesRepo';
import type { Resource } from '../types';

const VAZIO: ResourceInput = { nome: '', foto: null, descricao: '', tipo: 'pessoa' };

function ResourceForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: ResourceInput;
  onSave: (input: ResourceInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ResourceInput>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function escolherFoto(files: FileList | null) {
    // Copiado antes de limpar o input (o FileList é "vivo").
    const file = files ? Array.from(files)[0] : undefined;
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    try {
      const foto = await fotoParaAvatar(file);
      setForm((f) => ({ ...f, foto }));
    } catch {
      setError('Não foi possível ler essa imagem. Tente uma foto JPEG ou PNG.');
    }
  }

  async function salvar() {
    setSaving(true);
    setError(null);
    try {
      await onSave(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="resource-form">
      <div className="resource-form-foto">
        <ResourceAvatar resource={{ nome: form.nome || '?', foto: form.foto }} size={64} />
        <div className="resource-form-foto-acoes">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => void escolherFoto(e.target.files)}
          />
          <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
            {form.foto ? 'Trocar foto' : 'Escolher foto'}
          </button>
          {form.foto && (
            <button type="button" className="btn-link" onClick={() => setForm((f) => ({ ...f, foto: null }))}>
              remover foto
            </button>
          )}
        </div>
      </div>
      <label className="resource-form-campo">
        <span>Nome</span>
        <input
          type="text"
          value={form.nome}
          onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
          placeholder="Nome da pessoa"
          autoFocus
        />
      </label>
      <label className="resource-form-campo">
        <span>Que tarefas pode fazer</span>
        <textarea
          value={form.descricao}
          onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
          placeholder="Ex.: compras, serviços de banco, revisar textos em inglês…"
          rows={4}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={form.tipo === 'ia'}
          onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.checked ? 'ia' : 'pessoa' }))}
        />
        &nbsp;é uma IA (o secretário agendado executa as tarefas dela)
      </label>
      {error && <p className="error">{error}</p>}
      <div className="settings-actions">
        <button type="button" className="btn-primary" onClick={salvar} disabled={saving || !form.nome.trim()}>
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/**
 * Aba Recursos das Configurações: quem pode receber tarefas, com foto e uma
 * descrição do que cada um sabe fazer — referência na hora de delegar.
 */
export function ResourcesSettings({ uid }: { uid: string }) {
  const { resources, loaded } = useResources();
  const [editingId, setEditingId] = useState<string | 'novo' | null>(null);

  async function remover(r: Resource) {
    if (!window.confirm(`Remover ${r.nome}? As tarefas atribuídas a ${r.nome} ficam sem responsável.`)) return;
    try {
      await deleteResource(uid, r.id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Não foi possível remover.');
    }
  }

  return (
    <article className="settings-card">
      <h3>Recursos</h3>
      <p className="muted">
        Pessoas (e IAs) para quem você pode atribuir tarefas. A descrição diz o que cada uma pode
        fazer — use-a para decidir a quem delegar. O responsável aparece como avatar no card da tarefa.
      </p>

      {!loaded ? (
        <p className="muted">Carregando…</p>
      ) : (
        <ul className="resource-lista">
          {resources.map((r) =>
            editingId === r.id ? (
              <li key={r.id} className="resource-item resource-item-editando">
                <ResourceForm
                  initial={{ nome: r.nome, foto: r.foto, descricao: r.descricao, tipo: r.tipo }}
                  onSave={async (input) => {
                    await updateResource(uid, r.id, input);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li key={r.id} className="resource-item">
                <ResourceAvatar resource={r} size={48} />
                <div className="resource-item-corpo">
                  <strong>
                    {r.nome}
                    {r.tipo === 'ia' && <span className="resource-tag-ia">IA</span>}
                  </strong>
                  {r.descricao ? (
                    <p className="resource-item-descricao">{r.descricao}</p>
                  ) : (
                    <p className="muted">Sem descrição.</p>
                  )}
                </div>
                <div className="resource-item-acoes">
                  <button type="button" className="btn-link" onClick={() => setEditingId(r.id)}>
                    editar
                  </button>
                  <button type="button" className="btn-link" onClick={() => remover(r)}>
                    remover
                  </button>
                </div>
              </li>
            ),
          )}
          {resources.length === 0 && <p className="muted">Nenhum recurso cadastrado.</p>}
        </ul>
      )}

      {editingId === 'novo' ? (
        <ResourceForm
          initial={VAZIO}
          onSave={async (input) => {
            await createResource(uid, { ...input, ordem: resources.length });
            setEditingId(null);
          }}
          onCancel={() => setEditingId(null)}
        />
      ) : (
        <div className="settings-actions">
          <button type="button" className="btn-primary" onClick={() => setEditingId('novo')}>
            + Adicionar recurso
          </button>
        </div>
      )}
    </article>
  );
}
