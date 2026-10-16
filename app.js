let usuario = null;

const AREAS = ['CCO', 'Piloto', 'Manutenção', 'Aeroporto', 'Tráfego aéreo', 'Tripulação'];

const estado = {
  data: null,
  agora: null,
  motivos: [],
  aeronaves: [],
  voos: [],
  atrasos: [],
  pareceres: [],
  vooSelecionado: null,
  formAberto: false,
};

const $ = (id) => document.getElementById(id);

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const hora = (ts) => (ts ? ts.slice(11, 16) : '');
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

function diaSeguinte(d) {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}

function motivo(codigo) {
  return estado.motivos.find((m) => m.codigo === codigo) || { codigo, descricao: codigo };
}

const emFrase = (texto) => texto.charAt(0).toLowerCase() + texto.slice(1);

let timerToast;
function toast(msg, erro = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (erro ? ' erro' : '');
  t.hidden = false;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => (t.hidden = true), 4500);
}

function opcoesMotivo(selecionado, incluirReativo = false) {
  const grupos = {};
  estado.motivos
    .filter((m) => incluirReativo || !m.reativo)
    .forEach((m) => (grupos[m.categoria] ||= []).push(m));
  return Object.entries(grupos).map(([cat, lista]) => `
    <optgroup label="${esc(cat)}">
      ${lista.map((m) => `<option value="${esc(m.codigo)}" ${m.codigo === selecionado ? 'selected' : ''}>${esc(m.descricao)}</option>`).join('')}
    </optgroup>`).join('');
}

