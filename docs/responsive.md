# Plano de Responsividade — App Produtividade

Plano permanente pra garantir que o app funciona bem em qualquer tela —
do celular estreito (360px) ao desktop. Mobile-first por padrão, já que
o uso primário é em celular.

> Este documento é a referência ÚNICA para decisões de layout responsivo.
> Toda PR que mexer em CSS/UI deve seguir o checklist do final.

---

## 1. Sistema de breakpoints

Quatro faixas, mobile-first. As declarações `@media (max-width: ...)`
são usadas para **ajustes** sobre o padrão mobile.

| Token CSS | Faixa | Quando usar | Exemplos |
|-----------|-------|-------------|----------|
| **base** (sem media query) | 360px+ | Estilos default mobile. Tudo deve funcionar aqui sem ajuste. | Celular estreito |
| **`--bp-sm`: 480px** | 480px+ | Folga extra: pode aumentar font, gap, padding. | Celular largo |
| **`--bp-md`: 720px** | 720px+ | Trocar de stack vertical → 2 colunas. Mostrar sidebars. | Tablet portrait |
| **`--bp-lg`: 1024px** | 1024px+ | Tudo expansível: 3+ colunas, gap maior. | Tablet landscape / desktop |

```css
/* Convenção: definir como custom property pra documentação inline */
:root {
  --bp-sm: 480px;
  --bp-md: 720px;
  --bp-lg: 1024px;
}

/* Uso (mobile-first): */
.painel {
  display: flex;
  flex-direction: column; /* mobile default */
}
@media (min-width: 720px) {
  .painel { flex-direction: row; }
}
```

---

## 2. Regras de layout (anti-patterns identificados na auditoria)

### 2.1. Nunca usar `min-width` em rem grandes sem fallback mobile

❌ **Errado**:
```css
.filter-select { min-width: 12rem; }
.pin-input { width: 12rem; }
```

✅ **Certo**:
```css
.filter-select {
  width: 100%;
  max-width: 12rem;
}
.pin-input {
  width: min(12rem, 100%);
}
```

**Regra prática**: `min-width` > 8rem em qualquer container interno é red flag.

### 2.2. Grid com `minmax(N, 1fr)` precisa ter `N` que cabe em 360px

❌ **Errado** (`.columned-view`):
```css
grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
```

Em 360px com padding/gap, 220px gera scroll horizontal silencioso.

✅ **Certo**:
```css
grid-template-columns: 1fr; /* mobile = stack */
@media (min-width: 720px) {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
```

### 2.3. Flex children com texto longo precisam de `min-width: 0`

❌ **Errado** (estourou no DepPicker):
```css
.dep-candidate { display: flex; }
.dep-candidate span { /* sem min-width */ }
```

✅ **Certo**:
```css
.dep-candidate { display: flex; }
.dep-candidate > span {
  flex: 1;
  min-width: 0;
  word-break: break-word;
  overflow-wrap: anywhere;
}
```

**Regra prática**: todo flex child que pode conter texto livre precisa
`min-width: 0` + uma estratégia de quebra (`word-break` ou ellipsis).

### 2.4. Popovers com boundary check obrigatório

❌ **Problema atual**: `.popover-panel.align-end { right: 0 }` pode sair
da tela se o trigger está perto da borda esquerda.

✅ **Padrão**:
- Adicionar `max-width: calc(100vw - 2rem)` e `max-height: 60vh`
- Considerar usar Floating UI / Popper se a complexidade crescer
- Triggers em telas mobile devem abrir popover **centrado** ou em sheet
  (modal bottom) ao invés de absolute positioning

### 2.5. Modais

✅ **Padrão obrigatório**:
```css
.modal {
  width: 100%;
  max-width: 520px;
  max-height: calc(100vh - 2rem); /* respeita viewport vertical */
  display: flex;
  flex-direction: column;
}
.modal-body { overflow-y: auto; flex: 1; }
```

Header e footer fixos, body scrollável.

### 2.6. Topbar / navegação primária

Em mobile (<480px):
- Logo + tabs + ações em **uma linha** só se couber. Se não, dropdown hambúrguer.
- Sub-tabs sempre em `overflow-x: auto` com `scroll-snap-type: x mandatory`
  e um indicador visual de "tem mais" (sombra ou seta).

