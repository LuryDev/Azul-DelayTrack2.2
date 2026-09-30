// =====================================================================
//  Causa Raiz · Definição de Motivos de Atrasos
//  Front-end em JavaScript puro conectado ao Supabase
// =====================================================================

const configurado = typeof SUPABASE_URL === 'string' && SUPABASE_URL.startsWith('http');
const db = configurado ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const AREAS = ['CCO', 'Piloto', 'Manutenção', 'Aeroporto', 'Tráfego aéreo', 'Tripulação'];

const estado = {
  data: null,        // dia selecionado (AAAA-MM-DD)
  motivos: [],
  aeronaves: [],
  voos: [],          // vw_voo_resumo
  atrasos: [],       // vw_atraso_detalhado
  pareceres: [],
  vooSelecionado: null,
  analiseSelecionada: null,
  raizSelecionada: null,
};

// ---------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const hora = (ts) => (ts ? ts.slice(11, 16) : '');
const dataBR = (d) => d.split('-').reverse().join('/');
const min = (n) => `${n} min`;

function diaSeguinte(d) {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}

function motivo(codigo) {
  return estado.motivos.find((m) => m.codigo === codigo) || { codigo, descricao: codigo };
}

let timerToast;
function toast(msg, erro = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (erro ? ' erro' : '');
  t.hidden = false;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => (t.hidden = true), 4000);
}