function mostrarTela() {
  const nome = (location.hash || '#voos').slice(1);
  const valida = ['voos', 'confirmar', 'relatorio'].includes(nome) ? nome : 'voos';
  document.querySelectorAll('.tela').forEach((t) => (t.hidden = t.id !== valida));
  document.querySelectorAll('.aba').forEach((a) => {
    if (a.dataset.tela === valida) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', () => { mostrarTela(); window.scrollTo(0, 0); });

async function iniciar() {
  desenharMarcas();
  mostrarTela();
  if (!configurado) { $('aviso-config').hidden = false; return; }

  mostrarEsqueletos();
  usuario = await exigirSessao('FUNCIONARIO');
  if (!usuario) return;
  $('usuario-nome').textContent = usuario.nome;
  $('usuario-info').textContent = `${usuario.codigo} · ${usuario.area}`;
  $('btn-sair').addEventListener('click', sair);
  configurarRelogio();

  try {
    const [motivos, aeronaves, vazias, config] = await Promise.all([
      consulta(db.from('motivo').select('*').order('codigo')),
      consulta(db.from('aeronave').select('*').order('matricula')),
      consulta(db.from('palavra_vazia').select('palavra')).catch(() => []),
      consulta(db.from('configuracao').select('*')).catch(() => []),
    ]);
    estado.motivos = motivos;
    estado.aeronaves = aeronaves;
    ModeloMotivo.vazias = new Set(vazias.map((v) => v.palavra));
    estado.solo = Number(config.find((c) => c.chave === 'tempo_minimo_solo')?.valor ?? 30);
    await recarregar();
  } catch (e) {
    toast('Não foi possível conectar ao banco de dados: ' + e.message, true);
  }
}

function mostrarEsqueletos() {
  const barra = (largura) => `<span class="esqueleto" style="width:${largura}"></span>`;
  $('resumo-dia').innerHTML = barra('min(520px, 90%)');
  $('aeronaves').innerHTML = [140, 120, 130].map((largura) => `
    <section class="aeronave" aria-hidden="true">
      <span class="esqueleto titulo-esq" style="width:${largura}px"></span>
      <ol class="voos">${'<li><span class="esqueleto voo-esq"></span></li>'.repeat(4)}</ol>
    </section>`).join('');
  $('pendentes').innerHTML = `<div class="cartao" aria-hidden="true">
      <span class="esqueleto titulo-esq" style="width:55%"></span>
      ${barra('80%')}${barra('100%')}<span class="esqueleto bloco-esq"></span>
    </div>`.repeat(2);
}

async function recarregar() {
  const relogio = await consulta(db.from('relogio').select('agora').single());
  estado.agora = relogio.agora;
  estado.data = relogio.agora.slice(0, 10);
  const relogioEl = $('relogio-hora');
  if (relogioEl.textContent !== hora(estado.agora)) {
    relogioEl.textContent = hora(estado.agora);
    relogioEl.classList.remove('tique'); void relogioEl.offsetWidth; relogioEl.classList.add('tique');
  }

  const inicio = estado.data;
  const fim = diaSeguinte(estado.data);

  const [voos, atrasos, modeloPalavras, modeloMotivos, exemplos] = await Promise.all([
    consulta(db.from('vw_voo_resumo').select('*')
      .gte('partida_prevista', inicio).lt('partida_prevista', fim).order('partida_prevista')),
    consulta(db.from('vw_atraso_detalhado').select('*')
      .gte('partida_prevista', inicio).lt('partida_prevista', fim).order('partida_prevista').order('id')),
    consulta(db.from('vw_modelo_palavra').select('*')).catch(() => []),
    consulta(db.from('vw_modelo_motivo').select('*')).catch(() => []),
    consulta(db.from('exemplo_motivo').select('texto, motivo_codigo, origem, minutos'))
      .catch(() => consulta(db.from('exemplo_motivo').select('texto, motivo_codigo, origem')))
      .catch(() => []),
  ]);
  estado.exemplos = exemplos;
  ModeloMotivo.treinar(modeloPalavras, modeloMotivos);
  estado.voos = voos;
  estado.atrasos = atrasos;

  const ids = atrasos.map((a) => a.id);
  estado.pareceres = ids.length
    ? await consulta(db.from('parecer').select('*').in('atraso_id', ids).order('criado_em'))
    : [];

  renderVoos();
  renderConfirmar();
  Relatorio.render();
}

const FIM_DO_DIA = '15:00';
let reproduzindo = null;
let avancando = false;

async function avancar(minutos) {
  if (avancando) return;
  avancando = true;
  try {
    const r = await consulta(db.rpc('avancar_relogio', { p_token: Sessao.token(), p_minutos: minutos }));
    await recarregar();
    if (r.eventos.length) toast(r.eventos.map((e) => `${e.hora} · ${e.texto}`).join('  |  '));
    if (reproduzindo && hora(estado.agora) >= FIM_DO_DIA) pararReproducao();
  } catch (e) {
    pararReproducao();
    toast(e.message, true);
  } finally {
    avancando = false;
  }
}

function pararReproducao() {
  clearInterval(reproduzindo);
  reproduzindo = null;
  document.querySelector('.relogio').classList.remove('rodando');
  $('btn-play').textContent = '▶ Reproduzir';
  $('btn-play').classList.remove('ativo');
}

function configurarRelogio() {
  document.querySelectorAll('[data-avancar]').forEach((b) => b.addEventListener('click', () => avancar(Number(b.dataset.avancar))));

  $('btn-play').addEventListener('click', () => {
    if (reproduzindo) { pararReproducao(); return; }
    voarAviao($('btn-play'));
    reproduzindo = setInterval(() => avancar(5), 1500);
    document.querySelector('.relogio').classList.add('rodando');
    $('btn-play').textContent = '❚❚ Pausar';
    $('btn-play').classList.add('ativo');
  });

  $('btn-reiniciar').addEventListener('click', async () => {
    if (!confirm('Voltar o dia para 06:00? Todos os atrasos e opiniões registrados serão apagados.')) return;
    pararReproducao();
    try {
      await consulta(db.rpc('reiniciar_simulacao', { p_token: Sessao.token() }));
      estado.vooSelecionado = null;
      estado.formAberto = false;
      await recarregar();
      toast('Dia reiniciado: 06:00, nenhum atraso registrado.');
    } catch (e) { toast(e.message, true); }
  });
}

const originadores = () => estado.atrasos.filter((a) => a.tipo === 'ORIGINADOR');

const atrasoAnterior = new Map();

function renderVoos() {
  const voos = estado.voos;
  const atrasados = voos.filter((v) => v.atraso_total > 0).length;
  const total = voos.reduce((s, v) => s + v.atraso_total, 0);
  const problemas = originadores().length;

  $('resumo-dia').innerHTML = atrasados
    ? `<strong>${atrasados} de ${voos.length} voos</strong> atrasaram, somando <strong>${total} min</strong>.
       Tudo começou em <strong>${plural(problemas, 'problema', 'problemas')}</strong>.`
    : `Nenhum dos ${voos.length} voos atrasou até agora. Use ▶ Reproduzir para ver o dia acontecer.`;

  const porAeronave = {};
  voos.forEach((v) => (porAeronave[v.matricula] ||= []).push(v));

  $('aeronaves').innerHTML = Object.keys(porAeronave).length
    ? Object.entries(porAeronave).map(([matricula, lista]) => {
        const aeronave = estado.aeronaves.find((a) => a.matricula === matricula);
        return `
          <section class="aeronave" aria-label="Aeronave ${esc(matricula)}">
            <h3>${esc(matricula)} <small>${esc(aeronave?.modelo)}</small></h3>
            <ol class="voos">${lista.map(cartaoVoo).join('')}</ol>
          </section>`;
      }).join('')
    : '<p class="vazio">Nenhum voo neste dia.</p>';

  document.querySelectorAll('.voo').forEach((b) => {
    b.addEventListener('click', () => selecionarVoo(Number(b.dataset.id)));
    const v = voos.find((x) => x.id === Number(b.dataset.id));
    const antes = atrasoAnterior.get(v.id);
    if (antes !== undefined && antes !== v.atraso_total) piscar(b);
    atrasoAnterior.set(v.id, v.atraso_total);
  });

  renderDetalhe();
}

const FASE = { EMBARQUE: 'Embarque', EM_VOO: 'Em voo', POUSOU: 'Pousou' };
const partiu = (v) => v.fase === 'EM_VOO' || v.fase === 'POUSOU';

function cartaoVoo(v) {
  const classes = ['voo'];
  if (v.fase === 'POUSOU') classes.push('pousou');
  if (v.atraso_novo > 0) classes.push('com-problema');
  else if (v.atraso_herdado > 0) classes.push('herdou');
  const horario = v.atraso_total
    ? `<s>${hora(v.partida_prevista)}</s> ${hora(v.partida_estimada)}`
    : hora(v.partida_prevista);

  return `
    <li>
      <button class="${classes.join(' ')}" data-id="${v.id}" aria-pressed="${v.id === estado.vooSelecionado}">
        <span class="voo-numero">${esc(v.numero)}${FASE[v.fase] ? `<span class="fase fase-${v.fase.toLowerCase()}">${FASE[v.fase]}</span>` : ''}</span>
        <span class="voo-rota">${esc(v.origem)} → ${esc(v.destino)}</span>
        <span class="voo-hora">${horario}</span>
        <span class="voo-status">${v.atraso_total ? `+${v.atraso_total} min` : 'No horário'}</span>
      </button>
    </li>`;
}

function selecionarVoo(id) {
  estado.vooSelecionado = estado.vooSelecionado === id ? null : id;
  estado.formAberto = false;
  document.querySelectorAll('.voo').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.id) === estado.vooSelecionado)));
  renderDetalhe();
  const det = $('detalhe');
  det.classList.remove('surgir'); void det.offsetWidth; det.classList.add('surgir');
  if (estado.vooSelecionado && window.innerWidth < 1000) $('detalhe').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderDetalhe() {
  const alvo = $('detalhe');
  const rascunho = $('form-atraso') ? {
    obs: $('f-obs').value, motivo: $('f-motivo').value, minutos: $('f-minutos').value,
    foco: document.activeElement?.id,
  } : null;
  const v = estado.voos.find((x) => x.id === estado.vooSelecionado);
  if (!v) {
    alvo.innerHTML = '<p class="vazio">Escolha um voo para ver por que ele atrasou.</p>';
    return;
  }

  const atrasos = estado.atrasos.filter((a) => a.voo_id === v.id).sort((x, y) => y.minutos - x.minutos);
  const raizes = [...new Set(atrasos.map((a) => a.raiz_id))];

  alvo.innerHTML = `
    <header class="detalhe-topo">
      <h3>Voo ${esc(v.numero)}</h3>
      <p>${esc(v.origem)} → ${esc(v.destino)} · aeronave ${esc(v.matricula)}</p>
    </header>

    ${v.fase === 'POUSOU'
      ? `<div class="status encerrado">
           <strong>Pousou às ${hora(v.chegada_estimada)}</strong>
           <span>${v.atraso_total ? `Com ${v.atraso_total} min de atraso` : 'No horário'}</span>
         </div>`
      : v.fase === 'EM_VOO'
      ? `<div class="status em-voo">
           <strong>Em voo</strong>
           <span>Chegada prevista às ${hora(v.chegada_estimada)}${v.atraso_total ? ` (${v.atraso_total} min de atraso)` : ''}</span>
         </div>`
      : v.atraso_total
      ? `<div class="status atrasado">
           <strong>Atrasado ${v.atraso_total} min</strong>
           <span>Nova partida às ${hora(v.partida_estimada)} (prevista ${hora(v.partida_prevista)})</span>
         </div>`
      : `<div class="status ok">
           <strong>No horário</strong>
           <span>Partida às ${hora(v.partida_prevista)}</span>
         </div>`}

    ${linhaDoAviao(v)}

    ${atrasos.length ? `
      <h4>Por que atrasou</h4>
      <ul class="motivos">${atrasos.map(itemMotivo).join('')}</ul>
      ${cascatas(raizes, v.id)}` : ''}

    <div class="acao-detalhe">
      ${partiu(v)
        ? '<p class="ajuda">Este voo já decolou. Atrasos só podem ser informados antes da partida.</p>'
        : estado.formAberto ? formAtraso(v) : `<button class="botao secundario largo" id="abrir-form">Informar atraso neste voo</button>`}
    </div>`;

  $('abrir-form')?.addEventListener('click', () => {
    estado.formAberto = true;
    renderDetalhe();
    $('f-obs').focus();
  });
  if ($('f-obs')) {
    let espera;
    $('f-obs').addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => { mostrarSugestoes(); atualizarPrevisao(); }, 200); });
    $('f-motivo').addEventListener('change', () => { marcarSugestaoEscolhida(); atualizarPrevisao(); });
    $('f-minutos').addEventListener('input', atualizarPrevisao);
    if (rascunho) {
      $('f-obs').value = rascunho.obs;
      $('f-motivo').value = rascunho.motivo;
      $('f-minutos').value = rascunho.minutos;
      mostrarSugestoes();
      atualizarPrevisao();
      if (rascunho.foco && $(rascunho.foco)) $(rascunho.foco).focus();
    }
  }
  $('fechar-form')?.addEventListener('click', () => { estado.formAberto = false; renderDetalhe(); });
  $('form-atraso')?.addEventListener('submit', registrarAtraso);
  alvo.querySelectorAll('[data-desfazer]').forEach((b) => b.addEventListener('click', () => desfazer(Number(b.dataset.desfazer))));
}

