# Consolidação dos projetos Supabase

Runbook da fusão dos dois projetos Supabase (`app-produtividade` e `wishlist`)
num só. Tarefa #0958.

## Decisões

| Decisão | Escolha | Por quê |
|---|---|---|
| Projeto destino | `app-produtividade` (`robwqxgllzxbxwnjkyic`) | Tem 6.421 linhas contra 149, 7 Edge Functions contra 2, o schema `private` e os secrets do Google OAuth já configurados. Migrar a wishlist para dentro dele move muito menos coisa que o inverso. A org está no plano free (limite de 2 projetos), então um terceiro projeto também não cabia. |
| Colisão de `app_version` | Um schema por app: `produtividade.*` e `wishlist.*` | As duas tabelas não tinham o mesmo formato (`id` int4 vs int2, `atualizado_em` vs `updated_at`, nullability distinta) e cada app tem seu próprio APK e ciclo de release — precisam coexistir como duas linhas. Schema separado resolve sem prefixo de nome, e como o supabase-js aceita schema padrão no `createClient`, nenhum dos 62 call sites de `.from()` precisou mudar. |
| Identidade de auth | Tudo reatribuído a `kly@sapo.pt` | Os projetos tinham usuários diferentes (`kly@sapo.pt` na produtividade, `ttiburcio@outlook.com` na wishlist) e `auth.users` não atravessa projetos. As linhas da wishlist passam a ter `user_id = 66acb2fb-1050-490d-85c1-702e2465399b`. |

## Estado (o que já está aplicado no destino)

- [x] Schema `wishlist` com `items`, `item_ratings`, `app_version` — tipos, defaults, constraints, índices e RLS espelhados da origem
- [x] Grants explícitos (`anon`/`authenticated`/`service_role`) — schema novo não herda os defaults do `public`
- [x] Bucket público `app-builds` + policy `app_builds_public_read`
- [x] Schema `wishlist_staging` (transitório, recebe o COPY antes do remap)
- [ ] Dados da wishlist copiados — **passo manual abaixo**
- [ ] Cutover do app-produtividade para o schema `produtividade` — **só depois da wishlist validada**

Os dois projetos originais seguem **intactos e ativos**. Nada foi dropado,
apagado ou pausado.

## 1. Backup (antes de qualquer coisa)

O plano free não tem backup automático nem download pelo dashboard — tem que
ser manual. Pegue as connection strings em **Dashboard → Connect** de cada
projeto (a senha do banco não fica em lugar nenhum do repo).

```bash
ORIGEM='postgresql://postgres.jwmuwogwutiiuvewhkku:SENHA@HOST:5432/postgres'
DESTINO='postgresql://postgres.robwqxgllzxbxwnjkyic:SENHA@HOST:5432/postgres'

# Backup completo dos dois, incluindo auth.users — pg_dump, não `supabase db
# dump` (o do CLI não traz os schemas gerenciados por padrão)
pg_dump "$DESTINO" -Fc --schema=public --schema=private --schema=auth --schema=storage \
  -f produtividade_$(date +%F).dump
pg_dump "$ORIGEM"  -Fc --schema=public --schema=auth --schema=storage \
  -f wishlist_$(date +%F).dump

# Storage da wishlist (bucket público, dá para baixar direto)
curl -L -o wishlist.apk \
  "https://jwmuwogwutiiuvewhkku.supabase.co/storage/v1/object/public/app-builds/wishlist.apk"

ls -lh *.dump wishlist.apk   # confira que não estão vazios
```

## 2. Copiar os dados da wishlist

Precisa da senha do banco, então roda daqui (o Claude não tem essa credencial).

```bash
# Dump só dos dados das 3 tabelas
pg_dump "$ORIGEM" --data-only --no-owner --no-privileges \
  -t public.items -t public.item_ratings -t public.app_version \
  -f wishlist_data.sql

# Redireciona a carga para o staging. O `^COPY public.` casa só o cabeçalho da
# instrução, nunca conteúdo dentro dos dados (as fotos em base64 e as URLs).
sed -i 's/^COPY public\./COPY wishlist_staging./' wishlist_data.sql
grep -c '^COPY wishlist_staging\.' wishlist_data.sql   # deve imprimir 3

# Carrega no destino
psql "$DESTINO" -v ON_ERROR_STOP=1 -f wishlist_data.sql
```

O staging existe porque as linhas vêm com o `user_id` original
(`e6f806ae-…`), que não existe no `auth.users` do destino — a FK recusaria a
carga direta. O remap para `kly@sapo.pt` acontece no `INSERT..SELECT` para as
tabelas definitivas, que o Claude roda em seguida junto da validação.

### APK no Storage

```bash
curl -X POST \
  "https://robwqxgllzxbxwnjkyic.supabase.co/storage/v1/object/app-builds/wishlist.apk" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY_DESTINO" \
  -H "Content-Type: application/vnd.android.package-archive" \
  --data-binary @wishlist.apk
```

O próximo build de CI regrava esse objeto e a linha `app_version` de qualquer
forma; a cópia serve para o verificador de atualização não ficar apontando para
o projeto antigo no intervalo.

## 3. Configuração que só dá para fazer pelo dashboard

**Project Settings → API → Exposed schemas** do projeto destino: adicione
`wishlist` (e `produtividade`, quando fizer o cutover). Sem isso o PostgREST
recusa todas as consultas dos apps. Essa é a única peça da consolidação que não
fica versionada nas migrations — se for resetada, os dois apps param.

**Authentication → URL Configuration:** acrescente as URLs da wishlist
(`https://kielima.github.io/wishlist/` e `http://localhost:5173/`) às Redirect
URLs do projeto destino.

## 4. Variáveis de CI (nos dois repos)

| Repo | Onde | O que muda |
|---|---|---|
| `wishlist` | Actions → Variables → `VITE_SUPABASE_URL` | `https://robwqxgllzxbxwnjkyic.supabase.co` |
| `wishlist` | Actions → Variables → `VITE_SUPABASE_ANON_KEY` | anon key do projeto destino |
| `wishlist` | Actions → Secrets → `SUPABASE_SERVICE_ROLE_KEY` | service_role key do destino |
| `app-produtividade` | — | A URL não muda (é o mesmo projeto). Nada a fazer. |

## 5. Cutover do app-produtividade

**Só depois da wishlist validada e testada.** A migration
`20260812120000_move_public_to_produtividade_schema.sql` move as 9 tabelas de
`public` para `produtividade` com `ALTER TABLE ... SET SCHEMA`, que preserva
dados, FKs, índices, RLS e a inscrição no realtime — nada é recriado.

Migration e deploy precisam sair juntos: enquanto o build publicado apontar
para `public`, ele não enxerga as tabelas. Aplique a migration e rode o deploy
em seguida; uma aba já aberta precisa de reload.

Se em algum momento a simetria não compensar o cutover, dá para parar aqui: a
colisão de `app_version` já está resolvida pelo schema `wishlist`, e o
app-produtividade pode continuar no `public` indefinidamente. Nesse caso reverta
as mudanças de schema no código deste repo e descarte a migration.

## 6. Desativar os projetos antigos

**Não fazer até os dois apps estarem testados e confirmados contra o projeto
consolidado.** Depois disso, e só com confirmação explícita:

- `wishlist` (`jwmuwogwutiiuvewhkku`) — pausar primeiro, apagar só depois de um
  período de segurança com os backups guardados
- `wishlist_staging` no destino — dropar quando a validação estiver fechada
