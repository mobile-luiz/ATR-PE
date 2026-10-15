'use strict';

/* =========================================================
   Preço de Cana — sistema do fornecedor de cana (PE)
   HTML + CSS + JavaScript puro, dados salvos no navegador
   ========================================================= */

const CHAVE = 'conta-da-cana-v1'; // nome interno mantido para não perder os dados já salvos
const CANA_PADRAO = 119.0063; // kg de ATR por tonelada (Consecana-PE)
const URL_AFCP = 'https://afcp.com.br/atr/';
const INTERVALO_BUSCA = 60 * 60 * 1000; // confere a AFCP a cada 1 hora
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/* ---------- Estado ---------- */
function estadoInicial() {
  return {
    perfil: { nome: '', cpf: '', usina: '' },
    entregas: [],
    // Valores publicados pela AFCP (confira e atualize na tela Preço ATR)
    precos: {
      '2026-05': { kg: 1.1904, tipo: 'final', fonte: 'AFCP' },
      '2026-06': { kg: 1.1705, tipo: 'final', fonte: 'AFCP' },
      '2026-09': { kg: 1.2557, tipo: 'final', fonte: 'AFCP' },
      '2026-10': { kg: 1.2935, tipo: 'estimativa', fonte: 'AFCP (2ª estimativa)' }
    },
    descontos: [
      { id: 'd1', nome: 'Contribuição rural (Funrural)', tipo: 'percentual', valor: 1.5, ativo: false }
    ],
    ultimaBusca: null
  };
}

function carregar() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (bruto) return Object.assign(estadoInicial(), JSON.parse(bruto));
  } catch (e) { /* armazenamento indisponível: começa vazio */ }
  return estadoInicial();
}

function salvar() {
  try { localStorage.setItem(CHAVE, JSON.stringify(st)); }
  catch (e) { toast('Não foi possível salvar neste navegador.'); }
}

/* Histórico oficial da AFCP (preço da tonelada de cana padrão, R$/t).
   Fonte: PDF "Preço referencial da tonelada de cana padrão pelo sistema ATR de Pernambuco".
   Meses passados não mudam; o restante é completado sozinho pelo PDF atual da AFCP. */
const HISTORICO_TON = {
  '2021-09': 167.7275, '2021-10': 168.4296, '2021-11': 177.9501, '2021-12': 176.2483,
  '2022-01': 171.2501, '2022-02': 167.5252, '2022-03': 172.1783, '2022-04': 177.7716,
  '2022-07': 183.7695, '2022-08': 166.7516, '2022-09': 158.5045, '2022-10': 154.6368,
  '2022-11': 162.1818, '2022-12': 165.8115, '2023-01': 165.6092, '2023-02': 166.2875,
  '2023-03': 170.2385, '2023-04': 179.8304, '2023-05': 188.2680, '2023-06': 184.0432,
  '2023-07': 175.2606, '2023-08': 170.3456, '2023-09': 176.7839, '2023-10': 176.3792,
  '2023-11': 171.9284, '2023-12': 158.8615, '2024-01': 158.9210, '2024-02': 165.2879,
  '2024-03': 172.5115, '2024-04': 174.7846, '2024-05': 169.6792, '2024-06': 171.6071,
  '2024-07': 174.7250, '2024-08': 171.2382, '2026-05': 141.6651, '2026-06': 139.2969,
  '2026-08': 139.2731
};

// Kg de ATR bruto de PE divulgado pelo Consecana-PE (Notícias Agrícolas / Sindaçúcar-AL).
// Substituído automaticamente pelo valor do PDF da AFCP quando ele for lido.
const HISTORICO_KG_OUTRAS = {
  '2026-01': 1.1959, '2026-02': 1.1950, '2026-03': 1.2149, '2026-04': 1.1992, '2026-07': 1.1917
};

function mesclarHistorico(precos, tabelaTon, fonte) {
  let novos = 0;
  for (const [mes, ton] of Object.entries(tabelaTon)) {
    const atual = precos[mes];
    // não mexe em valor fechado vindo da própria AFCP
    if (atual && atual.tipo === 'final' && String(atual.fonte || '').startsWith('AFCP')) continue;
    if (atual && atual.tipo === 'final' && !fonte.startsWith('AFCP')) continue;
    precos[mes] = { kg: Math.round(ton / CANA_PADRAO * 10000) / 10000, ton, tipo: 'final', fonte };
    novos++;
  }
  return novos;
}

let st = carregar();
mesclarHistorico(st.precos, HISTORICO_TON, 'AFCP (histórico)');
mesclarHistorico(st.precos, Object.fromEntries(Object.entries(HISTORICO_KG_OUTRAS).map(([k, v]) => [k, v * CANA_PADRAO])), 'Consecana-PE (Notícias Agrícolas)');
let modoGrafico = 'tempo'; // 'tempo' (mês a mês) ou 'safras' (ano contra ano)
let viewAtual = 'painel';
let safraSel = safraDe(hojeISO());
let editandoEntrega = null;
let buscando = false;
let ultimoHtmlAFCP = '';
let avisoBusca = null; // mensagem da última tentativa que falhou

/* ---------- Utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = n => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const nf = (n, d = 2) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

function lerNum(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(/^R\$/, '');
  if (!s) return NaN;
  return parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
}

function hojeISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
const mesDe = iso => iso.slice(0, 7);

// Safra de Pernambuco: setembro a agosto
function safraDe(iso) {
  const a = +iso.slice(0, 4), m = +iso.slice(5, 7);
  return m >= 9 ? `${a}/${a + 1}` : `${a - 1}/${a}`;
}

function mesesDaSafra(safra) {
  const a = +safra.slice(0, 4);
  const lista = [];
  for (let i = 0; i < 12; i++) {
    const m = ((8 + i) % 12) + 1;
    const ano = m >= 9 ? a : a + 1;
    lista.push(`${ano}-${String(m).padStart(2, '0')}`);
  }
  return lista;
}

function rotuloMes(chave) {
  const [a, m] = chave.split('-');
  return `${MESES_CURTOS[+m - 1]}/${a}`;
}
function rotuloMesLongo(chave) {
  const [a, m] = chave.split('-');
  return `${MESES[+m - 1]} de ${a}`;
}
const dataBR = iso => iso.split('-').reverse().join('/');

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('visivel');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('visivel'), 3600);
}

function baixar(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ---------- Preço e cálculo ---------- */
function precoDoMes(mes) {
  const p = st.precos[mes];
  if (p) return { ...p, mes };
  const chaves = Object.keys(st.precos).sort();
  const anteriores = chaves.filter(k => k < mes);
  const base = anteriores.length ? anteriores[anteriores.length - 1] : chaves[0];
  if (!base) return null;
  return { kg: st.precos[base].kg, tipo: 'projetado', fonte: `repete ${rotuloMes(base)}`, mes: base };
}

function ultimoPreco(tipo) {
  const chaves = Object.keys(st.precos).filter(k => !tipo || st.precos[k].tipo === tipo).sort();
  const k = chaves[chaves.length - 1];
  return k ? { ...st.precos[k], mes: k } : null;
}

function calcular(toneladas, atr, kg, comDescontos = true) {
  const porTon = atr * kg;
  const bruto = porTon * toneladas;
  const itens = [].map(d => ({
    nome: d.nome,
    valor: d.tipo === 'percentual' ? bruto * d.valor / 100 : d.valor * toneladas
  }));
  const desc = itens.reduce((s, i) => s + i.valor, 0);
  return { porTon, bruto, itens, desc, liquido: bruto - desc };
}

