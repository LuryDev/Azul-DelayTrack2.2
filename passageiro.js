desenharMarcas();

const CIDADES = {
  GRU: 'São Paulo', CGH: 'São Paulo', VCP: 'Campinas', SDU: 'Rio de Janeiro', GIG: 'Rio de Janeiro',
  CNF: 'Belo Horizonte', POA: 'Porto Alegre', CWB: 'Curitiba', FLN: 'Florianópolis', VIX: 'Vitória',
  RAO: 'Ribeirão Preto', UDI: 'Uberlândia', BSB: 'Brasília', REC: 'Recife', SSA: 'Salvador', FOR: 'Fortaleza',
};

const $ = (id) => document.getElementById(id);
const hora = (ts) => ts.slice(11, 16);

function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function dataPorExtenso(ts) {
  const d = new Date(ts.slice(0, 10) + 'T12:00:00');
  const texto = d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function duracao(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h}h${String(min % 60).padStart(2, '0')}` : `${h}h`;
}

function situacaoDoVoo(v, atrasado) {
  const motivo = atrasado && v.motivo ? `<p class="motivo">${esc(v.motivo)}</p>` : '';
  const bloco = (classe, titulo, texto, comMotivo) => `
    <div class="situacao ${classe}">
      <div class="situacao-titulo"><span class="ponto"></span>${titulo}</div>
      ${texto ? `<p>${texto}</p>` : ''}
      ${comMotivo ? motivo : ''}
    </div>`;

  if (v.fase === 'POUSOU') {
    return bloco('encerrado', `Pousou às ${hora(v.chegada_estimada)}`,
      atrasado ? `Chegou com ${duracao(v.atraso)} de atraso.` : 'Chegou no horário.', false);
  }
  if (v.fase === 'EM_VOO') {
    return bloco('em-voo', 'Em voo', `Chegada prevista às <strong>${hora(v.chegada_estimada)}</strong>.`, false);
  }
  if (atrasado) {
    const texto = v.fase === 'EMBARQUE'
      ? `Embarque aberto. Nova partida às <strong>${hora(v.partida_estimada)}</strong>.`
      : `Nova partida às <strong>${hora(v.partida_estimada)}</strong>.`;
    return bloco('atrasado', `Atrasado ${duracao(v.atraso)}`, texto, true);
  }
  return bloco('ok', v.fase === 'EMBARQUE' ? 'Embarque aberto' : 'No horário', '', false);
}

function bilhete(v) {
  const atrasado = v.atraso > 0;
  const partida = atrasado
    ? `<s>${hora(v.partida_prevista)}</s>${hora(v.partida_estimada)}`
    : hora(v.partida_prevista);
  const chegada = atrasado
    ? `<s>${hora(v.chegada_prevista)}</s>${hora(v.chegada_estimada)}`
    : hora(v.chegada_prevista);

  const situacao = situacaoDoVoo(v, atrasado);

  return `
    <article class="bilhete" aria-label="Voo ${esc(v.numero)}">
      <div class="bilhete-topo">
        <strong>Voo ${esc(v.numero)}</strong>
        <span>${dataPorExtenso(v.partida_prevista)}</span>
      </div>
      <div class="trecho">
        <div class="ponta">
          <div class="codigo">${esc(v.origem)}</div>
          <div class="cidade">${esc(CIDADES[v.origem] || '')}</div>
          <div class="horario">${partida}</div>
        </div>
        <svg class="trecho-linha" viewBox="0 0 72 24" aria-hidden="true">
          <path d="M2 18 C 22 18, 42 12, 64 5" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round"/>
          <path d="M64 5 L 57 5.5 M64 5 L 60 11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
        </svg>
        <div class="ponta fim">
          <div class="codigo">${esc(v.destino)}</div>
          <div class="cidade">${esc(CIDADES[v.destino] || '')}</div>
          <div class="horario">${chegada}</div>
        </div>
      </div>
      <div class="picote"></div>
      ${situacao}
      <div class="bilhete-rodape">
        <button class="link" data-remover="${v.voo_id}">Parar de acompanhar</button>
      </div>
    </article>`;
}

const situacaoAnterior = new Map();

async function carregar() {
  const { agora, voos } = await consulta(db.rpc('meus_voos', { p_token: Sessao.token() }));
  $('horario').textContent = `Situação às ${hora(agora)} (horário simulado)`;
  $('voos').innerHTML = voos.length
    ? voos.map(bilhete).join('')
    : `<div class="vazio-pax">
         <strong>Nenhum voo por aqui ainda</strong>
         Digite abaixo o número do seu voo para acompanhar.
       </div>`;

  $('voos').querySelectorAll('.bilhete').forEach((el, i) => {
    const v = voos[i];
    const chave = `${v.atraso}|${v.fase}`;
    const antes = situacaoAnterior.get(v.voo_id);
    if (antes === undefined) el.classList.add('surgir');
    else if (antes !== chave) piscar(el);
    situacaoAnterior.set(v.voo_id, chave);
  });

  $('voos').querySelectorAll('[data-remover]').forEach((b) => {
    b.addEventListener('click', async () => {
      await consulta(db.rpc('deixar_de_acompanhar', { p_token: Sessao.token(), p_voo_id: Number(b.dataset.remover) }));
      carregar();
    });
  });

}

$('form-acompanhar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const erro = form.querySelector('.erro');
  erro.hidden = true;
  try {
    await consulta(db.rpc('acompanhar_voo', { p_token: Sessao.token(), p_numero: form.numero.value }));
    voarAviao(form.querySelector('button[type=submit]'));
    form.reset();
    await carregar();
  } catch (err) {
    erro.textContent = err.message;
    erro.hidden = false;
  }
});

$('btn-sair').addEventListener('click', sair);

(async () => {
  const quem = await exigirSessao('PASSAGEIRO');
  if (!quem) return;
  $('saudacao').textContent = `Olá, ${quem.nome.split(' ')[0]}`;
  await carregar();
  setInterval(() => carregar().catch(() => {}), 10000);
})();
