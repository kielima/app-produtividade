## Resumo

<!-- 1-2 frases descrevendo o que muda e por quê -->

## Checklist de UI/CSS

Se a PR mexe em CSS ou componentes visuais, preencher (ver `docs/responsive.md`):

- [ ] Testado em viewport 360x800 (Chrome DevTools → Galaxy S8/S9)
- [ ] Testado em viewport 768x1024 (iPad portrait)
- [ ] Sem scroll horizontal indesejado em 360px
- [ ] Textos longos quebram (word-break / min-width: 0 em flex)
- [ ] Popovers/modais cabem na viewport
- [ ] Sem anti-patterns proibidos (ver `docs/responsive.md` §6)

Se não mexe em UI/CSS: marcar N/A.
