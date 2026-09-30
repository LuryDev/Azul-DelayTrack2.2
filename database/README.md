# Banco de dados: Definição de Motivos de Atrasos

## Como instalar no Supabase

1. Crie uma conta em https://supabase.com e clique em **New project** (plano gratuito).
2. No menu lateral, abra **SQL Editor** → **New query**.
3. Cole todo o conteúdo de `01_schema.sql` e clique em **Run**.
4. Abra outra query, cole `02_dados_exemplo.sql` e clique em **Run**.
5. Em **Table Editor** você já verá as tabelas preenchidas.
6. Em **Project Settings → API**, anote a **Project URL** e a **anon public key**. O site vai usar essas duas.

O `01_schema.sql` apaga e recria tudo, então pode ser rodado de novo sempre que quiser "zerar" o banco (rode o `02` em seguida).

## O que tem no banco

| Objeto | Para que serve |
|---|---|
| `aeronave`, `voo`, `motivo` | Cadastros básicos |
| `atraso` | Cada atraso: `ORIGINADOR` (causa nova) ou `CONSEQUENTE` (herdado, com `atraso_pai_id`) |
| `parecer` | A visão de cada área (CCO, piloto, manutenção) sobre um atraso |
| `configuracao` | Tempo mínimo de solo (30 min) usado no cálculo da folga |
| `registrar_atraso()` | Registro rápido; dispara a propagação automática |
| `propagar_atrasos()` | Recalcula a cadeia de voos da aeronave no dia |
| `registrar_parecer()` / `validar_atraso()` | Etapa de análise e causa oficial |
| `remover_atraso()` | Desfaz um registro feito por engano |
| `cadeia_atraso(id)` | Árvore completa a partir de uma causa raiz (CTE recursiva) |
| `vw_atraso_detalhado` | Cada atraso com sintoma **e** causa raiz |
| `vw_voo_resumo` | Atraso total, herdado e novo por voo |
| `vw_minutos_por_sintoma` | Relatório "do jeito antigo" |
| `vw_minutos_por_causa_raiz` | Relatório com a solução |

## Regra de propagação

Para cada voo da aeronave, em ordem de horário:

```
folga    = (partida prevista - chegada prevista do voo anterior) - tempo mínimo de solo
herdado  = atraso do voo anterior - folga   (nunca negativo)
```

Os minutos herdados viram atrasos `CONSEQUENTE` ligados aos atrasos do voo anterior.
Se o voo também teve um problema próprio, ele entra como um novo `ORIGINADOR`.

## Chamando do JavaScript

```js
const supabase = window.supabase.createClient(URL, ANON_KEY);

// ler voos
const { data } = await supabase.from('vw_voo_resumo').select('*');

// registrar atraso (propaga sozinho)
await supabase.rpc('registrar_atraso', {
  p_voo_id: 1, p_motivo: '41', p_minutos: 55, p_observacao: 'Pane no freio'
});

// árvore da causa raiz
const { data: arvore } = await supabase.rpc('cadeia_atraso', { p_raiz_id: 1 });
```

Segurança: a chave pública só consegue **ler** as tabelas. Qualquer alteração passa pelas funções, que aplicam as regras de negócio.