function calcEntrega(e) {
  const preco = precoDoMes(mesDe(e.data));
  if (!preco) return { preco: null, porTon: 0, bruto: 0, desc: 0, liquido: 0, itens: [] };
  return { preco, ...calcular(e.toneladas, e.atr, preco.kg) };
}


function safrasDisponiveis() {
  const s = new Set([safraDe(hojeISO()), ...st.entregas.map(e => safraDe(e.data))]);
  return [...s].sort().reverse();
}

function resumoSafra(safra) {
  const r = { ton: 0, atrTon: 0, bruto: 0, desc: 0, liquido: 0, conf: 0, prev: 0, semPreco: 0, n: 0, porMes: {} };
  for (const e of st.entregas) {
    if (safraDe(e.data) !== safra) continue;
    const c = calcEntrega(e);
    r.n++;
    r.ton += e.toneladas;
    r.atrTon += e.atr * e.toneladas;
    if (!c.preco) { r.semPreco++; continue; }
    r.bruto += c.bruto; r.desc += c.desc; r.liquido += c.liquido;
    if (c.preco.tipo === 'final') r.conf += c.liquido; else r.prev += c.liquido;
    const m = mesDe(e.data);
    const pm = r.porMes[m] || (r.porMes[m] = { bruto: 0, final: true });
    pm.bruto += c.bruto;
    if (c.preco.tipo !== 'final') pm.final = false;
  }
  return r;
}

function seloPreco(preco) {
  if (!preco) return '<span class="selo sem">Sem preço</span>';
  const nomes = { final: 'Confirmado', estimativa: 'Estimado', projetado: 'Projetado' };
  return `<span class="selo ${preco.tipo}" title="${esc(preco.fonte || '')}">${nomes[preco.tipo] || preco.tipo}</span>`;
}

/* ---------- Busca do ATR no site da AFCP ---------- */
async function buscarComTempo(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r;
  } finally { clearTimeout(t); }
}

function textoDoHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ');
}

function numeroDoMes(nome) {
  const limpar = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return MESES.map(limpar).indexOf(limpar(nome)) + 1;
}

function extrairATR(html) {
  const t = textoDoHtml(html);
  const m = t.match(/Kg do ATR para o m[êe]s de ([A-Za-zÀ-ú]+) de (\d{4}) [ée] de R\$\s*(\d+,\d+)/i);
  const e = t.match(/(\d+)\s*[ªaº°]\s*estimativa.*?m[êe]s de ([A-Za-zÀ-ú]+) de (\d{4}) [ée] de R\$\s*(\d+,\d+)/i);
  const montar = (nomeMes, ano, valor) => {
    const n = numeroDoMes(nomeMes);
    return n ? { mes: `${ano}-${String(n).padStart(2, '0')}`, kg: lerNum(valor) } : null;
  };
  const mensal = m ? montar(m[1], m[2], m[3]) : null;
  const estimativa = e ? { ...montar(e[2], e[3], e[4]), numero: e[1] } : null;
  if (!mensal && !(estimativa && estimativa.mes)) return null;
  return { mensal, estimativa: estimativa && estimativa.mes ? estimativa : null };
}

const FONTES_ATR = [
  {
    nome: 'site da AFCP',
    ler: async () => {
      const r = await buscarComTempo('https://afcp.com.br/wp-json/wp/v2/pages?slug=atr&_fields=content');
      const j = await r.json();
      return j[0].content.rendered;
    }
  },
  {
    nome: 'site da AFCP (via allorigins)',
    ler: async () => (await buscarComTempo('https://api.allorigins.win/raw?url=' + encodeURIComponent(URL_AFCP))).text()
  },
  {
    nome: 'site da AFCP (via corsproxy)',
    ler: async () => (await buscarComTempo('https://corsproxy.io/?url=' + encodeURIComponent(URL_AFCP))).text()
  }
];

/* ---------- Histórico pelo PDF da AFCP ---------- */
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
let buscandoHistorico = false;

function carregarPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((ok, erro) => {
    const sc = document.createElement('script');
    sc.src = PDFJS + 'pdf.min.js';
    sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; ok(window.pdfjsLib); };
    sc.onerror = () => erro(new Error('não carregou o leitor de PDF'));
    document.head.appendChild(sc);
  });
}

