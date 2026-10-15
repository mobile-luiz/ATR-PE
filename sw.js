/* Service worker do Preço de Cana
   - guarda os arquivos do app para abrir mais rápido e funcionar sem internet
   - confere o preço do ATR na AFCP em segundo plano (quando o navegador permite)
   - mostra a notificação e abre o app ao tocar nela */

const VERSAO = 'preco-de-cana-v1';
const ARQUIVOS = [
  './', './index.html', './style.css', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon-64.png'
];
const CACHE_ESTADO = 'preco-de-cana-estado';
const URL_API_AFCP = 'https://afcp.com.br/wp-json/wp/v2/pages?slug=atr&_fields=content';
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const CANA_PADRAO = 119.0063;

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(nomes.filter(n => n !== VERSAO && n !== CACHE_ESTADO).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Arquivos do próprio app: tenta a internet primeiro (pega a versão nova) e usa a cópia guardada se estiver sem sinal.
self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  ev.respondWith(
    fetch(req)
      .then(resp => {
        if (resp.ok) { const copia = resp.clone(); caches.open(VERSAO).then(c => c.put(req, copia)); }
        return resp;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});

/* ---------- Conferência do preço em segundo plano ---------- */
const lerEstado = async () => {
  const r = await (await caches.open(CACHE_ESTADO)).match('ultimo-atr');
  return r ? r.json() : null;
};
const gravarEstado = async est => {
  await (await caches.open(CACHE_ESTADO)).put('ultimo-atr', new Response(JSON.stringify(est), { headers: { 'Content-Type': 'application/json' } }));
};

function textoLimpo(html) {
  const nomes = { nbsp: ' ', ecirc: 'ê', eacute: 'é', ordf: 'ª', ccedil: 'ç', atilde: 'ã', amp: '&' };
  return html.replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&([a-z]+);/g, (m, n) => nomes[n] ?? m)
    .replace(/\s+/g, ' ');
}

function mesNumero(nome) {
  const limpar = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return MESES.map(limpar).indexOf(limpar(nome)) + 1;
}

function extrair(html) {
  const t = textoLimpo(html);
  const m = t.match(/Kg do ATR para o m[êe]s de ([A-Za-zÀ-ú]+) de (\d{4}) [ée] de R\$\s*(\d+,\d+)/i);
  const e = t.match(/(\d+)\s*[ªaº°]\s*estimativa.*?m[êe]s de ([A-Za-zÀ-ú]+) de (\d{4}) [ée] de R\$\s*(\d+,\d+)/i);
  const montar = (nome, ano, v) => {
    const n = mesNumero(nome);
    return n ? { mes: `${ano}-${String(n).padStart(2, '0')}`, kg: parseFloat(v.replace(',', '.')) } : null;
  };
  return { mensal: m ? montar(m[1], m[2], m[3]) : null, estimativa: e ? montar(e[2], e[3], e[4]) : null };
}

const rotulo = k => { const [a, m] = k.split('-'); return `${MESES[+m - 1]}/${a}`; };
const reais = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function checarATR() {
  const resp = await fetch(URL_API_AFCP, { cache: 'no-store' });
  const html = (await resp.json())[0].content.rendered;
  const novo = extrair(html);
  if (!novo.mensal && !novo.estimativa) return;
  const antigo = await lerEstado();
  await gravarEstado(novo);
  if (!antigo) return; // primeira vez: só guarda, não avisa

  const mudou = [];
  const igual = (a, b) => a && b && a.mes === b.mes && a.kg === b.kg;
  if (novo.mensal && !igual(novo.mensal, antigo.mensal)) {
    mudou.push(`${rotulo(novo.mensal.mes)} fechado: R$ ${novo.mensal.kg.toFixed(4).replace('.', ',')}/kg (${reais(novo.mensal.kg * CANA_PADRAO)}/t)`);
  }
  if (novo.estimativa && !igual(novo.estimativa, antigo.estimativa)) {
    mudou.push(`${rotulo(novo.estimativa.mes)} estimado: R$ ${novo.estimativa.kg.toFixed(4).replace('.', ',')}/kg (${reais(novo.estimativa.kg * CANA_PADRAO)}/t)`);
  }
  if (mudou.length) await avisar(mudou);
}

async function avisar(linhas) {
  // se o app estiver aberto e visível, ele mesmo mostra o aviso
  const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (janelas.some(j => j.visibilityState === 'visible')) return;
  await self.registration.showNotification('Preço do ATR atualizado', {
    body: linhas.join('\n'),
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'preco-atr',
    renotify: true,
    data: { url: './#precos' }
  });
}

// Chrome com o app instalado: conferência periódica mesmo com o app fechado
self.addEventListener('periodicsync', ev => {
  if (ev.tag === 'checar-atr') ev.waitUntil(checarATR().catch(() => {}));
});

// O app avisa o service worker quando ele mesmo já leu um preço novo (para não avisar duas vezes)
self.addEventListener('message', ev => {
  const d = ev.data || {};
  if (d.tipo === 'estado-atr') ev.waitUntil(gravarEstado(d.estado));
  if (d.tipo === 'notificar') {
    ev.waitUntil(self.registration.showNotification(d.titulo, {
      body: d.corpo, icon: './icons/icon-192.png', badge: './icons/icon-192.png',
      tag: 'preco-atr', renotify: true, data: { url: './#precos' }
    }));
  }
});

self.addEventListener('notificationclick', ev => {
  ev.notification.close();
  const url = new URL(ev.notification.data?.url || './', self.registration.scope).href;
  ev.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const j of janelas) {
      if (j.url.startsWith(self.registration.scope)) { await j.focus(); j.postMessage({ tipo: 'abrir', view: 'precos' }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
