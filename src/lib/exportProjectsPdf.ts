import { Capacitor } from '@capacitor/core';
import type { MoSCoW, Project, ProjectPriority } from '../types';

const MOSCOW_LABEL: Record<MoSCoW, string> = {
  must: 'Must',
  should: 'Should',
  could: 'Could',
  wont: "Won't",
  '': '—',
};

const PRIORITY_LABEL: Record<ProjectPriority, string> = {
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
  '': '—',
};

function formatDeadline(deadline: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(deadline);
  if (!m) return deadline || '—';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Gera e baixa um PDF com os detalhes dos projetos passados (já filtrados
// e ordenados pela aba Projetos), na mesma ordem em que aparecem na tela.
// Importa o jsPDF sob demanda para não engordar o bundle principal com uma
// lib usada só ao clicar em "exportar".
export async function exportProjectsToPdf(projects: Project[]): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 15;
  const marginBottom = 15;
  const contentWidth = pageWidth - marginX * 2;
  let y = 18;

  const now = new Date();

  function ensureSpace(needed: number) {
    if (y + needed > pageHeight - marginBottom) {
      doc.addPage();
      y = 18;
    }
  }

  function writeField(label: string, value: string) {
    if (!value.trim()) return;
    ensureSpace(9);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(label, marginX, y);
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(value, contentWidth) as string[];
    for (const line of lines) {
      ensureSpace(4.5);
      doc.text(line, marginX, y);
      y += 4.5;
    }
    y += 1.5;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Projetos ativos', marginX, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(
    `Exportado em ${now.toLocaleDateString('pt-BR')} · ${projects.length} projeto${
      projects.length === 1 ? '' : 's'
    }`,
    marginX,
    y,
  );
  doc.setTextColor(20);
  y += 8;

  if (projects.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Nenhum projeto para o filtro selecionado.', marginX, y);
  }

  for (const p of projects) {
    ensureSpace(14);
    doc.setDrawColor(210);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    const nameLines = doc.splitTextToSize(p.name || '(sem nome)', contentWidth) as string[];
    for (const line of nameLines) {
      ensureSpace(6);
      doc.text(line, marginX, y);
      y += 6;
    }

    const metaParts = [
      `Status: ${p.status || '—'}`,
      `Prioridade: ${PRIORITY_LABEL[p.priority]}`,
      `MoSCoW: ${MOSCOW_LABEL[p.moscow]}`,
      `Prazo: ${formatDeadline(p.deadline)}`,
    ];
    if (p.area) metaParts.push(`Área: ${p.area}`);
    if (p.estimatedDuration) metaParts.push(`Duração estimada: ${p.estimatedDuration}`);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90);
    for (const line of doc.splitTextToSize(metaParts.join('   ·   '), contentWidth) as string[]) {
      ensureSpace(4.5);
      doc.text(line, marginX, y);
      y += 4.5;
    }
    doc.setTextColor(20);

    if (p.categories.length > 0) {
      ensureSpace(4.5);
      doc.setFontSize(9);
      doc.setTextColor(90);
      for (const line of doc.splitTextToSize(
        `Categorias: ${p.categories.join(', ')}`,
        contentWidth,
      ) as string[]) {
        ensureSpace(4.5);
        doc.text(line, marginX, y);
        y += 4.5;
      }
      doc.setTextColor(20);
    }

    y += 2;
    writeField('Objetivo', p.objective);
    writeField('Status atual', p.currentStatus);
    writeField('Próximos passos', p.nextSteps);
    writeField('Notas', p.notes);

    y += 3;
  }

  const fileDate = now.toISOString().slice(0, 10);
  const filename = `projetos-${fileDate}.pdf`;

  if (Capacitor.isNativePlatform()) {
    // No WebView do Android (Capacitor) não existe mecanismo de download de
    // browser: nem o `doc.save()` do jsPDF nem `<a download>` com Blob
    // disparam nada, silenciosamente (o WebView não tem DownloadListener
    // registrado). Gravamos o PDF no cache do app via Filesystem e abrimos a
    // folha de compartilhamento nativa, de onde o usuário salva/abre/envia o
    // arquivo — evita depender de permissões de armazenamento por escopo.
    const base64 = doc.output('datauristring').split(',')[1];
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({
      title: filename,
      dialogTitle: 'Salvar ou compartilhar PDF',
      files: [uri],
    });
  } else {
    downloadBlob(doc.output('blob'), filename);
  }
}

// Padrão de download usado em `exportData.ts` (Blob + <a download>) —
// funciona em qualquer browser real, mas não no WebView nativo do Capacitor
// (ver ramo `isNativePlatform` acima).
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