function linkPdfHistorico(html) {
  const m = html.match(/https?:\/\/[^"'\s>]*ATR_Preco_referencial_tonelada_Cana_pe\.pdf/i);
  return m ? m[0].replace(/^http:/, 'https:') : null;
}

async function baixarPdf(url) {
  const tentativas = [
    url,
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
    'https://corsproxy.io/?url=' + encodeURIComponent(url)
  ];
  for (const u of tentativas) {
    try {
      const buf = new Uint8Array(await (await buscarComTempo(u, 20000)).arrayBuffer());
      if (String.fromCharCode(...buf.slice(0, 4)) === '%PDF') return buf;
    } catch (e) { /* tenta o próximo */ }
  }
  return null;
}

async function linhasDoPdf(bytes) {
  const pdfjs = await carregarPdfJs();
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const linhas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pag = await doc.getPage(n);
    const itens = (await pag.getTextContent()).items
      .filter(i => i.str && i.str.trim())
      .map(i => ({ t: i.str.trim(), x: i.transform[4], y: i.transform[5] }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const grupos = [];
    for (const it of itens) {
      const g = grupos.find(g => Math.abs(g.y - it.y) < 3);
      if (g) g.itens.push(it); else grupos.push({ y: it.y, itens: [it] });
    }
    grupos.forEach(g => linhas.push(g.itens.sort((a, b) => a.x - b.x).map(i => i.t).join(' ')));
  }
  return linhas;
}

// Cada linha começa com o mês; os valores mais à direita são os anos mais recentes.
function historicoDoPdf(linhas) {
  const nomes = 'Janeiro|Fevereiro|Mar[çc]o|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro';
  const ref = linhas.join(' ').match(new RegExp(`\\b(${nomes})\\s+(20\\d{2})\\b`, 'i'));
  if (!ref) return null;
  const mesRef = numeroDoMes(ref[1]), anoRef = +ref[2];
  const ton = {};
  for (const linha of linhas) {
    const m = linha.trim().match(new RegExp(`^(${nomes})\\s+(.*)$`, 'i'));
    if (!m) continue;
    const mes = numeroDoMes(m[1]);
    const tokens = m[2].split(/\s+/).filter(t => /^[\d.,-]+$/.test(t));
    const ultimoAno = mes <= mesRef ? anoRef : anoRef - 1;
    for (let i = 0; i < 4 && i < tokens.length; i++) {
      const tk = tokens[tokens.length - 1 - i];
      if (!/^\d{2,3}[.,]\d{2,4}$/.test(tk)) continue; // ignora valores quebrados no PDF
      const v = parseFloat(tk.replace(',', '.'));
      if (v > 20 && v < 400) ton[`${ultimoAno - i}-${String(mes).padStart(2, '0')}`] = v;
    }
  }
  return Object.keys(ton).length ? { ref: `${anoRef}-${String(mesRef).padStart(2, '0')}`, ton } : null;
}

async function atualizarHistorico() {
  if (buscandoHistorico) return;
  const url = linkPdfHistorico(ultimoHtmlAFCP);
  if (!url) return;
  const h = st.historico;
  const SETE_DIAS = 7 * 24 * 60 * 60 * 1000;
  if (h && h.url === url && Date.now() - new Date(h.quando).getTime() < SETE_DIAS) return;
  buscandoHistorico = true;
  try {
    const bytes = await baixarPdf(url);
    if (!bytes) throw new Error('PDF não baixou');
    const dados = historicoDoPdf(await linhasDoPdf(bytes));
    if (!dados) throw new Error('PDF sem tabela reconhecida');
    const novos = mesclarHistorico(st.precos, dados.ton, 'AFCP (histórico)');
    st.historico = { url, quando: new Date().toISOString(), ref: dados.ref, meses: Object.keys(dados.ton).length };
    salvar();
    renderTudo();
    if (novos) toast(`Histórico da AFCP atualizado: ${novos} mês(es) anterior(es).`);
  } catch (e) {
    console.warn('Histórico ATR:', e);
  } finally {
    buscandoHistorico = false;
  }
}

async function atualizarATR(silencioso = false) {
  if (buscando) return;
  buscando = true;
  const jaBuscouAntes = !!st.ultimaBusca; // na primeira busca não avisa (só carrega)
  definirStatusBusca('Buscando o preço no site da AFCP…', true);
  let resultado = null, origem = '';
  for (const fonte of FONTES_ATR) {
    try {
      const html = await fonte.ler();
      const dados = extrairATR(html);
      if (dados) ultimoHtmlAFCP = html;
      if (dados) { resultado = dados; origem = fonte.nome; break; }
    } catch (err) { console.warn('ATR: falhou em', fonte.nome, err); }
  }
  buscando = false;

  if (!resultado) {
    avisoBusca = 'Não deu para ler o site da AFCP agora. O sistema tenta de novo sozinho em alguns minutos.';
    if (!silencioso) toast('A busca no site da AFCP falhou. O sistema tenta de novo sozinho.');
    renderTudo();
    return;
  }

  const novidades = [];
  const detalhes = [];
  const descrever = (p, tipo) => `${rotuloMes(p.mes)} ${tipo}: R$ ${nf(p.kg, 4)}/kg (${brl(p.kg * CANA_PADRAO)}/t)`;
  const { mensal, estimativa } = resultado;
  if (mensal) {
    const atual = st.precos[mensal.mes];
    if (!atual || atual.tipo !== 'final' || atual.kg !== mensal.kg) { novidades.push(`${rotuloMes(mensal.mes)} fechado`); detalhes.push(descrever(mensal, 'fechado')); }
    st.precos[mensal.mes] = { kg: mensal.kg, tipo: 'final', fonte: 'AFCP' };
  }
  if (estimativa) {
    const atual = st.precos[estimativa.mes];
    if (!atual || atual.tipo !== 'final') {
      if (!atual || atual.kg !== estimativa.kg) { novidades.push(`${rotuloMes(estimativa.mes)} estimado`); detalhes.push(descrever(estimativa, 'estimado')); }
      st.precos[estimativa.mes] = { kg: estimativa.kg, tipo: 'estimativa', fonte: `AFCP (${estimativa.numero}ª estimativa)` };
    }
  }
  avisoBusca = null;
  st.ultimaBusca = { quando: new Date().toISOString(), origem };
  atualizarHistorico(); // completa meses e anos anteriores pelo PDF da AFCP (em segundo plano)
  salvar();
  renderTudo();
  if (!silencioso || novidades.length) {
    toast(novidades.length ? `Preço atualizado: ${novidades.join(' e ')}.` : 'Preço conferido, sem mudanças.');
  }
  // conta ao service worker o que já foi lido, para ele não avisar de novo em segundo plano
  enviarAoServiceWorker({ tipo: 'estado-atr', estado: { mensal, estimativa } });
  if (novidades.length && jaBuscouAntes) notificarPreco(detalhes);
}

function textoUltimaBusca() {
  if (avisoBusca) return avisoBusca;
  if (!st.ultimaBusca) return 'Ainda não buscou no site da AFCP.';
  const d = new Date(st.ultimaBusca.quando);
  const prox = new Date(d.getTime() + INTERVALO_BUSCA);
  const hora = x => x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `Atualização automática ligada. Última busca: ${d.toLocaleDateString('pt-BR')} às ${hora(d)}, pelo ${st.ultimaBusca.origem}. Próxima: ${hora(prox)}.`;
}

function definirStatusBusca(msg, carregando) {
  document.querySelectorAll('[data-status-busca]').forEach(el => { el.textContent = msg; });
  document.querySelectorAll('[data-acao="buscar-atr"]').forEach(b => {
    b.disabled = carregando;
    b.textContent = carregando ? 'Buscando…' : 'Atualizar agora';
  });
}

/* ---------- Telas ---------- */
function opcoesSafra(sel) {
  return safrasDisponiveis().map(s => `<option value="${s}" ${s === sel ? 'selected' : ''}>Safra ${s}</option>`).join('');
}

function blocoPrecoAtual() {
  const fechado = ultimoPreco('final');
  const estim = ultimoPreco('estimativa');
  const linha = (titulo, p) => p ? `
    <div class="preco-linha">
      <div><span>${titulo}</span><span class="sutil">${rotuloMesLongo(p.mes)} · cana padrão ${brl(p.kg * CANA_PADRAO)}/t</span></div>
      <strong>R$ ${nf(p.kg, 4)}</strong>
    </div>` : '';
  return `
    <article class="bloco">
      <h2>Preço do kg de ATR</h2>
      ${linha('Último mês fechado', fechado)}
      ${estim && (!fechado || estim.mes > fechado.mes) ? linha('Estimativa do mês', estim) : ''}
      ${!fechado && !estim ? '<p class="sutil">Nenhum preço lançado.</p>' : ''}
      <div class="acoes" style="margin-top:14px">
        <button class="btn" data-acao="buscar-atr">Atualizar agora</button>
      </div>
      <p class="sutil" data-status-busca style="margin-top:10px">${esc(textoUltimaBusca())}</p>
    </article>`;
}

function graficoSafra(safra, r) {
  const meses = mesesDaSafra(safra);
  const max = Math.max(1, ...meses.map(m => (r.porMes[m] || {}).bruto || 0));
  const L = 720, A = 240, base = 200, larg = L / 12;
  const barras = meses.map((m, i) => {
    const d = r.porMes[m];
    const v = d ? d.bruto : 0;
    const h = v ? Math.max(3, (v / max) * 160) : 0;
    const x = i * larg + larg * 0.18;
    const w = larg * 0.64;
    const rotV = v >= 1000 ? `${nf(v / 1000, 1)} mil` : v ? nf(v, 0) : '';
    return `
      ${h ? `<rect class="${d.final ? 'barra-final' : 'barra-prev'}" x="${x}" y="${base - h}" width="${w}" height="${h}" rx="3"><title>${rotuloMes(m)}: ${brl(v)}</title></rect>` : ''}
      ${rotV ? `<text class="valor" x="${x + w / 2}" y="${base - h - 6}" text-anchor="middle">${rotV}</text>` : ''}
      <text x="${x + w / 2}" y="${base + 20}" text-anchor="middle">${MESES_CURTOS[+m.slice(5) - 1]}</text>`;
  }).join('');
  return `
    <div class="grafico-wrap"><svg class="grafico" viewBox="0 0 ${L} ${A}" role="img" aria-label="Valor bruto por mês da safra ${safra}">
      <line class="eixo" x1="0" x2="${L}" y1="${base}" y2="${base}"/>
      ${barras}
    </svg></div>
    <div class="legenda"><span><i style="background:var(--folha)"></i>Preço confirmado</span><span><i style="background:var(--colmo)"></i>Estimado ou projetado</span></div>`;
}

function renderPainel() {
  const r = resumoSafra(safraSel);
  const atrMedio = r.ton ? r.atrTon / r.ton : 0;
  const precoMedio = r.atrTon && r.bruto ? r.bruto / r.atrTon : (ultimoPreco() || {}).kg || 0;
  const p = st.perfil;

  $('#v-painel').innerHTML = `
    <header class="topo">
      <div>
        <h1>Safra ${safraSel}</h1>
        <p>${p.nome ? esc(p.nome) : 'Seu canavial'}${p.usina ? `, entregando na ${esc(p.usina)}` : ''}. Valores calculados com o ATR de cada carga e o preço do mês da entrega.</p>
      </div>
      <label>Safra<select data-sel-safra>${opcoesSafra(safraSel)}</select></label>
    </header>

    <div class="grade-2">
      <article class="ticket">
        <p class="ticket-rotulo">${r.n ? 'A receber nesta safra' : 'Nenhuma entrega lançada nesta safra'}</p>
        <p class="ticket-valor">${brl(r.liquido)}</p>
        <div class="ticket-conta">
          <div><span>${nf(r.ton)}</span><small>toneladas</small></div>
          <b>×</b>
          <div><span>${nf(atrMedio)}</span><small>kg de ATR por t</small></div>
          <b>×</b>
          <div><span>${nf(precoMedio, 4)}</span><small>R$ por kg de ATR</small></div>
        </div>
        <div class="ticket-pe">
          <div><small>Bruto</small><strong>${brl(r.bruto)}</strong></div>
          <div><small>Entregas</small><strong>${r.n}</strong></div>
          <div><small>Com preço confirmado</small><strong>${brl(r.conf)}</strong></div>
          <div><small>Ainda pode mudar</small><strong>${brl(r.prev)}</strong></div>
        </div>
        ${r.semPreco ? `<p class="aviso">${r.semPreco} entrega(s) ainda sem preço de ATR. O valor entra assim que a AFCP publicar.</p>` : ''}
        ${!r.n ? `<div class="acoes" style="margin-top:16px"><button class="btn" data-ir="entregas">Lançar a primeira entrega</button></div>` : ''}
      </article>
      ${blocoPrecoAtual()}
    </div>

    <article class="bloco">
      <h2>Valor bruto por mês</h2>
      ${graficoSafra(safraSel, r)}
    </article>

    <div class="acoes">
      <button class="btn sec" data-acao="whatsapp" ${r.n ? '' : 'disabled'}>Enviar resumo pelo WhatsApp</button>
    </div>
    <p class="sutil" style="margin-top:14px">Previsão feita com os valores de referência do Consecana-PE. O valor oficial é o do demonstrativo da usina.</p>`;
}

function renderEntregas() {
  const e = editandoEntrega ? st.entregas.find(x => x.id === editandoEntrega) : null;
  const lista = st.entregas.filter(x => safraDe(x.data) === safraSel).sort((a, b) => b.data.localeCompare(a.data));
  let tot = { ton: 0, atrTon: 0, bruto: 0, liq: 0 };

  const linhas = lista.map(x => {
    const c = calcEntrega(x);
    tot.ton += x.toneladas; tot.atrTon += x.atr * x.toneladas; tot.bruto += c.bruto; tot.liq += c.liquido;
    return `<tr>
      <td>${dataBR(x.data)}</td>
      <td>${esc(x.ticket || '—')}</td>
      <td class="n">${nf(x.toneladas)}</td>
      <td class="n">${nf(x.atr)}</td>
      <td class="n">${c.preco ? nf(c.preco.kg, 4) : '—'}</td>
      <td class="n">${c.preco ? brl(c.porTon) : '—'}</td>
      <td class="n">${brl(c.bruto)}</td>
      <td class="n">${brl(c.liquido)}</td>
      <td>${seloPreco(c.preco)}</td>
      <td><button class="link-btn" data-acao="editar-entrega" data-id="${x.id}">Editar</button><button class="link-btn perigo" data-acao="excluir-entrega" data-id="${x.id}">Excluir</button></td>
    </tr>`;
  }).join('');


  $('#v-entregas').innerHTML = `
    <header class="topo">
      <div><h1>Entregas</h1><p>Cada carga com o ATR medido pela usina. O valor usa o preço do mês da entrega.</p></div>
      <label>Safra<select data-sel-safra>${opcoesSafra(safraSel)}</select></label>
    </header>

    <form id="f-entrega" class="bloco form-grid" autocomplete="off">
      <h2>${e ? 'Editar entrega' : 'Lançar entrega'}</h2>
      <label>Data da entrega<input type="date" name="data" required value="${e ? e.data : hojeISO()}"></label>
      <label>Ticket da balança<input name="ticket" value="${e ? esc(e.ticket) : ''}" placeholder="Ex.: 104532"></label>
      <label>Toneladas<input name="toneladas" inputmode="decimal" required value="${e ? nf(e.toneladas) : ''}" placeholder="Ex.: 32,45"></label>
      <label>ATR (kg/t)<input name="atr" inputmode="decimal" required value="${e ? nf(e.atr) : ''}" placeholder="Ex.: 128,30"></label>
      <label>Observação<input name="obs" value="${e ? esc(e.obs) : ''}"></label>
      <div class="previa" id="previa-entrega">Preencha toneladas e ATR para ver o valor da carga.</div>
      <div class="acoes largo">
        <button class="btn" type="submit">${e ? 'Salvar alterações' : 'Lançar entrega'}</button>
        ${e ? '<button class="btn sec" type="button" data-acao="cancelar-entrega">Cancelar edição</button>' : ''}
      </div>
    </form>

    <article class="bloco">
      <div class="topo" style="margin-bottom:12px">
        <h2 style="margin:0">Safra ${safraSel}: ${lista.length} entrega(s)</h2>
        <div class="acoes">
          <button class="btn sec mini" data-acao="importar-csv">Importar planilha (CSV)</button>
          <button class="btn sec mini" data-acao="exportar-csv" ${lista.length ? '' : 'disabled'}>Exportar CSV</button>
        </div>
      </div>
      ${lista.length ? `<div class="rolagem"><table>
        <thead><tr><th>Data</th><th>Ticket</th><th class="n">Toneladas</th><th class="n">ATR</th><th class="n">R$/kg ATR</th><th class="n">R$/t</th><th class="n">Bruto</th><th class="n">Líquido</th><th>Preço</th><th></th></tr></thead>
        <tbody>${linhas}</tbody>
        <tfoot><tr><td colspan="2">Total</td><td class="n">${nf(tot.ton)}</td><td class="n">${nf(tot.ton ? tot.atrTon / tot.ton : 0)}</td><td></td><td></td><td class="n">${brl(tot.bruto)}</td><td class="n">${brl(tot.liq)}</td><td colspan="2"></td></tr></tfoot>
      </table></div>` : '<p class="vazio">Nenhuma entrega nesta safra. Lance a primeira no formulário acima ou importe a planilha da usina.</p>'}
      <p class="sutil" style="margin-top:12px">Formato do CSV para importar: data;ticket;toneladas;atr (ex.: 15/09/2026;104532;32,45;128,3).</p>
    </article>`;
  atualizarPreviaEntrega();
}

function atualizarPreviaEntrega() {
  const f = $('#f-entrega');
  if (!f) return;
  const ton = lerNum(f.elements.toneladas.value), atr = lerNum(f.elements.atr.value), data = f.elements.data.value;
  const el = $('#previa-entrega');
  if (!(ton > 0) || !(atr > 0) || !data) { el.textContent = 'Preencha toneladas e ATR para ver o valor da carga.'; return; }
  const preco = precoDoMes(mesDe(data));
  if (!preco) { el.innerHTML = 'Ainda sem preço de ATR para este mês. O valor entra assim que a AFCP publicar.'; return; }
  const c = calcular(ton, atr, preco.kg);
  el.innerHTML = `${nf(atr)} kg × R$ ${nf(preco.kg, 4)} = <strong>${brl(c.porTon)}/t</strong> · × ${nf(ton)} t = <strong>${brl(c.bruto)}</strong> bruto · líquido <strong>${brl(c.liquido)}</strong> ${seloPreco(preco)}`;
}

// Preço usado na calculadora: o mais recente publicado pela AFCP (não editável)
function precoDaCalculadora() {
  const est = ultimoPreco('estimativa'), fin = ultimoPreco('final');
  return est && (!fin || est.mes > fin.mes) ? est : fin || ultimoPreco();
}

function renderCalculadora() {
  const p = precoDaCalculadora();
  $('#v-calculadora').innerHTML = `
    <header class="topo">
      <div><h1>Calcular uma carga</h1><p>Simule quanto uma carga vale antes de lançar. Útil para comparar ATR e conversar com a usina.</p></div>
    </header>
    <div class="grade-2">
      <form id="f-calc" class="bloco form-grid" autocomplete="off">
        <label>Toneladas<input name="toneladas" inputmode="decimal" value="" placeholder="Ex.: 30"></label>
        <label>ATR da carga (kg/t)<input name="atr" inputmode="decimal" value="" placeholder="Ex.: 125"></label>
        <div class="campo-fixo">
          <span>Preço do kg de ATR (R$)</span>
          <output name="kg" aria-readonly="true">${p ? nf(p.kg, 4) : '—'}</output>
        </div>
        <p class="sutil largo">${p ? `Preço oficial da AFCP: ${p.tipo === 'final' ? 'fechado' : 'estimativa'} de ${rotuloMesLongo(p.mes)}. Atualizado automaticamente.` : 'Ainda não há preço da AFCP. Aguarde a atualização automática.'}</p>
      </form>
      <article class="ticket" id="calc-resultado"></article>
    </div>`;
  atualizarCalculadora();
}

function atualizarCalculadora() {
  const f = $('#f-calc');
  if (!f) return;
  const p = precoDaCalculadora();
  const ton = lerNum(f.elements.toneladas.value), atr = lerNum(f.elements.atr.value), kg = p ? p.kg : NaN;
  const out = $('#calc-resultado');
  if (!(kg > 0)) {
    out.innerHTML = '<p class="ticket-rotulo">Sem preço de ATR disponível para calcular.</p>';
    return;
  }
  if (!(ton > 0) || !(atr > 0)) {
    out.innerHTML = '<p class="ticket-rotulo">Preencha toneladas e ATR para ver o resultado.</p>';
    return;
  }
  const c = calcular(ton, atr, kg);
  const padrao = CANA_PADRAO * kg;
  const dif = c.porTon - padrao;
  out.innerHTML = `
    <p class="ticket-rotulo">Valor bruto da carga</p>
    <p class="ticket-valor">${brl(c.liquido)}</p>
    <div class="ticket-conta">
      <div><span>${nf(atr)}</span><small>kg de ATR por t</small></div><b>×</b>
      <div><span>${nf(kg, 4)}</span><small>R$ por kg</small></div><b>=</b>
      <div><span>${nf(c.porTon)}</span><small>R$ por tonelada</small></div>
    </div>
    <div class="ticket-pe">
      <div><small>Toneladas</small><strong>${nf(ton)}</strong></div>
      <div><small>Cana padrão (119 kg)</small><strong>${brl(padrao)}/t</strong></div>
      <div><small>${dif >= 0 ? 'Acima' : 'Abaixo'} do padrão</small><strong>${brl(Math.abs(dif))}/t</strong></div>
    </div>
    ${c.itens.length ? `<p class="sutil" style="margin-top:12px">${c.itens.map(i => `${esc(i.nome)}: ${brl(i.valor)}`).join(' · ')}</p>` : ''}`;
}

/* ---------- Gráficos de evolução do ATR ---------- */
const CORES_SAFRA = ['var(--folha)', '#C9A227', '#3B6FB6', '#B4532A', '#7A4FA0', '#4E8F88'];

const valorTon = p => p.ton ?? p.kg * CANA_PADRAO; // R$ por tonelada de cana padrão

function escalaY(valores, H, topo, base) {
  const bruto = Math.max(...valores) - Math.min(...valores) || 1;
  const passo = [5, 10, 20, 25, 50].find(p => bruto / p <= 6) || 50;
  const min = Math.floor((Math.min(...valores) - passo * 0.2) / passo) * passo;
  const max = Math.ceil((Math.max(...valores) + passo * 0.2) / passo) * passo;
  const y = v => base - (v - min) / (max - min) * (base - topo);
  const marcas = [];
  for (let v = min; v <= max + 1e-9; v += passo) marcas.push(v);
  return { y, marcas };
}

function graficoLinhaDoTempo() {
  const chaves = Object.keys(st.precos).sort();
  if (chaves.length < 2) return '<p class="vazio">Ainda não há meses suficientes para o gráfico.</p>';
  // meses contínuos do primeiro ao último
  const meses = [];
  let [a, m] = chaves[0].split('-').map(Number);
  const fim = chaves[chaves.length - 1];
  while (true) {
    const k = `${a}-${String(m).padStart(2, '0')}`;
    meses.push(k);
    if (k >= fim) break;
    m++; if (m > 12) { m = 1; a++; }
  }
  const W = 760, H = 300, esq = 54, dir = 16, topo = 18, base = H - 40;
  const passoX = (W - esq - dir) / Math.max(1, meses.length - 1);
  const x = i => esq + i * passoX;
  const { y, marcas } = escalaY(chaves.map(k => valorTon(st.precos[k])), H, topo, base);

  let caminho = '', aberto = false, pontos = '';
  meses.forEach((k, i) => {
    const p = st.precos[k];
    if (!p) { aberto = false; return; }
    caminho += `${aberto ? 'L' : 'M'}${x(i).toFixed(1)},${y(valorTon(p)).toFixed(1)} `;
    aberto = true;
    const est = p.tipo !== 'final';
    pontos += `<circle class="${est ? 'ponto-est' : 'ponto'}" cx="${x(i).toFixed(1)}" cy="${y(valorTon(p)).toFixed(1)}" r="${est ? 4.5 : 3.2}"><title>${rotuloMesLongo(k)}: ${brl(valorTon(p))}/t (R$ ${nf(p.kg, 4)}/kg)${est ? ' (estimativa)' : ''}</title></circle>`;
  });

  const grade = marcas.map(v => `
    <line class="grade" x1="${esq}" x2="${W - dir}" y1="${y(v)}" y2="${y(v)}"/>
    <text x="${esq - 8}" y="${y(v) + 4}" text-anchor="end">${nf(v, 0)}</text>`).join('');

  // faixas de safra (setembro) e rótulo do ano em janeiro
  const eixoX = meses.map((k, i) => {
    const mes = +k.slice(5);
    if (mes === 9) return `<line class="safra-div" x1="${x(i)}" x2="${x(i)}" y1="${topo}" y2="${base}"/>`;
    if (mes === 1) return `<text x="${x(i)}" y="${base + 20}" text-anchor="middle">${k.slice(0, 4)}</text><line class="eixo" x1="${x(i)}" x2="${x(i)}" y1="${base}" y2="${base + 5}"/>`;
    return '';
  }).join('');

  // destaca o último mês fechado e, se houver, a estimativa mais nova
  const idx = k => meses.indexOf(k);
  const fech = ultimoPreco('final');
  const estim = ultimoPreco('estimativa');
  const rotulos = [];
  if (fech) rotulos.push(`<text class="valor destaque" x="${x(idx(fech.mes)) - 10}" y="${y(valorTon(fech)) + 22}" text-anchor="end">${brl(valorTon(fech))}</text>`);
  if (estim && (!fech || estim.mes > fech.mes)) rotulos.push(`<text class="valor estim" x="${x(idx(estim.mes)) - 6}" y="${y(valorTon(estim)) - 12}" text-anchor="end">${brl(valorTon(estim))} est.</text>`);
  return `
    <div class="grafico-wrap"><svg class="grafico evolucao" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução do preço do kg de ATR em Pernambuco, mês a mês">
      ${grade}
      <line class="eixo" x1="${esq}" x2="${W - dir}" y1="${base}" y2="${base}"/>
      ${eixoX}
      <path class="linha-atr" d="${caminho}"/>
      ${pontos}
      ${rotulos.join('')}
    </svg></div>
    <div class="legenda"><span><i style="background:var(--folha)"></i>Mês fechado</span><span><i style="background:var(--colmo)"></i>Estimativa</span><span><i class="tracejado"></i>Início de safra (setembro)</span></div>
    <p class="sutil" style="margin-top:6px">Trechos sem linha são meses sem dado guardado.</p>`;
}

function graficoSafraContraSafra() {
  const atualIni = +safraDe(hojeISO()).slice(0, 4);
  const safras = [];
  for (let a = atualIni; a > atualIni - 6; a--) {
    const sf = `${a}/${a + 1}`;
    if (mesesDaSafra(sf).some(k => st.precos[k])) safras.push(sf);
  }
  if (!safras.length) return '<p class="vazio">Ainda não há preços guardados.</p>';
  const W = 760, H = 300, esq = 54, dir = 16, topo = 18, base = H - 40;
  const passoX = (W - esq - dir) / 11;
  const x = i => esq + i * passoX;
  const todos = safras.flatMap(sf => mesesDaSafra(sf).map(k => st.precos[k]).filter(Boolean).map(valorTon));
  const { y, marcas } = escalaY(todos, H, topo, base);
  const ordem = ['set', 'out', 'nov', 'dez', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago'];

  const linhas = safras.map((sf, idx) => {
    const cor = CORES_SAFRA[idx % CORES_SAFRA.length];
    let d = '', aberto = false, pts = '';
    mesesDaSafra(sf).forEach((k, i) => {
      const p = st.precos[k];
      if (!p) { aberto = false; return; }
      d += `${aberto ? 'L' : 'M'}${x(i).toFixed(1)},${y(valorTon(p)).toFixed(1)} `;
      aberto = true;
      pts += `<circle cx="${x(i).toFixed(1)}" cy="${y(valorTon(p)).toFixed(1)}" r="${idx === 0 ? 4 : 3}" style="fill:${cor}"><title>${sf}, ${rotuloMesLongo(k)}: ${brl(valorTon(p))}/t</title></circle>`;
    });
    return `<path d="${d}" fill="none" style="stroke:${cor}" stroke-width="${idx === 0 ? 3.2 : 2}" stroke-linejoin="round" stroke-linecap="round" ${idx === 0 ? '' : 'opacity=".85"'}/>${pts}`;
  }).reverse().join(''); // safra atual desenhada por cima

  const grade = marcas.map(v => `
    <line class="grade" x1="${esq}" x2="${W - dir}" y1="${y(v)}" y2="${y(v)}"/>
    <text x="${esq - 8}" y="${y(v) + 4}" text-anchor="end">${nf(v, 0)}</text>`).join('');

  return `
    <div class="grafico-wrap"><svg class="grafico evolucao" viewBox="0 0 ${W} ${H}" role="img" aria-label="Preço do kg de ATR por mês, uma linha por safra">
      ${grade}
      <line class="eixo" x1="${esq}" x2="${W - dir}" y1="${base}" y2="${base}"/>
      ${ordem.map((mes, i) => `<text x="${x(i)}" y="${base + 20}" text-anchor="middle">${mes}</text>`).join('')}
      ${linhas}
    </svg></div>
    <div class="legenda">${safras.map((sf, i) => `<span><i style="background:${CORES_SAFRA[i % CORES_SAFRA.length]}"></i>${sf}</span>`).join('')}</div>`;
}

function blocoGraficoEvolucao() {
  return `
    <article class="bloco">
      <div class="topo" style="margin-bottom:10px">
        <div>
          <h2 style="margin:0">Evolução do preço do ATR</h2>
          <p class="sutil" style="margin-top:4px">R$ por tonelada de cana padrão em Pernambuco${modoGrafico === 'tempo' ? ', mês a mês' : ', cada linha é uma safra'}.</p>
        </div>
        <div class="alternar" role="group" aria-label="Tipo de gráfico">
          <button class="${modoGrafico === 'tempo' ? 'ativo' : ''}" data-acao="grafico-modo" data-modo="tempo" aria-pressed="${modoGrafico === 'tempo'}">Mês a mês</button>
          <button class="${modoGrafico === 'safras' ? 'ativo' : ''}" data-acao="grafico-modo" data-modo="safras" aria-pressed="${modoGrafico === 'safras'}">Safra contra safra</button>
        </div>
      </div>
      ${modoGrafico === 'tempo' ? graficoLinhaDoTempo() : graficoSafraContraSafra()}
    </article>`;
}

function renderPrecos() {
  const chaves = Object.keys(st.precos).sort().reverse();
  const linhas = chaves.map(k => {
    const p = st.precos[k];
    return `<tr>
      <td>${rotuloMesLongo(k)}</td>
      <td class="n">R$ ${nf(p.kg, 4)}</td>
      <td class="n">${brl(p.ton ?? p.kg * CANA_PADRAO)}</td>
      <td>${seloPreco({ ...p })}</td>
      <td>${esc(p.fonte || '')}</td>
    </tr>`;
  }).join('');

  $('#v-precos').innerHTML = `
    <header class="topo">
      <div><h1>Preço do ATR</h1><p>Valor do kg de ATR do Consecana-PE, publicado pela AFCP. O valor fechado substitui a estimativa quando sai.</p></div>
    </header>
    <article class="bloco">
        <h2>Buscar no site da AFCP</h2>
        <p class="sutil">O sistema lê a página de ATR da AFCP e guarda o mês fechado e a estimativa semanal. Ele confere sozinho ao abrir, a cada 1 hora enquanto estiver aberto e quando você volta para a tela. O botão é só para forçar na hora.</p>
        <div class="acoes" style="margin-top:14px">
          <button class="btn" data-acao="buscar-atr">Atualizar agora</button>
          <a class="link-btn" href="${URL_AFCP}" target="_blank" rel="noopener">Abrir a página da AFCP</a>
        </div>
        <p class="sutil" data-status-busca style="margin-top:10px">${esc(textoUltimaBusca())}</p>
    </article>
    ${blocoAppEAvisos()}
    <article class="bloco">
      <h2>Preços guardados</h2>
      ${chaves.length ? `<div class="rolagem"><table>
        <thead><tr><th>Mês</th><th class="n">R$/kg ATR</th><th class="n">Cana padrão (R$/t)</th><th>Situação</th><th>Fonte</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>` : '<p class="vazio">Nenhum preço guardado ainda. O sistema busca na AFCP automaticamente.</p>'}
      <p class="sutil" style="margin-top:12px">Meses sem preço usam o último valor anterior e aparecem como "Projetado".</p>
    </article>`;
}

function renderGrafico() {
  $('#v-grafico').innerHTML = `
    <header class="topo">
      <div><h1>Gráfico do ATR</h1><p>Evolução do preço da tonelada de cana padrão em Pernambuco, com os valores publicados pela AFCP.</p></div>
    </header>
    ${blocoGraficoEvolucao()}`;
  rolarGraficoParaFim();
}

// No celular o gráfico rola para o lado: começa mostrando os meses mais recentes
function rolarGraficoParaFim() {
  requestAnimationFrame(() => {
    document.querySelectorAll('#v-grafico .grafico-wrap').forEach(w => { w.scrollLeft = w.scrollWidth; });
  });
}

function renderTudo() {
  renderPainel();
  renderEntregas();
  renderCalculadora();
  renderPrecos();
  renderGrafico();
}

function irPara(view) {
  viewAtual = view;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('ativa', v.id === 'v-' + view));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('ativo', b.dataset.view === view));
  if (view === 'grafico') rolarGraficoParaFim();
  window.scrollTo({ top: 0 });
}

/* ---------- CSV ---------- */
function exportarCSV() {
  const lista = st.entregas.filter(x => safraDe(x.data) === safraSel).sort((a, b) => a.data.localeCompare(b.data));
  const cab = 'data;ticket;toneladas;atr_kg_t;preco_kg_atr;situacao_preco;valor_tonelada;bruto;descontos;liquido';
  const linhas = lista.map(x => {
    const c = calcEntrega(x);
    return [dataBR(x.data), x.ticket || '', nf(x.toneladas), nf(x.atr),
      c.preco ? nf(c.preco.kg, 4) : '', c.preco ? c.preco.tipo : 'sem preço',
      nf(c.porTon), nf(c.bruto), nf(c.desc), nf(c.liquido)]
      .map(v => String(v).includes(';') ? `"${v}"` : v).join(';');
  });
  baixar(`entregas-safra-${safraSel.replace('/', '-')}.csv`, '\uFEFF' + [cab, ...linhas].join('\r\n'), 'text/csv;charset=utf-8');
}

function lerData(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function importarCSV(texto) {
  const linhas = texto.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (!linhas.length) return toast('O arquivo está vazio.');
  const sep = linhas[0].includes(';') ? ';' : ',';
  let ok = 0, erro = 0;
  for (const linha of linhas) {
    const c = linha.split(sep).map(v => v.replace(/^"|"$/g, '').trim());
    const data = lerData(c[0]);
    // aceita data;ticket;toneladas;atr e também o formato antigo data;talhao;ticket;toneladas;atr
    const [ticket, tonTxt, atrTxt] = c.length >= 5 ? [c[2], c[3], c[4]] : [c[1], c[2], c[3]];
    const ton = lerNum(tonTxt), atr = lerNum(atrTxt);
    if (!data) continue; // cabeçalho ou linha inválida
    if (!(ton > 0) || !(atr > 0)) { erro++; continue; }
    st.entregas.push({ id: uid(), data, ticket: ticket || '', toneladas: ton, atr, obs: 'Importado' });
    ok++;
  }
  salvar();
  renderTudo();
  toast(`${ok} entrega(s) importada(s)${erro ? `, ${erro} linha(s) com erro ignorada(s)` : ''}.`);
}

function enviarWhatsApp() {
  const r = resumoSafra(safraSel);
  const p = st.perfil;
  const fechado = ultimoPreco('final');
  const texto = [
    `*Resumo da safra ${safraSel}*`,
    p.nome ? `Fornecedor: ${p.nome}` : null,
    p.usina ? `Usina: ${p.usina}` : null,
    `Entregas: ${r.n}`,
    `Toneladas: ${nf(r.ton)}`,
    `ATR médio: ${nf(r.ton ? r.atrTon / r.ton : 0)} kg/t`,
    `Valor bruto: ${brl(r.bruto)}`,
    `*A receber: ${brl(r.liquido)}*`,
    `(confirmado ${brl(r.conf)}, ainda pode mudar ${brl(r.prev)})`,
    fechado ? `ATR de ${rotuloMes(fechado.mes)}: R$ ${nf(fechado.kg, 4)}/kg` : null,
    '_Previsão pelo Consecana-PE. Valor oficial no demonstrativo da usina._'
  ].filter(Boolean).join('\n');
  window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank', 'noopener');
}

/* ---------- Eventos ---------- */
document.addEventListener('click', ev => {
  const nav = ev.target.closest('[data-view]');
  if (nav) { irPara(nav.dataset.view); return; }
  const ir = ev.target.closest('[data-ir]');
  if (ir) { irPara(ir.dataset.ir); return; }

  const b = ev.target.closest('[data-acao]');
  if (!b || b.tagName === 'INPUT') return;
  const id = b.dataset.id;

  switch (b.dataset.acao) {
    case 'buscar-atr': atualizarATR(); break;
    case 'ativar-avisos': ativarAvisos(); break;
    case 'desativar-avisos': desativarAvisos(); break;
    case 'testar-aviso': mostrarNotificacao('Preço do ATR (teste)', 'Assim vai chegar o aviso quando a AFCP publicar um preço novo.'); break;
    case 'instalar-app': instalarApp(); break;
    case 'grafico-modo': modoGrafico = b.dataset.modo; renderGrafico(); break;
    case 'whatsapp': enviarWhatsApp(); break;
    case 'editar-entrega':
      editandoEntrega = id; renderEntregas();
      $('#f-entrega').scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    case 'cancelar-entrega': editandoEntrega = null; renderEntregas(); break;
    case 'excluir-entrega':
      if (confirm('Excluir esta entrega?')) {
        st.entregas = st.entregas.filter(x => x.id !== id);
        if (editandoEntrega === id) editandoEntrega = null;
        salvar(); renderTudo(); toast('Entrega excluída.');
      }
      break;
    case 'importar-csv': $('#arq-csv').click(); break;
    case 'exportar-csv': exportarCSV(); break;
  }
});

document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.matches('[data-sel-safra]')) { safraSel = t.value; renderTudo(); irPara(viewAtual); return; }
  if (t.id === 'arq-csv' && t.files[0]) {
    t.files[0].text().then(importarCSV); t.value = '';
    return;
  }
});

