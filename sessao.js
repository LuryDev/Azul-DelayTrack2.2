// =====================================================================
//  DelayTrack · conexão com o Supabase e controle de sessão
//  Usado pelas três páginas (login, operação e passageiro).
// =====================================================================

const configurado = typeof SUPABASE_URL === 'string' && SUPABASE_URL.startsWith('http');
const db = configurado ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// O token da sessão fica guardado no navegador.
const Sessao = {
  chave: 'delaytrack.sessao',
  token() {
    try { return localStorage.getItem(this.chave); } catch (e) { return null; }
  },
  salvar(token) {
    try { localStorage.setItem(this.chave, token); } catch (e) { /* navegação privada */ }
  },
  limpar() {
    try { localStorage.removeItem(this.chave); } catch (e) { /* navegação privada */ }
  },
};

function irParaLogin(tipo) {
  location.replace('index.html' + (tipo === 'FUNCIONARIO' ? '#funcionario' : ''));
  return null;
}

// Confere se quem abriu a página está logado com o tipo de conta certo.
async function exigirSessao(tipo) {
  const token = Sessao.token();
  if (!configurado || !token) return irParaLogin(tipo);
  const { data, error } = await db.rpc('sessao_atual', { p_token: token });
  if (error || !data) {
    Sessao.limpar();
    return irParaLogin(tipo);
  }
  if (data.tipo !== tipo) {
    // logado com outro tipo de conta: vai para a própria página
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

// Executa uma chamada ao banco; se a sessão venceu, volta para o login.
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

// Marca da companhia (desenho original): linha de voo que nasce de uma raiz.
const MARCA_SVG = `
  <svg class="marca-simbolo" viewBox="0 0 48 48" aria-hidden="true">
    <path d="M9 34 C 18 33, 28 26, 40 9" fill="none" stroke="var(--cor-rota, #F2A93B)" stroke-width="5" stroke-linecap="round"/>
    <path d="M40 9 L 31 12.5 M40 9 L 38.5 18.5" fill="none" stroke="var(--cor-rota, #F2A93B)" stroke-width="5" stroke-linecap="round"/>
    <circle cx="9" cy="34" r="4" fill="var(--cor-raiz, currentColor)"/>
    <path d="M9 38 L 9 44 M9 39.5 L 4.5 43.5 M9 39.5 L 13.5 43.5" fill="none" stroke="var(--cor-raiz, currentColor)" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`;

function desenharMarcas() {
  document.querySelectorAll('[data-marca]').forEach((el) => { el.innerHTML = MARCA_SVG; });
}
