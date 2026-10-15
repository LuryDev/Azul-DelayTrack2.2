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
    this.vocabulario = new Set();
    linhasPalavra.forEach(({ palavra, motivo_codigo, contagem }) => {
      if (!this.exemplosPorClasse.has(motivo_codigo)) return;
      this.contagem.set(`${palavra}|${motivo_codigo}`, contagem);
      this.totalPorClasse.set(motivo_codigo, (this.totalPorClasse.get(motivo_codigo) || 0) + contagem);
      this.vocabulario.add(palavra);
    });
  },

  probPalavra(palavra, classe) {
    const c = this.contagem.get(`${palavra}|${classe}`) || 0;
    return (c + this.suavizacao) / ((this.totalPorClasse.get(classe) || 0) + this.suavizacao * this.vocabulario.size);
  },

  sugerir(texto, quantas = 3) {
    const conhecidas = this.palavras(texto).filter((p) => this.vocabulario.has(p));
    if (!conhecidas.length || !this.classes.length) return [];

    const k = this.classes.length;
    const pontos = this.classes.map((classe) => {
      let log = Math.log((this.exemplosPorClasse.get(classe) + 1) / (this.totalExemplos + k));
      conhecidas.forEach((p) => { log += Math.log(this.probPalavra(p, classe)); });
      return { codigo: classe, log };
    });

    const maior = Math.max(...pontos.map((p) => p.log));
    const soma = pontos.reduce((s, p) => s + Math.exp(p.log - maior), 0);
    return pontos
      .map((p) => ({
        codigo: p.codigo,
        chance: Math.exp(p.log - maior) / soma,
        porque: conhecidas
          .filter((w) => this.contagem.has(`${w}|${p.codigo}`))
          .sort((a, b) => this.probPalavra(b, p.codigo) - this.probPalavra(a, p.codigo))
          .slice(0, 3),
      }))
      .sort((a, b) => b.chance - a.chance)
      .slice(0, quantas);
  },
};