const partiuId = (id) => partiu(estado.voos.find((v) => v.id === id) || {});

function itemMotivo(a) {
  if (a.tipo === 'CONSEQUENTE') {
    const raiz = estado.atrasos.find((x) => x.id === a.raiz_id);
    return `
      <li class="herdado">
        <strong>+${a.minutos} min</strong>
        herdados do voo ${esc(raiz?.voo_numero ?? 'anterior')}, que atrasou por ${esc(emFrase(a.causa_raiz_descricao))}.
      </li>`;
  }
  return `
    <li class="proprio">
      <strong>+${a.minutos} min</strong>
      ${esc(a.sintoma_descricao)} neste voo.
      ${a.observacao ? `<small>“${esc(a.observacao)}”</small>` : ''}
      <small>${a.status === 'VALIDADO' ? 'Motivo confirmado.' : 'Motivo provisório, aguardando confirmação.'}
        ${partiuId(a.voo_id) ? '' : `<button class="link" data-desfazer="${a.id}">Desfazer registro</button>`}</small>
    </li>`;
}

function cascatas(raizes, vooAtual) {
  const blocos = raizes.map((r) => blocoCascata(r, vooAtual)).filter(Boolean);
  return blocos.length ? `<h4>Efeito cascata</h4>${blocos.join('')}` : '';
}

