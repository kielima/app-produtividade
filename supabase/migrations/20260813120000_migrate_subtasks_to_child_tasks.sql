-- Subtarefas embutidas → tarefas-filhas.
--
-- O app tinha dois sistemas paralelos de subtarefa:
--   1. `tasks.subtasks` — lista jsonb embutida ([{text, checked, blockedByPrev}]),
--      herdada do dashboard.html. Já não era renderizada em lugar nenhum: a
--      tela da tarefa passou a mostrar apenas as filhas.
--   2. `tasks.parent_id` — tarefas-filhas de verdade, com id, score, prazo,
--      dependências e página própria.
--
-- Esta migration converte cada item da lista embutida numa tarefa-filha e
-- remove a coluna legada. O front correspondente deixa de ler/escrever
-- `subtasks`, então aplique a migration junto com o deploy.
--
-- Regras da conversão:
--   * `text`          → título (serializado com as tags do app: [#NNNN],
--                       [Modo], [MoSCoW], [Esforço], [prazo: …], (adicionado: …)).
--   * `checked`       → `checked` da filha.
--   * `blockedByPrev` → dependência `#<task_id>` da irmã anterior, igual ao
--                       botão de ligação entre subtarefas na tela da tarefa.
--   * posição na lista → `order` (depois das filhas que a tarefa já tenha).
--   * moscow/modo/esforco/deadline/project_id são copiados do pai, como faz
--     `createChildTask()` ao criar uma filha pelo app.
--
-- `completed_at` fica null mesmo nos itens já marcados: o formato antigo não
-- guardava a data de conclusão, e carimbar `now()` criaria um pico falso nas
-- estatísticas e no gráfico de atividade. O efeito prático é que esses itens
-- entram como concluídos, mas fora da lista "Concluídas" por bucket de data.
--
-- Os novos `task_id` são alocados a partir do maior valor já em uso (contando
-- também os `id` numéricos, que o app deriva do `task_id`), para não colidir
-- nem com a PK nem com o unique (user_id, task_id).

with expanded as (
  select
    t.user_id,
    t.id                                             as parent_id,
    t.project_id,
    t.moscow,
    t.modo,
    t.esforco,
    t.deadline,
    coalesce(nullif(t.added_date, ''), to_char(now(), 'YYYY-MM-DD')) as added_date,
    btrim(item.value ->> 'text')                     as text,
    coalesce((item.value ->> 'checked')::boolean, false)       as checked,
    coalesce((item.value ->> 'blockedByPrev')::boolean, false) as blocked_by_prev,
    (item.ord - 1)::int                              as idx,
    -- Filhas que a tarefa já tem: os itens migrados entram depois delas.
    (
      select count(*)
      from produtividade.tasks c
      where c.parent_id = t.id
    )::int                                           as existing_children
  from produtividade.tasks t
  cross join lateral jsonb_array_elements(t.subtasks) with ordinality as item(value, ord)
  where jsonb_typeof(t.subtasks) = 'array'
    and jsonb_typeof(item.value) = 'object'
    and coalesce(btrim(item.value ->> 'text'), '') <> ''
),
numbered as (
  select
    e.*,
    -- Posição entre os irmãos já filtrados (itens sem texto não entram), para
    -- que `order` fique denso e "a anterior" seja mesmo a irmã anterior.
    (row_number() over (partition by e.user_id, e.parent_id order by e.idx) - 1)::int as sib,
    (
      select greatest(
        coalesce(max(task_id), 0),
        coalesce(max(case when id ~ '^[0-9]+$' then id::bigint end), 0)
      )
      from produtividade.tasks
    ) + row_number() over (order by e.user_id, e.parent_id, e.idx) as new_task_id
  from expanded e
),
tagged as (
  select
    n.*,
    case
      when n.blocked_by_prev and n.sib > 0
        then array['#' || (n.new_task_id - 1)::text]
      else '{}'::text[]
    end as depends_on,
    case lower(coalesce(n.modo, ''))
      when 'delegar' then 'Delegar'
      when 'cowork'  then 'Cowork'
      when 'design'  then 'Design'
      when 'code'    then 'Code'
      when 'chat'    then 'Chat'
      else 'Manual'
    end as modo_tag,
    case lower(coalesce(n.moscow, ''))
      when 'must'   then ' [Must]'
      when 'should' then ' [Should]'
      when 'could'  then ' [Could]'
      when 'wont'   then ' [Won''t]'
      else ''
    end as moscow_tag,
    case lower(coalesce(n.esforco, ''))
      when 'rapido' then ' [Rápido]'
      when 'medio'  then ' [Médio]'
      when 'longo'  then ' [Longo]'
      else ''
    end as esforco_tag,
    case
      when coalesce(n.deadline, '') <> '' then ' [prazo: ' || n.deadline || ']'
      else ''
    end as prazo_tag
  from numbered n
)
insert into produtividade.tasks (
  id, user_id, task_id, title, note, checked, in_progress,
  moscow, modo, esforco, deadline, added_date, depends_on,
  parent_id, "order", project_id, completed_at
)
select
  g.new_task_id::text,
  g.user_id,
  g.new_task_id::int,
  g.text
    || ' [#' || lpad(g.new_task_id::text, 4, '0') || ']'
    || ' [' || g.modo_tag || ']'
    || g.moscow_tag
    || g.esforco_tag
    || g.prazo_tag
    || ' (adicionado: ' || g.added_date || ')'
    || case
         when array_length(g.depends_on, 1) is null then ''
         else ' 🔗 ' || g.depends_on[1]
       end,
  '',
  g.checked,
  false,
  g.moscow,
  g.modo,
  g.esforco,
  g.deadline,
  g.added_date,
  g.depends_on,
  g.parent_id,
  g.existing_children + g.sib,
  g.project_id,
  null
from tagged g;

alter table produtividade.tasks drop column subtasks;
