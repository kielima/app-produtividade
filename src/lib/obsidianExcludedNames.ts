// Pastas/arquivos que nunca aparecem em nenhuma visualização derivada do
// vault (grafo, sistema solar) — ruído estrutural do próprio Obsidian/
// ferramentas auxiliares. Casamento por nome exato; excluir uma pasta
// esconde tudo dentro dela. Compartilhado entre obsidianGraph.ts e
// obsidianSolarSystem.ts (e pelo crawler eager do sistema solar, que nem
// chega a explorar essas pastas) para não ter duas listas divergentes.
export const EXCLUDED_NAMES = new Set(['.obsidian', '00_AVALIACOES', 'CLAUDE.md', '_MOC.md']);