async function consulta(promessa) {
  const { data, error } = await promessa;
  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------------
// Carregamento de dados
// ---------------------------------------------------------------------
async function iniciar() {
  configurarAbas();
  if (!configurado) {
    $('aviso-config').hidden = false;
    return;
  }

  try {
    const [motivos, aeronaves, datasVoo] = await Promise.all([
      consulta(db.from('motivo').select('*').order('codigo')),
      consulta(db.from('aeronave').select('*').order('matricula')),
      consulta(db.from('voo').select('partida_prevista').order('partida_prevista')),
    ]);
    estado.motivos = motivos;
    estado.aeronaves = aeronaves;

    const datas = [...new Set(datasVoo.map((v) => v.partida_prevista.slice(0, 10)))];
    $('data').innerHTML = datas.map((d) => `<option value="${d}">${dataBR(d)}</option>`).join('');
    estado.data = datas[datas.length - 1] || null;
    $('data').value = estado.data;
    $('data').addEventListener('change', (e) => {
      estado.data = e.target.value;
      estado.vooSelecionado = null;
      estado.analiseSelecionada = null;
      estado.raizSelecionada = null;
      recarregar();
    });

    preencherMotivos();
    configurarFormularios();
    await recarregar();
  } catch (e) {
    toast('Erro ao conectar no Supabase: ' + e.message, true);
  }
}

async function recarregar() {
  if (!estado.data) return;
  const inicio = estado.data;
  const fim = diaSeguinte(estado.data);

  const [voos, atrasos] = await Promise.all([
    consulta(db.from('vw_voo_resumo').select('*')
      .gte('partida_prevista', inicio).lt('partida_prevista', fim)
      .order('partida_prevista')),
    consulta(db.from('vw_atraso_detalhado').select('*')
      .gte('partida_prevista', inicio).lt('partida_prevista', fim)
      .order('partida_prevista').order('id')),
  ]);
  estado.voos = voos;
  estado.atrasos = atrasos;

  const ids = atrasos.map((a) => a.id);
  estado.pareceres = ids.length
    ? await consulta(db.from('parecer').select('*').in('atraso_id', ids).order('criado_em'))
    : [];

  renderPainel();
  renderRegistrar();
  await renderCadeia();
  renderAnalise();
  await renderRelatorios();
}

// ---------------------------------------------------------------------
// Abas
// ---------------------------------------------------------------------
function configurarAbas() {
  document.querySelectorAll('.aba').forEach((botao) => {
    botao.addEventListener('click', () => abrirAba(botao.dataset.aba));
  });
}

function abrirAba(nome) {
  document.querySelectorAll('.aba').forEach((b) => b.classList.toggle('ativa', b.dataset.aba === nome));
  document.querySelectorAll('.tela').forEach((t) => t.classList.toggle('ativa', t.id === nome));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------------------------------------------------------------
// PAINEL
// ---------------------------------------------------------------------
function renderPainel() {
  const voos = estado.voos;
  const atrasados = voos.filter((v) => v.atraso_total > 0).length;
  const total = voos.reduce((s, v) => s + v.atraso_total, 0);
  const herdado = voos.reduce((s, v) => s + v.atraso_herdado, 0);
  const pct = total ? Math.round((herdado / total) * 100) : 0;
  const causas = estado.atrasos.filter((a) => a.tipo === 'ORIGINADOR').length;

  $('kpis').innerHTML = `
    <div class="kpi"><span>Voos no dia</span><strong>${voos.length}</strong><small>${estado.aeronaves.length} aeronaves</small></div>
    <div class="kpi"><span>Voos atrasados</span><strong>${atrasados}</strong><small>originados por ${causas} evento(s)</small></div>
    <div class="kpi"><span>Minutos de atraso</span><strong>${total}</strong><small>somando todos os voos</small></div>
    <div class="kpi"><span>Atraso herdado</span><strong>${pct}%</strong><small>${herdado} min vieram de voos anteriores</small></div>`;

  const porAeronave = {};
  voos.forEach((v) => (porAeronave[v.matricula] ||= []).push(v));

  $('linhas-aeronaves').innerHTML = Object.keys(porAeronave).length
    ? Object.entries(porAeronave).map(([matricula, lista]) => {
        const aeronave = estado.aeronaves.find((a) => a.matricula === matricula);
        const cartoes = lista.map((v) => cartaoVoo(v)).join('<span class="seta">›</span>');
        return `
          <div class="linha-aeronave">
            <div class="aeronave-nome"><strong>${esc(matricula)}</strong><small>${esc(aeronave?.modelo)}</small></div>
            <div class="voos">${cartoes}</div>
          </div>`;
      }).join('')
    : '<div class="vazio">Nenhum voo cadastrado neste dia.</div>';

  document.querySelectorAll('.voo').forEach((el) => {
    el.addEventListener('click', () => {
      estado.vooSelecionado = Number(el.dataset.id);
      renderPainel();
      $('detalhe-voo').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  renderDetalheVoo();
}

function cartaoVoo(v) {
  const classes = ['voo'];
  if (v.atraso_total > 0) classes.push('atrasado');
  if (v.atraso_novo > 0) classes.push('tem-novo');
  if (v.id === estado.vooSelecionado) classes.push('selecionado');

  const barra = v.atraso_total > 0
    ? `<div class="barra-atraso">
         <div class="h" style="width:${(v.atraso_herdado / v.atraso_total) * 100}%"></div>
         <div class="n" style="width:${(v.atraso_novo / v.atraso_total) * 100}%"></div>
       </div>`
    : '';

  return `
    <button class="${classes.join(' ')}" data-id="${v.id}">
      <div class="voo-numero">${esc(v.numero)}</div>
      <div class="voo-rota">${esc(v.origem)} → ${esc(v.destino)}</div>
      <div class="voo-hora">${hora(v.partida_prevista)}${v.atraso_total ? ` → ${hora(v.partida_estimada)}` : ''}</div>
      <div class="voo-atraso ${v.atraso_total ? '' : 'ok'}">${v.atraso_total ? `+${min(v.atraso_total)}` : 'No horário'}</div>
      ${barra}
    </button>`;
}

function renderDetalheVoo() {
  const painel = $('detalhe-voo');
  const v = estado.voos.find((x) => x.id === estado.vooSelecionado);
  if (!v) { painel.hidden = true; return; }

  const atrasos = estado.atrasos.filter((a) => a.voo_id === v.id);
  painel.hidden = false;
  painel.innerHTML = `
    <div class="cartao-topo">
      <h2>${esc(v.numero)} · ${esc(v.origem)} → ${esc(v.destino)} · ${hora(v.partida_prevista)}</h2>
      <span class="etiqueta">${esc(v.matricula)}</span>
    </div>
    ${atrasos.length ? atrasos.map((a) => itemAtraso(a)).join('') : '<div class="vazio">Voo sem atrasos.</div>'}`;
  ligarBotoesCadeia(painel);
}

function itemAtraso(a) {
  const raiz = estado.atrasos.find((x) => x.id === a.raiz_id);
  const origem = a.tipo === 'CONSEQUENTE'
    ? `<small><span class="raiz-seta">↳</span> Causa raiz: <b>${esc(a.causa_raiz_descricao)}</b>
         (${esc(raiz?.voo_numero ?? 'outro voo')}, ${a.profundidade} voo(s) antes)</small>`
    : `<small>${esc(a.observacao || 'Sem observação')}</small>`;

  return `
    <div class="item-atraso">
      <div class="min">+${a.minutos}</div>
      <div class="desc">
        <span class="etiqueta ${a.tipo.toLowerCase()}">${a.tipo === 'ORIGINADOR' ? 'Originador' : 'Consequente'}</span>
        ${esc(a.sintoma_codigo)} · ${esc(a.sintoma_descricao)}
        ${origem}
      </div>
      <button class="link" data-raiz="${a.raiz_id}">Ver cadeia</button>
    </div>`;
}

function ligarBotoesCadeia(container) {
  container.querySelectorAll('[data-raiz]').forEach((b) => {
    b.addEventListener('click', async () => {
      estado.raizSelecionada = Number(b.dataset.raiz);
      await renderCadeia();
      abrirAba('cadeia');
    });
  });
}

// ---------------------------------------------------------------------
// REGISTRAR
// ---------------------------------------------------------------------
function preencherMotivos() {
  const opcoes = estado.motivos
    .filter((m) => !m.reativo)
    .map((m) => `<option value="${esc(m.codigo)}">${esc(m.codigo)} · ${esc(m.descricao)}</option>`)
    .join('');
  $('f-motivo').innerHTML = '<option value="">Selecione...</option>' + opcoes;
}

function renderRegistrar() {
  const porAeronave = {};
  estado.voos.forEach((v) => (porAeronave[v.matricula] ||= []).push(v));
  const atual = $('f-voo').value;
  $('f-voo').innerHTML = '<option value="">Selecione...</option>' +
    Object.entries(porAeronave).map(([mat, lista]) => `
      <optgroup label="${esc(mat)}">
        ${lista.map((v) => `<option value="${v.id}">${esc(v.numero)} · ${esc(v.origem)}→${esc(v.destino)} · ${hora(v.partida_prevista)}</option>`).join('')}
      </optgroup>`).join('');
  if (atual) $('f-voo').value = atual;

  const originadores = estado.atrasos.filter((a) => a.tipo === 'ORIGINADOR');
  $('lista-originadores').innerHTML = originadores.length
    ? originadores.map((a) => {
        const impactados = estado.atrasos.filter((x) => x.raiz_id === a.id && x.id !== a.id);
        const minutosCadeia = impactados.reduce((s, x) => s + x.minutos, 0);
        return `
          <div class="item-atraso">
            <div class="min">+${a.minutos}</div>
            <div class="desc">
              <b>${esc(a.voo_numero)}</b> · ${esc(a.sintoma_codigo)} · ${esc(a.sintoma_descricao)}
              <span class="etiqueta ${a.status.toLowerCase()}">${a.status === 'VALIDADO' ? 'Validado' : 'Provisório'}</span>
              <small>${impactados.length
                ? `Propagou +${minutosCadeia} min para ${new Set(impactados.map((x) => x.voo_id)).size} voo(s) seguinte(s)`
                : 'Absorvido pela folga, sem impacto nos próximos voos'}</small>
            </div>
            <div>
              <button class="link" data-raiz="${a.id}">Ver cadeia</button>
              <button class="botao perigo" data-remover="${a.id}">Remover</button>
            </div>
          </div>`;
      }).join('')
    : '<div class="vazio">Nenhum atraso registrado neste dia.</div>';

  ligarBotoesCadeia($('lista-originadores'));
  $('lista-originadores').querySelectorAll('[data-remover]').forEach((b) => {
    b.addEventListener('click', () => removerAtraso(Number(b.dataset.remover)));
  });
}

function configurarFormularios() {
  $('form-atraso').addEventListener('submit', async (e) => {
    e.preventDefault();
    const botao = e.target.querySelector('button[type=submit]');
    botao.disabled = true;
    try {
      const id = await consulta(db.rpc('registrar_atraso', {
        p_voo_id: Number($('f-voo').value),
        p_motivo: $('f-motivo').value,
        p_minutos: Number($('f-minutos').value),
        p_observacao: $('f-obs').value.trim() || null,
      }));
      await recarregar();
      const linhas = await consulta(db.rpc('cadeia_atraso', { p_raiz_id: id }));
      const impactados = new Set(linhas.filter((l) => l.nivel > 0).map((l) => l.voo_id)).size;
      $('impacto').className = '';
      $('impacto').innerHTML = `
        <p class="ajuda">${impactados
          ? `O atraso se propagou para <b>${impactados} voo(s)</b> seguinte(s), todos vinculados a esta causa raiz.`
          : 'A folga no solo absorveu o atraso: nenhum voo seguinte foi impactado.'}</p>
        ${arvoreHTML(linhas)}`;
      e.target.reset();
      toast('Atraso registrado e propagado.');
    } catch (err) {
      toast(err.message, true);
    } finally {
      botao.disabled = false;
    }
  });
}

async function removerAtraso(id) {
  if (!confirm('Remover este atraso? Os voos seguintes serão recalculados.')) return;
  try {
    await consulta(db.rpc('remover_atraso', { p_atraso_id: id }));
    if (estado.raizSelecionada === id) estado.raizSelecionada = null;
    if (estado.analiseSelecionada === id) estado.analiseSelecionada = null;
    await recarregar();
    toast('Atraso removido e cadeia recalculada.');
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------------------------------------------------------------------
// CADEIA
// ---------------------------------------------------------------------
async function renderCadeia() {
  const originadores = estado.atrasos.filter((a) => a.tipo === 'ORIGINADOR');
  const seletor = $('c-raiz');

  if (!originadores.length) {
    seletor.innerHTML = '';
    $('resumo-cadeia').innerHTML = '';
    $('arvore').innerHTML = '<div class="vazio">Nenhum atraso originador neste dia.</div>';
    return;
  }

  if (!originadores.some((a) => a.id === estado.raizSelecionada)) {
    // começa pela causa que mais gerou atraso
    const total = (a) => estado.atrasos.filter((x) => x.raiz_id === a.id).reduce((s, x) => s + x.minutos, 0);
    estado.raizSelecionada = [...originadores].sort((a, b) => total(b) - total(a))[0].id;
  }

  seletor.innerHTML = originadores.map((a) =>
    `<option value="${a.id}">${esc(a.voo_numero)} · ${esc(a.sintoma_descricao)} · ${a.minutos} min</option>`).join('');
  seletor.value = estado.raizSelecionada;
  seletor.onchange = async () => {
    estado.raizSelecionada = Number(seletor.value);
    await renderCadeia();
  };

  const linhas = await consulta(db.rpc('cadeia_atraso', { p_raiz_id: estado.raizSelecionada }));
  const raiz = linhas[0];
  const totalMin = linhas.reduce((s, l) => s + l.minutos, 0);
  const voos = new Set(linhas.map((l) => l.voo_id)).size;
  const niveis = Math.max(...linhas.map((l) => l.nivel));

  $('resumo-cadeia').innerHTML = `
    <div>Causa raiz<strong>${esc(raiz.motivo_codigo)} · ${esc(raiz.motivo_descricao)}</strong></div>
    <div>Atraso original<strong>${min(raiz.minutos)}</strong></div>
    <div>Total na cadeia<strong>${min(totalMin)}</strong></div>
    <div>Voos afetados<strong>${voos}</strong></div>
    <div>Níveis de propagação<strong>${niveis}</strong></div>`;
  $('arvore').innerHTML = arvoreHTML(linhas);
}

// Monta a árvore a partir das linhas da função cadeia_atraso()
function arvoreHTML(linhas) {
  if (!linhas.length) return '';
  const filhos = {};
  linhas.forEach((l) => (filhos[l.atraso_pai_id] ||= []).push(l));

  const no = (l) => {
    const tipo = l.nivel === 0 ? 'originador' : 'consequente';
    const sub = filhos[l.atraso_id] || [];
    return `
      <li>
        <div class="no ${tipo}">
          <div class="min">+${l.minutos}</div>
          <div class="titulo">${esc(l.voo_numero)} · ${esc(l.origem)} → ${esc(l.destino)} · ${hora(l.partida_prevista)}</div>
          <div class="sub">${l.nivel === 0
            ? `Causa raiz: ${esc(l.motivo_codigo)} · ${esc(l.motivo_descricao)}`
            : `Herdado do voo anterior (nível ${l.nivel})`}</div>
        </div>
        ${sub.length ? `<ul>${sub.map(no).join('')}</ul>` : ''}
      </li>`;
  };

  return `<ul class="arvore">${no(linhas[0])}</ul>`;
}

// ---------------------------------------------------------------------
// ANÁLISE
// ---------------------------------------------------------------------
function renderAnalise() {
  const originadores = estado.atrasos
    .filter((a) => a.tipo === 'ORIGINADOR')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'PROVISORIO' ? -1 : 1));

  $('lista-analise').innerHTML = originadores.length
    ? originadores.map((a) => {
        const qtd = estado.pareceres.filter((p) => p.atraso_id === a.id).length;
        return `
          <button class="item-analise ${a.id === estado.analiseSelecionada ? 'selecionado' : ''}" data-id="${a.id}">
            <div class="linha1">
              <span>${esc(a.voo_numero)} · +${a.minutos} min</span>
              <span class="etiqueta ${a.status.toLowerCase()}">${a.status === 'VALIDADO' ? 'Validado' : 'Provisório'}</span>
            </div>
            <small>${esc(a.sintoma_descricao)} · ${qtd} parecer(es)</small>
          </button>`;
      }).join('')
    : '<div class="vazio">Nada para analisar neste dia.</div>';

  $('lista-analise').querySelectorAll('.item-analise').forEach((b) => {
    b.addEventListener('click', () => {
      estado.analiseSelecionada = Number(b.dataset.id);
      renderAnalise();
    });
  });

  renderPainelAnalise();
}

function renderPainelAnalise() {
  const alvo = $('painel-analise');
  const a = estado.atrasos.find((x) => x.id === estado.analiseSelecionada);
  if (!a) {
    alvo.innerHTML = '<div class="vazio">Selecione um atraso para ver os pareceres das áreas.</div>';
    return;
  }

  const pareceres = estado.pareceres.filter((p) => p.atraso_id === a.id);
  const votos = {};
  pareceres.forEach((p) => (votos[p.motivo_codigo] = (votos[p.motivo_codigo] || 0) + 1));
  const maioria = Object.entries(votos).sort((x, y) => y[1] - x[1])[0]?.[0];
  const consequentes = estado.atrasos.filter((x) => x.raiz_id === a.id && x.id !== a.id).length;

  const opcoesMotivo = (selecionado) => estado.motivos.map((m) =>
    `<option value="${esc(m.codigo)}" ${m.codigo === selecionado ? 'selected' : ''}>${esc(m.codigo)} · ${esc(m.descricao)}</option>`).join('');

  alvo.innerHTML = `
    <div class="cartao-topo">
      <h2>${esc(a.voo_numero)} · ${esc(a.origem)} → ${esc(a.destino)} · +${a.minutos} min</h2>
      <span class="etiqueta ${a.status.toLowerCase()}">${a.status === 'VALIDADO' ? 'Validado' : 'Provisório'}</span>
    </div>
    <p class="ajuda">Registrado como <b>${esc(a.sintoma_codigo)} · ${esc(a.sintoma_descricao)}</b>${a.observacao ? ` — “${esc(a.observacao)}”` : ''}</p>

    <h3>Visão de cada área</h3>
    ${pareceres.length
      ? `<div class="pareceres">${pareceres.map((p) => `
          <div class="parecer ${p.motivo_codigo === maioria && pareceres.length > 1 ? 'maioria' : ''}">
            <div class="area">${esc(p.area)}</div>
            <div class="motivo">${esc(p.motivo_codigo)} · ${esc(motivo(p.motivo_codigo).descricao)}</div>
            <small>${esc(p.justificativa || '')}</small>
          </div>`).join('')}</div>`
      : '<div class="vazio" style="margin:12px 0 20px">Nenhuma área deu parecer ainda.</div>'}

    <form class="bloco" id="form-parecer">
      <h3>Adicionar parecer</h3>
      <div class="linha-form">
        <label>Área
          <select id="p-area">${AREAS.map((x) => `<option>${esc(x)}</option>`).join('')}</select>
        </label>
        <label>Motivo na visão da área
          <select id="p-motivo">${opcoesMotivo(a.sintoma_codigo)}</select>
        </label>
      </div>
      <label>Justificativa
        <input id="p-just" placeholder="Por que esta área entende assim?">
      </label>
      <button class="botao secundario" type="submit">Salvar parecer</button>
    </form>

    <form class="bloco" id="form-validar">
      <h3>Causa oficial</h3>
      <p class="ajuda">Ao validar, os ${consequentes} atraso(s) consequente(s) desta cadeia herdam a causa automaticamente, sem reclassificação manual.</p>
      <div class="acoes">
        <label>Motivo final
          <select id="v-motivo">${opcoesMotivo(maioria || a.sintoma_codigo)}</select>
        </label>
        <button class="botao" type="submit">${a.status === 'VALIDADO' ? 'Atualizar causa oficial' : 'Validar causa'}</button>
      </div>
    </form>`;

  $('form-parecer').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await consulta(db.rpc('registrar_parecer', {
        p_atraso_id: a.id,
        p_area: $('p-area').value,
        p_motivo: $('p-motivo').value,
        p_justificativa: $('p-just').value.trim() || null,
      }));
      await recarregar();
      toast('Parecer registrado.');
    } catch (err) { toast(err.message, true); }
  });

  $('form-validar').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await consulta(db.rpc('validar_atraso', { p_atraso_id: a.id, p_motivo_final: $('v-motivo').value }));
      await recarregar();
      toast('Causa oficial definida. A cadeia foi atualizada.');
    } catch (err) { toast(err.message, true); }
  });
}

