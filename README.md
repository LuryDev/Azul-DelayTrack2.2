# DelayTrack · Definição de Motivos de Atrasos

Sistema web que distingue o **motivo originador** de um atraso de voo dos **motivos consequentes**, propagando e herdando automaticamente a causa raiz ao longo da cadeia de voos impactados.

Projeto do **Tema 1 – Definição de Motivos de Atrasos** (ETEC Praia Grande), apresentado para a companhia fictícia **Alçar Linhas Aéreas**.

## O problema

Quando um voo atrasa, os voos seguintes da mesma aeronave também atrasam, mas cada um recebe um motivo isolado ("chegada tardia da aeronave"). Os relatórios passam a mostrar o **sintoma** e não a **origem** do problema.

## A solução

- **Originador × consequente:** cada atraso herdado aponta para o atraso que o causou (`atraso_pai_id`).
- **Propagação automática:** ao registrar um atraso, o sistema recalcula os voos seguintes da aeronave, descontando a folga no solo.
- **Divisão de minutos:** um voo pode ter parte do atraso herdada e parte nova.
- **Registro rápido, validação depois:** o aeroporto registra na hora; CCO, piloto e manutenção dão pareceres; a causa oficial é definida na análise.
- **Relatórios por causa raiz:** comparação lado a lado com o relatório por sintoma.

## Páginas

| Página | Quem usa | Como entra |
|---|---|---|
| `index.html` | Todos | Tela de login, com uma aba para passageiro e outra para funcionário |
| `operacao.html` | Funcionários da companhia | Código de identificação + senha |
| `passageiro.html` | Passageiros | E-mail + senha (o passageiro pode criar a própria conta) |

**Operação** (funcionários): painel dos voos por aeronave, registro rápido de atraso com propagação automática, árvore da cadeia, análise com pareceres das áreas e relatórios por sintoma × causa raiz. Cada atraso e parecer fica registrado com o nome de quem o lançou.

**Passageiro**: mostra apenas os voos que ele acompanha, com o novo horário e o motivo do atraso em linguagem simples. Por exemplo: *"O avião deste voo chega de um voo anterior que atrasou por manutenção na aeronave."* Para acompanhar outro voo, basta digitar o número.

### Simulação do dia

O sistema tem um **relógio simulado**, que começa às **06:00 do dia 05/10/2026**. No topo da página da operação:

| Botão | O que faz |
|---|---|
| ▶ Reproduzir | O horário anda sozinho, 5 minutos a cada 1,5 segundo, até as 15:00 |
| +15 min / +1 h | Avança o horário |
| ↺ | Volta o dia para 06:00 e apaga os atrasos |

Os problemas do dia estão programados e acontecem no horário deles, e a propagação para os voos seguintes é automática:

| Horário | O que acontece |
|---|---|
| 06:15 | Nevoeiro em CGH atrasa o AD2200 em 30 min |
| 06:40 | Pane nos freios atrasa o AD4100 em 55 min e se espalha por 3 voos |
| 07:30 a 08:30 | CCO, piloto e manutenção dão pareceres diferentes sobre a pane |
| 08:45 | Comandante atrasado: AD3301 atrasa 25 min |
| 09:00 | A causa oficial da pane é validada |
| 10:10 | Restrição de tráfego aéreo: AD3302 atrasa 15 min |
| 10:45 | Esteira parada em CNF: mais 10 min no AD4102 |

Os voos também mudam de fase conforme o horário: Programado, Embarque, Em voo e Pousou. A página do passageiro segue o mesmo relógio e se atualiza sozinha a cada 10 segundos. Dá para deixá-la aberta em outra aba enquanto o horário anda na operação.

### Contas de demonstração

| Tipo | Login | Senha |
|---|---|---|
| Funcionária do CCO | `AL-1001` | `alcar2026` |
| Funcionário do aeroporto | `AL-2002` | `alcar2026` |
| Funcionária da manutenção | `AL-3003` | `alcar2026` |
| Passageira | `ana@exemplo.com` | `senha123` |

### Segurança

- As senhas são guardadas com hash bcrypt (extensão `pgcrypto`), nunca em texto.
- O login gera um token de sessão: 12 horas para funcionários e 30 dias para passageiros.
- As tabelas de contas e sessões não podem ser lidas pela chave pública.
- As ações da operação (`op_*`) conferem se o token é de um funcionário; o passageiro só enxerga os próprios voos.

## Tecnologias

- HTML, CSS e JavaScript puro
- [Supabase](https://supabase.com) (PostgreSQL): funções PL/pgSQL e CTE recursiva
- Hospedagem gratuita: GitHub Pages

## Como rodar

1. **Banco:** siga o passo a passo em [`database/README.md`](database/README.md).
2. **Configuração:** abra `config.js` e cole a *Project URL* e a *anon public key* do Supabase.
3. **Teste local:** abra a pasta no VS Code e use a extensão *Live Server* (ou qualquer servidor estático). A primeira página é a de login.

## Publicar no GitHub Pages

1. Crie um repositório no GitHub e envie os arquivos desta pasta.
2. No repositório: **Settings → Pages → Branch: `main` / pasta `/ (root)` → Save**.
3. Em cerca de 1 minuto o site fica disponível em `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

A chave *anon* pode ficar no código: ela só permite leitura, e as alterações passam pelas funções do banco, que aplicam as regras de negócio.

## Estrutura

```
├── index.html          Login (passageiro e funcionário)
├── login.js
├── operacao.html       Área da operação (funcionários)
├── app.js
├── style.css
├── passageiro.html     Área do passageiro
├── passageiro.js
├── publico.css         Visual do login e da área do passageiro
├── sessao.js           Conexão com o Supabase, login e logo
├── config.js           URL e chave do Supabase
└── database/
    ├── 01_schema.sql         Tabelas, funções, contas, views e segurança
    ├── 02_dados_exemplo.sql  Um dia de operação e as contas de demonstração
    └── README.md             Instalação do banco
```
