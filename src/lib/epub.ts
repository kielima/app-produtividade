// Configuração central do epub.js — equivalente ao lib/pdf.ts, mas para o
// formato EPUB. `book.ready` resolve quando metadados/spine/manifest já
// foram parseados do zip; a paginação por local (`book.locations`) é gerada
// à parte, sob demanda, por quem abre o leitor (é lenta em livros grandes).
import ePub, { type Book } from 'epubjs';

export type { Book, Rendition, Location } from 'epubjs';

// epub.js "consome" o ArrayBuffer (o JSZip interno guarda referência); uma
// cópia evita invalidar o buffer original, que pode vir do cache local.
export async function loadEpubBook(data: ArrayBuffer): Promise<Book> {
  const copy = data.slice(0);
  const book = ePub(copy);
  await book.ready;
  return book;
}

// Autor(es) da metadata do OPF: dc:creator vem como uma única string; ';' é o
// separador mais comum quando o EPUB lista vários autores nesse campo.
export function authorsFromEpubCreator(creator: string | undefined): string[] {
  if (!creator?.trim()) return [];
  return creator
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}