### 2.7. Views especiais (Board, Kanban, Calendário)

- **Board horizontal**: aceitável ter scroll lateral em mobile, mas com
  `scroll-snap-type: x mandatory` e colunas em 80vw pra UX ok.
- **Calendário**: em <720px, sidebar vai pra cima do grid (já tem); em
  <450px, sidebar é colapsável (acordeão).
- **Matrizes 2x2 (MoSCoW, Modo, etc)**: viram stack 4x1 em <480px.

---

## 3. Tipografia responsiva

Usar `clamp()` pra escalar suavemente entre breakpoints:

```css
h1.topbar-title { font-size: clamp(1rem, 4vw, 1.5rem); }
.task-title { font-size: clamp(0.9rem, 2.5vw, 1rem); }
```

Evitar `font-size` em px ou rem fixo pra headings principais.

---

## 4. Plano de execução (priorização)

Vou dividir os 39 problemas em **4 ondas**. Cada onda = 1 PR.

### Onda 1 — Crítico (quebra UX em uso real)
- [ ] Topbar: H1 menor + ações wrap em <480px
- [ ] `.pin-input` width 100% até bp-sm
- [ ] `.filter-select` width 100% até bp-md
- [ ] Calendário: sidebar acima do grid em <720px (já tem), adicionar
      acordeão em <450px
- [ ] `.columned-view` (Kanban/MoSCoW/Modo/Esforço): single column em <720px
- [ ] Popover `max-width: calc(100vw - 2rem)` + `max-height: 60vh`

### Onda 2 — Alto impacto visual
- [ ] BoardView: column width 80vw em mobile, scroll-snap
- [ ] Filtros (.filters): selects empilhados em <480px
- [ ] Project cards: layout vertical em <480px
- [ ] PIN input + estética em mobile
- [ ] Settings preview grid: single column em <480px

### Onda 3 — Polish
- [ ] Sub-tabs com indicador visual de scroll
- [ ] Drag overlay max-width 100%
- [ ] Todos `min-width` > 8rem revisados
- [ ] Headings com `clamp()`

### Onda 4 — Sistema (preparar futuro)
- [ ] Adicionar custom properties `--bp-sm/md/lg`
- [ ] Adicionar utility classes: `.stack-mobile`, `.scroll-snap-x`,
      `.truncate`, `.break-words`
- [ ] Criar `docs/responsive.md` (este doc, já criado)
- [ ] Adicionar checklist de PR

---

## 5. Checklist obrigatório para PRs de UI/CSS

Antes de mergear qualquer PR que mexa em CSS ou componentes visuais:

```markdown
- [ ] Testei em viewport 360x800 (Chrome DevTools → "Galaxy S8/S9")
- [ ] Testei em viewport 768x1024 (iPad portrait)
- [ ] Nenhum scroll horizontal indesejado em 360px
- [ ] Textos longos quebram bem (`word-break` / `min-width: 0` em flex)
- [ ] Popovers e modais cabem na viewport (height + width)
- [ ] Toques têm área mínima de 44x44px (acessibilidade mobile)
- [ ] Se adicionei breakpoint, segui o sistema --bp-sm/md/lg
```

---

## 6. Anti-patterns proibidos

Estes padrões devem ser **rejeitados em review**:

| ❌ Anti-pattern | ✅ Alternativa |
|----------------|----------------|
| `width: 12rem` em input em modal/card | `width: 100%; max-width: 12rem` |
| `min-width: 8rem+` em flex item | considerar se mobile cabe |
| `grid-template-columns: 200px 1fr` | usar `minmax(0, 1fr)` ou breakpoint |
| `position: absolute` sem `max-width: calc(100vw - 2rem)` | add o max-width |
| Texto em flex sem `min-width: 0` no pai | sempre adicionar |
| `font-size` fixo > 1.5rem em headings | usar `clamp()` |
| Tabs/nav sem `overflow-x: auto` em mobile | sempre permitir scroll lateral |

---

## 7. Tooling (futuro)

Pra automatizar verificação responsiva:

- **Stylelint custom rule**: detectar `min-width` > 8rem fora de media query
- **Playwright visual regression**: snapshots em 360, 768, 1280
- **PR template**: incluir checklist da seção 5 automaticamente

Não implementar agora — só anotar como próximos passos.
