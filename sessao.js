const configurado = typeof SUPABASE_URL === 'string' && SUPABASE_URL.startsWith('http');
const db = configurado ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const Sessao = {
  chave: 'delaytrack.sessao',
  token() {
    try { return localStorage.getItem(this.chave); } catch (e) { return null; }
  },
  salvar(token) {
    try { localStorage.setItem(this.chave, token); } catch (e) {  }
  },
  limpar() {
    try { localStorage.removeItem(this.chave); } catch (e) {  }
  },
};

function irParaLogin(tipo) {
  location.replace('index.html' + (tipo === 'FUNCIONARIO' ? '#funcionario' : ''));
  return null;
}

async function exigirSessao(tipo) {
  const token = Sessao.token();
  if (!configurado || !token) return irParaLogin(tipo);
  const { data, error } = await db.rpc('sessao_atual', { p_token: token });
  if (error || !data) {
    Sessao.limpar();
    return irParaLogin(tipo);
  }
  if (data.tipo !== tipo) {

    location.replace(data.tipo === 'FUNCIONARIO' ? 'operacao.html' : 'passageiro.html');
    return null;
  }
  return data;
}

async function sair() {
  const token = Sessao.token();
  if (token && db) await db.rpc('sair', { p_token: token });
  Sessao.limpar();
  location.replace('index.html');
}

async function consulta(promessa) {
  const { data, error } = await promessa;
  if (error) {
    if (/Sessão expirada/.test(error.message)) {
      Sessao.limpar();
      irParaLogin();
    }
    throw new Error(error.message);
  }
  return data;
}

const MARCA_SVG = `
  <svg class="marca-simbolo" viewBox="0 0 48 48" aria-hidden="true">
    <path d="M5 43 C 11 41, 15 37, 18 32" fill="none" stroke="var(--cor-raiz, currentColor)" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0.5 4.5"/>
    <g transform="rotate(45 28 20)">
      <path d="M28 2.5 C29.6 2.5 30.6 4.6 30.6 7 L30.6 14.5 L43 22.5 L43 25.5 L30.6 21.6 L30.6 30.5 L34.4 33.6 L34.4 36 L28 34.2 L21.6 36 L21.6 33.6 L25.4 30.5 L25.4 21.6 L13 25.5 L13 22.5 L25.4 14.5 L25.4 7 C25.4 4.6 26.4 2.5 28 2.5 Z" fill="var(--cor-rota, #d3983f)"/>
    </g>
  </svg>`;

function desenharMarcas() {
  document.querySelectorAll('[data-marca]').forEach((el) => { el.innerHTML = MARCA_SVG; });
}

const reduzirMovimento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const AVIAO_PATH = 'M28 2.5 C29.6 2.5 30.6 4.6 30.6 7 L30.6 14.5 L43 22.5 L43 25.5 L30.6 21.6 L30.6 30.5 L34.4 33.6 L34.4 36 L28 34.2 L21.6 36 L21.6 33.6 L25.4 30.5 L25.4 21.6 L13 25.5 L13 22.5 L25.4 14.5 L25.4 7 C25.4 4.6 26.4 2.5 28 2.5 Z';

function voarAviao(origem) {
  if (!origem || reduzirMovimento() || !document.body.animate) return Promise.resolve();
  const r = origem.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;

  const aviao = document.createElement('div');
  aviao.className = 'aviao-voando';
  aviao.style.left = `${x}px`;
  aviao.style.top = `${y}px`;
  aviao.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><g transform="rotate(45 28 20)"><path d="${AVIAO_PATH}"/></g></svg>`;
  document.body.appendChild(aviao);

  for (let i = 0; i < 4; i++) {
    const ponto = document.createElement('span');
    ponto.className = 'rastro-ponto';
    ponto.style.left = `${x + 12 + i * 22}px`;
    ponto.style.top = `${y - 6 - i * 15}px`;
    document.body.appendChild(ponto);
    ponto.animate([{ opacity: 0 }, { opacity: 0.7 }, { opacity: 0 }],
      { duration: 650, delay: 90 + i * 90, easing: 'ease-out', fill: 'both' })
      .finished.then(() => ponto.remove());
  }

  const voo = aviao.animate([
    { transform: 'translate(-50%, -50%) translate(0, 0) scale(.7)', opacity: 0 },
    { offset: 0.15, transform: 'translate(-50%, -50%) translate(8px, -4px) scale(1)', opacity: 1 },
    { transform: 'translate(-50%, -50%) translate(150px, -105px) scale(.55)', opacity: 0 },
  ], { duration: 850, easing: 'cubic-bezier(.45, 0, .25, 1)' });
  return voo.finished.then(() => aviao.remove());
}

function piscar(el) {
  if (!el || reduzirMovimento()) return;
  el.classList.remove('mudou');
  void el.offsetWidth;
  el.classList.add('mudou');
}

const Tema = {
  chave: 'delaytrack.tema',
  atual() { return document.documentElement.dataset.tema === 'escuro' ? 'escuro' : 'claro'; },
  aplicar(tema) {
    document.documentElement.dataset.tema = tema;
    try { localStorage.setItem(this.chave, tema); } catch (e) {  }
    document.querySelectorAll('[data-tema-botao]').forEach(desenharBotaoTema);
  },
};

const ICONE_LUA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z" fill="currentColor"/></svg>';
const ICONE_SOL = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.6" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1.8v2.4M12 19.8v2.4M1.8 12h2.4M19.8 12h2.4M4.8 4.8l1.7 1.7M17.5 17.5l1.7 1.7M4.8 19.2l1.7-1.7M17.5 6.5l1.7-1.7"/></g></svg>';

function desenharBotaoTema(botao) {
  const escuro = Tema.atual() === 'escuro';
  botao.innerHTML = escuro ? ICONE_SOL : ICONE_LUA;
  const rotulo = escuro ? 'Usar modo claro' : 'Usar modo escuro';
  botao.setAttribute('aria-label', rotulo);
  botao.title = rotulo;
}

function configurarTema() {
  document.querySelectorAll('[data-tema-botao]').forEach((botao) => {
    desenharBotaoTema(botao);
    botao.addEventListener('click', () => {
      Tema.aplicar(Tema.atual() === 'escuro' ? 'claro' : 'escuro');
      botao.classList.remove('girar'); void botao.offsetWidth; botao.classList.add('girar');
    });
  });
}
configurarTema();