let assinaturaLinha = '';

function linhaDoAviao(v) {
  const voos = estado.voos.filter((x) => x.matricula === v.matricula);
  const n = voos.length;
  if (n < 2) return '';

  const assinatura = `${v.id}|${voos.map((x) => x.atraso_total).join(',')}`;
  const animar = assinatura !== assinaturaLinha && !reduzirMovimento();
  assinaturaLinha = assinatura;

  const comAtraso = voos.map((x, i) => (x.atraso_total > 0 ? i : -1)).filter((i) => i >= 0);
  const ini = comAtraso.length ? comAtraso[0] : -1;
  const fim = comAtraso.length ? comAtraso[comAtraso.length - 1] : -1;
  const pos = (i) => (i / (n - 1)) * 100;
  const passos = Math.max(1, fim - ini);
  const duracao = Math.min(1.8, 0.45 * passos + 0.3);

  const paradas = voos.map((x, i) => {
    const classe = x.atraso_novo > 0 ? 'origem' : x.atraso_herdado > 0 ? 'herdou' : 'ok';
    const atraso = ini >= 0 && i >= ini ? ((i - ini) / passos) * duracao : 0;
    return `
      <li class="parada ${classe} ${x.id === v.id ? 'atual' : ''}" style="--atraso:${atraso.toFixed(2)}s">
        <span class="parada-ponto"></span>
        <strong>${esc(x.numero)}</strong>
        <small>${hora(x.partida_prevista)}</small>
        <em>${x.atraso_total ? `+${x.atraso_total} min` : 'no horário'}</em>
      </li>`;
  }).join('');

  return `
    <div class="linha-aviao ${animar ? 'animar' : ''}" style="--n:${n};--de:${pos(Math.max(ini, 0))}%;--ate:${pos(Math.max(fim, 0))}%;--duracao:${duracao.toFixed(2)}s">
      <h4>Dia da aeronave ${esc(v.matricula)}</h4>
      <div class="linha-trilho" aria-hidden="true">
        <span class="trilho-base"></span>
        ${ini >= 0 && fim > ini ? '<span class="trilho-cheio"></span><span class="trilho-aviao"><svg viewBox="0 0 48 48"><g transform="rotate(90 28 20)"><path d="' + AVIAO_PATH + '"/></g></svg></span>' : ''}
      </div>
      <ol class="paradas" aria-label="Voos da aeronave ${esc(v.matricula)} hoje">${paradas}</ol>
    </div>`;
}