document.addEventListener('input', ev => {
  if (ev.target.closest('#f-entrega')) atualizarPreviaEntrega();
  if (ev.target.closest('#f-calc')) atualizarCalculadora();
});
document.addEventListener('change', ev => {
  if (ev.target.closest('#f-calc')) atualizarCalculadora();
  if (ev.target.closest('#f-entrega')) atualizarPreviaEntrega();
});

document.addEventListener('submit', ev => {
  ev.preventDefault();
  const f = ev.target;

  if (f.id === 'f-entrega') {
    const ton = lerNum(f.elements.toneladas.value), atr = lerNum(f.elements.atr.value);
    if (!(ton > 0)) return toast('Informe as toneladas da carga.');
    if (!(atr > 0) || atr > 250) return toast('Informe o ATR em kg por tonelada (geralmente entre 90 e 160).');
    const dados = { data: f.elements.data.value, ticket: f.elements.ticket.value.trim(), toneladas: ton, atr, obs: f.elements.obs.value.trim() };
    if (editandoEntrega) {
      Object.assign(st.entregas.find(x => x.id === editandoEntrega), dados);
      editandoEntrega = null;
      toast('Entrega atualizada.');
    } else {
      st.entregas.push({ id: uid(), ...dados });
      toast('Entrega lançada.');
    }
    safraSel = safraDe(dados.data);
    salvar(); renderTudo(); irPara('entregas');
  }




});

