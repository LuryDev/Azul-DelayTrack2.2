desenharMarcas();

const DESTINO = { PASSAGEIRO: 'passageiro.html', FUNCIONARIO: 'operacao.html' };

function mostrarAba(qual) {
  const func = qual === 'funcionario';
  document.getElementById('aba-passageiro').setAttribute('aria-selected', String(!func));
  document.getElementById('aba-funcionario').setAttribute('aria-selected', String(func));
  document.getElementById('painel-passageiro').hidden = func;
  document.getElementById('painel-funcionario').hidden = !func;
  history.replaceState(null, '', func ? '#funcionario' : location.pathname);
  const alvo = func ? document.querySelector('#form-funcionario input') : document.querySelector('#painel-passageiro form:not([hidden]) input');
  alvo?.focus();
}
document.getElementById('aba-passageiro').addEventListener('click', () => mostrarAba('passageiro'));
document.getElementById('aba-funcionario').addEventListener('click', () => mostrarAba('funcionario'));

document.querySelectorAll('[data-ir]').forEach((b) => {
  b.addEventListener('click', () => {
    const cadastro = b.dataset.ir === 'cadastro';
    document.getElementById('form-entrar').hidden = cadastro;
    document.getElementById('form-cadastro').hidden = !cadastro;
    document.querySelector(cadastro ? '#form-cadastro input' : '#form-entrar input').focus();
  });
});

function enviar(form, chamada, tipo) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const erro = form.querySelector('.erro');
    const botao = form.querySelector('button[type=submit]');
    erro.hidden = true;
    botao.disabled = true;
    try {
      const dados = Object.fromEntries(new FormData(form));
      const token = await consulta(chamada(dados));
      Sessao.salvar(token);
      await voarAviao(botao);
      location.replace(DESTINO[tipo]);
    } catch (err) {
      erro.textContent = err.message;
      erro.hidden = false;
      botao.disabled = false;
    }
  });
}

enviar(document.getElementById('form-entrar'),
  (d) => db.rpc('entrar_passageiro', { p_email: d.email, p_senha: d.senha }), 'PASSAGEIRO');
enviar(document.getElementById('form-cadastro'),
  (d) => db.rpc('cadastrar_passageiro', { p_nome: d.nome, p_email: d.email, p_senha: d.senha }), 'PASSAGEIRO');
enviar(document.getElementById('form-funcionario'),
  (d) => db.rpc('entrar_funcionario', { p_codigo: d.codigo, p_senha: d.senha }), 'FUNCIONARIO');

(async () => {
  if (!configurado) {
    document.getElementById('aviso-config').hidden = false;
    return;
  }
  if (location.hash === '#funcionario') mostrarAba('funcionario');

  const token = Sessao.token();
  if (token) {
    const { data } = await db.rpc('sessao_atual', { p_token: token });
    if (data && DESTINO[data.tipo]) location.replace(DESTINO[data.tipo]);
    else Sessao.limpar();
  }
})();