function blocoCascata(raizId, vooAtual) {
  const cadeia = estado.atrasos.filter((a) => a.raiz_id === raizId);
  if (cadeia.length < 2) return '';
  const raiz = cadeia.find((a) => a.id === raizId);

  const porVoo = [];
  cadeia.forEach((a) => {
    let item = porVoo.find((x) => x.voo_id === a.voo_id);
    if (!item) porVoo.push(item = { voo_id: a.voo_id, numero: a.voo_numero, minutos: 0, partida: a.partida_prevista });
    item.minutos += a.minutos;
  });
  porVoo.sort((x, y) => x.partida.localeCompare(y.partida));
  const total = porVoo.reduce((s, x) => s + x.minutos, 0);

  return `
    <p class="ajuda">O problema do ${esc(raiz.voo_numero)} (${esc(emFrase(raiz.causa_raiz_descricao))}) somou
      <strong>${total} min</strong> em ${plural(porVoo.length, 'voo', 'voos')}:
      ${porVoo.map((x) => `${esc(x.numero)} +${x.minutos}`).join(' → ')}.</p>`;
}

function formAtraso(v) {
  return `
    <form id="form-atraso" class="form-atraso">
      <h4>Informar atraso no ${esc(v.numero)}</h4>
      <p class="ajuda">Informe só o que aconteceu neste voo. Os voos seguintes da aeronave são atualizados sozinhos.</p>
      <label>Descreva o que aconteceu
        <input id="f-obs" placeholder="Ex.: pneu furado encontrado na inspeção" autocomplete="off">
      </label>
      <div id="f-sugestoes" class="sugestoes" aria-live="polite"></div>
      <label>Motivo
        <select id="f-motivo" required>
          <option value="">Escolha o motivo</option>
          ${opcoesMotivo()}
        </select>
      </label>
      <label>Quantos minutos
        <input id="f-minutos" type="number" min="1" max="600" inputmode="numeric" required>
      </label>
      <div id="f-previsao" class="previsao" aria-live="polite" hidden></div>
      <div class="acoes">
        <button class="botao" type="submit">Registrar atraso</button>
        <button class="botao fantasma" type="button" id="fechar-form">Cancelar</button>
      </div>
    </form>`;
}

