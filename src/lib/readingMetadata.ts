// Busca automática de metadados bibliográficos a partir de identificadores.
// Tudo client-side e sem chave/segredo:
//  - DOI  → CrossRef (api.crossref.org/works/{doi})
//  - ISSN → CrossRef journals (api.crossref.org/journals/{issn})
//  - ISBN → Google Books (googleapis.com/books/v1/volumes?q=isbn:{isbn})

import type { ReadingItem } from '../types';

// Subconjunto de campos que a busca consegue preencher.
export type FetchedMetadata = Partial<
  Pick<
    ReadingItem,
    'title' | 'authors' | 'year' | 'publication' | 'issn' | 'itemType'
  >
>;

export function normalizeDoi(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .trim();
}

export function normalizeIsbn(raw: string): string {
  return raw.replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function normalizeIssn(raw: string): string {
  const digits = raw.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return raw.trim();
}

type CrossrefAuthor = { given?: string; family?: string; name?: string };
type CrossrefWork = {
  message?: {
    title?: string[];
    author?: CrossrefAuthor[];
    'container-title'?: string[];
    ISSN?: string[];
    type?: string;
    issued?: { 'date-parts'?: number[][] };
    published?: { 'date-parts'?: number[][] };
  };
};

function authorName(a: CrossrefAuthor): string {
  if (a.name) return a.name;
  return [a.given, a.family].filter(Boolean).join(' ').trim();
}

function crossrefYear(msg: NonNullable<CrossrefWork['message']>): string | undefined {
  const parts =
    msg.issued?.['date-parts']?.[0] ?? msg.published?.['date-parts']?.[0];
  const y = parts?.[0];
  return y ? String(y) : undefined;
}

export async function fetchByDoi(doi: string): Promise<FetchedMetadata> {
  const clean = normalizeDoi(doi);
  if (!clean) throw new Error('DOI vazio.');
  const res = await fetch(
    `https://api.crossref.org/works/${encodeURIComponent(clean)}`,
  );
  if (res.status === 404) throw new Error('DOI não encontrado no CrossRef.');
  if (!res.ok) throw new Error(`CrossRef respondeu ${res.status}.`);
  const json = (await res.json()) as CrossrefWork;
  const msg = json.message;
  if (!msg) throw new Error('Resposta inválida do CrossRef.');

  const out: FetchedMetadata = {};
  if (msg.title?.[0]) out.title = msg.title[0];
  if (msg.author?.length) out.authors = msg.author.map(authorName).filter(Boolean);
  const pub = msg['container-title']?.[0];
  if (pub) out.publication = pub;
  if (msg.ISSN?.[0]) out.issn = msg.ISSN[0];
  const year = crossrefYear(msg);
  if (year) out.year = year;
  // CrossRef "journal-article" / "proceedings-article" → artigo; "book" → livro.
  if (msg.type?.includes('book')) out.itemType = 'book';
  else if (msg.type?.includes('article')) out.itemType = 'article';
  return out;
}

type CrossrefJournal = { message?: { title?: string; ISSN?: string[] } };

export async function fetchByIssn(issn: string): Promise<FetchedMetadata> {
  const clean = normalizeIssn(issn);
  if (!clean) throw new Error('ISSN vazio.');
  const res = await fetch(
    `https://api.crossref.org/journals/${encodeURIComponent(clean)}`,
  );
  if (res.status === 404) throw new Error('ISSN não encontrado no CrossRef.');
  if (!res.ok) throw new Error(`CrossRef respondeu ${res.status}.`);
  const json = (await res.json()) as CrossrefJournal;
  const out: FetchedMetadata = {};
  if (json.message?.title) out.publication = json.message.title;
  if (json.message?.ISSN?.[0]) out.issn = json.message.ISSN[0];
  return out;
}

type GoogleBooksVolume = {
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
  };
};
type GoogleBooksResponse = { totalItems?: number; items?: GoogleBooksVolume[] };

export async function fetchByIsbn(isbn: string): Promise<FetchedMetadata> {
  const clean = normalizeIsbn(isbn);
  if (!clean) throw new Error('ISBN vazio.');
  const res = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(clean)}`,
  );
  if (!res.ok) throw new Error(`Google Books respondeu ${res.status}.`);
  const json = (await res.json()) as GoogleBooksResponse;
  const vi = json.items?.[0]?.volumeInfo;
  if (!vi) throw new Error('ISBN não encontrado no Google Books.');
  const out: FetchedMetadata = { itemType: 'book' };
  if (vi.title) out.title = vi.subtitle ? `${vi.title}: ${vi.subtitle}` : vi.title;
  if (vi.authors?.length) out.authors = vi.authors;
  if (vi.publisher) out.publication = vi.publisher;
  const year = vi.publishedDate?.slice(0, 4);
  if (year) out.year = year;
  return out;
}

// Detecta um DOI no texto da primeira página de um PDF (heurística simples).
// Formato canônico: 10.xxxx/sufixo.
export function extractDoiFromText(text: string): string | null {
  const m = text.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  return m ? m[0].replace(/[.,;]+$/, '') : null;
}