/* ---------- Tabelas viram cartões no celular ---------- */
function rotularTabelas(raiz = document) {
  raiz.querySelectorAll('table').forEach(tab => {
    const titulos = [...tab.querySelectorAll('thead th')].map(th => th.textContent.trim());
    tab.querySelectorAll('tbody tr, tfoot tr').forEach(tr => {
      let col = 0;
      [...tr.children].forEach(td => {
        if (!td.dataset.label) td.dataset.label = titulos[col] || '';
        col += td.colSpan || 1;
      });
    });
  });
}
new MutationObserver(() => rotularTabelas($('#conteudo'))).observe($('#conteudo'), { childList: true, subtree: true });

/* ---------- Aplicativo (PWA) e avisos de preço ---------- */
let swRegistro = null;
let pedidoInstalacao = null; // evento guardado para mostrar o botão "Instalar"

const suportaAvisos = () => 'Notification' in window;
const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalado = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const avisosLigados = () => suportaAvisos() && Notification.permission === 'granted' && st.avisos !== false;

function enviarAoServiceWorker(msg) {
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (sw) sw.postMessage(msg);
}

// espera o service worker ficar pronto (no máximo 4 s), porque o aviso pode sair logo ao abrir o app
async function obterRegistro() {
  if (swRegistro) return swRegistro;
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return null;
  return Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 4000))]).catch(() => null);
}