function mostrarSugestoes() {
  const alvo = $('f-sugestoes');
  if (!alvo) return;
  const texto = $('f-obs').value;
  const { lista, confiante } = ModeloMotivo.decidir(ModeloMotivo.sugerir(texto)
    .filter((s) => !motivo(s.codigo).reativo));
  if (!texto.trim()) { alvo.innerHTML = ''; return; }
  if (!confiante) {
    alvo.innerHTML = '<p class="sugestoes-vazio">Ainda não sei sugerir um motivo para essa descrição. Escolha na lista abaixo.</p>';
    return;
  }
  const base = ModeloMotivo.totalConfirmados
    ? `aprendeu com ${plural(ModeloMotivo.totalConfirmados, 'motivo confirmado', 'motivos confirmados')}`
    : `${ModeloMotivo.totalExemplos} exemplos iniciais`;
  alvo.innerHTML = `
    <p class="sugestoes-titulo">Sugestão automática <span>${base}</span></p>
    <div class="sugestoes-lista">
      ${lista.map((s) => `
        <button type="button" class="sugestao" data-codigo="${esc(s.codigo)}">
          <span class="sugestao-nome">${esc(motivo(s.codigo).descricao)}</span>
          <span class="sugestao-chance">${Math.round(s.chance * 100)}%</span>
          <span class="sugestao-barra" style="--chance:${(s.chance * 100).toFixed(0)}%"></span>
          ${s.porque.length ? `<small>por causa de: ${s.porque.map(esc).join(', ')}</small>` : ''}
        </button>`).join('')}
    </div>`;
  alvo.querySelectorAll('.sugestao').forEach((b) => b.addEventListener('click', () => {
    $('f-motivo').value = b.dataset.codigo;
    marcarSugestaoEscolhida();
    atualizarPrevisao();
    $('f-minutos').focus();
  }));
  marcarSugestaoEscolhida();
}

function minutosEntre(depois, antes) {
  return Math.round((new Date(depois) - new Date(antes)) / 60000);
}

