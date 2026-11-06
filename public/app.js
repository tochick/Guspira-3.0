/* Guspira Events · aplicación de una sola página sin dependencias (salvo el generador de QR). */
(() => {
  'use strict';

  // ------------------------------------------------------------ utilidades
  const app = document.getElementById('app');
  const euros = (n) => PyroCalc.euros(n);
  let pollTimer = null;
  let statusCache = null;
  // Modo demostración: rutas en memoria (sin servidor) e imágenes incrustadas.
  const DEMO = Boolean(window.GUSPIRA_DEMO);
  const ASSET = window.GUSPIRA_ASSETS || { logo: '/logo.webp', icon: '/favicon.png', symbol: '/logo-symbol.webp', text: '/logo-text.webp' };
  let memPath = DEMO ? (['pirotecnia', 'admin'].includes(location.hash.slice(1)) ? '/' + location.hash.slice(1) : '/') : '';
  let pendingAnchor = '';
  const current = () => (DEMO ? new URL(memPath, 'http://demo') : new URL(location.href));
  const curPath = () => current().pathname.replace(/\/+$/, '') || '/';
  const query = () => current().searchParams;
  const linkPath = (link) => { const u = new URL(link, 'http://demo'); return u.pathname + u.search; };
  function replaceUrl(to) { if (DEMO) memPath = to; else history.replaceState({}, '', to); }

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, String(val));
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v; // solo para contenido estático propio
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function guestId() {
    let v = '';
    try { v = localStorage.getItem('gs_guest') || ''; } catch { /* sin almacenamiento */ }
    if (v.length < 8) {
      v = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      try { localStorage.setItem('gs_guest', v); } catch { /* sin almacenamiento */ }
    }
    return v;
  }
  const memoryTokens = {};
  const getToken = (slug) => { try { return localStorage.getItem('gs_tok_' + slug) || memoryTokens[slug] || ''; } catch { return memoryTokens[slug] || ''; } };
  const setToken = (slug, t) => { memoryTokens[slug] = t; try { localStorage.setItem('gs_tok_' + slug, t); } catch { /* sin almacenamiento */ } };

  async function api(path, options = {}) {
    const headers = { 'X-Guest-Id': guestId(), ...(options.headers || {}) };
    if (options.body !== undefined) { headers['Content-Type'] = 'application/json'; }
    if (options.method && options.method !== 'GET') headers['X-Requested-With'] = 'guspira';
    const res = await fetch(path, { ...options, headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || 'Algo ha fallado. Inténtalo de nuevo.'); err.status = res.status; throw err; }
    return data;
  }

  function toast(msg, kind = '') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast show ${kind}`;
    t.style.setProperty('--toast-ms', '3800ms');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.className = 'toast'; }, 3800);
  }

  function formatDate(d, t, locale = 'es-ES') {
    if (!d) return tr('Fecha por confirmar');
    const date = new Date(d + 'T12:00:00');
    if (Number.isNaN(date.getTime())) return d;
    const txt = date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return txt.charAt(0).toUpperCase() + txt.slice(1) + (t ? ` · ${t}` : '');
  }

  let site = { name: 'Guspira Events' };
  const daysUntil = (d) => { if (!d) return null; const t = new Date(d + 'T00:00:00'); const n = new Date(); n.setHours(0, 0, 0, 0); return Math.round((t - n) / 86400000); };
  const countdown = (d) => { const n = daysUntil(d); if (n === null) return ''; if (n > 1) return `Faltan ${n} días`; if (n === 1) return '¡Es mañana!'; if (n === 0) return '¡Es hoy!'; return 'Ya celebrado'; };
  function ago(iso) {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'ahora';
    if (m < 60) return `hace ${m} min`;
    const hrs = Math.round(m / 60);
    if (hrs < 24) return `hace ${hrs} h`;
    const d = Math.round(hrs / 24);
    return d === 1 ? 'ayer' : `hace ${d} días`;
  }
  const digits = (t) => String(t || '').replace(/[^\d+]/g, '');
  const privacyCheck = () => h('label', { class: 'check privacy' }, h('input', { type: 'checkbox', name: 'privacy', required: true }),
    h('span', {}, 'He leído y acepto la ', h('a', { class: 'text-link', href: '/privacidad', 'data-link': true }, 'política de privacidad'), '.'));
  // Idioma de las páginas de invitados (evento y pantalla): español o inglés.
  let lang = (() => { try { const v = localStorage.getItem('gs_lang'); if (v === 'es' || v === 'en') return v; } catch { /* sin almacenamiento */ } return /^en/i.test(navigator.language || '') ? 'en' : 'es'; })();
  const I18N = {
    'Este evento no existe o el enlace ya no es válido. Pide a los anfitriones el enlace o el QR actualizado.': 'This event does not exist or the link is no longer valid. Ask the hosts for the updated link or QR code.',
    'Evento': 'Event', 'Boda': 'Wedding', 'Babyshower': 'Baby shower', 'Revelación de género': 'Gender reveal', 'Comunión': 'First communion', 'Bautizo': 'Christening',
    'Cumpleaños': 'Birthday', 'Aniversario': 'Anniversary', 'Evento de empresa': 'Company event', 'Fiesta privada': 'Private party', 'Otro': 'Other',
    'Copiar enlace': 'Copy link', 'Compartir por WhatsApp': 'Share on WhatsApp', 'Añadir al calendario': 'Add to calendar',
    '¡Pide tus canciones para «{name}»! {link}': 'Request your songs for “{name}”! {link}', 'Pide tus canciones: {link}': 'Request your songs: {link}',
    'Código del evento': 'Event code', 'Evento protegido': 'Protected event', 'Introduce el código que te han facilitado los anfitriones para pedir canciones.': 'Enter the code the hosts gave you to request songs.', 'Entrar': 'Enter',
    'Todavía no hay canciones. ¡Sé el primero en pedir una!': 'No songs yet. Be the first to request one!',
    'Tu nombre (opcional)': 'Your name (optional)', 'Tu nombre': 'Your name', 'Dedicatoria o comentario (opcional)': 'Dedication or comment (optional)', 'Dedicatoria': 'Dedication',
    'Pide tu canción': 'Request your song', 'Las peticiones están cerradas en este momento. Aún puedes votar las canciones de la lista.': 'Requests are closed right now. You can still vote for songs on the list.',
    'Puedes pedir {n} canción más.': 'You can request {n} more song.', 'Puedes pedir {n} canciones más.': 'You can request {n} more songs.',
    'Has llegado al máximo de canciones. ¡Vota las de los demás!': "You've reached the song limit. Vote for other guests' picks!",
    'Buscar en Spotify': 'Search Spotify', 'Escribirla a mano': 'Type it in',
    ' Está en el puesto {n} de la lista.': ' It is number {n} on the list.', 'Esa canción ya estaba pedida: hemos sumado tu voto ♥{where}': 'That song was already requested: we added your vote ♥{where}', '¡Petición enviada!{where}': 'Request sent!{where}',
    'Canción o artista…': 'Song or artist…', 'Buscar canción': 'Search song', 'Buscando…': 'Searching…', 'Contenido explícito': 'Explicit content',
    'Sin resultados. Prueba con otras palabras o escríbela a mano.': 'No results. Try other words or type it in.', 'Cambiar': 'Change', 'Enviar petición': 'Send request',
    'Título de la canción': 'Song title', 'Título': 'Title', 'Artista': 'Artist', 'Escribe el título de la canción': 'Type the song title',
    'Lista de peticiones': 'Request list', 'Tus peticiones': 'Your requests', '{n} canción': '{n} song', '{n} canciones': '{n} songs', '{n} voto': '{n} vote', '{n} votos': '{n} votes',
    'En directo': 'Live', 'Tuya': 'Yours', 'Artista sin indicar': 'Unknown artist', 'Pendiente': 'Pending', 'Aprobada': 'Approved', 'Sonando / sonó': 'Played', 'Rechazada': 'Rejected',
    'Quitar voto': 'Remove vote', 'Votar': 'Vote', 'días': 'days', 'horas': 'hours', 'min': 'min', 'seg': 'sec', '¡Ha llegado el momento!': 'The moment has arrived!', 'Cuenta atrás para el evento': 'Countdown to the event',
    '¡Es mañana!': 'Tomorrow!', '¡Es hoy!': 'Today!', 'Ya celebrado': 'Already celebrated', 'Ahora suena': 'Now playing', 'En pausa': 'Paused', 'Fecha por confirmar': 'Date to be confirmed',
    'Escanea y pide tu canción': 'Scan and request your song', 'Código ': 'Code ', 'Busca tu canción en Spotify': 'Find your song on Spotify', 'Dedícasela a alguien especial': 'Dedicate it to someone special',
    'Vota las que más te gusten': 'Vote for your favourites', 'Las más votadas suenan antes': 'Top-voted songs play first', '{n} petición': '{n} request', '{n} peticiones': '{n} requests',
    'Pantalla completa': 'Full screen', 'Salir': 'Exit', 'Las más pedidas': 'Most requested', 'La lista de peticiones está oculta para los invitados en este evento.': 'The request list is hidden for guests at this event.',
    'Sé el primero en pedir una canción': 'Be the first to request a song', 'Nueva petición': 'New request', 'pedida por {name}': 'requested by {name}', '¡Nueva número 1!': 'New number 1!',
    'Tu navegador no permite la pantalla completa aquí': "Your browser doesn't allow full screen here", 'Idioma': 'Language'
  };
  const tr = (es, vars) => {
    let out = lang === 'en' && I18N[es] ? I18N[es] : es;
    if (vars) out = out.replace(/\{(\w+)\}/g, (_, key) => (vars[key] ?? ''));
    return out;
  };
  const plural = (n, one, many) => tr(n === 1 ? one : many, { n });
  const langToggle = () => h('div', { class: 'lang-toggle', role: 'group', 'aria-label': tr('Idioma') },
    ['es', 'en'].map((code) => h('button', { type: 'button', 'aria-pressed': String(lang === code), onclick: () => { if (lang === code) return; lang = code; try { localStorage.setItem('gs_lang', code); } catch { /* nada */ } render(); } }, code.toUpperCase())));
  const MOMENTS = ['Entrada', 'Primer baile', 'Corte de la tarta', 'Revelación', 'Brindis', 'Salida', 'Fin de fiesta', 'Otro'];
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // Enlace para añadir una fecha a Google Calendar (día completo o 5 horas desde la hora indicada).
  function calendarLink(title, date, time, place, details) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
    const compact = (d) => d.replace(/-/g, '');
    let dates;
    if (/^\d\d:\d\d$/.test(time || '')) {
      const start = new Date(`${date}T${time}:00`);
      const end = new Date(start.getTime() + 5 * 3600000);
      const fmt = (d) => `${isoDay(d).replace(/-/g, '')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;
      dates = `${fmt(start)}/${fmt(end)}`;
    } else {
      const next = new Date(`${date}T12:00:00`); next.setDate(next.getDate() + 1);
      dates = `${compact(date)}/${compact(isoDay(next))}`;
    }
    const params = new URLSearchParams({ action: 'TEMPLATE', text: title, dates, ctz: 'Europe/Madrid', details: details || '', location: place || '' });
    return `https://calendar.google.com/calendar/render?${params}`;
  }
  const copyTable = (rows) => copy(rows.map((r) => r.map((c) => String(c ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n'));
  const fmtTime = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const statusLabel = { pending: 'Pendiente', approved: 'Aprobada', played: 'Sonando / sonó', rejected: 'Rechazada' };

  function copy(text) {
    const fallback = () => {
      const area = h('textarea', { readonly: true, class: 'copy-area', rows: Math.min(12, text.split('\n').length + 1), 'aria-label': 'Texto para copiar' }, text);
      const dialog = h('dialog', { class: 'dialog copy-dialog' }, h('div', { class: 'dialog-form' },
        h('h2', { class: 'title small' }, 'Copia el texto'),
        h('p', { class: 'muted small' }, 'Tu navegador no deja copiar automáticamente. El texto ya está seleccionado: cópialo con Ctrl+C (o mantén pulsado en el móvil).'),
        area,
        h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, 'Listo'))));
      dialog.addEventListener('close', () => dialog.remove());
      document.body.append(dialog);
      dialog.showModal();
      area.focus();
      area.select();
    };
    try {
      if (!navigator.clipboard) throw new Error('sin portapapeles');
      navigator.clipboard.writeText(text).then(() => toast('Copiado al portapapeles', 'ok'), fallback);
    } catch { fallback(); }
  }

  function coverArt(track, size = 'md') {
    return track.image
      ? h('img', { class: `cover ${size}`, src: track.image, alt: '', loading: 'lazy' })
      : h('div', { class: `cover ${size} cover-empty`, 'aria-hidden': 'true' }, '♪');
  }

  function swatch(color, size = '') {
    const el = h('span', { class: `swatch ${size}`, title: color.name });
    if (color.hex === 'linear') el.classList.add('swatch-multi'); else el.style.background = color.hex;
    return el;
  }

  function qrSvg(text, cell = 6) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
  }

  function downloadQrPng(text, filename) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const scale = 16;
    const margin = 4;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = (n + margin * 2) * scale;
    const ctx = canvas.getContext('2d');
    const mask = document.createElement('canvas');
    const mctx = mask.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
    const a = h('a', { href: canvas.toDataURL('image/png'), download: filename });
    document.body.append(a); a.click(); a.remove();
  }

  // ------------------------------------------------------------ animaciones
  const REDUCED = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  const FINE = window.matchMedia ? matchMedia('(hover: hover) and (pointer: fine)').matches : false;
  let pendingCelebrate = false;

  // Aparición al hacer scroll. En reposo todo es visible; la animación se lanza justo antes de que el
  // elemento entre en pantalla, así no hay saltos ni contenido oculto.
  const REVEAL_SEL = '.card:not(.req-list):not(.line):not(.gate), .step, .kpi, .pack, .faq-item, .cta-band, .money > div, .marquee, .section > .title, .section > .lead, .section > .subhead, .contact-aside > .card, .event-hero > .title, .ornament';
  const revealObs = !REDUCED && 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('rv-in'); revealObs.unobserve(e.target); }
  }, { rootMargin: '0px 0px 90px 0px' }) : null;
  function reveal() {
    if (!revealObs) return;
    const counters = new Map();
    app.querySelectorAll(REVEAL_SEL).forEach((el) => {
      if (el.dataset.rv) return;
      el.dataset.rv = '1';
      const i = counters.get(el.parentElement) || 0;
      counters.set(el.parentElement, i + 1);
      el.style.setProperty('--rv-delay', `${Math.min(i, 7) * 70}ms`);
      el.addEventListener('animationend', (ev) => { if (ev.target === el && /^(rise|rise-pop|ink|draw-wrap)$/.test(ev.animationName)) el.classList.remove('rv-in'); });
      if (el.getBoundingClientRect().top < innerHeight + 90) el.classList.add('rv-in');
      else revealObs.observe(el);
    });
  }
  if (revealObs) {
    let queued = false;
    new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; reveal(); }); } }).observe(app, { childList: true, subtree: true });
  }

  // Estallido de chispas doradas (o corazones) para celebrar acciones.
  function celebrate(x, y, opts = {}) {
    if (REDUCED) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'fx-overlay';
    canvas.setAttribute('aria-hidden', 'true');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    document.body.append(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    if (x == null) { x = innerWidth / 2; y = innerHeight * 0.38; }
    const colors = opts.colors || ['#f8dc85', '#e9b949', '#fff1c2', '#d9a537', '#ffffff'];
    const parts = Array.from({ length: opts.count || 80 }, () => {
      const a = Math.random() * Math.PI * 2;
      const v = (opts.power || 7) * (0.3 + Math.random());
      return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (opts.lift ?? 3), life: 0, max: 45 + Math.random() * 45, size: 2 + Math.random() * 3, c: colors[(Math.random() * colors.length) | 0], rect: Math.random() < (opts.confetti ?? 0.35), rot: Math.random() * 6 };
    });
    let last = performance.now();
    function tick(now) {
      const k = Math.min(2.5, (now - last) / 16.7);
      last = now;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      let alive = 0;
      for (const p of parts) {
        p.life += k;
        if (p.life > p.max) continue;
        alive++;
        p.vy += 0.17 * k; p.vx *= Math.pow(0.97, k); p.vy *= Math.pow(0.97, k);
        p.x += p.vx * k; p.y += p.vy * k; p.rot += 0.2 * k;
        ctx.globalAlpha = 1 - p.life / p.max;
        if (p.rect) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.size, -p.size / 2.5, p.size * 2, p.size / 1.2); ctx.restore(); }
        else { ctx.strokeStyle = p.c; ctx.lineWidth = p.size * 0.6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.4, p.y - p.vy * 2.4); ctx.stroke(); }
      }
      if (alive) requestAnimationFrame(tick); else canvas.remove();
    }
    requestAnimationFrame(tick);
  }
  const burstFrom = (el, opts) => { if (!el || !el.isConnected) return celebrate(null, null, opts); const r = el.getBoundingClientRect(); celebrate(r.left + r.width / 2, r.top + r.height / 2, opts); };
  const HEARTS = { count: 22, power: 4, lift: 2, confetti: 0, colors: ['#ff8fb1', '#ffc2d4', '#ffffff', '#f8dc85'] };

  // Colores de celebración según el tipo de evento.
  const PALETTES = {
    boda: ['#f8dc85', '#e9b949', '#fff6e0', '#ffffff', '#d9a537'],
    baby: ['#f28bb7', '#ffc2d4', '#5aa9ff', '#a9d4ff', '#ffffff'],
    fiesta: ['#ff4d4d', '#f6d36b', '#4fd18b', '#5aa9ff', '#a77bff', '#f28bb7'],
    suave: ['#ffffff', '#e8eef2', '#f8dc85', '#cfe0f2'],
    empresa: ['#f8dc85', '#e8eef2', '#d9a537', '#ffffff']
  };
  function paletteFor(type) {
    const t = String(type || '').toLowerCase();
    if (/baby|revelaci/.test(t)) return PALETTES.baby;
    if (/cumple|fiesta|aniversario/.test(t)) return PALETTES.fiesta;
    if (/comuni|bautizo/.test(t)) return PALETTES.suave;
    if (/empresa/.test(t)) return PALETTES.empresa;
    return PALETTES.boda;
  }

  // Fuegos artificiales: cohetes que suben con estela y estallan en palmeras de chispas.
  function skyRockets(opts = {}) {
    if (REDUCED) return;
    const colors = opts.colors || PALETTES.boda;
    const canvas = document.createElement('canvas');
    canvas.className = 'fx-overlay';
    canvas.setAttribute('aria-hidden', 'true');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = innerWidth; const H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    document.body.append(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const G = 0.11;
    const rockets = Array.from({ length: opts.count || 6 }, (_, i) => {
      const tx = opts.x != null ? opts.x + (Math.random() - 0.5) * Math.min(W * 0.3, 260) : W * (0.12 + Math.random() * 0.76);
      const ty = Math.max(40, opts.y != null ? opts.y + (Math.random() - 0.5) * 70 : H * (0.12 + Math.random() * 0.3));
      return { x: tx + (Math.random() - 0.5) * 90, y: H + 10, tx, ty, delay: i * (opts.gap || 260) + Math.random() * 140, c: colors[i % colors.length], started: false, done: false };
    });
    const sparks = []; const flashes = [];
    const t0 = performance.now(); let last = t0;
    function explode(r) {
      const m = 64 + ((Math.random() * 24) | 0);
      for (let i = 0; i < m; i++) {
        const a = (i / m) * Math.PI * 2 + Math.random() * 0.08;
        const v = 2 + Math.random() * 2.6;
        sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 50 + Math.random() * 40, c: Math.random() < 0.18 ? '#ffffff' : r.c, size: 1.4 + Math.random() * 1.6, twinkle: Math.random() < 0.3 });
      }
      flashes.push({ x: r.x, y: r.y, life: 0, c: r.c });
    }
    function tick(now) {
      const k = Math.min(2.5, (now - last) / 16.7); last = now;
      const t = now - t0;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      let alive = 0;
      for (const r of rockets) {
        if (r.done) continue;
        alive++;
        if (t < r.delay) continue;
        if (!r.started) { r.started = true; const d = r.y - r.ty; r.vy = -Math.sqrt(2 * G * d); r.vx = (r.tx - r.x) / (-r.vy / G); }
        r.vy += G * k; r.x += r.vx * k; r.y += r.vy * k;
        ctx.globalAlpha = 1; ctx.strokeStyle = r.c; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x - r.vx * 4, r.y - r.vy * 4); ctx.stroke();
        if (Math.random() < 0.7) sparks.push({ x: r.x, y: r.y, vx: (Math.random() - 0.5) * 0.5, vy: Math.random() * 0.6, life: 0, max: 18 + Math.random() * 14, c: '#ffd27a', size: 1.1 });
        if (r.vy >= -0.4) { r.done = true; explode(r); }
      }
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i]; f.life += k;
        if (f.life > 14) { flashes.splice(i, 1); continue; }
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 90);
        g.addColorStop(0, 'rgba(255,250,230,0.55)'); g.addColorStop(1, 'rgba(255,220,140,0)');
        ctx.globalAlpha = 1 - f.life / 14; ctx.fillStyle = g; ctx.fillRect(f.x - 90, f.y - 90, 180, 180);
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i]; p.life += k;
        if (p.life > p.max) { sparks.splice(i, 1); continue; }
        p.vy += 0.045 * k; p.vx *= Math.pow(0.985, k); p.vy *= Math.pow(0.985, k);
        p.x += p.vx * k; p.y += p.vy * k;
        const a = 1 - p.life / p.max;
        ctx.globalAlpha = p.twinkle ? a * (0.4 + 0.6 * Math.abs(Math.sin(p.life * 0.6))) : a;
        ctx.strokeStyle = p.c; ctx.lineWidth = p.size;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3); ctx.stroke();
      }
      if (alive || sparks.length || flashes.length) requestAnimationFrame(tick); else canvas.remove();
    }
    requestAnimationFrame(tick);
  }

  // Separador dorado de estilo art déco que se dibuja al aparecer (eco de las líneas del logo).
  function ornament(extra = '') {
    const el = h('div', { class: `ornament ${extra}`.trim(), 'aria-hidden': 'true' });
    el.innerHTML = '<svg viewBox="0 0 240 26" fill="none" stroke-linecap="round" stroke-linejoin="round">'
      + '<path pathLength="1" d="M4 15H98"/><path pathLength="1" d="M142 15H236"/>'
      + '<path pathLength="1" d="M28 19H92"/><path pathLength="1" d="M148 19H212"/>'
      + '<path pathLength="1" d="M120 5L130 15L120 25L110 15Z"/>'
      + '<path pathLength="1" d="M120 1V9"/><path pathLength="1" d="M113 7L106 2"/><path pathLength="1" d="M127 7L134 2"/>'
      + '<circle cx="102" cy="15" r="1.6"/><circle cx="138" cy="15" r="1.6"/></svg>';
    return el;
  }
  // Esquinas doradas que enmarcan bloques destacados.
  const decoCorners = (always) => h('span', { class: `deco-corners${always ? ' always' : ''}`, 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));

  // Números que cuentan hasta su valor.
  function tween(el, to, fmt = (v) => String(Math.round(v)), ms = 800) {
    const from = Number(el.dataset.v || 0);
    el.dataset.v = String(to);
    if (REDUCED || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    el.textContent = fmt(from);
    requestAnimationFrame(step);
  }

  // Reordenación animada de listas (técnica FLIP): cada elemento se desliza a su nueva posición.
  function flipRender(container, nodes) {
    const before = new Map();
    for (const el of container.children) if (el.dataset && el.dataset.key) before.set(el.dataset.key, el.getBoundingClientRect().top);
    container.replaceChildren(...nodes);
    if (REDUCED || !nodes.length || !nodes[0].animate) return;
    for (const el of nodes) {
      const prev = before.get(el.dataset.key);
      if (prev === undefined) {
        if (before.size) el.animate([{ opacity: 0, transform: 'translateX(-14px) scale(.98)', background: 'rgba(233,185,73,.18)' }, { opacity: 1, transform: 'none', background: 'transparent' }], { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)' });
        continue;
      }
      const dy = prev - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }

  // Brasas doradas que suben lentamente (fondo de la portada y de la pantalla del evento).
  function embers(host, opts = {}) {
    if (REDUCED) return;
    const c = h('canvas', { class: 'embers', 'aria-hidden': 'true' });
    host.prepend(c);
    const ctx = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0; let H = 0; let visible = true; let raf = 0;
    const N = opts.count || (innerWidth < 700 ? 22 : 40);
    const resize = () => { W = c.clientWidth; H = c.clientHeight; c.width = Math.max(1, W * dpr); c.height = Math.max(1, H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const spawn = (p) => Object.assign(p, { x: Math.random() * W, y: H + 10 + Math.random() * 40, r: 0.6 + Math.random() * 1.7, vy: 0.18 + Math.random() * 0.5, vx: (Math.random() - 0.5) * 0.2, t: Math.random() * 6.3, c: opts.colors ? opts.colors[(Math.random() * opts.colors.length) | 0] : `hsl(${36 + Math.random() * 16}, 100%, 72%)` });
    resize();
    const ps = Array.from({ length: N }, () => { const p = spawn({}); p.y = Math.random() * H; return p; });
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) loop(); });
    io.observe(c);
    function loop() {
      cancelAnimationFrame(raf);
      if (!c.isConnected) { io.disconnect(); window.removeEventListener('resize', resize); return; }
      if (!visible || document.hidden) return;
      if (c.clientWidth !== W || c.clientHeight !== H) resize();
      ctx.clearRect(0, 0, W, H);
      for (const p of ps) {
        p.t += 0.025;
        p.y -= p.vy;
        p.x += p.vx + Math.sin(p.t) * 0.18;
        if (p.y < -10) spawn(p);
        const fade = Math.max(0, Math.min(1, p.y / (H * 0.35))) * (0.55 + 0.45 * Math.sin(p.t * 3));
        ctx.fillStyle = p.c;
        ctx.globalAlpha = 0.12 * fade;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 4, 0, 6.283); ctx.fill();
        ctx.globalAlpha = 0.85 * fade;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(loop);
    }
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loop(); });
    loop();
  }

  // Barras de ecualizador.
  const eqBars = () => h('span', { class: 'eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));

  // Tarjeta «Ahora suena» (invitados y pantalla).
  function nowPlaying(box, n) {
    if (!n || !n.active || !n.track) { box.hidden = true; box.dataset.key = ''; return; }
    const pct = n.track.durationMs ? Math.min(100, (n.progressMs / n.track.durationMs) * 100) : 0;
    const key = n.track.id || n.track.name;
    box.hidden = false;
    if (box.dataset.key === key) { const bar = box.querySelector('.now-bar i'); if (bar) bar.style.width = `${pct}%`; return; }
    box.dataset.key = key;
    box.replaceChildren(coverArt(n.track, 'md'),
      h('div', { class: 'now-text' },
        h('span', { class: 'now-label' }, n.isPlaying ? eqBars() : null, tr(n.isPlaying ? 'Ahora suena' : 'En pausa')),
        h('strong', {}, n.track.name),
        h('span', { class: 'muted small' }, n.track.artists),
        h('span', { class: 'now-bar' }, h('i', { style: { width: `${pct}%` } }))));
    if (!REDUCED && box.animate) box.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  // Cuenta atrás en directo (días, horas, minutos y segundos).
  function liveCountdown(date, time, colors) {
    const target = new Date(`${date}T${/^\d\d:\d\d$/.test(time || '') ? time : '00:00'}:00`);
    if (Number.isNaN(target.getTime()) || target - Date.now() <= 0) return null;
    const box = h('div', { class: 'cd', role: 'timer', 'aria-label': tr('Cuenta atrás para el evento') });
    const cells = [['días'], ['horas'], ['min'], ['seg']].map(([l]) => { const v = h('b', {}, '00'); box.append(h('span', { class: 'cd-cell' }, v, h('small', {}, tr(l)))); return v; });
    const tick = () => {
      let ms = target - Date.now();
      if (ms <= 0) {
        box.replaceChildren(h('span', { class: 'chip countdown arrived' }, tr('¡Ha llegado el momento!')));
        if (box.isConnected) skyRockets({ colors, count: 9, gap: 230 });
        return false;
      }
      const d = Math.floor(ms / 864e5); ms -= d * 864e5;
      const hh = Math.floor(ms / 36e5); ms -= hh * 36e5;
      const mm = Math.floor(ms / 6e4);
      const ss = Math.floor((ms % 6e4) / 1000);
      [d, hh, mm, ss].forEach((v, i) => {
        const t = String(v).padStart(2, '0');
        if (cells[i].textContent !== t) { cells[i].textContent = t; if (!REDUCED) { cells[i].classList.remove('tick'); void cells[i].offsetWidth; cells[i].classList.add('tick'); } }
      });
      return true;
    };
    tick();
    const iv = setInterval(() => { if (!box.isConnected || !tick()) clearInterval(iv); }, 1000);
    return box;
  }

  // Cabecera compacta y barra de progreso al hacer scroll; foco de luz que sigue al cursor en tarjetas.
  const topbarEl = document.querySelector('.topbar');
  const progressEl = document.getElementById('progress');
  let scrollQueued = false;
  window.addEventListener('scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      const y = window.scrollY;
      if (topbarEl) topbarEl.classList.toggle('scrolled', y > 12);
      document.body.classList.toggle('past-hero', y > 320);
      const max = document.documentElement.scrollHeight - innerHeight;
      if (progressEl) progressEl.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
    });
  }, { passive: true });
  if (FINE) {
    document.addEventListener('pointermove', (e) => {
      const el = e.target.closest && e.target.closest('.card, .kpi, .pack');
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
      if (!REDUCED && el.matches('.event-card, .pack, .fx-card, .kpi, .service')) {
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--ry', `${(px * 9).toFixed(2)}deg`);
        el.style.setProperty('--rx', `${(-py * 7).toFixed(2)}deg`);
      }
    }, { passive: true });
    document.addEventListener('pointerout', (e) => {
      const el = e.target.closest && e.target.closest('.event-card, .pack, .fx-card, .kpi, .service');
      if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    }, { passive: true });
  }

  // ------------------------------------------------------------ enrutado
  function pageSweep() {
    if (REDUCED) return;
    const el = h('div', { class: 'page-sweep', 'aria-hidden': 'true' });
    el.addEventListener('animationend', () => el.remove());
    document.body.append(el);
  }
  function navigate(to, replace = false) {
    if (new URL(to, 'http://demo').pathname !== curPath()) pageSweep();
    if (DEMO) memPath = to;
    else if (replace) history.replaceState({}, '', to); else history.pushState({}, '', to);
    render();
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    const url = new URL(a.getAttribute('href'), DEMO ? 'http://demo' : location.href);
    if (!DEMO && url.origin !== location.origin) return;
    e.preventDefault();
    if (url.pathname === curPath() && url.hash) {
      const target = document.getElementById(url.hash.slice(1));
      if (target) { if (!DEMO) history.replaceState({}, '', url.pathname + url.search + url.hash); target.scrollIntoView({ behavior: 'smooth' }); return; }
    }
    pendingAnchor = url.hash.slice(1);
    navigate(url.pathname + url.search + (DEMO ? '' : url.hash));
  });
  window.addEventListener('popstate', render);

  async function render() {
    clearInterval(pollTimer);
    pollTimer = null;
    const path = curPath();
    const section = (p, hash) => (p === '/' ? (hash === '#eventos' ? 'music' : 'home') : p.startsWith('/e/') ? 'music' : /^\/(pirotecnia|presupuesto)/.test(p) ? 'pyro' : p === '/contacto' ? 'contact' : p.startsWith('/admin') ? 'admin' : '');
    const here = section(path, '');
    document.querySelectorAll('.admin-link').forEach((a) => a.classList.toggle('active', here === 'admin'));
    document.querySelectorAll('.nav a, .tabbar a').forEach((a) => {
      const u = new URL(a.getAttribute('href'), 'http://demo');
      const on = section(u.pathname, u.hash) === here;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    app.replaceChildren();
    document.body.classList.toggle('screen-mode', path.startsWith('/pantalla/'));
    document.body.classList.toggle('is-home', path === '/');
    window.scrollTo(0, 0);
    try {
      let m;
      if (path === '/') await renderHome();
      else if ((m = path.match(/^\/e\/([^/]+)$/))) await renderEvent(decodeURIComponent(m[1]));
      else if (path === '/pirotecnia') await renderPyro();
      else if ((m = path.match(/^\/presupuesto\/([^/]+)$/))) await renderQuote(m[1]);
      else if (path === '/admin') await renderAdmin();
      else if (path === '/contacto') renderContact();
      else if ((m = path.match(/^\/pantalla\/([^/]+)$/))) await renderScreen(decodeURIComponent(m[1]));
      else if (path === '/privacidad') renderPrivacy();
      else renderNotFound();
    } catch (err) {
      app.replaceChildren(h('section', { class: 'section narrow center' }, h('h1', { class: 'title' }, 'Vaya…'), h('p', { class: 'lead' }, err.message), h('a', { class: 'btn', href: '/', 'data-link': true }, 'Volver al inicio')));
    }
    if (pendingCelebrate) {
      const pc = pendingCelebrate;
      pendingCelebrate = false;
      setTimeout(() => { if (pc.fireworks) skyRockets({ colors: pc.colors, count: 8 }); celebrate(null, null, { count: 140, power: 9, colors: pc.colors }); }, 150);
    }
    const anchor = pendingAnchor || (DEMO ? '' : location.hash.slice(1));
    pendingAnchor = '';
    if (anchor) { const t = document.getElementById(anchor); if (t) t.scrollIntoView(); }
  }

  function renderNotFound() {
    app.append(h('section', { class: 'section narrow center notfound' },
      h('p', { class: 'big-404', 'aria-hidden': 'true' }, '404'),
      h('h1', { class: 'title small' }, 'Esta página se ha ido de fiesta'),
      h('p', { class: 'lead' }, 'No encontramos lo que buscas. Vuelve al inicio o diseña tu espectáculo de chispas.'),
      h('div', { class: 'row center-row' }, h('a', { class: 'btn', href: '/', 'data-link': true }, 'Volver al inicio'), h('a', { class: 'btn ghost', href: '/pirotecnia', 'data-link': true }, 'Ver pirotecnia'))));
  }

  // ------------------------------------------------------------ portada
  async function renderHome() {
    document.title = 'Guspira Events · Bodas y celebraciones';
    const hero = h('section', { class: 'hero' },
      h('div', { class: 'hero-glow', 'aria-hidden': 'true' }),
      heroLogo(),
      h('p', { class: 'hero-tag' }, 'Celebraciones que se recuerdan'),
      ornament(),
      h('p', { class: 'lead' }, 'Bodas, babyshowers, comuniones y fiestas privadas. Tu música, tus momentos y un final que brilla.'),
      h('div', { class: 'hero-actions' },
        h('a', { class: 'btn', href: '/#eventos', 'data-link': true }, 'Pedir una canción'),
        h('a', { class: 'btn ghost', href: '/pirotecnia', 'data-link': true }, 'Presupuesto de pirotecnia'))
    );

    embers(hero);
    const kinds = ['Bodas', 'Babyshowers', 'Comuniones', 'Bautizos', 'Revelaciones', 'Cumpleaños', 'Aniversarios', 'Eventos de empresa', 'Fiestas privadas'];
    const marquee = h('div', { class: 'marquee', 'aria-hidden': 'true' }, h('div', { class: 'marquee-track' }, [...kinds, ...kinds].map((k) => h('span', {}, k, h('i', {}, '✦')))));
    const services = h('section', { class: 'section' },
      h('div', { class: 'grid two' },
        h('article', { class: 'card service' },
          h('div', { class: 'service-icon', 'aria-hidden': 'true' }, '♫'),
          h('h2', {}, 'Tu música, en directo'),
          h('p', {}, 'Escanea el QR de tu evento o elige uno de la portada, busca en Spotify y pide la canción que quieres bailar. Vota las peticiones del resto de invitados y el DJ decidirá el orden.'),
          h('a', { class: 'text-link', href: '/#eventos', 'data-link': true }, 'Ver eventos →')),
        h('article', { class: 'card service' },
          h('div', { class: 'service-icon spark', 'aria-hidden': 'true' }, '✦'),
          h('h2', {}, 'Pirotecnia fría'),
          h('p', {}, 'Fuentes verticales, abanicos y cascadas de chispas para la entrada de los novios, el primer baile o la revelación de un babyshower. Elige cantidad y colores y recibe tu presupuesto al momento.'),
          h('a', { class: 'text-link', href: '/pirotecnia', 'data-link': true }, 'Diseñar mi espectáculo →'))
      )
    );

    const list = h('div', { class: 'grid events', 'aria-busy': 'true' }, h('div', { class: 'card skeleton-card', 'aria-hidden': 'true' }), h('div', { class: 'card skeleton-card', 'aria-hidden': 'true' }), h('span', { class: 'sr-only' }, 'Cargando eventos…'));
    const eventsSection = h('section', { class: 'section', id: 'eventos' },
      h('h2', { class: 'title' }, 'Peticiones de canciones'),
      ornament('left'),
      h('p', { class: 'lead' }, 'Elige tu evento. Si es privado, usa el enlace o el código QR que te han dado los anfitriones.'),
      list);

    const step = (n, title, text) => h('li', { class: 'step' }, h('span', { class: 'step-n', 'aria-hidden': 'true' }, n), h('div', {}, h('h3', {}, title), h('p', { class: 'muted small' }, text)));
    const how = h('section', { class: 'section how' },
      h('h2', { class: 'title small' }, 'Así se piden las canciones'),
      ornament('left'),
      h('ol', { class: 'steps-row' },
        step('1', 'Escanea el QR', 'Lo encontrarás en las mesas o en la invitación. También puedes elegir tu evento aquí abajo.'),
        step('2', 'Busca tu canción', 'Encuéntrala en Spotify o escríbela a mano, y añade una dedicatoria si quieres.'),
        step('3', 'Vota y a bailar', 'Apoya las canciones de los demás. Las más votadas tienen más opciones de sonar.')));
    const cta = h('section', { class: 'section' }, h('div', { class: 'cta-band' }, decoCorners(),
      h('div', {}, h('h2', { class: 'title small' }, '¿Tienes una fecha en mente?'), h('p', { class: 'muted' }, 'Cuéntanos cómo imaginas tu celebración y te preparamos una propuesta a medida.')),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: '/contacto', 'data-link': true }, 'Pedir información'), h('a', { class: 'btn ghost', href: '/pirotecnia', 'data-link': true }, 'Calcular pirotecnia'))));
    const gallerySection = h('section', { class: 'section', id: 'galeria', hidden: true });
    const reviewsSection = h('section', { class: 'section reviews-section', hidden: true });
    app.append(hero, marquee, services, gallerySection, how, eventsSection, reviewsSection, cta);
    Promise.all([api('/api/gallery').catch(() => []), api('/api/testimonials').catch(() => [])]).then(([photos, reviews]) => {
      if (!gallerySection.isConnected) return;
      if (photos.length) {
        const shown = photos.slice(0, 9);
        gallerySection.hidden = false;
        gallerySection.append(...[
          h('h2', { class: 'title' }, 'Momentos que brillan'), ornament('left'),
          h('p', { class: 'lead' }, 'Algunas de las celebraciones que hemos tenido el honor de iluminar.'),
          h('div', { class: 'masonry' }, shown.map((g, i) => h('button', { type: 'button', class: 'm-item', style: { '--i': String(i) }, 'aria-label': g.caption ? `Ver foto: ${g.caption}` : `Ver foto ${i + 1}`, onclick: () => lightbox(photos, i) },
            h('img', { src: g.url, alt: g.caption || '', width: g.width, height: g.height, loading: 'lazy', decoding: 'async' }),
            g.caption ? h('span', { class: 'm-cap' }, g.caption) : null))),
          photos.length > shown.length ? h('div', { class: 'row center-row' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => lightbox(photos, shown.length) }, `Ver las ${photos.length} fotos`)) : null].filter(Boolean));
      }
      if (reviews.length) {
        reviewsSection.hidden = false;
        reviewsSection.append(h('h2', { class: 'title center-title' }, 'Lo que dicen de nosotros'), ornament(), reviewsCarousel(reviews));
      }
    });

    const events = await api('/api/events');
    list.replaceChildren();
    if (!events.length) list.append(h('div', { class: 'card empty' }, h('p', {}, 'Ahora mismo no hay eventos públicos. Si tienes un enlace o un QR de un evento privado, ábrelo directamente.')));
    events.forEach((ev, idx) => {
      list.append(h('a', { class: `card event-card${idx === 0 && daysUntil(ev.date) !== null && daysUntil(ev.date) >= 0 ? ' next' : ''}`, href: `/e/${encodeURIComponent(ev.slug)}`, 'data-link': true },
        h('div', { class: 'event-card-top' },
          h('span', { class: 'chip' }, ev.type || 'Evento'),
          ev.locked ? h('span', { class: 'chip lock', title: 'Necesitas el código del evento' }, '🔒 Con código') : h('span', { class: 'chip open' }, 'Acceso libre'),
          daysUntil(ev.date) === 0 ? h('span', { class: 'chip live-chip' }, h('i', { class: 'live-dot', 'aria-hidden': 'true' }), 'Hoy') : null),
        h('h3', {}, ev.name),
        h('p', { class: 'muted' }, formatDate(ev.date, ev.time)),
        ev.venue ? h('p', { class: 'muted small' }, ev.venue) : null,
        h('span', { class: 'text-link' }, ev.requestsOpen ? 'Pedir canciones →' : 'Ver canciones →')));
    });
  }

  // ------------------------------------------------------------ galería, visor y opiniones
  function lightbox(items, start = 0) {
    let i = start;
    const prevFocus = document.activeElement;
    const img = h('img', { class: 'lb-img', alt: '' });
    const cap = h('p', { class: 'lb-cap' });
    const count = h('span', { class: 'lb-count' });
    const closeBtn = h('button', { type: 'button', class: 'icon-btn lb-close', 'aria-label': 'Cerrar' }, '✕');
    const prev = h('button', { type: 'button', class: 'lb-nav prev', 'aria-label': 'Foto anterior' }, '‹');
    const next = h('button', { type: 'button', class: 'lb-nav next', 'aria-label': 'Foto siguiente' }, '›');
    const overlay = h('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Galería de fotos' },
      closeBtn, prev, h('figure', { class: 'lb-figure' }, img, h('figcaption', {}, cap, count)), next);
    const show = (n, dir = 0) => {
      i = (n + items.length) % items.length;
      const g = items[i];
      img.src = g.url; img.alt = g.caption || '';
      cap.textContent = g.caption || '';
      count.textContent = `${i + 1} / ${items.length}`;
      if (!REDUCED && img.animate) img.animate([{ opacity: 0, transform: `translateX(${dir * 40}px) scale(.98)` }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    };
    const close = () => { overlay.classList.add('closing'); document.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); setTimeout(() => overlay.remove(), 280); if (prevFocus && prevFocus.focus) prevFocus.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') show(i + 1, 1); else if (e.key === 'ArrowLeft') show(i - 1, -1); };
    prev.addEventListener('click', () => show(i - 1, -1));
    next.addEventListener('click', () => show(i + 1, 1));
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    let x0 = null;
    overlay.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
    overlay.addEventListener('pointerup', (e) => { if (x0 === null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1); });
    if (items.length < 2) { prev.hidden = true; next.hidden = true; }
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    document.body.classList.add('no-scroll');
    show(i);
    closeBtn.focus();
  }

  function reviewsCarousel(reviews) {
    let i = 0;
    const slides = reviews.map((r) => h('figure', { class: 'review' },
      h('div', { class: 'stars', 'aria-label': `${r.rating} de 5 estrellas` }, h('span', {}, '★'.repeat(r.rating)), h('span', { class: 'off' }, '★'.repeat(5 - r.rating))),
      h('blockquote', {}, `“${r.text}”`),
      h('figcaption', {}, h('strong', {}, r.name), r.event ? h('span', { class: 'chip' }, r.event) : null)));
    const dots = h('div', { class: 'review-dots' }, reviews.map((_, n) => h('button', { type: 'button', 'aria-label': `Opinión ${n + 1}`, onclick: () => { go(n); restart(); } })));
    const go = (n) => {
      i = (n + slides.length) % slides.length;
      slides.forEach((el, k) => { el.classList.toggle('active', k === i); el.setAttribute('aria-hidden', String(k !== i)); });
      [...dots.children].forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
    };
    const box = h('div', { class: 'reviews' }, h('div', { class: 'reviews-track' }, slides),
      slides.length > 1 ? h('div', { class: 'review-controls' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Opinión anterior', onclick: () => { go(i - 1); restart(); } }, '‹'), dots,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Opinión siguiente', onclick: () => { go(i + 1); restart(); } }, '›')) : null);
    let timer = null;
    let paused = false;
    const restart = () => {
      clearInterval(timer);
      if (slides.length < 2 || REDUCED) return;
      timer = setInterval(() => { if (!box.isConnected) { clearInterval(timer); return; } if (!paused && !document.hidden) go(i + 1); }, 6500);
    };
    box.addEventListener('pointerenter', () => { paused = true; });
    box.addEventListener('pointerleave', () => { paused = false; });
    box.addEventListener('focusin', () => { paused = true; });
    box.addEventListener('focusout', () => { paused = false; });
    go(0);
    restart();
    return box;
  }

  // Reduce y comprime las fotos en el navegador antes de subirlas.
  async function resizeImage(file, maxSide) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error(`No se pudo leer «${file.name}».`)); im.src = url; });
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const hgt = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = hgt;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, hgt);
      ctx.drawImage(img, 0, 0, w, hgt);
      return { data: c.toDataURL('image/jpeg', DEMO ? 0.72 : 0.85), width: w, height: hgt };
    } finally { URL.revokeObjectURL(url); }
  }

  // ------------------------------------------------------------ logo animado
  // Coordenadas sobre la imagen original del símbolo (1312 × 674 px).
  const LOGO = { w: 1312, h: 674, pad: 150, base: [648, 650],
    tips: [[648, 9], [435, 229], [862, 229], [285, 339], [1010, 339], [88, 476], [1208, 476]],
    line: [[40, 652], [1258, 652]] };

  function heroLogo() {
    const symbol = h('img', { class: 'hero-symbol', src: ASSET.symbol, alt: '', width: 900, height: 462, draggable: 'false' });
    const mark = h('div', { class: 'hero-mark' }, symbol);
    const wrap = h('h1', { class: 'hero-logo', 'aria-label': 'Guspira Events' }, mark,
      h('img', { class: 'hero-word', src: ASSET.text, alt: '', width: 900, height: 214, draggable: 'false' }));
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) {
      symbol.classList.add('pending');
      const go = () => requestAnimationFrame(() => fireworks(mark, symbol));
      if (symbol.complete && symbol.naturalWidth) go(); else symbol.addEventListener('load', go, { once: true });
      symbol.addEventListener('error', () => symbol.classList.remove('pending'), { once: true });
    }
    return wrap;
  }

  // Pirotecnia: chispas que suben desde la base por cada hoja del símbolo y lo van revelando.
  function fireworks(mark, img) {
    const { w: W, h: H, pad: P, base } = LOGO;
    const canvas = h('canvas', { class: 'hero-canvas', 'aria-hidden': 'true' });
    canvas.style.left = `${(-P / W) * 100}%`;
    canvas.style.top = `${(-P / H) * 100}%`;
    canvas.style.width = `${((W + 2 * P) / W) * 100}%`;
    canvas.style.height = `${((H + P + 40) / H) * 100}%`;
    mark.append(canvas);
    const ctx = canvas.getContext('2d');
    const mask = document.createElement('canvas');
    const mctx = mask.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const fit = () => {
      const cssW = canvas.clientWidth || mark.clientWidth;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(canvas.width * (H + P + 40) / (W + 2 * P));
      const k = canvas.width / (W + 2 * P);
      ctx.setTransform(k, 0, 0, k, P * k, P * k);
      mask.width = canvas.width;
      mask.height = canvas.height;
    };
    fit();

    const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
    const bez = (p0, c, p1, t) => [(1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0], (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]];
    // Cada hoja: curva que sube recta desde la base y se abre hacia su punta.
    const paths = LOGO.tips.map((tip, i) => ({
      from: base, to: tip, ctrl: [base[0] + (tip[0] - base[0]) * 0.12, tip[1] + (base[1] - tip[1]) * 0.35],
      delay: 380 + Math.ceil(i / 2) * 110, dur: 900, burst: false
    })).concat(LOGO.line.map((end) => ({ from: base, to: end, ctrl: [(base[0] + end[0]) / 2, base[1]], delay: 300, dur: 760, burst: false, small: true })));
    const sparks = [];
    const gold = () => `hsl(${38 + Math.random() * 14}, 95%, ${58 + Math.random() * 30}%)`;
    const emit = (x, y, n, speed, spread = Math.PI * 2, angle = 0, life = 900) => {
      for (let i = 0; i < n; i++) {
        const a = angle + (Math.random() - 0.5) * spread;
        const v = speed * (0.3 + Math.random() * 0.9);
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.5 + Math.random() * 0.7), age: 0, size: 1.5 + Math.random() * 2.6, color: gold() });
      }
    };
    const total = 2700;
    let start = 0;
    let last = 0;

    function frame(ts) {
      if (!canvas.isConnected) return;
      if (!start) { start = ts; last = ts; }
      const t = ts - start;
      const dt = Math.min(40, ts - last);
      last = ts;
      ctx.clearRect(-P, -P, W + 2 * P, H + P + 40);

      // Revelado: cada hoja aparece justo detrás de su chispa; al final se funde el símbolo completo.
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, mask.width, mask.height);
      mctx.setTransform(ctx.getTransform());
      mctx.globalCompositeOperation = 'source-over';
      mctx.strokeStyle = '#000';
      mctx.lineCap = 'round';
      mctx.lineJoin = 'round';
      let drawn = false;
      for (const p of paths) {
        const k = (t - p.delay) / p.dur;
        if (k <= 0) continue;
        const e = ease(k);
        mctx.lineWidth = p.small ? 70 : 120;
        mctx.beginPath();
        mctx.moveTo(p.from[0], p.from[1]);
        for (let i = 1; i <= 24; i++) { const [x, y] = bez(p.from, p.ctrl, p.to, (e * i) / 24); mctx.lineTo(x, y); }
        mctx.stroke();
        drawn = true;
      }
      if (drawn) {
        mctx.globalCompositeOperation = 'source-in';
        mctx.drawImage(img, 0, 0, W, H);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(mask, 0, 0);
        ctx.restore();
      }
      const full = Math.min(1, Math.max(0, (t - 1450) / 550));
      if (full > 0) { ctx.globalAlpha = full; ctx.drawImage(img, 0, 0, W, H); ctx.globalAlpha = 1; }

      ctx.globalCompositeOperation = 'lighter';
      // Mecha encendida en la base.
      const fuse = t < 1500 ? Math.min(1, t / 300) * (1 - Math.max(0, (t - 1100) / 400)) : 0;
      if (fuse > 0) {
        const g = ctx.createRadialGradient(base[0], base[1], 0, base[0], base[1], 90);
        g.addColorStop(0, `rgba(255, 236, 170, ${0.9 * fuse})`);
        g.addColorStop(1, 'rgba(233, 185, 73, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(base[0] - 90, base[1] - 90, 180, 180);
        if (t < 1100) emit(base[0], base[1] - 4, 3, 0.55, 1.4, -Math.PI / 2, 500);
      }

      // Cabezas de chispa recorriendo cada hoja.
      for (const p of paths) {
        const k = (t - p.delay) / p.dur;
        if (k < 0) continue;
        if (k <= 1) {
          const e = ease(k);
          const [x, y] = bez(p.from, p.ctrl, p.to, e);
          const [px, py] = bez(p.from, p.ctrl, p.to, Math.max(0, e - 0.03));
          const ang = Math.atan2(py - y, px - x);
          emit(x, y, p.small ? 2 : 4, 0.18, 1.1, ang, 650);
          const g = ctx.createRadialGradient(x, y, 0, x, y, p.small ? 16 : 26);
          g.addColorStop(0, 'rgba(255, 250, 225, 1)');
          g.addColorStop(0.4, 'rgba(255, 214, 120, 0.7)');
          g.addColorStop(1, 'rgba(233, 185, 73, 0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(x, y, p.small ? 16 : 26, 0, Math.PI * 2); ctx.fill();
        } else if (!p.burst) {
          p.burst = true;
          emit(p.to[0], p.to[1], p.small ? 18 : 46, p.small ? 0.35 : 0.55, Math.PI * 2, 0, 1100);
        }
      }

      // Partículas con gravedad y estela.
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.age += dt;
        if (s.age >= s.life) { sparks.splice(i, 1); continue; }
        s.vy += 0.0009 * dt;
        s.vx *= 0.985; s.vy *= 0.985;
        s.x += s.vx * dt; s.y += s.vy * dt;
        const a = 1 - s.age / s.life;
        ctx.strokeStyle = s.color;
        ctx.globalAlpha = a;
        ctx.lineWidth = s.size * (0.4 + a * 0.6);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x - s.vx * 18, s.y - s.vy * 18);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      if (t < total || sparks.length) requestAnimationFrame(frame);
      else { img.classList.remove('pending'); canvas.remove(); }
    }
    window.addEventListener('resize', fit, { once: true });
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ evento (invitados)
  async function renderEvent(slug) {
    const k = query().get('k') || '';
    const qs = k ? `?k=${encodeURIComponent(k)}` : '';
    const load = () => api(`/api/events/${encodeURIComponent(slug)}${qs}`, { headers: { 'X-Guest-Token': getToken(slug) } });
    let data;
    try { data = await load(); } catch (err) {
      if (err.status === 404) throw new Error(tr('Este evento no existe o el enlace ya no es válido. Pide a los anfitriones el enlace o el QR actualizado.'));
      throw err;
    }
    const ev = data.event;
    document.title = `${ev.name} · Guspira Events`;

    const shareLink = DEMO ? `https://guspira.events/e/${slug}${qs}` : location.origin + `/e/${encodeURIComponent(slug)}${qs}`;
    const cd = countdown(ev.date);
    const header = h('section', { class: 'event-hero' },
      h('div', { class: 'row center-row' }, h('span', { class: 'chip' }, tr(ev.type || 'Evento')), cd && daysUntil(ev.date) <= 0 ? h('span', { class: 'chip countdown' }, tr(cd)) : null, langToggle()),
      h('h1', { class: 'title' }, ev.name),
      ornament(),
      h('p', { class: 'muted' }, formatDate(ev.date, ev.time, lang === 'en' ? 'en-GB' : 'es-ES'), ev.venue ? ` · ${ev.venue}` : ''),
      liveCountdown(ev.date, ev.time, paletteFor(ev.type)),
      ev.description ? h('p', { class: 'lead' }, ev.description) : null,
      h('div', { class: 'row center-row share-row' },
        h('button', { type: 'button', class: 'link-btn share-btn', onclick: () => copy(shareLink) }, tr('Copiar enlace')),
        h('span', { class: 'muted', 'aria-hidden': 'true' }, '·'),
        h('a', { class: 'link-btn share-btn', href: `https://wa.me/?text=${encodeURIComponent(tr('¡Pide tus canciones para «{name}»! {link}', { name: ev.name, link: shareLink }))}`, target: '_blank', rel: 'noopener' }, tr('Compartir por WhatsApp')),
        daysUntil(ev.date) >= 0 && calendarLink(ev.name, ev.date, ev.time, ev.venue, tr('Pide tus canciones: {link}', { link: shareLink })) ? [h('span', { class: 'muted', 'aria-hidden': 'true' }, '·'),
          h('a', { class: 'link-btn share-btn', href: calendarLink(ev.name, ev.date, ev.time, ev.venue, tr('Pide tus canciones: {link}', { link: shareLink })), target: '_blank', rel: 'noopener' }, tr('Añadir al calendario'))] : null));
    app.append(header);
    embers(header, { count: innerWidth < 700 ? 14 : 24, colors: paletteFor(ev.type) });

    if (!data.authorized) {
      const input = h('input', { type: 'text', name: 'code', autocomplete: 'off', required: true, placeholder: tr('Código del evento'), 'aria-label': tr('Código del evento') });
      const form = h('form', { class: 'card gate', onsubmit: async (e) => {
        e.preventDefault();
        try {
          const r = await api(`/api/events/${encodeURIComponent(slug)}/unlock`, { method: 'POST', body: { code: input.value, k } });
          setToken(slug, r.token);
          render();
        } catch (err) { toast(err.message, 'error'); input.select(); }
      } },
      decoCorners(true),
      h('div', { class: 'gate-icon', 'aria-hidden': 'true' }, '🔒'),
      h('h2', {}, tr('Evento protegido')),
      h('p', { class: 'muted' }, tr('Introduce el código que te han facilitado los anfitriones para pedir canciones.')),
      h('div', { class: 'row' }, input, h('button', { class: 'btn', type: 'submit' }, tr('Entrar'))));
      app.append(h('section', { class: 'section narrow' }, form));
      input.focus();
      return;
    }

    const layout = h('section', { class: 'section event-layout' });
    const requestPanel = h('div', { class: 'card request-panel' });
    const listPanel = h('div', { class: 'card queue-panel' });
    const listHead = h('div', { class: 'panel-head' });
    const listBody = h('ul', { class: 'req-list' });
    const listEmpty = h('p', { class: 'muted empty-msg' }, tr('Todavía no hay canciones. ¡Sé el primero en pedir una!'));
    listPanel.append(listHead, listEmpty, listBody);
    const nowBox = h('div', { class: 'card now-card', hidden: true, 'aria-live': 'polite' });
    layout.append(requestPanel, listPanel);
    app.append(h('section', { class: 'section now-section' }, nowBox), layout);
    const loadNow = () => (ev.showNowPlaying ? api(`/api/events/${encodeURIComponent(slug)}/now${qs}`, { headers: { 'X-Guest-Token': getToken(slug) } }).then((n) => nowPlaying(nowBox, n), () => {}) : null);
    loadNow();

    // Panel de petición
    let selected = null;
    const remaining = () => (ev.maxPerGuest ? Math.max(0, ev.maxPerGuest - (data.myCount || 0)) : null);
    const nameInput = h('input', { type: 'text', maxlength: 60, placeholder: tr('Tu nombre (opcional)'), 'aria-label': tr('Tu nombre') });
    try { nameInput.value = localStorage.getItem('gs_name') || ''; } catch { /* nada */ }
    const msgInput = h('input', { type: 'text', maxlength: 200, placeholder: tr('Dedicatoria o comentario (opcional)'), 'aria-label': tr('Dedicatoria') });

    function buildRequestPanel() {
      requestPanel.replaceChildren();
      requestPanel.append(h('h2', {}, tr('Pide tu canción')));
      if (!ev.requestsOpen) { requestPanel.append(h('p', { class: 'notice' }, tr('Las peticiones están cerradas en este momento. Aún puedes votar las canciones de la lista.'))); return; }
      const rem = remaining();
      if (rem !== null) requestPanel.append(h('p', { class: 'muted small' }, rem > 0 ? plural(rem, 'Puedes pedir {n} canción más.', 'Puedes pedir {n} canciones más.') : tr('Has llegado al máximo de canciones. ¡Vota las de los demás!')));
      if (rem === 0) return;

      const tabs = h('div', { class: 'tabs', role: 'tablist' });
      const body = h('div');
      const showSearch = () => { setTab(0); body.replaceChildren(searchView()); };
      const showManual = () => { setTab(1); body.replaceChildren(manualView()); };
      const setTab = (i) => [...tabs.children].forEach((b, j) => b.setAttribute('aria-selected', String(i === j)));
      if (data.spotify) tabs.append(h('button', { type: 'button', role: 'tab', onclick: showSearch }, tr('Buscar en Spotify')));
      tabs.append(h('button', { type: 'button', role: 'tab', onclick: showManual }, tr('Escribirla a mano')));
      requestPanel.append(tabs, body);
      if (data.spotify) showSearch(); else showManual();
    }

    function guestFields(onSend, label) {
      return h('div', { class: 'guest-fields' }, nameInput, msgInput, h('button', { class: 'btn block', type: 'button', onclick: onSend }, label));
    }

    async function sendRequest(body) {
      try { localStorage.setItem('gs_name', nameInput.value.trim()); } catch { /* nada */ }
      const r = await api(`/api/events/${encodeURIComponent(slug)}/requests${qs}`, { method: 'POST', body: { ...body, guestName: nameInput.value, message: msgInput.value }, headers: { 'X-Guest-Token': getToken(slug) } });
      burstFrom(requestPanel.querySelector('.guest-fields .btn') || requestPanel, r.duplicate ? HEARTS : { count: 90, colors: paletteFor(ev.type) });
      msgInput.value = '';
      selected = null;
      await refresh();
      buildRequestPanel();
      const pos = (data.requests || []).findIndex((x) => x.id === r.request.id);
      const where = pos >= 0 && ev.showQueue ? tr(' Está en el puesto {n} de la lista.', { n: pos + 1 }) : '';
      toast(tr(r.duplicate ? 'Esa canción ya estaba pedida: hemos sumado tu voto ♥{where}' : '¡Petición enviada!{where}', { where }), 'ok');
      const li = listBody.querySelector(`[data-key="${r.request.id}"]`);
      if (li && !REDUCED) { li.classList.add('just-added'); setTimeout(() => li.classList.remove('just-added'), 2600); if (window.matchMedia('(max-width: 900px)').matches) li.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }

    function searchView() {
      const q = h('input', { type: 'search', placeholder: tr('Canción o artista…'), 'aria-label': tr('Buscar canción'), autocomplete: 'off' });
      const results = h('div', { class: 'results' });
      const chosen = h('div');
      let timer = null;
      let seq = 0;
      q.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const term = q.value.trim();
          const my = ++seq;
          if (term.length < 2) { results.replaceChildren(); return; }
          results.replaceChildren(h('p', { class: 'muted small' }, tr('Buscando…')));
          try {
            const tracks = await api(`/api/events/${encodeURIComponent(slug)}/search${qs ? qs + '&' : '?'}q=${encodeURIComponent(term)}`, { headers: { 'X-Guest-Token': getToken(slug) } });
            if (my !== seq) return;
            results.replaceChildren(...(tracks.length ? tracks.map((t) => h('button', { type: 'button', class: 'track', onclick: () => choose(t) },
              coverArt(t, 'sm'),
              h('span', { class: 'track-text' }, h('strong', {}, t.name, t.explicit ? h('span', { class: 'explicit', title: tr('Contenido explícito') }, 'E') : null), h('span', { class: 'muted small' }, `${t.artists} · ${fmtTime(t.durationMs)}`)),
              h('span', { class: 'plus', 'aria-hidden': 'true' }, '+'))) : [h('p', { class: 'muted small' }, tr('Sin resultados. Prueba con otras palabras o escríbela a mano.'))]));
          } catch (err) { results.replaceChildren(h('p', { class: 'notice' }, err.message)); }
        }, 320);
      });
      function choose(t) {
        selected = t;
        results.replaceChildren();
        q.value = '';
        chosen.replaceChildren(h('div', { class: 'chosen' },
          coverArt(t, 'md'),
          h('div', {}, h('strong', {}, t.name), h('p', { class: 'muted small' }, t.artists), h('button', { type: 'button', class: 'link-btn', onclick: () => { selected = null; chosen.replaceChildren(); q.focus(); } }, tr('Cambiar'))),
        ), guestFields(() => sendRequest({ trackId: selected.id }).catch((e) => toast(e.message, 'error')), tr('Enviar petición')));
      }
      return h('div', {}, q, results, chosen);
    }

    function manualView() {
      const title = h('input', { type: 'text', maxlength: 120, placeholder: tr('Título de la canción'), 'aria-label': tr('Título') });
      const artist = h('input', { type: 'text', maxlength: 120, placeholder: tr('Artista'), 'aria-label': tr('Artista') });
      return h('div', {}, title, artist, guestFields(() => {
        if (!title.value.trim()) { toast(tr('Escribe el título de la canción'), 'error'); title.focus(); return; }
        sendRequest({ title: title.value, artist: artist.value }).then(() => {}, (e) => toast(e.message, 'error'));
      }, tr('Enviar petición')));
    }

    // Lista de peticiones
    function buildList() {
      const reqs = data.requests || [];
      const votes = reqs.reduce((n, r) => n + r.votes, 0);
      listHead.replaceChildren(h('h2', {}, ev.showQueue ? tr('Lista de peticiones') : tr('Tus peticiones')),
        h('span', { class: 'muted small live' }, h('i', { class: 'live-dot', 'aria-hidden': 'true' }), reqs.length ? `${plural(reqs.length, '{n} canción', '{n} canciones')} · ${plural(votes, '{n} voto', '{n} votos')}` : tr('En directo')));
      listEmpty.hidden = reqs.length > 0;
      flipRender(listBody, reqs.map((r) =>
        h('li', { class: `req ${r.status}${r.mine ? ' mine' : ''}`, 'data-key': r.id },
          coverArt(r.track, 'sm'),
          h('div', { class: 'req-text' },
            h('strong', {}, r.track.name, r.mine ? h('span', { class: 'mine-tag' }, tr('Tuya')) : null),
            h('span', { class: 'muted small' }, r.track.artists || tr('Artista sin indicar')),
            r.guestName || r.message ? h('span', { class: 'small dedication' }, r.guestName ? `— ${r.guestName}` : '', r.message ? ` “${r.message}”` : '') : null),
          h('div', { class: 'req-side' },
            h('span', { class: `badge ${r.status}` }, tr(statusLabel[r.status])),
            h('button', { type: 'button', class: `vote ${r.voted ? 'voted' : ''}`, 'aria-pressed': String(r.voted), title: r.voted ? tr('Quitar voto') : tr('Votar'), onclick: async (e) => {
              const btn = e.currentTarget;
              if (!r.voted) { burstFrom(btn, HEARTS); btn.classList.add('pop'); }
              try { await api(`/api/events/${encodeURIComponent(slug)}/requests/${r.id}/vote${qs}`, { method: 'POST', body: {}, headers: { 'X-Guest-Token': getToken(slug) } }); await refresh(); } catch (err) { toast(err.message, 'error'); }
            } }, h('span', { class: 'heart', 'aria-hidden': 'true' }, '♥'), ' ', String(r.votes))))));
    }

    async function refresh() {
      try {
        data = await load();
        if (!data.authorized) { render(); return; }
        buildList();
        loadNow();
      } catch { /* sin conexión: se reintenta */ }
    }

    buildRequestPanel();
    buildList();
    pollTimer = setInterval(() => { if (!document.hidden) refresh(); }, 10000);
  }

  // ------------------------------------------------------------ pirotecnia
  const EFFECT_ART = {
    vertical: () => h('div', { class: 'fx fx-vertical', 'aria-hidden': 'true' }, Array.from({ length: 14 }, (_, i) => h('i', { style: { '--i': i } }))),
    abanico: () => h('div', { class: 'fx fx-abanico', 'aria-hidden': 'true' }, Array.from({ length: 5 }, (_, j) => h('b', { style: { '--a': `${(j - 2) * 22}deg` } }, Array.from({ length: 8 }, (_, i) => h('i', { style: { '--i': i } }))))),
    cascada: () => h('div', { class: 'fx fx-cascada', 'aria-hidden': 'true' }, Array.from({ length: 24 }, (_, i) => h('i', { style: { '--i': i, '--x': `${(i % 12) * 8 + 4}%` } }))),
    bengalas: () => h('div', { class: 'fx fx-bengalas', 'aria-hidden': 'true' }, Array.from({ length: 3 }, (_, i) => h('b', { style: { '--i': i } }, h('i'), h('i'), h('i')))),
    humo: () => h('div', { class: 'fx fx-humo', 'aria-hidden': 'true' }, Array.from({ length: 6 }, (_, i) => h('i', { style: { '--i': i } }))),
    confeti: () => h('div', { class: 'fx fx-confeti', 'aria-hidden': 'true' }, Array.from({ length: 18 }, (_, i) => h('i', { style: { '--i': i } })))
  };
  const fxObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => entries.forEach((e) => e.target.classList.toggle('paused', !e.isIntersecting)), { rootMargin: '80px' })
    : null;
  const effectArt = (kind, color) => {
    const el = (EFFECT_ART[kind] || EFFECT_ART.vertical)();
    if (fxObserver) { el.classList.add('paused'); fxObserver.observe(el); }
    if (color) el.style.setProperty('--fx', color.hex === 'linear' ? '#f6d36b' : color.hex);
    if (color && color.hex === 'linear') el.classList.add('fx-multi');
    return el;
  };

  async function renderPyro() {
    document.title = 'Pirotecnia para bodas y eventos · Guspira Events';
    const catalog = await api('/api/pyro/catalog');
    let lines = [];
    try { lines = JSON.parse(sessionStorage.getItem('gs_pyro_lines') || '[]'); } catch { lines = []; }
    lines = lines.filter((l) => catalog.items.some((i) => i.id === l.itemId));
    const persist = () => { try { sessionStorage.setItem('gs_pyro_lines', JSON.stringify(lines)); } catch { /* nada */ } };

    const pyroHero = h('section', { class: 'event-hero pyro-hero' },
      h('span', { class: 'chip' }, 'Pirotecnia fría · interior y exterior'),
      h('h1', { class: 'title' }, 'Diseña tu espectáculo de chispas'),
      ornament(),
      h('p', { class: 'lead' }, 'Elige los efectos, la cantidad y los colores. El presupuesto se calcula al momento e incluye montaje, técnico acreditado y seguro.'));
    app.append(pyroHero);
    embers(pyroHero, { count: innerWidth < 700 ? 16 : 30 });

    const catalogGrid = h('div', { class: 'grid fx-grid' });
    for (const item of catalog.items) {
      const colors = PyroCalc.itemColors(catalog, item);
      catalogGrid.append(h('article', { class: 'card fx-card' },
        effectArt(item.kind, colors[0]),
        h('h3', {}, item.name),
        h('p', { class: 'muted small' }, item.description),
        h('div', { class: 'swatches' }, colors.map((c) => swatch(c, 'sm'))),
        h('div', { class: 'fx-foot' },
          h('span', { class: 'price' }, 'desde ', h('strong', {}, euros(item.unitPrice)), ` / ${item.unitLabel}`),
          h('button', { type: 'button', class: 'btn small', onclick: (e) => {
            lines.push({ uid: Math.random().toString(36).slice(2), itemId: item.id, qty: item.minQty || 1, colorId: colors[0] && colors[0].id, durationId: item.durations[0] && item.durations[0].id, moment: '' });
            persist(); drawLines(); updateSummary();
            const btn = e.currentTarget;
            burstFrom(btn, { count: 36, power: 5 });
            btn.textContent = '✓ Añadido';
            btn.classList.add('added');
            setTimeout(() => { btn.textContent = 'Añadir'; btn.classList.remove('added'); }, 1400);
            if (!window.matchMedia('(max-width: 900px)').matches) linesBox.lastElementChild && linesBox.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } }, 'Añadir'))));
    }
    const packGrid = h('div', { class: 'grid packs' });
    for (const pack of catalog.packs || []) {
      const est = PyroCalc.computeQuote(catalog, pack.lines, {});
      packGrid.append(h('article', { class: 'card pack' },
        h('div', { class: 'row space' }, pack.tag ? h('span', { class: 'chip' }, pack.tag) : h('span'), h('span', { class: 'pack-price' }, h('small', {}, 'aprox. '), euros(est.total))),
        h('h3', {}, pack.name),
        h('p', { class: 'muted small' }, pack.description),
        h('ul', { class: 'pack-lines' }, est.lines.map((l) => h('li', {}, swatch({ hex: l.colorHex, name: l.colorName }, 'sm'), ` ${l.qty} × ${l.name}`))),
        h('p', { class: 'muted tiny' }, 'Incluye montaje, técnico, seguro e IVA. Puedes cambiar cantidades y colores después.'),
        h('button', { type: 'button', class: 'btn ghost block', onclick: (e) => {
          pack.lines.forEach((l) => lines.push({ ...l, uid: Math.random().toString(36).slice(2) }));
          persist(); drawLines(); updateSummary();
          const btn = e.currentTarget;
          burstFrom(btn, { count: 60, power: 6 });
          btn.textContent = '✓ Paquete añadido';
          btn.classList.add('added');
          setTimeout(() => { btn.textContent = 'Añadir paquete'; btn.classList.remove('added'); }, 1600);
          toast(`«${pack.name}» añadido. Ajusta cantidades y colores más abajo.`, 'ok');
        } }, 'Añadir paquete')));
    }
    app.append(h('section', { class: 'section' },
      h('h2', { class: 'title small' }, '1 · Elige un paquete o efectos sueltos'),
      (catalog.packs || []).length ? [h('h3', { class: 'subhead' }, 'Paquetes recomendados'), packGrid, h('h3', { class: 'subhead' }, 'Efectos sueltos')] : null,
      catalogGrid));

    const linesBox = h('div', { class: 'lines' });
    const summary = h('aside', { class: 'card summary', 'aria-live': 'polite' });
    const f = {
      name: h('input', { type: 'text', name: 'name', required: true, maxlength: 100, autocomplete: 'name' }),
      email: h('input', { type: 'email', name: 'email', maxlength: 120, autocomplete: 'email' }),
      phone: h('input', { type: 'tel', name: 'phone', maxlength: 30, autocomplete: 'tel' }),
      type: h('select', { name: 'type' }, catalog.eventTypes.map((t) => h('option', {}, t))),
      date: h('input', { type: 'date', name: 'date', required: true, min: new Date().toISOString().slice(0, 10) }),
      place: h('input', { type: 'text', name: 'place', maxlength: 160, placeholder: 'Finca, restaurante, ciudad…' }),
      indoor: h('select', { name: 'indoor' }, h('option', { value: 'interior' }, 'Interior'), h('option', { value: 'exterior' }, 'Exterior')),
      guests: h('input', { type: 'number', name: 'guests', min: 0, max: 5000, inputmode: 'numeric' }),
      km: h('input', { type: 'number', name: 'km', min: 0, max: 2000, value: 0, inputmode: 'numeric' }),
      notes: h('textarea', { name: 'notes', rows: 3, maxlength: 1000, placeholder: 'Cuéntanos el momento que quieres destacar, horarios, dudas…' })
    };
    f.km.addEventListener('input', () => updateSummary());
    const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint ? (hint instanceof Node ? hint : h('small', { class: 'muted' }, hint)) : null);
    const dateHint = h('small', { class: 'avail', 'aria-live': 'polite' });
    let availSeq = 0;
    f.date.addEventListener('change', async () => {
      const value = f.date.value;
      const my = ++availSeq;
      dateHint.className = 'avail';
      dateHint.textContent = value ? 'Consultando la agenda…' : '';
      if (!value) return;
      try {
        const r = await api(`/api/pyro/availability?date=${encodeURIComponent(value)}`);
        if (my !== availSeq) return;
        const weekend = [0, 5, 6].includes(new Date(value + 'T12:00:00').getDay());
        if (!r.booked) { dateHint.className = 'avail ok'; dateHint.textContent = `✓ Fecha libre en nuestra agenda${weekend ? ' · fin de semana con mucha demanda, reserva pronto' : ''}`; }
        else { dateHint.className = 'avail warn'; dateHint.textContent = `Ya tenemos ${r.booked === 1 ? 'un evento' : `${r.booked} eventos`} ese día. Te confirmaremos disponibilidad.`; }
      } catch { dateHint.textContent = ''; }
    });
    const submit = h('button', { class: 'btn block', type: 'submit' }, 'Solicitar presupuesto');
    const form = h('form', { class: 'card quote-form', onsubmit: async (e) => {
      e.preventDefault();
      if (!lines.length) { toast('Añade al menos un efecto', 'error'); return; }
      if (!f.email.value.trim() && !f.phone.value.trim()) { toast('Déjanos un correo o un teléfono', 'error'); f.email.focus(); return; }
      submit.disabled = true;
      try {
        const q = await api('/api/pyro/quotes', { method: 'POST', body: {
          lines, distanceKm: f.km.value, notes: f.notes.value, privacy: form.elements.privacy.checked,
          customer: { name: f.name.value, email: f.email.value, phone: f.phone.value },
          event: { type: f.type.value, date: f.date.value, place: f.place.value, indoor: f.indoor.value, guests: f.guests.value }
        } });
        lines = []; persist();
        pendingCelebrate = { colors: paletteFor(f.type.value) };
        navigate(linkPath(q.link));
      } catch (err) { toast(err.message, 'error'); } finally { submit.disabled = false; }
    } },
    h('h2', { class: 'title small' }, '3 · Tus datos y el evento'),
    h('div', { class: 'form-grid' },
      field('Nombre y apellidos *', f.name), field('Correo electrónico', f.email), field('Teléfono', f.phone),
      field('Tipo de evento', f.type), field('Fecha *', f.date, dateHint), field('Lugar', f.place),
      field('Espacio', f.indoor), field('Invitados aprox.', f.guests),
      field('Distancia desde nuestra base (km)', f.km, `Los primeros ${catalog.fees.freeKm} km están incluidos.`)),
    field('Comentarios', f.notes),
    privacyCheck(),
    h('p', { class: 'muted small' }, 'Presupuesto orientativo sujeto a disponibilidad y a la normativa del espacio. Te contactaremos para confirmarlo.'),
    submit);

    const bar = h('div', { class: 'pyro-bar', hidden: true });
    app.append(h('section', { class: 'section pyro-builder' },
      h('div', { class: 'builder-main' }, h('h2', { class: 'title small' }, '2 · Ajusta cantidades y colores'), linesBox),
      summary, form), bar);

    function drawLines() {
      linesBox.replaceChildren();
      if (!lines.length) { linesBox.append(h('div', { class: 'card empty' }, h('p', { class: 'muted' }, 'Aún no has añadido efectos. Pulsa «Añadir» en cualquiera de los de arriba.'))); return; }
      lines.forEach((line) => {
        const item = catalog.items.find((i) => i.id === line.itemId);
        const colors = PyroCalc.itemColors(catalog, item);
        const color = colors.find((c) => c.id === line.colorId) || colors[0];
        const art = effectArt(item.kind, color);
        const qty = h('input', { type: 'number', min: item.minQty, max: item.maxQty, value: line.qty, inputmode: 'numeric', 'aria-label': 'Cantidad' });
        const setQty = (v) => {
          const prev = line.qty;
          line.qty = Math.max(item.minQty, Math.min(item.maxQty, Math.floor(Number(v)) || item.minQty));
          qty.value = line.qty;
          if (prev !== line.qty && !REDUCED) { qty.classList.remove('bump'); void qty.offsetWidth; qty.classList.add('bump'); }
          persist(); updateSummary();
        };
        qty.addEventListener('change', () => setQty(qty.value));
        const lineTotal = h('strong', { class: 'line-total' });
        line._total = lineTotal;
        const colorPicker = h('div', { class: 'swatches pick', role: 'radiogroup', 'aria-label': 'Color' }, colors.map((c) => {
          const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(c.id === color.id), title: `${c.name}${c.surcharge ? ` (+${euros(c.surcharge)})` : ''}`, onclick: () => { line.colorId = c.id; persist(); drawLines(); updateSummary(); } }, swatch(c), h('span', {}, c.name));
          return b;
        }));
        const duration = h('select', { 'aria-label': 'Duración', onchange: (e) => { line.durationId = e.target.value; persist(); updateSummary(); } },
          item.durations.map((d) => h('option', { value: d.id, selected: d.id === line.durationId }, d.label)));
        const moment = h('select', { 'aria-label': 'Momento', onchange: (e) => { line.moment = e.target.value; persist(); } },
          h('option', { value: '' }, 'Momento (opcional)'), catalog.moments.map((m) => h('option', { value: m, selected: m === line.moment }, m)));
        linesBox.append(h('div', { class: 'card line' },
          h('div', { class: 'line-art' }, art),
          h('div', { class: 'line-body' },
            h('div', { class: 'line-head' }, h('h3', {}, item.name), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Quitar', title: 'Quitar', onclick: () => { lines = lines.filter((l) => l !== line); persist(); drawLines(); updateSummary(); } }, '✕')),
            h('div', { class: 'line-controls' },
              h('div', { class: 'stepper' },
                h('button', { type: 'button', 'aria-label': 'Menos', onclick: () => setQty(line.qty - 1) }, '−'), qty,
                h('button', { type: 'button', 'aria-label': 'Más', onclick: () => setQty(line.qty + 1) }, '+'),
                h('span', { class: 'muted small' }, item.unitLabel + (line.qty === 1 ? '' : 's'))),
              item.durations.length > 1 ? duration : h('span', { class: 'muted small' }, item.durations[0].label),
              moment),
            colorPicker,
            h('div', { class: 'line-foot' }, lineTotal))));
      });
    }

    let lastTotal = 0;
    function updateSummary() {
      const calc = PyroCalc.computeQuote(catalog, lines, { distanceKm: f.km.value });
      lines.forEach((l, i) => { const c = calc.lines[i]; if (l._total && c) l._total.textContent = `${c.qty} × ${euros(c.unitPrice)} = ${euros(c.total)}`; });
      summary.replaceChildren(h('h2', { class: 'title small' }, 'Tu presupuesto'));
      if (lines.length) {
        const stage = h('div', { class: 'stage', 'aria-label': 'Vista previa del espectáculo' });
        const shown = lines.slice(0, 6);
        shown.forEach((l) => {
          const item = catalog.items.find((i) => i.id === l.itemId);
          if (!item) return;
          const cols = PyroCalc.itemColors(catalog, item);
          const color = cols.find((c) => c.id === l.colorId) || cols[0];
          const art = effectArt(item.kind, color);
          art.classList.remove('paused');
          stage.append(h('div', { class: 'stage-slot', title: `${l.qty} × ${item.name}` }, art, h('span', { class: 'stage-qty' }, `×${l.qty}`)));
        });
        summary.append(h('p', { class: 'eyebrow stage-label' }, 'Vista previa del espectáculo'), stage,
          h('button', { type: 'button', class: 'btn block rehearse-btn', onclick: () => rehearsal(catalog, lines, PyroCalc.computeQuote(catalog, lines, { distanceKm: f.km.value })) }, h('span', { class: 'play', 'aria-hidden': 'true' }), 'Ver ensayo del espectáculo'));
      }
      const units = calc.lines.reduce((n, l) => n + 1, 0);
      bar.hidden = !calc.lines.length;
      const barTotal = h('strong', { 'data-v': String(lastTotal) });
      bar.replaceChildren(
        h('div', {}, h('span', { class: 'muted small' }, `${units} ${units === 1 ? 'efecto' : 'efectos'} · IVA incl.`), barTotal),
        h('button', { type: 'button', class: 'btn small', onclick: () => summary.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 'Ver resumen'));
      if (!calc.lines.length) { summary.append(h('p', { class: 'muted small' }, 'Añade efectos para ver el precio.')); return; }
      const rows = h('dl', { class: 'sum-rows' });
      const row = (k, v, cls = '') => rows.append(h('dt', { class: cls }, k), h('dd', { class: cls }, v));
      calc.lines.forEach((l) => row(`${l.qty} × ${l.name} · ${l.colorName}`, euros(l.total)));
      row('Montaje, técnico y seguro', euros(calc.setup), 'sep');
      if (calc.travel) row(`Desplazamiento (${calc.distanceKm} km)`, euros(calc.travel));
      if (calc.discount) row(`Descuento ${calc.discountPct}%`, `−${euros(calc.discount)}`, 'discount');
      row('Base imponible', euros(calc.base), 'sep');
      row(`IVA ${Math.round(calc.vatRate * 100)}%`, euros(calc.vat));
      const sumTotal = h('strong', { 'data-v': String(lastTotal) });
      summary.append(rows, h('div', { class: 'sum-total' }, h('span', {}, 'Total'), sumTotal));
      tween(sumTotal, calc.total, euros, 650);
      tween(barTotal, calc.total, euros, 650);
      lastTotal = calc.total;
      const next = (catalog.fees.discounts || []).filter((d) => d.min > calc.itemsTotal).sort((a, b) => a.min - b.min)[0];
      if (next) summary.append(h('p', { class: 'muted small' }, `Añade ${euros(next.min - calc.itemsTotal)} más en efectos y obtén un ${next.pct}% de descuento.`));
      summary.append(h('button', { type: 'button', class: 'btn ghost block', onclick: () => form.scrollIntoView({ behavior: 'smooth' }) }, 'Continuar'));
    }

    const faq = [
      ['¿La chispa fría se puede usar en interiores?', 'Sí. Las fuentes de chispa fría están pensadas para salones y carpas: trabajan a una temperatura mucho menor que la pirotecnia tradicional y no producen llama. Aun así, siempre las monta y controla nuestro técnico respetando las distancias de seguridad.'],
      ['¿Necesito permiso de la finca o del restaurante?', 'Conviene confirmarlo con el espacio. Si quieres, hablamos directamente con ellos y les enviamos la documentación técnica y el seguro.'],
      ['¿Qué pasa si llueve o hace viento?', 'En interior no afecta. En exterior, con lluvia intensa o viento fuerte, el técnico puede proponer otra ubicación u otro momento para hacerlo con seguridad.'],
      ['¿Con cuánta antelación debo reservar?', 'Cuanto antes, mejor, sobre todo en temporada de bodas. La fecha queda reservada cuando aceptas el presupuesto y abonas la señal.'],
      ['¿Puedo combinar colores y efectos?', 'Claro. Cada efecto puede llevar su propio color y momento. Los colores especiales tienen un pequeño recargo que ves al instante en el presupuesto.']
    ];
    app.append(h('section', { class: 'section narrow faq' }, h('h2', { class: 'title small' }, 'Preguntas frecuentes'),
      faq.map(([q, a]) => h('details', { class: 'faq-item' }, h('summary', {}, q), h('p', { class: 'muted' }, a)))));

    drawLines();
    updateSummary();
  }

  // ------------------------------------------------------------ presupuesto
  async function renderQuote(qid) {
    const t = query().get('t') || '';
    const q = await api(`/api/pyro/quotes/${encodeURIComponent(qid)}?t=${encodeURIComponent(t)}`);
    document.title = `Presupuesto ${q.number} · Guspira Events`;
    app.append(quoteDocument(q, true, t));
  }

  function quoteDocument(q, withActions, token) {
    const table = h('table', { class: 'quote-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Concepto'), h('th', {}, 'Color'), h('th', {}, 'Duración'), h('th', { class: 'num' }, 'Cant.'), h('th', { class: 'num' }, 'Precio'), h('th', { class: 'num' }, 'Importe'))),
      h('tbody', {}, q.lines.map((l) => h('tr', {},
        h('td', { class: 'concept' }, l.name, l.moment ? h('div', { class: 'muted small' }, l.moment) : null),
        h('td', { 'data-label': 'Color' }, swatch({ hex: l.colorHex, name: l.colorName }, 'sm'), ' ', l.colorName),
        h('td', { 'data-label': 'Duración' }, l.durationLabel),
        h('td', { class: 'num', 'data-label': 'Cantidad' }, l.qty),
        h('td', { class: 'num', 'data-label': 'Precio' }, euros(l.unitPrice)),
        h('td', { class: 'num total', 'data-label': 'Importe' }, euros(l.total))))));
    const totals = h('dl', { class: 'sum-rows quote-totals' });
    const row = (k, v, cls = '') => totals.append(h('dt', { class: cls }, k), h('dd', { class: cls }, v));
    row('Efectos', euros(q.itemsTotal));
    if (q.discount) row(`Descuento ${q.discountPct}%`, `−${euros(q.discount)}`, 'discount');
    row('Montaje, técnico y seguro', euros(q.setup));
    if (q.travel) row(`Desplazamiento (${q.distanceKm} km)`, euros(q.travel));
    row('Base imponible', euros(q.base), 'sep');
    row(`IVA ${Math.round(q.vatRate * 100)}%`, euros(q.vat));
    const accepted = q.status === 'aceptado';
    const fmtDay = (iso) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    const validUntil = new Date(new Date(q.createdAt).getTime() + 30 * 86400000);
    let notice = null;
    if (withActions) {
      if (accepted) notice = h('div', { class: 'notice ok no-print' }, `Has aceptado este presupuesto${q.acceptedAt ? ` el ${fmtDay(q.acceptedAt)}` : ''}. Te contactaremos para confirmar la reserva y la señal.`);
      else if (q.status === 'descartado') notice = h('div', { class: 'notice no-print' }, 'Este presupuesto ya no está disponible. Escríbenos y te preparamos uno nuevo.');
      else notice = h('div', { class: 'notice ok no-print' }, '¡Solicitud recibida! Revisaremos la disponibilidad y te contactaremos. Guarda este enlace para consultarlo o aceptarlo cuando quieras.');
    }
    const companyLines = [site.legalName || site.name, site.taxId ? `CIF/NIF ${site.taxId}` : '', site.phone, site.email, site.address].filter(Boolean);
    let acceptBox = null;
    if (withActions && token && !accepted && q.status !== 'descartado') {
      const btn = h('button', { class: 'btn', type: 'button' }, 'Aceptar presupuesto');
      const hint = h('p', { class: 'muted small' }, 'Al aceptarlo reservamos tu fecha de forma provisional y te contactamos para la señal.');
      btn.addEventListener('click', async () => {
        if (!btn.dataset.confirm) { btn.dataset.confirm = '1'; btn.textContent = `Confirmar: acepto ${euros(q.total)}`; hint.textContent = 'Pulsa de nuevo para confirmar la aceptación.'; return; }
        btn.disabled = true;
        try { await api(`/api/pyro/quotes/${q.id}/accept`, { method: 'POST', body: { t: token } }); toast('Presupuesto aceptado. ¡Gracias!', 'ok'); pendingCelebrate = { fireworks: true, colors: paletteFor(q.event.type) }; render(); } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
      });
      acceptBox = h('div', { class: 'accept-box no-print' }, h('div', {}, h('strong', {}, '¿Te encaja?'), hint), btn);
    }
    return h('section', { class: 'section narrow' },
      notice,
      h('article', { class: 'card quote-doc' },
        decoCorners(),
        accepted ? h('div', { class: 'stamp', 'aria-hidden': 'true' }, 'Aceptado') : null,
        h('header', { class: 'quote-head' },
          h('img', { src: ASSET.logo, alt: 'Guspira Events', width: 180, height: 135 }),
          h('div', { class: 'quote-title' }, h('h1', {}, 'Presupuesto de pirotecnia'), h('p', {}, h('strong', {}, q.number), accepted ? h('span', { class: 'badge q-aceptado' }, ' Aceptado') : null),
            h('p', { class: 'muted small' }, `Emitido el ${fmtDay(q.createdAt)} · válido hasta el ${fmtDay(validUntil)}`)),
          companyLines.length > 1 ? h('div', { class: 'quote-company small' }, companyLines.map((l, i) => h('p', { class: i ? 'muted' : '' }, l))) : null),
        h('div', { class: 'quote-meta' },
          h('div', {}, h('h3', {}, 'Cliente'), h('p', {}, q.customer.name), q.customer.email ? h('p', { class: 'muted small' }, q.customer.email) : null, q.customer.phone ? h('p', { class: 'muted small' }, q.customer.phone) : null),
          h('div', {}, h('h3', {}, 'Evento'), h('p', {}, q.event.type || 'Evento'), h('p', { class: 'muted small' }, formatDate(q.event.date)), h('p', { class: 'muted small' }, [q.event.place, q.event.indoor === 'exterior' ? 'Exterior' : 'Interior', q.event.guests ? `${q.event.guests} invitados` : ''].filter(Boolean).join(' · ')))),
        h('div', { class: 'table-wrap' }, table),
        (() => {
          if (!q.lines.some((l) => l.moment)) return null;
          const groups = MOMENTS.map((m) => [m, q.lines.filter((l) => l.moment === m)]).filter(([, ls]) => ls.length);
          const rest = q.lines.filter((l) => !l.moment || !MOMENTS.includes(l.moment));
          if (rest.length) groups.push(['Momento por decidir', rest]);
          return h('div', { class: 'guion' }, h('h3', {}, 'Guion del espectáculo'),
            h('ol', { class: 'timeline' }, groups.map(([m, ls]) => h('li', {},
              h('strong', {}, m),
              h('span', { class: 'muted small' }, ls.map((l) => `${l.qty} × ${l.name} · ${l.colorName.toLowerCase()} · ${l.durationLabel.toLowerCase()}`).join('  |  '))))));
        })(),
        totals,
        h('div', { class: 'sum-total' }, h('span', {}, 'Total (IVA incluido)'), h('strong', {}, euros(q.total))),
        q.notes ? h('p', { class: 'small' }, h('strong', {}, 'Comentarios: '), q.notes) : null,
        h('div', { class: 'conditions' }, h('h3', {}, 'Condiciones'), h('p', { class: 'muted small' }, site.conditions || 'Pirotecnia fría manipulada por técnico acreditado. El precio puede variar según los permisos y las condiciones del espacio.'))),
      acceptBox,
      withActions ? h('div', { class: 'row no-print' },
        DEMO ? null : h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Imprimir / guardar PDF'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => copy(q.link) }, 'Copiar enlace'),
        calendarLink(`${q.event.type || 'Evento'} · pirotecnia ${site.name}`, q.event.date, '', q.event.place, `Presupuesto ${q.number}: ${q.link}`) ? h('a', { class: 'btn ghost', href: calendarLink(`${q.event.type || 'Evento'} · pirotecnia ${site.name}`, q.event.date, '', q.event.place, `Presupuesto ${q.number}: ${q.link}`), target: '_blank', rel: 'noopener' }, 'Añadir al calendario') : null,
        h('a', { class: 'btn ghost', href: '/pirotecnia', 'data-link': true }, 'Nuevo presupuesto')) : null);
  }

  // ------------------------------------------------------------ administración
  async function renderAdmin() {
    document.title = 'Administración · Guspira Events';
    statusCache = await api('/api/status');
    if (!statusCache.admin) return renderLogin();
    const params = query();
    const spotifyMsg = params.get('spotify');
    if (spotifyMsg) {
      toast(spotifyMsg === 'ok' ? 'Spotify conectado correctamente' : spotifyMsg, spotifyMsg === 'ok' ? 'ok' : 'error');
      replaceUrl('/admin?tab=ajustes');
    }
    let tab = query().get('tab') || 'resumen';
    if (tab === 'spotify') tab = 'ajustes';
    const overview = await api('/api/admin/overview');
    const c = overview.counts;
    const tabs = [['resumen', 'Resumen', 0], ['eventos', 'Eventos', c.pendingRequests], ['presupuestos', 'Presupuestos', c.newQuotes], ['mensajes', 'Mensajes', c.newMessages], ['catalogo', 'Catálogo', 0], ['contenido', 'Contenido', 0], ['ajustes', 'Ajustes', 0]];
    const content = h('div', { class: 'admin-content' });
    app.append(h('section', { class: 'section admin' },
      h('div', { class: 'admin-head' },
        h('div', {}, h('p', { class: 'eyebrow' }, 'Área privada'), h('h1', { class: 'title' }, 'Panel de gestión')),
        h('div', { class: 'row' },
          h('a', { class: 'btn ghost small', href: '/', 'data-link': true }, 'Ver la web'),
          h('button', { class: 'btn ghost small', type: 'button', onclick: async () => { await api('/api/admin/logout', { method: 'POST', body: {} }); render(); } }, 'Cerrar sesión'))),
      h('nav', { class: 'tabs admin-tabs', role: 'tablist' }, tabs.map(([k, label, n]) => h('a', { href: `/admin?tab=${k}`, 'data-link': true, role: 'tab', 'aria-selected': String(k === tab) }, label, n ? h('span', { class: 'tab-badge', 'aria-label': `${n} pendientes` }, String(n)) : null))),
      content));
    const views = { resumen: (root) => adminOverview(root, overview), eventos: adminEvents, presupuestos: adminQuotes, mensajes: adminMessages, catalogo: adminCatalog, contenido: adminContent, ajustes: adminSettings };
    await (views[tab] || views.resumen)(content);
  }

  function renderLogin() {
    const setup = statusCache.setupNeeded;
    const pass = h('input', { type: 'password', required: true, minlength: setup ? 8 : 1, autocomplete: setup ? 'new-password' : 'current-password', 'aria-label': 'Contraseña', placeholder: 'Contraseña' });
    const pass2 = setup ? h('input', { type: 'password', required: true, minlength: 8, autocomplete: 'new-password', placeholder: 'Repite la contraseña', 'aria-label': 'Repite la contraseña' }) : null;
    app.append(h('section', { class: 'section narrow' }, h('form', { class: 'card gate', onsubmit: async (e) => {
      e.preventDefault();
      if (setup && pass.value !== pass2.value) { toast('Las contraseñas no coinciden', 'error'); return; }
      try { await api(setup ? '/api/admin/setup' : '/api/admin/login', { method: 'POST', body: { password: pass.value } }); render(); } catch (err) { toast(err.message, 'error'); pass.select(); }
    } },
    decoCorners(true),
    h('img', { src: ASSET.icon, alt: '', width: 56, height: 56, class: 'gate-logo' }),
    h('h1', { class: 'title small' }, setup ? 'Crea la contraseña de administración' : 'Acceso de administración'),
    setup ? h('p', { class: 'muted small' }, 'Es la primera vez que se abre el panel. Elige una contraseña de al menos 8 caracteres.') : null,
    pass, pass2, h('button', { class: 'btn block', type: 'submit' }, setup ? 'Crear y entrar' : 'Entrar'))));
    pass.focus();
  }

  // --- eventos
  async function adminEvents(root) {
    const events = await api('/api/admin/events');
    const selectedId = query().get('event');
    if (selectedId) {
      const ev = events.find((e) => e.id === selectedId);
      if (ev) return adminEventDetail(root, ev);
    }
    root.append(h('div', { class: 'row space' }, h('p', { class: 'muted' }, `${events.length} ${events.length === 1 ? 'evento' : 'eventos'}`), h('button', { class: 'btn', type: 'button', onclick: () => eventDialog(null) }, '+ Nuevo evento')));
    if (!events.length) root.append(h('div', { class: 'card empty' }, h('p', {}, 'Crea tu primer evento para empezar a recibir peticiones de canciones.')));
    const grid = h('div', { class: 'grid events' });
    for (const ev of events) {
      grid.append(h('article', { class: `card event-card admin-event ${ev.archived ? 'archived' : ''}` },
        h('div', { class: 'event-card-top' },
          h('span', { class: 'chip' }, ev.visibility === 'public' ? 'En portada' : 'Privado (enlace/QR)'),
          ev.access === 'code' ? h('span', { class: 'chip lock' }, `🔒 ${ev.code}`) : h('span', { class: 'chip open' }, 'Libre'),
          ev.archived ? h('span', { class: 'chip' }, 'Archivado') : null),
        h('h3', {}, ev.name),
        h('p', { class: 'muted small' }, formatDate(ev.date, ev.time)),
        h('p', { class: 'stats' },
          h('span', { class: 'badge pending' }, `${ev.stats.pending} pendientes`),
          h('span', { class: 'badge approved' }, `${ev.stats.approved} aprobadas`),
          h('span', { class: 'badge played' }, `${ev.stats.played} sonadas`)),
        ev.stats.total ? h('div', { class: 'progress-stack', title: `${ev.stats.total} peticiones` },
          ['played', 'approved', 'pending', 'rejected'].map((k) => ev.stats[k] ? h('i', { class: `ps-${k}`, style: { '--w': `${(ev.stats[k] / ev.stats.total) * 100}%` } }) : null)) : null,
        h('div', { class: 'row' },
          h('a', { class: 'btn small', href: `/admin?tab=eventos&event=${ev.id}`, 'data-link': true }, 'Gestionar'),
          h('button', { class: 'btn ghost small', type: 'button', title: 'Crear un evento con la misma configuración', onclick: async () => {
            const keys = ['type', 'date', 'time', 'venue', 'description', 'visibility', 'access', 'code', 'requestsOpen', 'allowExplicit', 'showQueue', 'autoQueue', 'maxPerGuest', 'showNowPlaying'];
            const body = Object.fromEntries(keys.filter((k) => ev[k] !== undefined).map((k) => [k, ev[k]]));
            body.name = `${ev.name} (copia)`;
            try { const saved = await api('/api/admin/events', { method: 'POST', body }); toast('Evento duplicado. Revisa la fecha y el nombre.', 'ok'); navigate(`/admin?tab=eventos&event=${saved.id}`); } catch (err) { toast(err.message, 'error'); }
          } }, 'Duplicar'),
          h('button', { class: 'btn ghost small', type: 'button', onclick: () => eventDialog(ev) }, 'Editar'))));
    }
    root.append(grid);
  }

  function eventDialog(ev) {
    const isNew = !ev;
    ev = { ...(ev || { visibility: 'public', access: 'open', requestsOpen: true, allowExplicit: true, showQueue: true, autoQueue: false, maxPerGuest: 5 }) };
    ev.showNowPlaying = ev.showNowPlaying !== false;
    const inp = (name, attrs = {}) => h('input', { name, value: ev[name] ?? '', ...attrs });
    const fields = {
      name: inp('name', { required: true, maxlength: 120, placeholder: 'Boda de Lucía y Marcos' }),
      type: h('select', { name: 'type' }, ['Boda', 'Babyshower', 'Comunión', 'Bautizo', 'Cumpleaños', 'Aniversario', 'Evento de empresa', 'Fiesta privada', 'Otro'].map((t) => h('option', { selected: t === ev.type }, t))),
      date: inp('date', { type: 'date' }),
      time: inp('time', { type: 'time' }),
      venue: inp('venue', { maxlength: 120, placeholder: 'Finca El Olivar, Sevilla' }),
      slug: inp('slug', { maxlength: 80, placeholder: 'Se genera a partir del nombre' }),
      description: h('textarea', { name: 'description', rows: 2, maxlength: 1000 }, ev.description || ''),
      code: inp('code', { maxlength: 40, placeholder: 'p. ej. LUCIAYMARCOS' }),
      maxPerGuest: inp('maxPerGuest', { type: 'number', min: 0, max: 50 })
    };
    const radio = (name, value, label, hint) => h('label', { class: 'option' }, h('input', { type: 'radio', name, value, checked: ev[name] === value }), h('span', {}, h('strong', {}, label), h('small', { class: 'muted' }, hint)));
    const check = (name, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name, checked: Boolean(ev[name]) }), label);
    const codeField = h('label', { class: 'field' }, h('span', {}, 'Código de acceso para invitados'), fields.code);
    const form = h('form', { class: 'dialog-form', method: 'dialog' },
      h('h2', { class: 'title small' }, isNew ? 'Nuevo evento' : 'Editar evento'),
      h('div', { class: 'form-grid' },
        h('label', { class: 'field wide' }, h('span', {}, 'Nombre *'), fields.name),
        h('label', { class: 'field' }, h('span', {}, 'Tipo'), fields.type),
        h('label', { class: 'field' }, h('span', {}, 'Fecha'), fields.date),
        h('label', { class: 'field' }, h('span', {}, 'Hora'), fields.time),
        h('label', { class: 'field' }, h('span', {}, 'Lugar'), fields.venue),
        h('label', { class: 'field' }, h('span', {}, 'Dirección web (/e/…)'), fields.slug),
        h('label', { class: 'field wide' }, h('span', {}, 'Descripción para los invitados'), fields.description)),
      h('fieldset', {}, h('legend', {}, 'Visibilidad'),
        radio('visibility', 'public', 'En portada', 'Aparece en la página principal.'),
        radio('visibility', 'private', 'Privado', 'Solo con el enlace secreto o el código QR.')),
      h('fieldset', {}, h('legend', {}, 'Acceso'),
        radio('access', 'open', 'Libre', 'Cualquiera que vea el evento puede pedir canciones.'),
        radio('access', 'code', 'Con código', 'Se pide un código a modo de contraseña.'),
        codeField),
      h('fieldset', {}, h('legend', {}, 'Peticiones'),
        check('requestsOpen', 'Peticiones abiertas'),
        check('showQueue', 'Mostrar a los invitados la lista de peticiones'),
        check('allowExplicit', 'Permitir canciones con contenido explícito'),
        check('autoQueue', 'Al aprobar, añadir automáticamente a la cola de Spotify'),
        check('showNowPlaying', 'Mostrar a los invitados la canción que está sonando'),
        h('label', { class: 'field' }, h('span', {}, 'Máximo de canciones por invitado (0 = sin límite)'), fields.maxPerGuest),
        !isNew ? check('archived', 'Archivar (oculta el evento y cierra el enlace)') : null),
      h('div', { class: 'row end' },
        !isNew ? h('button', { type: 'button', class: 'btn danger ghost', onclick: async () => {
          if (!confirm(`¿Eliminar «${ev.name}» y todas sus peticiones? No se puede deshacer.`)) return;
          await api(`/api/admin/events/${ev.id}`, { method: 'DELETE' }); dialog.close(); navigate('/admin?tab=eventos', true);
        } }, 'Eliminar') : null,
        h('button', { type: 'button', class: 'btn ghost', onclick: () => dialog.close() }, 'Cancelar'),
        h('button', { type: 'submit', class: 'btn', value: 'save' }, 'Guardar')));
    const syncCode = () => { codeField.hidden = form.elements.access.value !== 'code'; fields.code.required = !codeField.hidden; };
    form.addEventListener('change', syncCode);
    const dialog = h('dialog', { class: 'dialog' }, form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const el = form.elements;
      const body = {
        name: el.name.value, type: el.type.value, date: el.date.value, time: el.time.value, venue: el.venue.value, description: el.description.value,
        visibility: el.visibility.value, access: el.access.value, code: el.code.value, maxPerGuest: el.maxPerGuest.value,
        requestsOpen: el.requestsOpen.checked, showQueue: el.showQueue.checked, allowExplicit: el.allowExplicit.checked, autoQueue: el.autoQueue.checked, showNowPlaying: el.showNowPlaying.checked,
        archived: el.archived ? el.archived.checked : false
      };
      if (el.slug.value.trim() && el.slug.value.trim() !== ev.slug) body.slug = el.slug.value;
      try {
        const saved = await api(isNew ? '/api/admin/events' : `/api/admin/events/${ev.id}`, { method: isNew ? 'POST' : 'PUT', body });
        dialog.close();
        toast('Evento guardado', 'ok');
        navigate(`/admin?tab=eventos&event=${saved.id}`, true);
      } catch (err) { toast(err.message, 'error'); }
    });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    syncCode();
    dialog.showModal();
  }

  async function adminEventDetail(root, ev) {
    let filter = 'all';
    let term = '';
    const listBox = h('div');
    const search = h('input', { type: 'search', placeholder: 'Buscar canción, artista o invitado', 'aria-label': 'Buscar peticiones', class: 'search' });
    search.addEventListener('input', () => { term = search.value.trim().toLowerCase(); drawList(); });
    const nowBox = h('div', { class: 'now' });
    const qr = h('div', { class: 'qr', html: qrSvg(ev.link) });
    const screenParams = new URLSearchParams();
    if (ev.visibility === 'private') screenParams.set('k', ev.shareToken);
    if (ev.access === 'code') screenParams.set('c', ev.code);
    const screenPath = `/pantalla/${encodeURIComponent(ev.slug)}${screenParams.toString() ? `?${screenParams}` : ''}`;
    root.append(
      h('a', { class: 'text-link', href: '/admin?tab=eventos', 'data-link': true }, '← Todos los eventos'),
      h('div', { class: 'detail-head' },
        h('div', {},
          h('h2', { class: 'title small' }, ev.name),
          h('p', { class: 'muted' }, formatDate(ev.date, ev.time), ev.venue ? ` · ${ev.venue}` : ''),
          h('p', {}, h('span', { class: 'chip' }, ev.visibility === 'public' ? 'En portada' : 'Privado'), ' ', ev.access === 'code' ? h('span', { class: 'chip lock' }, `🔒 Código: ${ev.code}`) : h('span', { class: 'chip open' }, 'Acceso libre'), ' ', h('span', { class: `chip ${ev.requestsOpen ? 'open' : 'lock'}` }, ev.requestsOpen ? 'Peticiones abiertas' : 'Peticiones cerradas')),
          h('div', { class: 'share' },
            h('input', { type: 'text', readonly: true, value: ev.link, 'aria-label': 'Enlace del evento', onfocus: (e) => e.target.select() }),
            h('button', { class: 'btn small', type: 'button', onclick: () => copy(ev.link) }, 'Copiar enlace')),
          h('div', { class: 'row' },
            DEMO ? h('a', { class: 'btn ghost small', href: linkPath(ev.link), 'data-link': true }, 'Abrir como invitado') : h('a', { class: 'btn ghost small', href: ev.link, target: '_blank', rel: 'noopener' }, 'Abrir como invitado'),
            DEMO ? null : h('button', { class: 'btn ghost small', type: 'button', onclick: () => downloadQrPng(ev.link, `qr-${ev.slug}.png`) }, 'Descargar QR'),
            DEMO ? null : h('button', { class: 'btn ghost small', type: 'button', onclick: () => printCard(ev) }, 'Imprimir tarjeta QR'),
            h('a', { class: 'btn small', href: screenPath, ...(DEMO ? { 'data-link': true } : { target: '_blank', rel: 'noopener' }) }, 'Pantalla para proyectar'),
            h('button', { class: 'btn ghost small', type: 'button', onclick: () => eventDialog(ev) }, 'Editar'),
            ev.visibility === 'private' ? h('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
              if (!confirm('Se generará un enlace y un QR nuevos. Los anteriores dejarán de funcionar. ¿Continuar?')) return;
              await api(`/api/admin/events/${ev.id}/new-link`, { method: 'POST', body: {} }); render();
            } }, 'Regenerar enlace') : null)),
        h('div', { class: 'qr-box' }, qr, h('small', { class: 'muted' }, 'Escanea para pedir canciones'))),
      h('div', { class: 'card spotify-bar' },
        nowBox,
        h('div', { class: 'row' },
          h('button', { class: 'btn spotify small', type: 'button', onclick: () => exportDialog(ev, requests, (url) => { ev.playlistUrl = url; drawNow(); }) }, spotifyIcon(), 'Exportar a Spotify'),
          h('span', { class: 'playlist-link' }))),
      h('div', { class: 'filters', role: 'tablist' }, [['all', 'Todas'], ['pending', 'Pendientes'], ['approved', 'Aprobadas'], ['played', 'Sonadas'], ['rejected', 'Rechazadas']].map(([k, label]) =>
        h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === filter), onclick: (e) => { filter = k; [...e.target.parentNode.children].forEach((b) => b.setAttribute('aria-selected', String(b === e.target))); drawList(); } }, label))),
      h('div', { class: 'row list-tools' }, search,
        h('button', { type: 'button', class: 'btn ghost small', onclick: () => {
          const setlist = requests.filter((r) => r.status === 'approved').map((r, i) => `${i + 1}. ${r.track.name}${r.track.artists ? ` — ${r.track.artists}` : ''}${r.votes > 1 ? ` (♥ ${r.votes})` : ''}`);
          if (!setlist.length) { toast('Aún no hay canciones aprobadas', 'error'); return; }
          copy(`${ev.name}\n${setlist.join('\n')}`);
        } }, 'Copiar lista aprobada')),
      listBox);

    let requests = [];
    const adminUl = h('ul', { class: 'req-list admin-list card' });
    async function load() { requests = await api(`/api/admin/events/${ev.id}/requests`); drawList(); }

    async function act(r, fn) {
      try { const res = await fn(); if (res && res.warning) toast(res.warning, 'error'); await load(); } catch (err) { toast(err.message, 'error'); }
    }

    function drawList() {
      const items = requests.filter((r) => (filter === 'all' || r.status === filter) && (!term || `${r.track.name} ${r.track.artists} ${r.guestName} ${r.message}`.toLowerCase().includes(term)));
      if (!items.length) { listBox.replaceChildren(h('div', { class: 'card empty' }, h('p', { class: 'muted' }, filter === 'all' ? 'Aún no hay peticiones. Comparte el enlace o el QR con los invitados.' : 'No hay peticiones en este estado.'))); return; }
      if (adminUl.parentNode !== listBox) listBox.replaceChildren(adminUl);
      flipRender(adminUl, items.map((r) => h('li', { class: `req ${r.status}`, 'data-key': r.id },
        coverArt(r.track, 'sm'),
        h('div', { class: 'req-text' },
          h('strong', {}, r.track.name, r.track.explicit ? h('span', { class: 'explicit' }, 'E') : null),
          h('span', { class: 'muted small' }, r.track.artists || '—', r.track.uri ? '' : ' · escrita a mano'),
          r.guestName || r.message ? h('span', { class: 'small dedication' }, r.guestName ? `— ${r.guestName}` : '', r.message ? ` “${r.message}”` : '') : null,
          h('span', { class: 'muted small' }, `♥ ${r.votes} · ${new Date(r.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`, r.queuedAt ? ' · en cola de Spotify' : '', r.inPlaylist ? ' · en playlist' : '')),
        h('div', { class: 'req-actions' },
          h('span', { class: `badge ${r.status}` }, statusLabel[r.status]),
          r.status !== 'approved' ? h('button', { type: 'button', class: 'btn small', onclick: () => act(r, () => api(`/api/admin/requests/${r.id}`, { method: 'PATCH', body: { status: 'approved' } })) }, 'Aprobar') : null,
          r.track.uri && !r.queuedAt ? h('button', { type: 'button', class: 'btn ghost small', onclick: () => act(r, () => api(`/api/admin/requests/${r.id}/queue`, { method: 'POST', body: {} }).then((x) => { toast('Añadida a la cola de Spotify', 'ok'); return x; })) }, 'A la cola') : null,
          r.track.url ? h('a', { class: 'btn ghost small', href: r.track.url, target: '_blank', rel: 'noopener' }, 'Spotify') : null,
          r.status !== 'played' ? h('button', { type: 'button', class: 'btn ghost small', onclick: () => act(r, () => api(`/api/admin/requests/${r.id}`, { method: 'PATCH', body: { status: 'played' } })) }, 'Sonada') : null,
          r.status !== 'rejected' ? h('button', { type: 'button', class: 'btn ghost small danger', onclick: () => act(r, () => api(`/api/admin/requests/${r.id}`, { method: 'PATCH', body: { status: 'rejected' } })) }, 'Rechazar') : null,
          h('button', { type: 'button', class: 'icon-btn', title: 'Eliminar', 'aria-label': 'Eliminar', onclick: () => confirm('¿Eliminar esta petición?') && act(r, () => api(`/api/admin/requests/${r.id}`, { method: 'DELETE' })) }, '✕')))));
    }

    async function drawNow() {
      const pl = root.querySelector('.playlist-link');
      if (pl) pl.replaceChildren(ev.playlistUrl ? h('a', { class: 'text-link', href: ev.playlistUrl, target: '_blank', rel: 'noopener' }, 'Abrir playlist del evento ↗') : '');
      try {
        const n = await api('/api/admin/spotify/now');
        if (!n.connected) { nowBox.replaceChildren(h('p', { class: 'muted small' }, 'Spotify no está conectado. ', h('a', { class: 'text-link', href: '/admin?tab=spotify', 'data-link': true }, 'Conectar'), ' para enviar canciones a la cola y crear playlists.')); return; }
        if (!n.active || !n.track) { nowBox.replaceChildren(h('p', { class: 'muted small' }, n.error ? `Spotify: ${n.error}` : 'Spotify conectado. No hay nada sonando ahora mismo: abre Spotify en el equipo del DJ para usar la cola.')); return; }
        nowBox.replaceChildren(h('div', { class: 'chosen' }, coverArt(n.track, 'sm'), h('div', {}, h('span', { class: 'muted small now-label' }, n.isPlaying ? eqBars() : null, n.isPlaying ? `Sonando en ${n.device}` : `En pausa · ${n.device}`), h('strong', {}, n.track.name), h('span', { class: 'muted small' }, n.track.artists))));
      } catch { /* sin conexión */ }
    }

    await load();
    drawNow();
    pollTimer = setInterval(() => { if (document.hidden) return; load().catch(() => {}); drawNow(); }, 8000);
  }

  function printCard(ev) {
    const w = window.open('', '_blank', 'width=600,height=800');
    if (!w) { toast('Permite las ventanas emergentes para imprimir la tarjeta', 'error'); return; }
    const doc = w.document;
    doc.title = `QR · ${ev.name}`;
    const style = doc.createElement('style');
    style.textContent = 'body{font-family:Georgia,serif;text-align:center;padding:40px;color:#111}img{width:220px}h1{font-weight:400;letter-spacing:.04em;margin:.4em 0}.qr svg{width:320px;height:320px}p{color:#555}.code{font-family:monospace;font-size:22px;letter-spacing:.15em;color:#111}';
    doc.head.append(style);
    const logo = doc.createElement('img'); logo.src = `${location.origin}/logo.webp`;
    const h1 = doc.createElement('h1'); h1.textContent = ev.name;
    const p = doc.createElement('p'); p.textContent = '¡Escanea y pide tu canción!';
    const qrDiv = doc.createElement('div'); qrDiv.className = 'qr'; qrDiv.innerHTML = qrSvg(ev.link, 8);
    doc.body.append(logo, h1, p, qrDiv);
    if (ev.access === 'code') { const c = doc.createElement('p'); c.append('Código: '); const s = doc.createElement('span'); s.className = 'code'; s.textContent = ev.code; c.append(s); doc.body.append(c); }
    logo.onload = () => w.print();
  }

  // --- presupuestos
  async function adminQuotes(root) {
    const quotes = await api('/api/admin/quotes');
    if (!quotes.length) { root.append(h('div', { class: 'card empty' }, h('p', {}, 'Aún no hay solicitudes de presupuesto. Llegarán aquí cuando un cliente lo pida desde la sección de pirotecnia.'))); return; }
    const sum = (s) => quotes.filter((q) => q.status === s).length;
    let qFilter = 'all';
    let qTerm = '';
    const filters = h('div', { class: 'filters', role: 'tablist' }, [['all', `Todos · ${quotes.length}`], ['nuevo', `Nuevos · ${sum('nuevo')}`], ['contactado', `Contactados · ${sum('contactado')}`], ['aceptado', `Aceptados · ${sum('aceptado')}`], ['descartado', `Descartados · ${sum('descartado')}`]].map(([k, label]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === qFilter), onclick: (e) => { qFilter = k; [...filters.children].forEach((b) => b.setAttribute('aria-selected', String(b === e.currentTarget))); applyFilter(); } }, label)));
    const search = h('input', { type: 'search', class: 'search', placeholder: 'Buscar por cliente, número o lugar', 'aria-label': 'Buscar presupuestos' });
    search.addEventListener('input', () => { qTerm = search.value.trim().toLowerCase(); applyFilter(); });
    const noMatch = h('div', { class: 'card empty', hidden: true }, h('p', { class: 'muted' }, 'Ningún presupuesto coincide con el filtro.'));
    const exportBtn = h('button', { type: 'button', class: 'btn ghost small', title: 'Copia los presupuestos visibles para pegarlos en Excel o Google Sheets', onclick: () => {
      const visible = quotes.filter((q) => { const el = list.querySelector(`[data-id="${q.id}"]`); return el && !el.hidden; });
      copyTable([['Número', 'Fecha solicitud', 'Cliente', 'Correo', 'Teléfono', 'Tipo', 'Fecha evento', 'Lugar', 'Total (€)', 'Estado'],
        ...visible.map((q) => [q.number, new Date(q.createdAt).toLocaleDateString('es-ES'), q.customer.name, q.customer.email, q.customer.phone, q.event.type, q.event.date, q.event.place, q.total.toFixed(2).replace('.', ','), q.status])]);
    } }, 'Copiar tabla para Excel');
    root.append(filters, h('div', { class: 'row list-tools' }, search, exportBtn), noMatch);
    const list = h('div', { class: 'quote-list' });
    const applyFilter = () => {
      let shown = 0;
      for (const el of list.children) {
        const ok = (qFilter === 'all' || el.dataset.status === qFilter) && (!qTerm || el.dataset.text.includes(qTerm));
        el.hidden = !ok;
        if (ok) shown++;
      }
      noMatch.hidden = shown > 0;
    };
    for (const q of quotes) {
      const status = h('select', { 'aria-label': 'Estado', onchange: async (e) => { try { await api(`/api/admin/quotes/${q.id}`, { method: 'PATCH', body: { status: e.target.value } }); toast('Estado actualizado', 'ok'); details.dataset.status = e.target.value; const badge = details.querySelector('summary .badge'); badge.className = `badge q-${e.target.value}`; badge.textContent = e.target.value; if (e.target.value === 'aceptado') burstFrom(e.target, { count: 70 }); } catch (err) { toast(err.message, 'error'); } } },
        ['nuevo', 'contactado', 'aceptado', 'descartado'].map((s) => h('option', { value: s, selected: s === q.status }, s.charAt(0).toUpperCase() + s.slice(1))));
      const notes = h('textarea', { rows: 2, placeholder: 'Notas internas', 'aria-label': 'Notas internas' }, q.adminNotes || '');
      notes.addEventListener('change', () => api(`/api/admin/quotes/${q.id}`, { method: 'PATCH', body: { adminNotes: notes.value } }).then(() => toast('Notas guardadas', 'ok'), (e) => toast(e.message, 'error')));
      const details = h('details', { class: 'card quote-item', 'data-id': q.id, 'data-status': q.status, 'data-text': `${q.number} ${q.customer.name} ${q.customer.email} ${q.event.place} ${q.event.type}`.toLowerCase() },
        h('summary', {},
          h('span', { class: `badge q-${q.status}` }, q.status),
          h('strong', {}, q.number), h('span', {}, q.customer.name), h('span', { class: 'muted small' }, `${q.event.type} · ${formatDate(q.event.date)}`), h('strong', { class: 'price' }, euros(q.total))),
        h('div', { class: 'quote-admin' },
          h('div', { class: 'row' },
            q.customer.email && !DEMO ? h('a', { class: 'btn small', href: `mailto:${q.customer.email}?subject=${encodeURIComponent(`Presupuesto ${q.number} · Guspira Events`)}&body=${encodeURIComponent(`Hola ${q.customer.name},\n\nAquí tienes tu presupuesto: ${q.link}\n\nUn saludo,\nGuspira Events`)}` }, 'Responder por correo') : null,
            q.customer.phone ? h('a', { class: 'btn ghost small', href: `tel:${q.customer.phone}` }, `Llamar ${q.customer.phone}`) : null,
            DEMO ? h('a', { class: 'btn ghost small', href: linkPath(q.link), 'data-link': true }, 'Ver presupuesto') : h('a', { class: 'btn ghost small', href: q.link, target: '_blank', rel: 'noopener' }, 'Ver / imprimir'),
            status,
            h('button', { class: 'btn ghost small danger', type: 'button', onclick: async () => { if (!confirm(`¿Eliminar el presupuesto ${q.number}?`)) return; await api(`/api/admin/quotes/${q.id}`, { method: 'DELETE' }); render(); } }, 'Eliminar')),
          notes,
          quoteDocument(q, false)));
      list.append(details);
    }
    root.append(list);
    applyFilter();
  }

  // --- catálogo
  async function adminCatalog(root) {
    const cat = await api('/api/admin/pyro/catalog');
    const num = (obj, key, attrs = {}) => { const i = h('input', { type: 'number', step: 'any', value: obj[key], ...attrs }); i.addEventListener('input', () => { obj[key] = Number(i.value); }); return i; };
    const txt = (obj, key, attrs = {}) => { const i = h(attrs.multiline ? 'textarea' : 'input', { type: 'text', value: obj[key] || '', rows: 2, ...attrs, multiline: null }, attrs.multiline ? obj[key] || '' : null); i.addEventListener('input', () => { obj[key] = i.value; }); return i; };
    const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);

    const fees = h('div', { class: 'card' }, h('h2', { class: 'title small' }, 'Tarifas generales'),
      h('div', { class: 'form-grid' },
        field('Montaje, técnico y seguro (€)', num(cat.fees, 'setup', { min: 0 })),
        field('Km incluidos', num(cat.fees, 'freeKm', { min: 0 })),
        field('Precio por km extra (€)', num(cat.fees, 'perKm', { min: 0 })),
        field('IVA (0,21 = 21%)', num(cat.fees, 'vatRate', { min: 0, max: 1 }))),
      h('h3', {}, 'Descuentos por volumen'),
      h('div', { class: 'discounts' }));
    const drawDiscounts = () => {
      const box = fees.querySelector('.discounts');
      box.replaceChildren(...cat.fees.discounts.map((d, i) => h('div', { class: 'row' }, 'A partir de', num(d, 'min', { min: 0, 'aria-label': 'Importe mínimo' }), '€ →', num(d, 'pct', { min: 0, max: 90, 'aria-label': 'Porcentaje' }), '%', h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Quitar', onclick: () => { cat.fees.discounts.splice(i, 1); drawDiscounts(); } }, '✕'))),
        h('button', { type: 'button', class: 'btn ghost small', onclick: () => { cat.fees.discounts.push({ min: 1000, pct: 5 }); drawDiscounts(); } }, '+ Descuento'));
    };
    drawDiscounts();

    const colorsBox = h('div', { class: 'card' });
    const drawColors = () => {
      colorsBox.replaceChildren(h('h2', { class: 'title small' }, 'Colores'), h('p', { class: 'muted small' }, 'El recargo se suma al precio de cada unidad que use ese color.'),
        ...cat.colors.map((c, i) => h('div', { class: 'row color-row' }, swatch(c),
          txt(c, 'name', { 'aria-label': 'Nombre del color' }),
          c.hex === 'linear' ? h('span', { class: 'muted small' }, 'Degradado') : (() => { const i2 = h('input', { type: 'color', value: c.hex, 'aria-label': 'Color' }); i2.addEventListener('input', () => { c.hex = i2.value; }); return i2; })(),
          h('span', { class: 'small' }, '+'), num(c, 'surcharge', { min: 0, 'aria-label': 'Recargo' }), '€',
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Quitar color', onclick: () => { cat.colors.splice(i, 1); cat.items.forEach((it) => { it.colorIds = it.colorIds.filter((x) => x !== c.id); }); drawColors(); drawItems(); } }, '✕'))),
        h('button', { type: 'button', class: 'btn ghost small', onclick: () => { const name = prompt('Nombre del nuevo color'); if (!name) return; cat.colors.push({ id: name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-'), name, hex: '#ffffff', surcharge: 8 }); drawColors(); drawItems(); } }, '+ Color'));
    };

    const itemsBox = h('div', { class: 'items-editor' });
    const drawItems = () => {
      itemsBox.replaceChildren(...cat.items.map((it, idx) => h('div', { class: 'card item-editor' },
        h('div', { class: 'row space' }, h('h3', {}, it.name || 'Nuevo producto'),
          h('label', { class: 'check' }, (() => { const c = h('input', { type: 'checkbox', checked: it.active !== false }); c.addEventListener('change', () => { it.active = c.checked; }); return c; })(), 'Visible'),
          h('button', { type: 'button', class: 'btn ghost small danger', onclick: () => { if (confirm(`¿Quitar «${it.name}» del catálogo?`)) { cat.items.splice(idx, 1); drawItems(); } } }, 'Quitar')),
        h('div', { class: 'form-grid' },
          field('Nombre', txt(it, 'name')),
          field('Tipo de efecto (animación)', (() => { const s = h('select', {}, ['vertical', 'abanico', 'cascada', 'bengalas', 'humo', 'confeti'].map((k) => h('option', { selected: k === it.kind }, k))); s.addEventListener('change', () => { it.kind = s.value; }); return s; })()),
          field('Precio base (€)', num(it, 'unitPrice', { min: 0 })),
          field('Unidad', txt(it, 'unitLabel')),
          field('Cantidad mínima', num(it, 'minQty', { min: 1 })),
          field('Cantidad máxima', num(it, 'maxQty', { min: 1 }))),
        field('Descripción', txt(it, 'description', { multiline: true })),
        h('div', { class: 'field' }, h('span', {}, 'Colores disponibles'), h('div', { class: 'swatches pick' }, cat.colors.map((c) => {
          const on = it.colorIds.includes(c.id);
          return h('button', { type: 'button', role: 'checkbox', 'aria-checked': String(on), onclick: () => { it.colorIds = on ? it.colorIds.filter((x) => x !== c.id) : [...it.colorIds, c.id]; drawItems(); } }, swatch(c), h('span', {}, c.name));
        }))),
        h('div', { class: 'field' }, h('span', {}, 'Duraciones (multiplican el precio)'),
          ...it.durations.map((d, j) => h('div', { class: 'row' }, txt(d, 'label', { 'aria-label': 'Duración' }), '×', num(d, 'multiplier', { min: 0.1, 'aria-label': 'Multiplicador' }),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Quitar duración', onclick: () => { it.durations.splice(j, 1); drawItems(); } }, '✕'))),
          h('button', { type: 'button', class: 'btn ghost small', onclick: () => { it.durations.push({ id: String(Date.now()), label: '120 segundos', multiplier: 2.6 }); drawItems(); } }, '+ Duración')))),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => { cat.items.push({ id: `producto-${Date.now()}`, kind: 'vertical', name: 'Nuevo efecto', description: '', unitPrice: 50, unitLabel: 'unidad', minQty: 1, maxQty: 20, active: true, colorIds: cat.colors.slice(0, 1).map((c) => c.id), durations: [{ id: 'std', label: 'Estándar', multiplier: 1 }] }); drawItems(); } }, '+ Añadir producto'));
    };
    drawColors();
    drawItems();

    const saveBar = h('div', { class: 'save-bar' },
      h('button', { type: 'button', class: 'btn ghost small', onclick: async () => { if (!confirm('¿Restaurar el catálogo y precios de ejemplo? Se perderán tus cambios.')) return; await api('/api/admin/pyro/catalog/reset', { method: 'POST', body: {} }); render(); } }, 'Restaurar valores de ejemplo'),
      h('button', { type: 'button', class: 'btn', onclick: async () => { try { await api('/api/admin/pyro/catalog', { method: 'PUT', body: cat }); toast('Catálogo guardado', 'ok'); render(); } catch (err) { toast(err.message, 'error'); } } }, 'Guardar catálogo'));
    cat.packs = cat.packs || [];
    const packsBox = h('div', { class: 'items-editor' });
    const drawPacks = () => {
      packsBox.replaceChildren(...cat.packs.map((pk, pi) => h('div', { class: 'card item-editor' },
        h('div', { class: 'row space' }, h('h3', {}, pk.name || 'Nuevo paquete'),
          h('button', { type: 'button', class: 'btn ghost small danger', onclick: () => { cat.packs.splice(pi, 1); drawPacks(); } }, 'Quitar')),
        h('div', { class: 'form-grid' }, field('Nombre', txt(pk, 'name')), field('Etiqueta (p. ej. Boda)', txt(pk, 'tag'))),
        field('Descripción', txt(pk, 'description', { multiline: true })),
        h('div', { class: 'field' }, h('span', {}, 'Contenido del paquete'),
          ...pk.lines.map((l, li) => {
            const item = cat.items.find((i) => i.id === l.itemId) || cat.items[0];
            const sel = (opts, key) => { const s2 = h('select', {}, opts.map(([v, t]) => h('option', { value: v, selected: v === l[key] }, t))); s2.addEventListener('change', () => { l[key] = s2.value; if (key === 'itemId') { const it = cat.items.find((i) => i.id === s2.value); l.colorId = it.colorIds[0]; l.durationId = it.durations[0].id; drawPacks(); } }); return s2; };
            return h('div', { class: 'row pack-line' },
              num(l, 'qty', { min: 1, 'aria-label': 'Cantidad' }), '×',
              sel(cat.items.map((i) => [i.id, i.name]), 'itemId'),
              sel(item.colorIds.map((cid) => [cid, (cat.colors.find((x) => x.id === cid) || { name: cid }).name]), 'colorId'),
              sel(item.durations.map((d) => [d.id, d.label]), 'durationId'),
              h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Quitar línea', onclick: () => { pk.lines.splice(li, 1); drawPacks(); } }, '✕'));
          }),
          h('button', { type: 'button', class: 'btn ghost small', onclick: () => { const it = cat.items[0]; pk.lines.push({ itemId: it.id, qty: 1, colorId: it.colorIds[0], durationId: it.durations[0].id, moment: '' }); drawPacks(); } }, '+ Línea')))),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => { const it = cat.items[0]; cat.packs.push({ id: `paquete-${Date.now()}`, name: 'Nuevo paquete', tag: '', description: '', lines: [{ itemId: it.id, qty: 2, colorId: it.colorIds[0], durationId: it.durations[0].id, moment: '' }] }); drawPacks(); } }, '+ Añadir paquete'));
    };
    drawPacks();
    root.append(saveBar, fees, colorsBox, h('h2', { class: 'title small' }, 'Productos'), itemsBox, h('h2', { class: 'title small section-gap' }, 'Paquetes recomendados'), h('p', { class: 'muted small' }, 'Aparecen al principio de la página de pirotecnia. El precio se calcula solo con las tarifas del catálogo.'), packsBox);
  }

  // --- Spotify y ajustes
  async function adminSettings(root) {
    const s = await api('/api/admin/settings');
    root.append(await companyCard(), spotifyCard(s), passwordCard());
  }

  const spotifyIcon = () => { const el = h('span', { class: 'sp-icon', 'aria-hidden': 'true' }); el.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7 9.6c3.4-1 7.2-.7 10.2 1M7.6 12.6c2.8-.8 5.9-.5 8.4.9M8.2 15.4c2.2-.6 4.5-.4 6.4.7" fill="none" stroke="#0b0906" stroke-width="1.6" stroke-linecap="round"/></svg>'; return el; };

  // Conexión con Spotify solo con el Client ID (OAuth con PKCE, sin Client Secret).
  function spotifyCard(s) {
    const connected = Boolean(s.connected);
    const cid = h('input', { type: 'text', value: s.spotifyClientId || '', maxlength: 64, disabled: s.fromEnv, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', placeholder: 'Pega aquí el Client ID', 'aria-label': 'Client ID de tu app de Spotify', class: 'mono-input' });
    const counter = h('span', { class: 'cid-count muted small', 'aria-live': 'polite' });
    const valid = (v) => /^[0-9a-zA-Z]{32}$/.test(v.replace(/\s+/g, ''));
    const sync = () => { const v = cid.value.replace(/\s+/g, ''); counter.textContent = v ? `${v.length}/32${valid(v) ? ' ✓' : ''}` : ''; counter.classList.toggle('ok', valid(v)); };
    cid.addEventListener('input', sync);
    sync();
    const market = h('input', { type: 'text', value: s.market, maxlength: 2, 'aria-label': 'País de las búsquedas', class: 'short' });
    const saveBtn = h('button', { type: 'button', class: 'btn ghost', disabled: s.fromEnv, onclick: async () => {
      const v = cid.value.replace(/\s+/g, '');
      if (!valid(v)) { toast('El Client ID tiene 32 letras y números. Cópialo de nuevo desde Spotify for Developers.', 'error'); cid.focus(); return; }
      try { await api('/api/admin/settings', { method: 'PUT', body: { spotifyClientId: v, market: market.value } }); toast('Client ID guardado. Ya puedes conectar tu cuenta.', 'ok'); render(); } catch (err) { toast(err.message, 'error'); }
    } }, '✓ Guardar Client ID');
    const connectBtn = h('button', { type: 'button', class: 'btn block connect-btn', disabled: !s.spotifyClientId, onclick: async () => {
      try { const r = await api('/api/admin/spotify/connect'); location.href = r.url; } catch (err) { toast(err.message, 'error'); }
    } }, h('span', { class: 'note-icon', 'aria-hidden': 'true' }, '♪'), 'Conectar Spotify');
    const step = (n, ...content) => h('li', { class: 'sp-step' }, h('span', { class: 'sp-n', 'aria-hidden': 'true' }, String(n)), h('div', {}, ...content));
    const setup = h('details', { class: 'sp-setup', open: !s.spotifyClientId || undefined },
      h('summary', {}, 'Configurar la conexión'),
      h('ol', { class: 'sp-steps' },
        step(1, h('p', {}, 'Crea una app en Spotify for Developers (marca «Web API»).'),
          h('a', { class: 'text-link', href: 'https://developer.spotify.com/dashboard', target: '_blank', rel: 'noopener' }, 'Abrir Spotify for Developers ↗')),
        step(2, h('p', {}, 'Añade esta Redirect URI en tu app de Spotify:'),
          h('code', { class: 'uri-box' }, s.redirectUri),
          h('button', { type: 'button', class: 'link-btn copy-btn', onclick: () => copy(s.redirectUri) }, '⧉ Copiar dirección')),
        step(3, h('label', { class: 'field' }, h('span', {}, 'Client ID de tu app de Spotify'), h('div', { class: 'cid-wrap' }, cid, counter)),
          h('div', { class: 'row' }, saveBtn, h('label', { class: 'field inline-field' }, h('span', {}, 'País'), market)),
          h('p', { class: 'muted small' }, 'Solo el Client ID. No necesitas el Client Secret.'),
          s.fromEnv ? h('p', { class: 'notice' }, 'El Client ID se lee de las variables de entorno del servidor.') : null),
        step(4, h('p', {}, 'En «User Management» de tu app, añade el correo de la cuenta de Spotify que vas a conectar (necesario mientras la app esté en modo desarrollo).'))));
    return h('div', { class: `card sp-card${connected ? ' is-connected' : ''}` },
      h('div', { class: 'sp-head' },
        h('span', { class: 'sp-badge', 'aria-hidden': 'true' }, '🎧'),
        h('div', {},
          h('h2', {}, 'Conecta tu Spotify'),
          h('p', { class: 'muted' }, 'Conecta tu cuenta para que los invitados busquen canciones reales, mandar las aprobadas a la cola y exportar las peticiones a una playlist.'))),
      connected
        ? h('div', { class: 'sp-connected' },
          h('span', { class: 'chip open' }, h('i', { class: 'live-dot', 'aria-hidden': 'true' }), `Conectado como ${s.connected.name}${s.connected.product ? ` · ${s.connected.product}` : ''}`),
          h('button', { type: 'button', class: 'btn ghost small danger', onclick: async () => { await api('/api/admin/spotify/disconnect', { method: 'POST', body: {} }); toast('Spotify desconectado', 'ok'); render(); } }, 'Desconectar'))
        : null,
      setup,
      connected ? null : connectBtn,
      connected ? null : h('p', { class: 'muted small center' }, s.spotifyClientId ? 'Te llevaremos a Spotify para que autorices la conexión y volverás aquí.' : 'Guarda primero el Client ID para poder conectar.'));
  }

  // Ventana para exportar las peticiones de un evento a una playlist de Spotify.
  function exportDialog(ev, requests, onDone) {
    const count = (statuses) => requests.filter((r) => statuses.includes(r.status)).length;
    const opts = [
      ['approved', 'Aprobadas y sonadas', count(['approved', 'played'])],
      ['approved-pending', 'Aprobadas, sonadas y pendientes', count(['approved', 'played', 'pending'])],
      ['all', 'Todas menos las rechazadas', count(['approved', 'played', 'pending'])]
    ].slice(0, 2);
    const manual = requests.filter((r) => !r.track.uri && r.status !== 'rejected').length;
    const name = h('input', { type: 'text', name: 'name', maxlength: 100, value: `${ev.name} · Guspira Events` });
    const radio = (group, value, label, hint, checked) => h('label', { class: 'option' }, h('input', { type: 'radio', name: group, value, checked }), h('span', {}, h('strong', {}, label), hint ? h('small', { class: 'muted' }, hint) : null));
    const body = h('div', { class: 'export-body' });
    const form = h('form', { class: 'dialog-form' },
      h('div', { class: 'row space' }, h('h2', { class: 'title small' }, 'Exportar a Spotify'), spotifyIcon()),
      h('p', { class: 'muted small' }, 'Crea una playlist en tu cuenta de Spotify con las canciones que han pedido los invitados, ordenadas por votos.'),
      body);
    const dialog = h('dialog', { class: 'dialog export-dialog' }, form);
    const showForm = () => {
      body.replaceChildren(
        h('label', { class: 'field' }, h('span', {}, 'Nombre de la playlist'), name),
        h('fieldset', {}, h('legend', {}, '¿Qué canciones?'), opts.map(([v, label, n], i) => radio('scope', v, label, `${n} ${n === 1 ? 'canción' : 'canciones'}`, i === 0))),
        h('fieldset', {}, h('legend', {}, 'Destino'),
          radio('mode', 'new', 'Crear una playlist nueva', '', !ev.playlistUrl),
          ev.playlistUrl ? radio('mode', 'update', 'Actualizar la playlist del evento', 'Sustituye su contenido por la lista actual', true) : null,
          h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'isPublic' }), 'Hacerla pública (visible en tu perfil)')),
        manual ? h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'matchManual', checked: true }), manual === 1 ? 'Buscar en Spotify la canción escrita a mano' : `Buscar en Spotify las ${manual} canciones escritas a mano`) : null,
        h('div', { class: 'row end' },
          h('button', { type: 'button', class: 'btn ghost', onclick: () => dialog.close() }, 'Cancelar'),
          h('button', { type: 'submit', class: 'btn spotify' }, spotifyIcon(), 'Exportar')));
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const el = form.elements;
      const payload = { name: name.value, scope: el.scope.value, mode: el.mode ? el.mode.value : 'new', isPublic: el.isPublic.checked, matchManual: el.matchManual ? el.matchManual.checked : true };
      body.replaceChildren(h('div', { class: 'export-progress' }, h('span', { class: 'eq big' }, h('i'), h('i'), h('i'), h('i')), h('p', {}, 'Preparando tu playlist en Spotify…'), manual && payload.matchManual ? h('p', { class: 'muted small' }, 'Buscando las canciones escritas a mano…') : null));
      try {
        const r = await api(`/api/admin/events/${ev.id}/export`, { method: 'POST', body: payload });
        onDone(r.playlistUrl);
        body.replaceChildren(h('div', { class: 'export-done' },
          h('div', { class: 'sent-icon', 'aria-hidden': 'true' }, '✓'),
          h('h3', {}, `Playlist lista con ${r.added} ${r.added === 1 ? 'canción' : 'canciones'}`),
          r.unmatched.length ? h('div', { class: 'notice' }, h('p', {}, `No hemos encontrado en Spotify ${r.unmatched.length === 1 ? 'esta canción' : `estas ${r.unmatched.length} canciones`}:`), h('ul', {}, r.unmatched.map((u) => h('li', {}, u)))) : null,
          h('div', { class: 'row center-row' },
            r.playlistUrl ? h('a', { class: 'btn spotify', href: r.playlistUrl, target: '_blank', rel: 'noopener' }, spotifyIcon(), 'Abrir en Spotify') : h('p', { class: 'muted small' }, 'En la demostración la playlist es simulada.'),
            h('button', { type: 'button', class: 'btn ghost', onclick: () => dialog.close() }, 'Cerrar'))));
        burstFrom(body.querySelector('.sent-icon'), { count: 90, colors: ['#1ed760', '#f8dc85', '#ffffff'] });
      } catch (err) {
        body.replaceChildren(h('div', { class: 'notice' }, err.message), h('div', { class: 'row end' },
          /Conecta/.test(err.message) ? h('a', { class: 'btn', href: '/admin?tab=ajustes', 'data-link': true, onclick: () => dialog.close() }, 'Ir a Ajustes') : null,
          h('button', { type: 'button', class: 'btn ghost', onclick: showForm }, 'Volver')));
      }
    });
    dialog.addEventListener('close', () => dialog.remove());
    showForm();
    document.body.append(dialog);
    dialog.showModal();
  }

  function passwordCard() {
    const cur = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Contraseña actual', 'aria-label': 'Contraseña actual' });
    const next = h('input', { type: 'password', autocomplete: 'new-password', minlength: 8, placeholder: 'Nueva contraseña', 'aria-label': 'Nueva contraseña' });
    return h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      try { await api('/api/admin/password', { method: 'POST', body: { current: cur.value, password: next.value } }); toast('Contraseña cambiada', 'ok'); cur.value = next.value = ''; } catch (err) { toast(err.message, 'error'); }
    } }, h('h2', { class: 'title small' }, 'Contraseña de administración'), h('div', { class: 'row' }, cur, next, h('button', { class: 'btn ghost', type: 'submit' }, 'Cambiar')));
  }

  // --- resumen
  function adminOverview(root, ov) {
    const counters = [];
    const tile = (n, label, tab, tone = '') => { const num = h('strong', {}, '0'); counters.push([num, n, (v) => String(Math.round(v))]); return h('a', { class: `kpi ${tone}`, href: `/admin?tab=${tab}`, 'data-link': true }, num, h('span', {}, label)); };
    const money = (v, cls) => { const el = h('strong', { class: cls || null }, euros(0)); counters.push([el, v, euros]); return el; };
    root.append(
      h('div', { class: 'kpis' },
        tile(ov.counts.upcomingEvents, 'Próximos eventos', 'eventos'),
        tile(ov.counts.pendingRequests, 'Canciones por revisar', 'eventos', ov.counts.pendingRequests ? 'warn' : ''),
        tile(ov.counts.newQuotes, 'Presupuestos nuevos', 'presupuestos', ov.counts.newQuotes ? 'warn' : ''),
        tile(ov.counts.newMessages, 'Mensajes sin responder', 'mensajes', ov.counts.newMessages ? 'warn' : '')),
      h('div', { class: 'money' },
        h('div', {}, h('span', { class: 'muted small' }, 'Presupuestos en curso'), money(ov.money.open)),
        h('div', {}, h('span', { class: 'muted small' }, 'Presupuestos aceptados'), money(ov.money.accepted, 'ok'))),
      h('div', { class: 'overview-grid' },
        h('div', { class: 'card' },
          h('div', { class: 'row space' }, h('h2', { class: 'title small' }, 'Próximos eventos'), h('button', { type: 'button', class: 'btn small', onclick: () => eventDialog(null) }, '+ Nuevo')),
          ov.upcoming.length ? h('ul', { class: 'mini-list' }, ov.upcoming.map((e) => h('li', {},
            h('a', { href: `/admin?tab=eventos&event=${e.id}`, 'data-link': true },
              h('span', { class: 'date-badge' }, h('b', {}, new Date(e.date + 'T12:00:00').getDate()), new Date(e.date + 'T12:00:00').toLocaleDateString('es-ES', { month: 'short' })),
              h('span', { class: 'mini-text' }, h('strong', {}, e.name), h('span', { class: 'muted small' }, [countdown(e.date), e.venue].filter(Boolean).join(' · '))),
              e.pending ? h('span', { class: 'badge pending' }, `${e.pending} por revisar`) : null)))) : h('p', { class: 'muted' }, 'No hay eventos próximos. Crea uno para empezar a recibir canciones.')),
        h('div', { class: 'card' },
          h('h2', { class: 'title small' }, 'Actividad reciente'),
          ov.activity.length ? h('ul', { class: 'activity' }, ov.activity.map((a) => h('li', { class: `act-${a.kind}` },
            h('span', { class: 'act-icon', 'aria-hidden': 'true' }, { request: '♪', quote: '✦', message: '✉' }[a.kind]),
            h('span', { class: 'mini-text' }, h('strong', {}, a.title), h('span', { class: 'muted small' }, a.detail)),
            h('span', { class: 'muted tiny' }, ago(a.at))))) : h('p', { class: 'muted' }, 'Aún no hay actividad.'))),
      agendaCard(ov.agenda || []));
    counters.forEach(([el, v, fmt]) => tween(el, v, fmt, 900));
  }

  // --- contenido: galería de fotos y opiniones
  async function adminContent(root) {
    const [photos, reviews] = await Promise.all([api('/api/gallery'), api('/api/testimonials')]);
    const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, class: 'sr-only' });
    const status = h('p', { class: 'muted small', 'aria-live': 'polite' });
    const drop = h('label', { class: 'dropzone' }, fileInput,
      h('span', { class: 'drop-icon', 'aria-hidden': 'true' }, '＋'),
      h('strong', {}, 'Sube fotos de tus eventos'),
      h('span', { class: 'muted small' }, 'Arrastra aquí las imágenes o pulsa para elegirlas (JPG, PNG o WebP). Se optimizan automáticamente antes de subirlas.'));
    async function upload(files) {
      const list = [...files].filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
      if (!list.length) { toast('Elige imágenes JPG, PNG o WebP', 'error'); return; }
      let done = 0;
      for (const f of list) {
        status.textContent = `Subiendo ${done + 1} de ${list.length}…`;
        try {
          const r = await resizeImage(f, DEMO ? 1100 : 1800);
          await api('/api/admin/gallery', { method: 'POST', body: { image: r.data, width: r.width, height: r.height, caption: '' } });
          done++;
        } catch (err) { toast(err.message, 'error'); break; }
      }
      status.textContent = '';
      if (done) toast(`${done} ${done === 1 ? 'foto subida' : 'fotos subidas'}`, 'ok');
      render();
    }
    fileInput.addEventListener('change', () => upload(fileInput.files));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files); });
    const order = photos.map((g) => g.id);
    const move = async (idx, dir) => {
      const j = idx + dir;
      if (j < 0 || j >= order.length) return;
      [order[idx], order[j]] = [order[j], order[idx]];
      await api('/api/admin/gallery/order', { method: 'POST', body: { ids: order } });
      render();
    };
    const grid = h('div', { class: 'gallery-admin' }, photos.map((g, idx) => {
      const caption = h('input', { type: 'text', value: g.caption, maxlength: 140, placeholder: 'Pie de foto (opcional)', 'aria-label': 'Pie de foto' });
      caption.addEventListener('change', () => api(`/api/admin/gallery/${g.id}`, { method: 'PATCH', body: { caption: caption.value } }).then(() => toast('Pie de foto guardado', 'ok'), (e) => toast(e.message, 'error')));
      return h('figure', { class: 'card ga-item' },
        h('button', { type: 'button', class: 'ga-thumb', 'aria-label': 'Ver foto', onclick: () => lightbox(photos, idx) }, h('img', { src: g.url, alt: g.caption || '', loading: 'lazy' })),
        caption,
        h('div', { class: 'row space ga-actions' },
          h('span', { class: 'row' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mover antes', disabled: idx === 0, onclick: () => move(idx, -1) }, '←'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mover después', disabled: idx === photos.length - 1, onclick: () => move(idx, 1) }, '→')),
          h('button', { type: 'button', class: 'btn ghost small danger', onclick: async () => { if (!confirm('¿Quitar esta foto de la galería?')) return; await api(`/api/admin/gallery/${g.id}`, { method: 'DELETE' }); toast('Foto eliminada', 'ok'); render(); } }, 'Quitar')));
    }));

    // Opiniones
    let editing = null;
    const fName = h('input', { type: 'text', name: 'name', maxlength: 80, required: true, placeholder: 'Lucía y Marcos' });
    const fEvent = h('input', { type: 'text', name: 'event', maxlength: 80, placeholder: 'Boda · junio 2026' });
    const fRating = h('select', { name: 'rating' }, [5, 4, 3, 2, 1].map((n) => h('option', { value: n }, `${'★'.repeat(n)} (${n})`)));
    const fText = h('textarea', { name: 'text', rows: 3, maxlength: 600, required: true, placeholder: 'Copia aquí lo que te escribió el cliente.' });
    const submit = h('button', { type: 'submit', class: 'btn' }, 'Añadir opinión');
    const cancel = h('button', { type: 'button', class: 'btn ghost', hidden: true, onclick: () => { editing = null; form.reset(); submit.textContent = 'Añadir opinión'; cancel.hidden = true; } }, 'Cancelar');
    const form = h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      const body = { name: fName.value, event: fEvent.value, rating: fRating.value, text: fText.value };
      try { await api(editing ? `/api/admin/testimonials/${editing}` : '/api/admin/testimonials', { method: editing ? 'PUT' : 'POST', body }); toast(editing ? 'Opinión actualizada' : 'Opinión añadida', 'ok'); render(); } catch (err) { toast(err.message, 'error'); }
    } },
    h('h3', {}, 'Añadir o editar una opinión'),
    h('p', { class: 'muted small' }, 'Publica solo opiniones reales de tus clientes y con su permiso.'),
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Nombre *'), fName),
      h('label', { class: 'field' }, h('span', {}, 'Celebración'), fEvent),
      h('label', { class: 'field' }, h('span', {}, 'Puntuación'), fRating),
      h('label', { class: 'field wide' }, h('span', {}, 'Opinión *'), fText)),
    h('div', { class: 'row' }, submit, cancel));
    const list = h('div', { class: 'review-admin' }, reviews.map((r) => h('div', { class: 'card review-row' },
      h('div', { class: 'stars small' }, '★'.repeat(r.rating), h('span', { class: 'off' }, '★'.repeat(5 - r.rating))),
      h('p', {}, `“${r.text}”`),
      h('div', { class: 'row space' }, h('span', { class: 'muted small' }, [r.name, r.event].filter(Boolean).join(' · ')),
        h('span', { class: 'row' },
          h('button', { type: 'button', class: 'btn ghost small', onclick: () => { editing = r.id; fName.value = r.name; fEvent.value = r.event || ''; fRating.value = String(r.rating); fText.value = r.text; submit.textContent = 'Guardar cambios'; cancel.hidden = false; form.scrollIntoView({ behavior: 'smooth', block: 'center' }); fName.focus(); } }, 'Editar'),
          h('button', { type: 'button', class: 'btn ghost small danger', onclick: async () => { if (!confirm(`¿Eliminar la opinión de ${r.name}?`)) return; await api(`/api/admin/testimonials/${r.id}`, { method: 'DELETE' }); render(); } }, 'Eliminar'))))));

    root.append(
      h('div', { class: 'row space' }, h('h2', { class: 'title small' }, `Galería de fotos · ${photos.length}`), h('a', { class: 'btn ghost small', href: '/#galeria', 'data-link': true }, 'Ver en la portada')),
      h('p', { class: 'muted small' }, 'Aparecen en la portada en «Momentos que brillan» (las 9 primeras, el resto en el visor). Usa las flechas para cambiar el orden.'),
      drop, status,
      photos.length ? grid : h('div', { class: 'card empty' }, h('p', { class: 'muted' }, 'Aún no hay fotos. La sección de la portada aparecerá cuando subas la primera.')),
      h('h2', { class: 'title small section-gap' }, `Opiniones de clientes · ${reviews.length}`),
      h('p', { class: 'muted small' }, 'Se muestran en la portada en un carrusel. Si no hay ninguna, la sección no aparece.'),
      form, list);
  }

  // --- agenda
  function agendaCard(items) {
    const byDate = new Map();
    for (const it of items) { if (!byDate.has(it.date)) byDate.set(it.date, []); byDate.get(it.date).push(it); }
    const today = isoDay(new Date());
    const cursor = new Date(); cursor.setDate(1);
    let selected = today;
    const title = h('strong', { class: 'cal-title' });
    const grid = h('div', { class: 'cal-grid', role: 'grid' });
    const detail = h('div', { class: 'cal-detail', 'aria-live': 'polite' });
    const tone = (it) => (it.kind === 'event' ? 'ev' : it.status === 'aceptado' ? 'ok' : 'warn');
    function showDay(day) {
      selected = day;
      grid.querySelectorAll('.cal-day').forEach((b) => b.classList.toggle('selected', b.dataset.day === day));
      const list = byDate.get(day) || [];
      const label = new Date(day + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      const next = items.filter((it) => it.date > day).slice(0, 3);
      detail.replaceChildren(h('h3', {}, label.charAt(0).toUpperCase() + label.slice(1)),
        list.length ? h('ul', { class: 'cal-items' }, list.map((it) => h('li', { class: `cal-item ${tone(it)}` },
          h('a', { href: it.kind === 'event' ? `/admin?tab=eventos&event=${it.ref}` : '/admin?tab=presupuestos', 'data-link': true },
            h('span', { class: 'cal-kind' }, it.kind === 'event' ? 'Canciones' : `Pirotecnia · ${it.status}`),
            h('strong', {}, it.title), it.detail ? h('span', { class: 'muted small' }, it.detail) : null)))) : h('p', { class: 'muted small' }, 'Nada programado este día.'),
        next.length ? h('div', { class: 'cal-next' }, h('p', { class: 'eyebrow' }, 'Después'), next.map((it) => h('p', { class: 'small' }, h('span', { class: `dot ${tone(it)}` }), ` ${new Date(it.date + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} · ${it.title}`))) : null);
    }
    function draw(dir = 0) {
      const t = cursor.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
      title.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      const offset = (cursor.getDay() + 6) % 7;
      const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
      const cells = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => h('span', { class: 'cal-wd', 'aria-hidden': 'true' }, d));
      for (let i = 0; i < offset; i++) cells.push(h('span', { class: 'cal-blank' }));
      for (let d = 1; d <= days; d++) {
        const day = isoDay(new Date(cursor.getFullYear(), cursor.getMonth(), d));
        const list = byDate.get(day) || [];
        cells.push(h('button', { type: 'button', class: `cal-day${day === today ? ' today' : ''}${day === selected ? ' selected' : ''}${list.length ? ' busy' : ''}${day < today ? ' past' : ''}`, 'data-day': day, 'aria-label': `${d}${list.length ? `, ${list.length} ${list.length === 1 ? 'cita' : 'citas'}` : ''}`, onclick: () => showDay(day) },
          h('span', {}, String(d)), list.length ? h('span', { class: 'cal-dots' }, list.slice(0, 3).map((it) => h('i', { class: `dot ${tone(it)}` }))) : null));
      }
      grid.replaceChildren(...cells);
      if (dir && !REDUCED && grid.animate) grid.animate([{ opacity: 0, transform: `translateX(${dir * 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    const move = (n) => { cursor.setMonth(cursor.getMonth() + n); draw(n); };
    draw();
    showDay(today);
    return h('div', { class: 'card agenda' },
      h('div', { class: 'row space' }, h('h2', { class: 'title small' }, 'Agenda'),
        h('div', { class: 'cal-legend muted small' }, h('span', {}, h('i', { class: 'dot ev' }), ' Canciones'), h('span', {}, h('i', { class: 'dot ok' }), ' Pirotecnia aceptada'), h('span', {}, h('i', { class: 'dot warn' }), ' Pirotecnia en curso'))),
      h('div', { class: 'cal-layout' },
        h('div', { class: 'cal' },
          h('div', { class: 'cal-head' },
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mes anterior', onclick: () => move(-1) }, '‹'),
            title,
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mes siguiente', onclick: () => move(1) }, '›'),
            h('button', { type: 'button', class: 'btn ghost small', onclick: () => { const n = new Date(); cursor.setFullYear(n.getFullYear(), n.getMonth(), 1); draw(); showDay(today); } }, 'Hoy')),
          grid),
        detail));
  }

  // --- mensajes
  async function adminMessages(root) {
    const msgs = await api('/api/admin/messages');
    if (!msgs.length) { root.append(h('div', { class: 'card empty' }, h('p', {}, 'Aún no hay mensajes. Llegarán aquí desde el formulario de contacto de la web.'))); return; }
    root.append(h('div', { class: 'row list-tools end' }, h('button', { type: 'button', class: 'btn ghost small', onclick: () => copyTable([['Fecha', 'Nombre', 'Correo', 'Teléfono', 'Celebración', 'Fecha prevista', 'Invitados', 'Servicios', 'Mensaje', 'Estado'],
      ...msgs.map((m) => [new Date(m.createdAt).toLocaleDateString('es-ES'), m.name, m.email, m.phone, m.eventType, m.date, m.guests || '', m.services.join(', '), m.message, m.status])]) }, 'Copiar tabla para Excel')));
    const list = h('div', { class: 'quote-list' });
    for (const m of msgs) {
      const status = h('select', { 'aria-label': 'Estado', onchange: async (e) => { try { await api(`/api/admin/messages/${m.id}`, { method: 'PATCH', body: { status: e.target.value } }); toast('Estado actualizado', 'ok'); } catch (err) { toast(err.message, 'error'); } } },
        [['nuevo', 'Nuevo'], ['respondido', 'Respondido'], ['archivado', 'Archivado']].map(([v, t]) => h('option', { value: v, selected: v === m.status }, t)));
      const notes = h('textarea', { rows: 2, placeholder: 'Notas internas', 'aria-label': 'Notas internas' }, m.adminNotes || '');
      notes.addEventListener('change', () => api(`/api/admin/messages/${m.id}`, { method: 'PATCH', body: { adminNotes: notes.value } }).then(() => toast('Notas guardadas', 'ok'), (e) => toast(e.message, 'error')));
      list.append(h('details', { class: 'card quote-item', open: m.status === 'nuevo' },
        h('summary', {},
          h('span', { class: `badge m-${m.status}` }, m.status),
          h('strong', {}, m.name), h('span', { class: 'muted small' }, [m.eventType, m.date ? formatDate(m.date) : ''].filter(Boolean).join(' · ')),
          h('span', { class: 'muted tiny push' }, ago(m.createdAt))),
        h('div', { class: 'quote-admin' },
          m.services.length ? h('div', { class: 'row' }, m.services.map((x) => h('span', { class: 'chip' }, x))) : null,
          m.message ? h('blockquote', { class: 'message' }, m.message) : null,
          h('div', { class: 'contact-lines' },
            m.email ? h('p', {}, h('span', { class: 'muted small' }, 'Correo '), h('span', { class: 'selectable' }, m.email), ' ', h('button', { type: 'button', class: 'link-btn', onclick: () => copy(m.email) }, 'copiar')) : null,
            m.phone ? h('p', {}, h('span', { class: 'muted small' }, 'Teléfono '), h('span', { class: 'selectable' }, m.phone), ' ', h('button', { type: 'button', class: 'link-btn', onclick: () => copy(m.phone) }, 'copiar')) : null,
            m.guests ? h('p', { class: 'muted small' }, `${m.guests} invitados aprox.`) : null),
          h('div', { class: 'row' },
            m.email && !DEMO ? h('a', { class: 'btn small', href: `mailto:${m.email}?subject=${encodeURIComponent(`Tu evento con ${site.name}`)}` }, 'Responder por correo') : null,
            status,
            h('button', { class: 'btn ghost small danger', type: 'button', onclick: async () => { if (!confirm(`¿Eliminar el mensaje de ${m.name}?`)) return; await api(`/api/admin/messages/${m.id}`, { method: 'DELETE' }); render(); } }, 'Eliminar')),
          notes)));
    }
    root.append(list);
  }

  // --- datos de la empresa
  async function companyCard() {
    const co = await api('/api/admin/company');
    const input = (k, attrs = {}) => h(attrs.multiline ? 'textarea' : 'input', { name: k, value: attrs.multiline ? null : co[k] || '', rows: 4, maxlength: attrs.max || 200, type: attrs.type || 'text', placeholder: attrs.placeholder || '', autocomplete: 'off', multiline: null, max: null }, attrs.multiline ? co[k] || '' : null);
    const form = h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      const body = {};
      for (const el of form.elements) if (el.name) body[el.name] = el.value;
      try { await api('/api/admin/company', { method: 'PUT', body }); toast('Datos de la empresa guardados', 'ok'); await loadSite(); } catch (err) { toast(err.message, 'error'); }
    } },
    h('h2', { class: 'title small' }, 'Datos de la empresa'),
    h('p', { class: 'muted small' }, 'Se muestran en el pie de la web, en la página de contacto y en los presupuestos. Deja vacío lo que no quieras publicar.'),
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Nombre comercial'), input('name', { max: 80 })),
      h('label', { class: 'field' }, h('span', {}, 'Razón social'), input('legalName', { max: 120 })),
      h('label', { class: 'field' }, h('span', {}, 'CIF / NIF'), input('taxId', { max: 20 })),
      h('label', { class: 'field' }, h('span', {}, 'Teléfono'), input('phone', { type: 'tel', max: 30 })),
      h('label', { class: 'field' }, h('span', {}, 'WhatsApp'), input('whatsapp', { type: 'tel', max: 30, placeholder: '+34 600 000 000' })),
      h('label', { class: 'field' }, h('span', {}, 'Correo'), input('email', { type: 'email', max: 120 })),
      h('label', { class: 'field' }, h('span', {}, 'Instagram (usuario)'), input('instagram', { max: 60, placeholder: 'sin @' })),
      h('label', { class: 'field wide' }, h('span', {}, 'Dirección o zona de trabajo'), input('address', { max: 200 })),
      h('label', { class: 'field wide' }, h('span', {}, 'Condiciones del presupuesto'), input('conditions', { multiline: true, max: 2000 }))),
    h('button', { class: 'btn', type: 'submit' }, 'Guardar datos'));
    return form;
  }

  // ------------------------------------------------------------ ensayo del espectáculo de pirotecnia
  function rehearsal(catalog, lines, calc) {
    const resolved = lines.map((l) => {
      const item = catalog.items.find((i) => i.id === l.itemId);
      if (!item) return null;
      const cols = PyroCalc.itemColors(catalog, item);
      return { ...l, item, color: cols.find((c) => c.id === l.colorId) || cols[0] };
    }).filter(Boolean);
    if (!resolved.length) return;
    const hasMoments = resolved.some((l) => l.moment);
    const groups = hasMoments
      ? [...MOMENTS.map((m) => ({ name: m, lines: resolved.filter((l) => l.moment === m) })), { name: 'Y además…', lines: resolved.filter((l) => !l.moment || !MOMENTS.includes(l.moment)) }].filter((g) => g.lines.length)
      : [{ name: 'Tu espectáculo', lines: resolved }];
    let alive = true;
    const previousFocus = document.activeElement;
    const caption = h('div', { class: 'reh-caption', 'aria-live': 'polite' });
    const stage = h('div', { class: 'reh-stage' });
    const steps = h('ol', { class: 'reh-steps' }, groups.map((g) => h('li', {}, g.name)));
    const controls = h('div', { class: 'reh-controls' });
    const closeBtn = h('button', { type: 'button', class: 'icon-btn reh-close', 'aria-label': 'Cerrar ensayo' }, '✕');
    const overlay = h('div', { class: 'rehearsal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ensayo del espectáculo' },
      h('div', { class: 'reh-top' }, h('p', { class: 'eyebrow' }, 'Ensayo del espectáculo'), closeBtn),
      caption, stage, steps, controls);
    const close = () => { alive = false; overlay.classList.add('closing'); document.body.classList.remove('no-scroll'); document.removeEventListener('keydown', onKey); setTimeout(() => overlay.remove(), 350); if (previousFocus && previousFocus.focus) previousFocus.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    document.body.classList.add('no-scroll');
    closeBtn.focus();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const showGroup = (g, i, finale) => {
      if (!finale) {
        [...steps.children].forEach((li, j) => { li.classList.toggle('active', j === i); li.classList.toggle('done', j < i); });
        caption.replaceChildren(h('p', { class: 'reh-moment' }, g.name), h('p', { class: 'muted small' }, g.lines.map((l) => `${l.qty} × ${l.item.name} · ${l.color.name.toLowerCase()}`).join('  ·  ')));
      }
      stage.replaceChildren();
      for (const l of g.lines) {
        const wide = l.item.kind === 'cascada';
        const copies = wide ? 1 : Math.min(l.qty, 6);
        const group = h('div', { class: `reh-group${wide ? ' wide' : ''}`, style: { '--n': String(copies), flex: wide ? `${Math.min(l.qty, 6)} 1 0` : `${copies} 1 0` } });
        for (let c = 0; c < copies; c++) {
          const art = effectArt(l.item.kind, l.color);
          art.classList.remove('paused');
          art.style.setProperty('animation-delay', `${c * 90}ms`);
          group.append(h('div', { class: 'reh-slot', style: { '--d': `${c * 90}ms` } }, art));
        }
        stage.append(group);
      }
      setTimeout(() => {
        if (!alive) return;
        stage.querySelectorAll('.reh-group').forEach((el, idx) => {
          const l = g.lines[idx];
          const r = el.getBoundingClientRect();
          celebrate(r.left + r.width / 2, r.bottom - 20, { count: 40, power: 5, lift: 6, confetti: l.item.kind === 'confeti' ? 0.9 : 0, colors: l.color.hex === 'linear' ? PALETTES.fiesta : [l.color.hex, '#ffffff', l.color.hex] });
        });
      }, 250);
    };
    (async () => {
      controls.replaceChildren();
      for (let i = 0; i < groups.length && alive; i++) {
        showGroup(groups[i], i);
        await wait(REDUCED ? 2200 : 3800);
      }
      if (!alive) return;
      [...steps.children].forEach((li) => { li.classList.remove('active'); li.classList.add('done'); });
      stage.classList.add('finale');
      showGroup({ name: 'Final', lines: resolved }, groups.length, true);
      caption.replaceChildren(h('p', { class: 'reh-moment' }, '¡Así brillará tu celebración!'), h('p', { class: 'muted' }, `Total con montaje e IVA: ${euros(calc.total)}`));
      skyRockets({ colors: [...new Set(resolved.map((l) => (l.color.hex === 'linear' ? '#f6d36b' : l.color.hex)))].concat(['#ffffff']), count: 8, gap: 220 });
      controls.replaceChildren(
        h('button', { type: 'button', class: 'btn', onclick: () => { close(); setTimeout(() => rehearsal(catalog, lines, calc), 380); } }, 'Repetir ensayo'),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => { close(); const fq = document.querySelector('.quote-form'); if (fq) fq.scrollIntoView({ behavior: 'smooth' }); } }, 'Pedir este presupuesto'));
    })();
  }

  // ------------------------------------------------------------ pantalla para proyectar en el evento
  async function renderScreen(slug) {
    const params = query();
    const k = params.get('k') || '';
    const code = params.get('c') || '';
    const qs = k ? `?k=${encodeURIComponent(k)}` : '';
    const headers = () => ({ 'X-Guest-Token': getToken(slug) });
    const load = () => api(`/api/events/${encodeURIComponent(slug)}${qs}`, { headers: headers() });
    let data;
    try { data = await load(); } catch { throw new Error('No se puede abrir la pantalla de este evento. Ábrela desde el panel de gestión.'); }
    if (!data.authorized && code) {
      try { const r = await api(`/api/events/${encodeURIComponent(slug)}/unlock`, { method: 'POST', body: { code, k } }); setToken(slug, r.token); data = await load(); } catch { /* código no válido */ }
    }
    if (!data.authorized) throw new Error('Esta pantalla necesita el código del evento. Ábrela desde el panel de gestión.');
    const ev = data.event;
    document.title = `${ev.name} · Pantalla`;
    const link = DEMO ? `https://guspira.events/e/${slug}${qs}` : `${location.origin}/e/${encodeURIComponent(slug)}${qs}`;
    const list = h('ol', { class: 'scr-list' });
    const nowBox = h('div', { class: 'scr-now', hidden: true });
    const banner = h('div', { class: 'scr-banner', role: 'status' });
    const clock = h('span', { class: 'scr-clock' });
    const total = h('span', { class: 'muted' });
    const tipTexts = ['Busca tu canción en Spotify', 'Dedícasela a alguien especial', 'Vota las que más te gusten', 'Las más votadas suenan antes'].map((x) => tr(x));
    const tips = h('p', { class: 'muted scr-tip' }, tipTexts[0]);
    let tipIndex = 0;
    const tipTimer = setInterval(() => {
      if (!tips.isConnected) { clearInterval(tipTimer); return; }
      tipIndex = (tipIndex + 1) % tipTexts.length;
      tips.classList.remove('swap'); void tips.offsetWidth; tips.classList.add('swap');
      setTimeout(() => { tips.textContent = tipTexts[tipIndex]; }, 250);
    }, 4500);
    const ticker = h('div', { class: 'scr-ticker', hidden: true, 'aria-hidden': 'true' }, h('div', { class: 'scr-ticker-track' }));
    let tickerKey = '';
    const root = h('section', { class: 'screen' },
      h('div', { class: 'scr-left' },
        h('img', { class: 'scr-symbol', src: ASSET.symbol, alt: '' }),
        h('p', { class: 'eyebrow' }, tr(ev.type || 'Evento')),
        h('h1', { class: 'scr-title' }, ev.name),
        ornament('always'),
        h('div', { class: 'scr-qr' }, decoCorners(true),
          h('div', { class: 'qr big', html: qrSvg(link, 10) }),
          h('div', {}, h('p', { class: 'scr-cta' }, tr('Escanea y pide tu canción')), code ? h('p', { class: 'scr-code' }, tr('Código '), h('b', {}, code)) : null, tips))),
      h('div', { class: 'scr-right' },
        h('div', { class: 'scr-top' },
          h('span', { class: 'live' }, h('i', { class: 'live-dot', 'aria-hidden': 'true' }), tr('En directo')), total, clock,
          h('span', { class: 'scr-actions' }, langToggle(),
            h('button', { type: 'button', class: 'btn ghost small', onclick: () => { const el = document.documentElement; (document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen ? el.requestFullscreen() : Promise.reject()).catch(() => toast(tr('Tu navegador no permite la pantalla completa aquí'), 'error')); } }, tr('Pantalla completa')),
            h('a', { class: 'btn ghost small', href: '/admin?tab=eventos', 'data-link': true }, tr('Salir')))),
        nowBox,
        h('h2', { class: 'scr-h' }, tr('Las más pedidas')),
        ev.showQueue ? list : h('p', { class: 'muted' }, tr('La lista de peticiones está oculta para los invitados en este evento.'))),
      banner, ticker);
    app.append(root);
    const colors = paletteFor(ev.type);
    embers(root, { count: innerWidth < 900 ? 30 : 60, colors });
    let known = null;
    let topId = null;
    function crown(r) {
      banner.replaceChildren(h('span', { class: 'eyebrow' }, tr('¡Nueva número 1!')), h('strong', {}, r.track.name), h('span', { class: 'muted' }, [r.track.artists, plural(r.votes, '{n} voto', '{n} votos')].filter(Boolean).join(' · ')));
      banner.classList.remove('show'); void banner.offsetWidth; banner.classList.add('show');
      setTimeout(() => {
        const first = list.querySelector('.scr-item');
        if (!first) return;
        first.classList.remove('crowned'); void first.offsetWidth; first.classList.add('crowned');
        const b = first.getBoundingClientRect();
        skyRockets({ colors, count: 5, x: b.left + b.width / 2, y: Math.max(80, b.top - 40), gap: 200 });
      }, 650);
    }
    function announce(r) {
      banner.replaceChildren(h('span', { class: 'eyebrow' }, tr('Nueva petición')), h('strong', {}, r.track.name), h('span', { class: 'muted' }, [r.track.artists, r.guestName ? tr('pedida por {name}', { name: r.guestName }) : ''].filter(Boolean).join(' · ')));
      banner.classList.remove('show');
      void banner.offsetWidth;
      banner.classList.add('show');
      setTimeout(() => { const b = banner.getBoundingClientRect(); celebrate(b.left + b.width / 2, b.top + 20, { count: 110, power: 8, colors }); }, 250);
    }
    async function refresh() {
      try {
        data = await load();
        const all = data.requests || [];
        const top = all.filter((r) => r.status !== 'played').sort((a, b) => b.votes - a.votes || (a.status === 'approved' ? -1 : 1)).slice(0, 7);
        total.textContent = plural(all.length, '{n} petición', '{n} peticiones');
        if (!top.length) list.replaceChildren(h('li', { class: 'scr-empty' }, tr('Sé el primero en pedir una canción')));
        else flipRender(list, top.map((r, i) => h('li', { class: `scr-item ${r.status}`, 'data-key': r.id },
          h('span', { class: 'scr-rank' }, String(i + 1)),
          coverArt(r.track, 'sm'),
          h('span', { class: 'mini-text' }, h('strong', {}, r.track.name), h('span', { class: 'muted' }, [r.track.artists, r.guestName].filter(Boolean).join(' · '))),
          h('span', { class: 'scr-votes' }, h('span', { class: 'heart' }, '♥'), ` ${r.votes}`))));
        const newTop = top[0] ? top[0].id : null;
        if (topId && newTop && newTop !== topId) crown(top[0]);
        else if (known) { const fresh = all.filter((r) => !known.has(r.id)); if (fresh.length) announce(fresh[fresh.length - 1]); }
        topId = newTop;
        known = new Set(all.map((r) => r.id));
        const dedications = all.filter((r) => r.message).slice(-12).map((r) => [r.guestName, r.message, r.track.name]);
        const key = JSON.stringify(dedications);
        if (key !== tickerKey) {
          tickerKey = key;
          ticker.hidden = !dedications.length;
          const items = dedications.map(([who, msg, song]) => h('span', {}, h('em', {}, `“${msg}”`), ` ${who ? `— ${who}` : ''} · ${song}`, h('i', {}, '✦')));
          const track = ticker.firstChild;
          track.replaceChildren(...items, ...items.map((n) => n.cloneNode(true)));
          track.style.setProperty('--dur', `${Math.max(25, dedications.length * 9)}s`);
        }
      } catch { /* se reintenta */ }
      if (ev.showNowPlaying) api(`/api/events/${encodeURIComponent(slug)}/now${qs}`, { headers: headers() }).then((n) => nowPlaying(nowBox, n), () => {});
    }
    const tickClock = () => { clock.textContent = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); };
    tickClock();
    await refresh();
    pollTimer = setInterval(() => { tickClock(); if (!document.hidden) refresh(); }, 5000);
  }

  // ------------------------------------------------------------ contacto
  function renderContact() {
    document.title = `Contacto · ${site.name}`;
    const f = {
      name: h('input', { type: 'text', name: 'name', required: true, maxlength: 100, autocomplete: 'name' }),
      email: h('input', { type: 'email', name: 'email', maxlength: 120, autocomplete: 'email' }),
      phone: h('input', { type: 'tel', name: 'phone', maxlength: 30, autocomplete: 'tel' }),
      eventType: h('select', { name: 'eventType' }, ['Boda', 'Babyshower', 'Revelación de género', 'Comunión', 'Bautizo', 'Cumpleaños', 'Aniversario', 'Evento de empresa', 'Fiesta privada', 'Otro'].map((t) => h('option', {}, t))),
      date: h('input', { type: 'date', name: 'date', min: new Date().toISOString().slice(0, 10) }),
      guests: h('input', { type: 'number', name: 'guests', min: 0, max: 5000, inputmode: 'numeric' }),
      message: h('textarea', { name: 'message', rows: 5, maxlength: 2000, placeholder: 'Cuéntanos cómo imaginas el día: lugar, horarios, momentos especiales…' })
    };
    const services = ['Música y peticiones de canciones', 'Pirotecnia fría', 'Otro'];
    const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);
    const submit = h('button', { class: 'btn block', type: 'submit' }, 'Enviar mensaje');
    const form = h('form', { class: 'card contact-form', onsubmit: async (e) => {
      e.preventDefault();
      if (!f.email.value.trim() && !f.phone.value.trim()) { toast('Déjanos un correo o un teléfono', 'error'); f.email.focus(); return; }
      submit.disabled = true;
      try {
        await api('/api/contact', { method: 'POST', body: {
          name: f.name.value, email: f.email.value, phone: f.phone.value, eventType: f.eventType.value, date: f.date.value, guests: f.guests.value, message: f.message.value,
          services: [...form.querySelectorAll('input[name=service]:checked')].map((c) => c.value), privacy: form.elements.privacy.checked
        } });
        form.replaceChildren(h('div', { class: 'sent' }, h('div', { class: 'sent-icon', 'aria-hidden': 'true' }, '✓'), h('h2', { class: 'title small' }, '¡Mensaje enviado!'),
          h('p', { class: 'muted' }, `Gracias, ${f.name.value.split(' ')[0]}. Te responderemos lo antes posible.`),
          h('a', { class: 'btn ghost', href: '/pirotecnia', 'data-link': true }, 'Mientras tanto, calcula tu pirotecnia')));
        burstFrom(form.querySelector('.sent-icon'), { count: 110, colors: paletteFor(f.eventType.value) });
      } catch (err) { toast(err.message, 'error'); submit.disabled = false; }
    } },
    h('div', { class: 'form-grid' }, field('Nombre y apellidos *', f.name), field('Correo electrónico', f.email), field('Teléfono', f.phone),
      field('Tipo de celebración', f.eventType), field('Fecha prevista', f.date), field('Invitados aprox.', f.guests)),
    h('fieldset', {}, h('legend', {}, '¿Qué te interesa?'), h('div', { class: 'row' }, services.map((x) => h('label', { class: 'check chip-check' }, h('input', { type: 'checkbox', name: 'service', value: x }), x)))),
    field('Mensaje', f.message),
    privacyCheck(),
    submit);

    const info = [];
    if (site.phone) info.push(h('li', {}, h('span', { class: 'muted small' }, 'Teléfono'), h('span', { class: 'selectable' }, site.phone)));
    if (site.whatsapp) info.push(h('li', {}, h('span', { class: 'muted small' }, 'WhatsApp'), h('a', { class: 'text-link', href: `https://wa.me/${digits(site.whatsapp).replace('+', '')}`, target: '_blank', rel: 'noopener' }, 'Escríbenos por WhatsApp ↗')));
    if (site.email) info.push(h('li', {}, h('span', { class: 'muted small' }, 'Correo'), h('span', { class: 'selectable' }, site.email)));
    if (site.instagram) info.push(h('li', {}, h('span', { class: 'muted small' }, 'Instagram'), h('a', { class: 'text-link', href: `https://instagram.com/${site.instagram.replace(/^@/, '')}`, target: '_blank', rel: 'noopener' }, `@${site.instagram.replace(/^@/, '')} ↗`)));
    if (site.address) info.push(h('li', {}, h('span', { class: 'muted small' }, 'Zona'), h('span', {}, site.address)));

    app.append(
      h('section', { class: 'event-hero' }, h('span', { class: 'chip' }, 'Contacto'), h('h1', { class: 'title' }, 'Hablemos de tu celebración'), ornament(),
        h('p', { class: 'lead' }, 'Bodas, babyshowers, comuniones o fiestas privadas: cuéntanos qué necesitas y te preparamos una propuesta sin compromiso.')),
      h('section', { class: 'section contact-layout' }, form,
        h('aside', { class: 'contact-aside' },
          info.length ? h('div', { class: 'card' }, h('h2', { class: 'title small' }, 'Contacto directo'), h('ul', { class: 'info-list' }, info)) : null,
          h('div', { class: 'card' }, h('h2', { class: 'title small' }, 'Qué hacemos'),
            h('ul', { class: 'check-list' },
              h('li', {}, 'Peticiones de canciones con Spotify y QR para tus invitados'),
              h('li', {}, 'Pirotecnia fría: fuentes, abanicos y cascadas de chispas'),
              h('li', {}, 'Revelaciones con humo de color y confeti'),
              h('li', {}, 'Montaje y técnico durante el espectáculo'))))));
  }

  // ------------------------------------------------------------ privacidad
  function renderPrivacy() {
    document.title = `Política de privacidad · ${site.name}`;
    const owner = site.legalName || site.name;
    const sec = (title, ...text) => [h('h2', {}, title), ...text.map((t) => h('p', {}, t))];
    app.append(h('section', { class: 'section narrow prose' },
      h('h1', { class: 'title' }, 'Política de privacidad'),
      sec('Responsable', `${owner}${site.taxId ? `, con CIF/NIF ${site.taxId}` : ''}${site.address ? `, ${site.address}` : ''}.${site.email ? ` Contacto: ${site.email}.` : ''}`),
      sec('Qué datos tratamos y para qué', 'Los datos que nos facilitas en los formularios de contacto y de presupuesto (nombre, correo, teléfono y detalles del evento) se usan solo para responderte, preparar tu presupuesto y organizar el servicio contratado.',
        'En las páginas de peticiones de canciones guardamos el nombre o la dedicatoria que quieras escribir y un identificador aleatorio de tu navegador para contar votos y limitar peticiones. No pedimos ninguna cuenta.'),
      sec('Base legal', 'El tratamiento se basa en tu consentimiento al enviar el formulario y, si contratas el servicio, en la ejecución del contrato.'),
      sec('Conservación', 'Conservamos los datos mientras sean necesarios para atender tu solicitud y durante los plazos que exija la ley. Las peticiones de canciones se pueden eliminar al terminar el evento.'),
      sec('Cesiones', 'No cedemos tus datos a terceros salvo obligación legal. Si el evento usa Spotify, la búsqueda de canciones se hace a través de su servicio sin enviar tus datos personales.'),
      sec('Tus derechos', `Puedes pedir acceso, rectificación, supresión, oposición, limitación o portabilidad de tus datos${site.email ? ` escribiendo a ${site.email}` : ' contactando con nosotros'}. También puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).`),
      sec('Almacenamiento en tu navegador', 'Usamos el almacenamiento local del navegador para recordar tu identificador de invitado, el código de un evento ya desbloqueado y el presupuesto que estás preparando. No usamos cookies publicitarias.')));
  }

  // ------------------------------------------------------------ datos públicos de la empresa (pie y WhatsApp)
  async function loadSite() {
    try { site = { ...site, ...(await api('/api/site')) }; } catch { /* sin conexión: se usan los valores por defecto */ }
    const box = document.getElementById('footer-contact');
    const parts = [];
    if (site.phone) parts.push(h('span', { class: 'selectable' }, site.phone));
    if (site.email) parts.push(h('span', { class: 'selectable' }, site.email));
    if (site.instagram) parts.push(h('a', { href: `https://instagram.com/${site.instagram.replace(/^@/, '')}`, target: '_blank', rel: 'noopener' }, `@${site.instagram.replace(/^@/, '')}`));
    if (box) box.replaceChildren(...parts);
    const legal = document.getElementById('footer-legal');
    if (legal) legal.textContent = [site.legalName || site.name, site.taxId ? `CIF/NIF ${site.taxId}` : ''].filter(Boolean).join(' · ');
    const wa = document.getElementById('wa');
    if (wa) {
      wa.hidden = !site.whatsapp;
      if (site.whatsapp) wa.href = `https://wa.me/${digits(site.whatsapp).replace('+', '')}?text=${encodeURIComponent(`Hola, me gustaría información sobre ${site.name}.`)}`;
    }
  }

  // ------------------------------------------------------------ inicio
  document.getElementById('year').textContent = new Date().getFullYear();
  document.querySelectorAll('img[data-asset]').forEach((img) => { img.src = ASSET[img.dataset.asset]; });
  loadSite().finally(render);
})();
