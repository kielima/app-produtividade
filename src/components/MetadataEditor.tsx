import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReadingItem, ReadingStatus } from '../types';
import {
  fetchByDoi,
  fetchByIsbn,
  fetchByIssn,
  type FetchedMetadata,
} from '../lib/readingMetadata';
import {
  BUILTIN_TYPE_LABELS,
  readingTypeFromInput,
  readingTypeLabel,
} from '../lib/readingTypes';
import { normalizeTags } from '../lib/tags';
import { driveFolderLink } from '../lib/googleDrive';

// Editor de metadados de um item da estante, com busca automática por
// DOI/ISBN/ISSN. Apresentado como diálogo sobre o leitor ou a estante.
export function MetadataEditor({
  item,
  allTypes,
  onSave,
  onClose,
}: {
  item: ReadingItem;
  // Tipos já existentes na estante, para sugerir no campo "Tipo" (o usuário
  // pode escolher um destes ou digitar um novo, criando uma nova estante).
  allTypes: string[];
  // Persiste o patch. Pode renomear o arquivo no Drive (assíncrono e falível),
  // então devolve uma Promise: o editor mostra "Salvando…", fecha no sucesso e
  // mantém-se aberto com a mensagem de erro se algo falhar.
  onSave: (patch: Partial<ReadingItem>) => Promise<void>;
  onClose: () => void;
}) {
  const initialFileName = item.fileName ?? '';
  const [fileName, setFileName] = useState(initialFileName);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [authors, setAuthors] = useState(item.authors.join(', '));
  // Campo "Tipo" é livre: guarda o rótulo digitado/escolhido; na hora de salvar
  // é convertido de volta para o valor canônico (chave embutida ou texto puro).
  const [typeInput, setTypeInput] = useState(readingTypeLabel(item.itemType));
  const [readingStatus, setReadingStatus] = useState<ReadingStatus>(item.readingStatus);
  const [doi, setDoi] = useState(item.doi ?? '');
  const [isbn, setIsbn] = useState(item.isbn ?? '');
  const [issn, setIssn] = useState(item.issn ?? '');
  const [year, setYear] = useState(item.year ?? '');
  const [publication, setPublication] = useState(item.publication ?? '');
  const [tags, setTags] = useState(item.tags.join(', '));
  const [fetching, setFetching] = useState<null | 'doi' | 'isbn' | 'issn'>(null);
  const [error, setError] = useState<string | null>(null);

  // Sugestões do campo "Tipo": rótulos dos embutidos + tipos já usados na
  // estante, sem duplicar e em ordem alfabética.
  const typeOptions = useMemo(() => {
    const set = new Set<string>(Object.values(BUILTIN_TYPE_LABELS));
    for (const t of allTypes) set.add(readingTypeLabel(t));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allTypes]);

  function applyFetched(meta: FetchedMetadata) {
    if (meta.title) setTitle(meta.title);
    if (meta.authors?.length) setAuthors(meta.authors.join(', '));
    if (meta.year) setYear(meta.year);
    if (meta.publication) setPublication(meta.publication);
    if (meta.issn) setIssn(meta.issn);
    if (meta.itemType) setTypeInput(readingTypeLabel(meta.itemType));
  }

  async function runFetch(kind: 'doi' | 'isbn' | 'issn') {
    setError(null);
    setFetching(kind);
    try {
      const meta =
        kind === 'doi'
          ? await fetchByDoi(doi)
          : kind === 'isbn'
            ? await fetchByIsbn(isbn)
            : await fetchByIssn(issn);
      applyFetched(meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(null);
    }
  }

  async function save() {
    setError(null);
    setSaving(true);
    const patch: Partial<ReadingItem> = {
      title: title.trim(),
      authors: authors.split(',').map((a) => a.trim()).filter(Boolean),
      itemType: readingTypeFromInput(typeInput),
      readingStatus,
      doi: doi.trim() || undefined,
      isbn: isbn.trim() || undefined,
      issn: issn.trim() || undefined,
      year: year.trim() || undefined,
      publication: publication.trim() || undefined,
      tags: normalizeTags(tags.split(',').map((t) => t.trim()).filter(Boolean)),
    };
    // Só pede renomeação ao Drive quando o usuário realmente mudou o nome —
    // evita renomear sem querer só por abrir e salvar os metadados.
    if (fileName.trim() !== initialFileName.trim()) {
      patch.fileName = fileName.trim();
    }
    try {
      await onSave(patch);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="share-dialog-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="share-dialog metadata-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="metadata-editor-title"
      >
        <h2 id="metadata-editor-title">Metadados</h2>

        <label className="metadata-field">
          <span>Título</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <label className="metadata-field">
          <span>Nome do arquivo (renomeia no Google Drive)</span>
          <input
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="ex.: artigo.pdf"
          />
        </label>

        {(item.folderPath || item.folderId) && (
          <div className="metadata-field">
            <span>Pasta no Google Drive</span>
            <div className="metadata-folder">
              <span className="metadata-folder-path" title={item.folderPath}>
                {item.folderPath || '—'}
              </span>
              {item.folderId && (
                <a
                  className="metadata-folder-link"
                  href={driveFolderLink(item.folderId)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir no Drive
                </a>
              )}
            </div>
          </div>
        )}

        <label className="metadata-field">
          <span>Autores (separados por vírgula)</span>
          <input value={authors} onChange={(e) => setAuthors(e.target.value)} />
        </label>

        <div className="metadata-row">
          <div className="metadata-field">
            <span>Tipo (estante)</span>
            <ShelfTypeSelect
              value={typeInput}
              onChange={setTypeInput}
              options={typeOptions}
            />
          </div>
          <label className="metadata-field">
            <span>Status</span>
            <select
              value={readingStatus}
              onChange={(e) => setReadingStatus(e.target.value as ReadingStatus)}
            >
              <option value="to-read">A ler</option>
              <option value="reading">Lendo</option>
              <option value="read">Lido</option>
            </select>
          </label>
          <label className="metadata-field metadata-field--narrow">
            <span>Ano</span>
            <input value={year} onChange={(e) => setYear(e.target.value)} />
          </label>
        </div>

        <label className="metadata-field">
          <span>Publicação (revista / editora)</span>
          <input value={publication} onChange={(e) => setPublication(e.target.value)} />
        </label>

        <div className="metadata-fetch-row">
          <input
            placeholder="DOI"
            value={doi}
            onChange={(e) => setDoi(e.target.value)}
          />
          <button type="button" onClick={() => runFetch('doi')} disabled={!doi.trim() || fetching !== null}>
            {fetching === 'doi' ? '…' : 'Buscar'}
          </button>
        </div>
        <div className="metadata-fetch-row">
          <input
            placeholder="ISBN"
            value={isbn}
            onChange={(e) => setIsbn(e.target.value)}
          />
          <button type="button" onClick={() => runFetch('isbn')} disabled={!isbn.trim() || fetching !== null}>
            {fetching === 'isbn' ? '…' : 'Buscar'}
          </button>
        </div>
        <div className="metadata-fetch-row">
          <input
            placeholder="ISSN"
            value={issn}
            onChange={(e) => setIssn(e.target.value)}
          />
          <button type="button" onClick={() => runFetch('issn')} disabled={!issn.trim() || fetching !== null}>
            {fetching === 'issn' ? '…' : 'Buscar'}
          </button>
        </div>

        <label className="metadata-field">
          <span>Tags (separadas por vírgula)</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="share-dialog-actions">
          <button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
          <button
            type="button"
            className="share-dialog-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
        </div>
      </div>
    </>
  );
}

// Seletor do campo "Tipo": lista suspensa nativa com as estantes existentes,
// uma opção para criar uma estante nova e um X para limpar a marcação atual
// (o item volta a cair em "Outro" ao salvar, como qualquer tipo vazio).
const CREATE_NEW_TYPE = '__create-new-type__';

function ShelfTypeSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const draftInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) draftInputRef.current?.focus();
  }, [creating]);

  // Garante que o valor atual apareça na lista mesmo que ainda não conste em
  // `options` (ex.: valor vindo de metadados buscados por DOI/ISBN/ISSN).
  const allOptions =
    value && !options.includes(value) ? [...options, value].sort((a, b) => a.localeCompare(b)) : options;

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (v === CREATE_NEW_TYPE) {
      setDraft('');
      setCreating(true);
      return;
    }
    onChange(v);
  }

  function confirmDraft() {
    const trimmed = draft.trim();
    if (trimmed) onChange(trimmed);
    setCreating(false);
  }

  if (creating) {
    return (
      <div className="type-combobox type-combobox--creating">
        <input
          ref={draftInputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Nome da nova estante…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              confirmDraft();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setCreating(false);
            }
          }}
        />
        <button
          type="button"
          className="type-combobox-confirm"
          onClick={confirmDraft}
          disabled={!draft.trim()}
          title="Confirmar nova estante"
          aria-label="Confirmar nova estante"
        >
          ✓
        </button>
        <button
          type="button"
          className="type-combobox-cancel"
          onClick={() => setCreating(false)}
          title="Cancelar"
          aria-label="Cancelar"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="type-combobox">
      <select value={value && allOptions.includes(value) ? value : ''} onChange={handleSelectChange}>
        <option value="" disabled hidden>
          Selecione…
        </option>
        {allOptions.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={CREATE_NEW_TYPE}>+ Criar nova estante…</option>
      </select>
      {value && (
        <button
          type="button"
          className="type-combobox-clear"
          onClick={() => onChange('')}
          title="Remover marcação atual"
          aria-label="Remover marcação atual"
        >
          ✕
        </button>
      )}
    </div>
  );
}