async function mostrarNotificacao(titulo, corpo) {
  const opcoes = { body: corpo, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'preco-atr', renotify: true, data: { url: './#precos' } };
  try {
    const reg = await obterRegistro();
    if (reg) return await reg.showNotification(titulo, opcoes); // Android exige este caminho
    new Notification(titulo, opcoes);
  } catch (e) { console.warn('Aviso não mostrado:', e); }
}

function notificarPreco(detalhes) {
  if (!avisosLigados() || !detalhes.length) return;
  mostrarNotificacao('Preço do ATR atualizado', detalhes.join('\n'));
}

async function ativarAvisos() {
  if (!suportaAvisos()) {
    toast(ehIOS() && !instalado() ? 'No iPhone, instale o app na tela de início para receber avisos.' : 'Este navegador não mostra avisos.');
    return;
  }
  const r = await Notification.requestPermission();
  if (r === 'granted') {
    st.avisos = true; salvar();
    await registrarConferenciaPeriodica();
    mostrarNotificacao('Avisos ligados', 'Você vai ser avisado quando a AFCP publicar um preço novo do ATR.');
  } else {
    toast('Os avisos foram bloqueados. Libere nas configurações do navegador para este site.');
  }
  renderPrecos();
}

function desativarAvisos() {
  st.avisos = false; salvar();
  toast('Avisos desligados.');
  renderPrecos();
}

