const Relatorio = (() => {
    const pct = (parte, total) => (total ? Math.round((parte / total) * 100) : 0);
  const somar = (lista, f) => lista.reduce((s, x) => s + f(x), 0);

  function agrupar(lista, chave, valor) {
    const mapa = new Map();
    lista.forEach((x) => {
      const k = chave(x);
      const atual = mapa.get(k) || { chave: k, minutos: 0, itens: [] };
      atual.minutos += valor(x);
      atual.itens.push(x);
      mapa.set(k, atual);
    });
    return [...mapa.values()].sort((a, b) => b.minutos - a.minutos);
  }

  function kmeans(pontos, k) {
    const distintos = [...new Set(pontos.map((p) => p.join(',')))].map((s) => s.split(',').map(Number));
    k = Math.min(k, distintos.length);
    if (!k) return { centros: [], grupo: [] };
    const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
    const centros = [distintos.reduce((m, p) => (p[0] + p[1] < m[0] + m[1] ? p : m))];
    while (centros.length < k) {
      let melhor = null;
      let maior = -1;
      distintos.forEach((p) => {
        const d = Math.min(...centros.map((c) => d2(p, c)));
        if (d > maior) { maior = d; melhor = p; }
      });
      centros.push(melhor);
    }
    let grupo = [];
    for (let rodada = 0; rodada < 50; rodada++) {
      const novo = pontos.map((p) => {
        let melhor = 0;
        centros.forEach((c, i) => { if (d2(p, c) < d2(p, centros[melhor])) melhor = i; });
        return melhor;
      });
      const mudou = novo.some((g, i) => g !== grupo[i]);
      grupo = novo;
      centros.forEach((_, i) => {
        const membros = pontos.filter((_, j) => grupo[j] === i);
        if (membros.length) centros[i] = [somar(membros, (m) => m[0]) / membros.length, somar(membros, (m) => m[1]) / membros.length];
      });
      if (!mudou) break;
    }
    return { centros, grupo };
  }

  function silhueta(pontos, grupo) {
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const ids = [...new Set(grupo)];
    if (ids.length < 2) return -1;
    const valores = pontos.map((p, i) => {
      const media = (g) => {
        const outros = pontos.filter((_, j) => grupo[j] === g && j !== i);
        return outros.length ? somar(outros, (o) => d(p, o)) / outros.length : 0;
      };
      const proprio = pontos.filter((_, j) => grupo[j] === grupo[i]).length > 1 ? media(grupo[i]) : 0;
      const vizinho = Math.min(...ids.filter((g) => g !== grupo[i]).map(media));
      const maior = Math.max(proprio, vizinho);
      return maior ? (vizinho - proprio) / maior : 0;
    });
    return somar(valores, (v) => v) / valores.length;
  }

  function melhorAgrupamento(pontos) {
    let melhor = null;
    for (let k = 2; k <= 4; k++) {
      const r = kmeans(pontos, k);
      if (r.centros.length < k) break;
      const nota = silhueta(pontos, r.grupo);
      if (!melhor || nota > melhor.nota) melhor = { ...r, k, nota };
    }
    return melhor || { ...kmeans(pontos, 1), k: 1, nota: 0 };
  }

  const PERFIS = {
    ok: { nome: 'No horário', classe: 'neutro', texto: 'sem atraso' },
    origem: { nome: 'Origem', classe: 'origem', texto: 'atrasaram por um problema próprio' },
    cascata: { nome: 'Cascata', classe: 'serie', texto: 'atrasaram por herança de voos anteriores' },
  };

  function perfilDoCentro([novo, herdado]) {
    return novo >= herdado ? 'origem' : 'cascata';
  }

  function calcular() {
    const voos = estado.voos;
    const atrasos = estado.atrasos;
    const atrasados = voos.filter((v) => v.atraso_total > 0);
    const total = somar(voos, (v) => v.atraso_total);
    const herdado = somar(voos, (v) => v.atraso_herdado);
    const pendentes = atrasos.filter((a) => a.tipo === 'ORIGINADOR' && a.status === 'PROVISORIO');

    const sintomas = agrupar(atrasos, (a) => a.sintoma_codigo, (a) => a.minutos)
      .map((g) => ({ ...g, descricao: g.itens[0].sintoma_descricao, reativo: motivo(g.chave).reativo }));
    const raizes = agrupar(atrasos, (a) => a.causa_raiz_codigo, (a) => a.minutos)
      .map((g) => ({
        ...g,
        descricao: g.itens[0].causa_raiz_descricao,
        area: g.itens[0].causa_raiz_area,
        voos: new Set(g.itens.map((a) => a.voo_id)).size,
      }));
    const areas = agrupar(atrasos, (a) => a.causa_raiz_area, (a) => a.minutos);
    const aeronaves = estado.aeronaves.map((a) => {
      const dela = voos.filter((v) => v.matricula === a.matricula);
      return {
        matricula: a.matricula,
        modelo: a.modelo,
        novo: somar(dela, (v) => v.atraso_novo),
        herdado: somar(dela, (v) => v.atraso_herdado),
        afetados: dela.filter((v) => v.atraso_herdado > 0).length,
      };
    }).sort((a, b) => (b.novo + b.herdado) - (a.novo + a.herdado));

    const pontos = atrasados.map((v) => [v.atraso_novo, v.atraso_herdado]);
    const { centros, grupo, k } = pontos.length >= 2 ? melhorAgrupamento(pontos) : { centros: pontos, grupo: pontos.map(() => 0), k: pontos.length };
    const perfilVoo = new Map(voos.map((v) => [v.id, 'ok']));
    atrasados.forEach((v, i) => perfilVoo.set(v.id, perfilDoCentro(centros[grupo[i]])));

    const perfis = new Set(centros.map(perfilDoCentro)).size;
    return { voos, atrasados, total, herdado, pendentes, sintomas, raizes, areas, aeronaves, perfilVoo, k, perfis };
  }

  function dica(el, linhas, rotulo) {
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', rotulo);
    el.classList.add('rel-alvo');
    el._dica = linhas;
  }

  function barras(alvo, itens, { maximo, rotulo, valor, classe, sufixo = 'min', vazio }) {
    alvo.replaceChildren();
    if (!itens.length) {
      const p = document.createElement('p');
      p.className = 'rel-vazio';
      p.textContent = vazio;
      alvo.appendChild(p);
      return;
    }
    const lista = document.createElement('ul');
    lista.className = 'rel-barras';
    itens.forEach((item) => {
      const li = document.createElement('li');
      const topo = document.createElement('div');
      topo.className = 'rel-barra-rotulo';
      const nome = document.createElement('span');
      nome.textContent = rotulo(item);
      const num = document.createElement('strong');
      num.textContent = `${valor(item)} ${sufixo}`;
      topo.append(nome, num);
      const trilho = document.createElement('div');
      trilho.className = 'rel-trilho';
      const barra = document.createElement('div');
      barra.className = `rel-barra ${classe(item)}`;
      barra.style.width = `${Math.max(1.5, (valor(item) / maximo) * 100)}%`;
      trilho.appendChild(barra);
      dica(trilho, [[`${valor(item)} ${sufixo}`, rotulo(item)]], `${rotulo(item)}: ${valor(item)} ${sufixo}`);
      li.append(topo, trilho);
      lista.appendChild(li);
    });
    alvo.appendChild(lista);
  }

  function pilha(alvo, partes, total) {
    alvo.replaceChildren();
    partes.filter((p) => p.valor > 0).forEach((p) => {
      const seg = document.createElement('div');
      seg.className = `rel-barra ${p.classe}`;
      seg.style.width = `${(p.valor / total) * 100}%`;
      dica(seg, [[`${p.nome}: ${p.valor}`, p.voos || '']], `${p.nome}: ${p.valor}${p.voos ? ` (${p.voos})` : ''}`);
      alvo.appendChild(seg);
    });
  }

  let tooltip;
  function prepararDicas() {
    if (tooltip) return;
    tooltip = document.createElement('div');
    tooltip.className = 'rel-tooltip';
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    const mostrar = (alvo, x, y) => {
      tooltip.replaceChildren();
      alvo._dica.forEach(([forte, fraco]) => {
        const linha = document.createElement('div');
        if (forte) { const b = document.createElement('strong'); b.textContent = forte; linha.appendChild(b); }
        if (fraco) { const s = document.createElement('span'); s.textContent = fraco; linha.appendChild(s); }
        tooltip.appendChild(linha);
      });
      tooltip.hidden = false;
      const r = tooltip.getBoundingClientRect();
      tooltip.style.left = `${Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2))}px`;
      tooltip.style.top = `${Math.max(8, y - r.height - 12)}px`;
    };
    const tela = document.getElementById('relatorio');
    tela.addEventListener('pointermove', (e) => {
      const alvo = e.target.closest('.rel-alvo');
      if (alvo) mostrar(alvo, e.clientX, e.clientY);
      else tooltip.hidden = true;
    });
    tela.addEventListener('pointerleave', () => { tooltip.hidden = true; });
    tela.addEventListener('focusin', (e) => {
      const alvo = e.target.closest('.rel-alvo');
      if (!alvo) return;
      const r = alvo.getBoundingClientRect();
      mostrar(alvo, r.left + r.width / 2, r.top);
    });
    tela.addEventListener('focusout', () => { tooltip.hidden = true; });
  }

  function legenda(alvo, itens) {
    alvo.replaceChildren();
    itens.forEach(([classe, texto]) => {
      const li = document.createElement('li');
      const cor = document.createElement('span');
      cor.className = `rel-cor ${classe}`;
      const t = document.createElement('span');
      t.textContent = texto;
      li.append(cor, t);
      alvo.appendChild(li);
    });
  }

  function render() {
    const tela = document.getElementById('relatorio');
    if (!tela || !estado.voos.length) return;
    prepararDicas();
    const d = calcular();
    const $r = (id) => document.getElementById(id);

    $r('rel-hora').textContent = `Até ${hora(estado.agora)}`;
    $r('rel-total').textContent = `${d.total} min`;
    $r('rel-atrasados').textContent = `${d.atrasados.length} de ${d.voos.length}`;
    $r('rel-cascata').textContent = `${pct(d.herdado, d.total)}%`;

    const sintomas = d.sintomas.slice(0, 3);
    const raizes = d.raizes.slice(0, 3);
    const maximo = Math.max(1, ...sintomas.map((s) => s.minutos), ...raizes.map((r) => r.minutos));
    const vazio = 'Sem atrasos.';
    barras($r('rel-sintoma'), sintomas, { maximo, vazio, rotulo: (s) => s.descricao, valor: (s) => s.minutos, classe: () => 'neutro' });
    barras($r('rel-raiz'), raizes, { maximo, vazio, rotulo: (r) => r.descricao, valor: (r) => r.minutos, classe: () => 'serie' });

    const av = ModeloMotivo.avaliar(estado.exemplos || []);
    const sugeriu = av.acertou + av.errou;
    $r('rel-acerto').textContent = sugeriu ? `${pct(av.acertou, sugeriu)}%` : '–';
    const ia = [
      { valor: av.acertou, classe: 'serie', nome: 'Acertou' },
      { valor: av.errou, classe: 'origem', nome: 'Errou' },
      { valor: av.semSugestao, classe: 'neutro', nome: 'Não sugeriu' },
    ];
    pilha($r('rel-acerto-barra'), ia, Math.max(1, av.total));
    legenda($r('rel-acerto-legenda'), ia.map((p) => [p.classe, `${p.nome} ${p.valor}`]));

    const grupos = Object.entries(PERFIS).map(([k, p]) => {
      const voos = d.voos.filter((v) => d.perfilVoo.get(v.id) === k);
      return { valor: voos.length, classe: p.classe, nome: p.nome, voos: voos.map((v) => v.numero).join(', ') };
    });
    pilha($r('rel-grupos-barra'), grupos, d.voos.length);
    legenda($r('rel-grupos-legenda'), grupos.filter((g) => g.valor).map((g) => [g.classe, `${g.nome} ${g.valor}`]));
  }

  return { render, kmeans, melhorAgrupamento };
})();