function horaMais(ts, minutos) {
  const d = new Date(ts);
  d.setMinutes(d.getMinutes() + minutos);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function preverCascata(voo, extra) {
  const solo = estado.solo ?? 30;
  const dia = estado.voos
    .filter((v) => v.matricula === voo.matricula)
    .sort((a, b) => a.partida_prevista.localeCompare(b.partida_prevista));
  const simular = (somar) => {
    let anterior = null;
    return dia.map((v) => {
      let herdado = 0;
      if (anterior && anterior.total > 0) {
        const folga = Math.max(0, minutosEntre(v.partida_prevista, anterior.chegada) - solo);
        herdado = Math.max(0, anterior.total - folga);
      }
      const total = herdado + v.atraso_novo + (v.id === voo.id ? somar : 0);
      anterior = { total, chegada: v.chegada_prevista };
      return { voo: v, total };
    });
  };
  const hoje = simular(0);
  const depois = simular(extra);
  const i = dia.findIndex((v) => v.id === voo.id);
  return depois.slice(i + 1).map((x, j) => ({
    voo: x.voo,
    antes: hoje[i + 1 + j].total,
    depois: x.total,
  }));
}

function atualizarPrevisao() {
  const alvo = $('f-previsao');
  if (!alvo) return;
  const voo = estado.voos.find((v) => v.id === estado.vooSelecionado);
  const est = ModeloMotivo.estimarDuracao($('f-obs').value, $('f-motivo').value, estado.exemplos);
  const digitado = Number($('f-minutos').value) || 0;
  const minutos = digitado || est?.minutos || 0;
  if (!voo || !minutos) { alvo.hidden = true; alvo.innerHTML = ''; return; }

  const duracao = est ? `
    <div class="previsao-duracao">
      <div><strong>≈ ${est.minutos} min</strong><span>${est.de === est.ate ? `${est.casos} ${est.casos === 1 ? 'caso parecido' : 'casos parecidos'}` : `entre ${est.de} e ${est.ate} min`}</span></div>
      ${digitado === est.minutos ? '' : `<button type="button" class="botao secundario" id="usar-previsao">Usar ${est.minutos} min</button>`}
    </div>` : '';

  const efeitos = preverCascata(voo, minutos);
  const linhas = efeitos.length
    ? efeitos.map(({ voo: v, antes, depois }) => {
        const mais = depois - antes;
        return `<li class="${mais > 0 ? 'afeta' : ''}">
          <strong>${esc(v.numero)}</strong>
          <span>${mais > 0 ? `${horaMais(v.partida_prevista, antes)} → ${horaMais(v.partida_prevista, depois)}` : 'sem efeito'}</span>
          <em>${mais > 0 ? `+${mais} min` : ''}</em>
        </li>`;
      }).join('')
    : '<li><span>Último voo da aeronave no dia.</span></li>';

  alvo.innerHTML = `
    <p class="previsao-titulo">Previsão</p>
    ${duracao}
    <p class="previsao-sub">Próximos voos com ${minutos} min</p>
    <ul class="previsao-voos">${linhas}</ul>`;
  alvo.hidden = false;
  $('usar-previsao')?.addEventListener('click', () => {
    $('f-minutos').value = est.minutos;
    atualizarPrevisao();
    $('f-minutos').focus();
  });
}

function marcarSugestaoEscolhida() {
  document.querySelectorAll('#f-sugestoes .sugestao').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.codigo === $('f-motivo').value));
  });
}

async function registrarAtraso(e) {
  e.preventDefault();
  const botao = e.target.querySelector('button[type=submit]');
  botao.disabled = true;
  try {
    const voo = estado.voos.find((v) => v.id === estado.vooSelecionado);
    const antes = estado.voos.filter((v) => v.matricula === voo.matricula && v.partida_prevista > voo.partida_prevista)
      .map((v) => [v.id, v.atraso_total]);
    await consulta(db.rpc('op_registrar_atraso', {
      p_token: Sessao.token(),
      p_voo_id: voo.id,
      p_motivo: $('f-motivo').value,
      p_minutos: Number($('f-minutos').value),
      p_observacao: $('f-obs').value.trim() || null,
    }));
    voarAviao(botao);
    estado.formAberto = false;
    await recarregar();
    const afetados = antes.filter(([id, min]) => estado.voos.find((v) => v.id === id).atraso_total !== min).length;
    toast(afetados
      ? `Atraso registrado. ${plural(afetados, 'voo seguinte foi atualizado', 'voos seguintes foram atualizados')}.`
      : 'Atraso registrado. A folga no solo absorveu o atraso, e os próximos voos não foram afetados.');
  } catch (err) {
    toast(err.message, true);
    botao.disabled = false;
  }
}

async function desfazer(id) {
  if (!confirm('Desfazer este registro? Os voos seguintes serão recalculados.')) return;
  try {
    await consulta(db.rpc('op_remover_atraso', { p_token: Sessao.token(), p_atraso_id: id }));
    await recarregar();
    toast('Registro desfeito.');
  } catch (err) { toast(err.message, true); }
}

function renderConfirmar() {
  const lista = originadores();
  const pendentes = lista.filter((a) => a.status === 'PROVISORIO');
  const confirmados = lista.filter((a) => a.status === 'VALIDADO');

  $('contador-pendentes').textContent = pendentes.length;
  $('contador-pendentes').hidden = !pendentes.length;

  $('pendentes').innerHTML = pendentes.length
    ? pendentes.map(cartaoPendente).join('')
    : '<p class="vazio cartao">Nenhum motivo esperando confirmação.</p>';

  const det = $('confirmados');
  det.hidden = !confirmados.length;
  det.querySelector('summary').textContent = `Motivos já confirmados (${confirmados.length})`;
  det.querySelector('ul').innerHTML = confirmados.map((a) => `
    <li><strong>${esc(a.voo_numero)}</strong> · ${a.minutos} min · ${esc(a.sintoma_descricao)}</li>`).join('');

  document.querySelectorAll('.form-confirmar').forEach((f) => f.addEventListener('submit', confirmarMotivo));
  document.querySelectorAll('.form-parecer').forEach((f) => f.addEventListener('submit', salvarParecer));
}