// Chrome com o app instalado: deixa o navegador conferir o preço mesmo com o app fechado (cerca de 2 vezes por dia)
async function registrarConferenciaPeriodica() {
  try {
    if (!swRegistro || !('periodicSync' in swRegistro)) return false;
    const perm = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (perm.state !== 'granted') return false;
    await swRegistro.periodicSync.register('checar-atr', { minInterval: 12 * 60 * 60 * 1000 });
    return true;
  } catch (e) { return false; }
}

async function instalarApp() {
  if (pedidoInstalacao) {
    pedidoInstalacao.prompt();
    const { outcome } = await pedidoInstalacao.userChoice;
    pedidoInstalacao = null;
    if (outcome === 'accepted') toast('Aplicativo instalado.');
    renderPrecos();
  } else if (ehIOS()) {
    toast('No iPhone: toque em Compartilhar e depois em "Adicionar à Tela de Início".');
  } else {
    toast('Use o menu do navegador e escolha "Instalar aplicativo" ou "Adicionar à tela inicial".');
  }
}

function blocoAppEAvisos() {
  let estadoAviso, botaoAviso;
  if (!suportaAvisos()) {
    estadoAviso = ehIOS() && !instalado()
      ? 'No iPhone os avisos só funcionam com o app instalado na tela de início (iOS 16.4 ou mais novo).'
      : 'Este navegador não mostra avisos.';
    botaoAviso = '';
  } else if (Notification.permission === 'denied') {
    estadoAviso = 'Avisos bloqueados neste navegador. Libere nas configurações do site (ícone do cadeado ao lado do endereço).';
    botaoAviso = '';
  } else if (avisosLigados()) {
    estadoAviso = 'Avisos ligados. Quando a AFCP publicar uma estimativa nova ou o valor fechado do mês, aparece uma notificação.';
    botaoAviso = '<button class="btn sec" data-acao="testar-aviso">Enviar aviso de teste</button><button class="link-btn perigo" data-acao="desativar-avisos">Desligar avisos</button>';
  } else {
    estadoAviso = 'Receba uma notificação quando a AFCP publicar um preço novo do ATR.';
    botaoAviso = '<button class="btn" data-acao="ativar-avisos">Ativar avisos de preço</button>';
  }
  const botaoInstalar = instalado()
    ? '<span class="selo final">App instalado</span>'
    : `<button class="btn sec" data-acao="instalar-app">Instalar no celular</button>`;
  return `
    <article class="bloco">
      <h2>Aplicativo e avisos</h2>
      <p class="sutil">${estadoAviso}</p>
      <div class="acoes" style="margin-top:14px">${botaoAviso}${botaoInstalar}</div>
      <p class="sutil" style="margin-top:12px">Com o app aberto ou em segundo plano, o aviso chega na hora. Com ele fechado, só o Chrome com o app instalado confere sozinho, cerca de duas vezes por dia.</p>
    </article>`;
}

