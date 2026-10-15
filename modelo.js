const ModeloMotivo = {
  vazias: new Set(),
  classes: [],
  contagem: new Map(),
  totalPorClasse: new Map(),
  exemplosPorClasse: new Map(),
  vocabulario: new Set(),
  totalExemplos: 0,
  totalConfirmados: 0,
  suavizacao: 0.2,

  palavras(texto) {
    const limpo = String(texto ?? '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const lista = limpo.split(/[^a-z0-9]+/)
      .filter((p) => p.length >= 3 && !this.vazias.has(p))
      .map((p) => (p.length > 4 && p.endsWith('s') ? p.slice(0, -1) : p));
    return [...new Set(lista)];
  },

  treinar(linhasPalavra, linhasMotivo, vazias) {
    if (vazias) this.vazias = new Set(vazias.map((v) => v.palavra));
    this.classes = linhasMotivo.filter((m) => m.exemplos > 0).map((m) => m.motivo_codigo);
    this.exemplosPorClasse = new Map(linhasMotivo.map((m) => [m.motivo_codigo, m.exemplos]));
    this.totalExemplos = linhasMotivo.reduce((s, m) => s + m.exemplos, 0);
    this.totalConfirmados = linhasMotivo.reduce((s, m) => s + m.confirmados, 0);
    this.contagem = new Map();
    this.totalPorClasse = new Map();
    this.totalPorPalavra = new Map();
    this.vocabulario = new Set();
    linhasPalavra.forEach(({ palavra, motivo_codigo, contagem }) => {
      if (!this.exemplosPorClasse.has(motivo_codigo)) return;
      this.contagem.set(`${palavra}|${motivo_codigo}`, contagem);
      this.totalPorClasse.set(motivo_codigo, (this.totalPorClasse.get(motivo_codigo) || 0) + contagem);
      this.totalPorPalavra.set(palavra, (this.totalPorPalavra.get(palavra) || 0) + contagem);
      this.vocabulario.add(palavra);
    });
  },

  contar(palavra, classe, sem) {
    const c = this.contagem.get(`${palavra}|${classe}`) || 0;
    return sem && sem.classe === classe && sem.palavras.has(palavra) ? c - 1 : c;
  },

  conhece(palavra, sem) {
    const total = this.totalPorPalavra.get(palavra) || 0;
    return (sem && sem.palavras.has(palavra) ? total - 1 : total) > 0;
  },

  sugerir(texto, quantas = 3, sem = null) {
    const conhecidas = this.palavras(texto).filter((p) => this.conhece(p, sem));
    const exemplos = (c) => (this.exemplosPorClasse.get(c) || 0) - (sem && sem.classe === c ? 1 : 0);
    const classes = this.classes.filter((c) => exemplos(c) > 0);
    if (!conhecidas.length || !classes.length) return [];

    const vocab = this.vocabulario.size - (sem ? [...sem.palavras].filter((p) => this.totalPorPalavra.get(p) === 1).length : 0);
    const totalExemplos = this.totalExemplos - (sem ? 1 : 0);
    const prob = (p, c) => {
      const totalClasse = (this.totalPorClasse.get(c) || 0) - (sem && sem.classe === c ? sem.palavras.size : 0);
      return (this.contar(p, c, sem) + this.suavizacao) / (totalClasse + this.suavizacao * vocab);
    };

    const pontos = classes.map((c) => {
      let log = Math.log((exemplos(c) + 1) / (totalExemplos + classes.length));
      conhecidas.forEach((p) => { log += Math.log(prob(p, c)); });
      return { codigo: c, log };
    });

    const maior = Math.max(...pontos.map((p) => p.log));
    const soma = pontos.reduce((s, p) => s + Math.exp(p.log - maior), 0);
    return pontos
      .map((p) => ({
        codigo: p.codigo,
        chance: Math.exp(p.log - maior) / soma,
        porque: conhecidas
          .filter((w) => this.contar(w, p.codigo, sem) > 0)
          .sort((a, b) => prob(b, p.codigo) - prob(a, p.codigo))
          .slice(0, 3),
      }))
      .sort((a, b) => b.chance - a.chance)
      .slice(0, quantas);
  },

  decidir(sugestoes) {
    const lista = sugestoes.filter((s) => s.chance >= 0.12 && s.porque.length);
    const segunda = lista[1]?.chance || 0;
    const confiante = lista.length > 0 && lista[0].chance >= 0.35 && lista[0].chance - segunda >= 0.15;
    return { lista, confiante };
  },

  avaliar(exemplos) {
    const r = { acertou: 0, errou: 0, semSugestao: 0, total: 0, confirmados: 0 };
    exemplos.forEach((ex) => {
      if (!this.exemplosPorClasse.get(ex.motivo_codigo)) return;
      const sem = { classe: ex.motivo_codigo, palavras: new Set(this.palavras(ex.texto)) };
      const { lista, confiante } = this.decidir(this.sugerir(ex.texto, 3, sem));
      r.total++;
      if (ex.origem === 'CONFIRMADO') r.confirmados++;
      if (!confiante) r.semSugestao++;
      else if (lista[0].codigo === ex.motivo_codigo) r.acertou++;
      else r.errou++;
    });
    return r;
  },
};