function cartaoPendente(a) {
  const afetados = estado.atrasos.filter((x) => x.raiz_id === a.id && x.id !== a.id);
  const minutosCadeia = afetados.reduce((s, x) => s + x.minutos, 0);
  const pareceres = estado.pareceres.filter((p) => p.atraso_id === a.id);

  const votos = {};
  pareceres.forEach((p) => (votos[p.motivo_codigo] = (votos[p.motivo_codigo] || 0) + 1));
  const sugestao = Object.entries(votos).sort((x, y) => y[1] - x[1])[0]?.[0];

  return `
    <article class="cartao pendente" aria-labelledby="pend-${a.id}">
      <header>
        <h3 id="pend-${a.id}">Voo ${esc(a.voo_numero)} · ${a.minutos} min</h3>
        <p>${afetados.length
          ? `Afetou mais ${plural(new Set(afetados.map((x) => x.voo_id)).size, 'voo', 'voos')}, somando +${minutosCadeia} min.`
          : 'Não afetou outros voos.'}</p>
      </header>

      <p class="registrado">Registrado como <strong>${esc(a.sintoma_descricao)}</strong>${a.observacao ? `: “${esc(a.observacao)}”` : ''}</p>

      ${pareceres.length ? `
        <ul class="opinioes" aria-label="Opinião das áreas">
          ${pareceres.map((p) => `
            <li class="${p.motivo_codigo === sugestao && pareceres.length > 1 ? 'maioria' : ''}">
              <strong>${esc(p.area)}</strong> ${esc(emFrase(motivo(p.motivo_codigo).descricao))}
              ${p.justificativa ? `<small>${esc(p.justificativa)}</small>` : ''}
            </li>`).join('')}
        </ul>` : ''}

      <form class="form-confirmar" data-id="${a.id}">
        <label>Motivo oficial
          <select name="motivo">${opcoesMotivo(sugestao || a.sintoma_codigo, true)}</select>
        </label>
        <button class="botao" type="submit">Confirmar motivo</button>
      </form>

      <details class="opiniao-nova">
        <summary>Registrar a opinião de uma área</summary>
        <form class="form-parecer" data-id="${a.id}">
          <div class="linha">
            <label>Área
              <select name="area">${AREAS.map((x) => `<option ${x === usuario?.area ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
            </label>
            <label>Para essa área, o motivo foi
              <select name="motivo">${opcoesMotivo(a.sintoma_codigo, true)}</select>
            </label>
          </div>
          <label>Justificativa <span class="opcional">(opcional)</span>
            <input name="justificativa">
          </label>
          <button class="botao secundario" type="submit">Salvar opinião</button>
        </form>
      </details>
    </article>`;
}

async function confirmarMotivo(e) {
  e.preventDefault();
  const f = e.target;
  try {
    await consulta(db.rpc('op_validar_atraso', { p_token: Sessao.token(), p_atraso_id: Number(f.dataset.id), p_motivo_final: f.motivo.value }));
    await voarAviao(f.querySelector('button'));
    const antes = ModeloMotivo.totalConfirmados;
    await recarregar();
    toast(ModeloMotivo.totalConfirmados > antes
      ? 'Motivo confirmado. A sugestão automática aprendeu com este caso.'
      : 'Motivo confirmado. Os voos afetados já mostram a causa oficial.');
  } catch (err) { toast(err.message, true); }
}

async function salvarParecer(e) {
  e.preventDefault();
  const f = e.target;
  try {
    await consulta(db.rpc('op_registrar_parecer', {
      p_token: Sessao.token(),
      p_atraso_id: Number(f.dataset.id),
      p_area: f.area.value,
      p_motivo: f.motivo.value,
      p_justificativa: f.justificativa.value.trim() || null,
    }));
    await recarregar();
    toast('Opinião registrada.');
  } catch (err) { toast(err.message, true); }
}

iniciar();