function iniciarPWA() {
  window.addEventListener('beforeinstallprompt', ev => { ev.preventDefault(); pedidoInstalacao = ev; renderPrecos(); });
  window.addEventListener('appinstalled', () => { pedidoInstalacao = null; renderPrecos(); });
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then(async reg => {
    swRegistro = await navigator.serviceWorker.ready;
    if (avisosLigados()) registrarConferenciaPeriodica();
  }).catch(e => console.warn('Service worker não registrado:', e));
  navigator.serviceWorker.addEventListener('message', ev => {
    if (ev.data && ev.data.tipo === 'abrir') irPara(ev.data.view);
  });
}

/* ---------- Início ---------- */
renderTudo();
iniciarPWA();
if (location.hash === '#precos') irPara('precos');

/* ---------- Atualização automática do preço ---------- */

function buscaVencida() {
  return !st.ultimaBusca || Date.now() - new Date(st.ultimaBusca.quando).getTime() >= INTERVALO_BUSCA;
}

function verificarAutomatico() {
  if (navigator.onLine === false) return;
  if (buscaVencida()) atualizarATR(true);
}

// 1) ao abrir o sistema
verificarAutomatico();
// 2) a cada 5 minutos confere se já passou 1 hora desde a última busca
setInterval(verificarAutomatico, 5 * 60 * 1000);
// 3) quando a pessoa volta para a aba ou desbloqueia o celular
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') verificarAutomatico(); });
// 4) quando a internet volta
window.addEventListener('online', verificarAutomatico);