// ---------------------------------------------------------------------
// RELATÓRIOS
// ---------------------------------------------------------------------
async function renderRelatorios() {
  const [sintoma, raiz] = await Promise.all([
    consulta(db.from('vw_minutos_por_sintoma').select('*').eq('data', estado.data).order('minutos', { ascending: false })),
    consulta(db.from('vw_minutos_por_causa_raiz').select('*').eq('data', estado.data).order('minutos', { ascending: false })),
  ]);

  const maximo = Math.max(1, ...sintoma.map((s) => s.minutos), ...raiz.map((r) => r.minutos));
  const barras = (lista, classe) => lista.length
    ? lista.map((item) => `
        <div class="barra-linha">
          <div class="barra-rotulo"><span>${esc(item.codigo)} · ${esc(item.descricao)}</span><span>${item.minutos} min</span></div>
          <div class="barra-fundo"><div class="barra-valor ${classe(item)}" style="width:${(item.minutos / maximo) * 100}%"></div></div>
        </div>`).join('')
    : '<div class="vazio">Sem atrasos neste dia.</div>';

  $('graf-sintoma').innerHTML = barras(sintoma, (i) => (motivo(i.codigo).reativo ? 'reativo' : 'cinza'));
  $('graf-raiz').innerHTML = barras(raiz, () => '');

  const total = raiz.reduce((s, r) => s + r.minutos, 0);
  const reativo = sintoma.find((s) => motivo(s.codigo).reativo);
  if (total && raiz.length) {
    const top = raiz[0];
    const pctTop = Math.round((top.minutos / total) * 100);
    $('insight').innerHTML = reativo
      ? `Pelo sintoma, <b>${reativo.minutos} de ${total} min</b> (${Math.round((reativo.minutos / total) * 100)}%) aparecem apenas como
         “chegada tardia da aeronave”, um motivo que não diz onde está o problema.
         Pela causa raiz, o maior ofensor do dia é <b>${esc(top.descricao)}</b>, responsável por <b>${top.minutos} min (${pctTop}%)</b>.`
      : `Todos os atrasos do dia são originadores. O maior ofensor é <b>${esc(top.descricao)}</b> com <b>${top.minutos} min</b>.`;
    $('insight').hidden = false;
  } else {
    $('insight').hidden = true;
  }

  const areas = {};
  raiz.forEach((r) => {
    areas[r.area] ||= { minutos: 0, ocorrencias: 0 };
    areas[r.area].minutos += r.minutos;
    areas[r.area].ocorrencias += r.ocorrencias;
  });
  const linhasArea = Object.entries(areas).sort((a, b) => b[1].minutos - a[1].minutos);
  $('tabela-areas').innerHTML = linhasArea.length
    ? `<table>
        <thead><tr><th>Área</th><th class="num">Registros</th><th class="num">Minutos</th><th class="num">% do dia</th></tr></thead>
        <tbody>${linhasArea.map(([area, v]) => `
          <tr><td>${esc(area)}</td><td class="num">${v.ocorrencias}</td><td class="num">${v.minutos}</td>
              <td class="num">${Math.round((v.minutos / total) * 100)}%</td></tr>`).join('')}</tbody>
      </table>`
    : '<div class="vazio">Sem atrasos neste dia.</div>';
}

iniciar();
