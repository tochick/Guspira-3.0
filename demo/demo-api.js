/* Demostración sin servidor: imita la API de server.cjs dentro del navegador.
   Los datos se guardan en este navegador y Spotify está simulado. */
(() => {
  'use strict';
  window.GUSPIRA_DEMO = true;
  window.confirm = () => true; // el visor no muestra diálogos
  window.prompt = (msg, def) => def || 'Nuevo color';

  const D = window.GuspiraDefaults;
  const { computeQuote } = window.PyroCalc;
  const BASE = 'https://guspira.events';
  const KEY = 'guspira_demo_v2';
  const ADMIN_PASSWORD = 'guspira2026';
  const rid = (n = 9) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('');
  const now = () => new Date().toISOString();
  const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
  const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

  const SONGS = [
    ['Perfect', 'Ed Sheeran'], ['Thinking Out Loud', 'Ed Sheeran'], ['Bailando', 'Enrique Iglesias'], ['Despacito', 'Luis Fonsi, Daddy Yankee'],
    ['La Bamba', 'Ritchie Valens'], ['September', 'Earth, Wind & Fire'], ['Uptown Funk', 'Mark Ronson, Bruno Mars'], ['Dancing Queen', 'ABBA'],
    ['I Wanna Dance with Somebody', 'Whitney Houston'], ['Can\'t Stop the Feeling!', 'Justin Timberlake'], ['Shut Up and Dance', 'WALK THE MOON'],
    ['Vivir mi vida', 'Marc Anthony'], ['Tusa', 'KAROL G, Nicki Minaj'], ['Quédate', 'Quevedo, Bizarrap'], ['Flowers', 'Miley Cyrus'],
    ['A Thousand Years', 'Christina Perri'], ['All of Me', 'John Legend'], ['Marry You', 'Bruno Mars'], ['Sugar', 'Maroon 5'],
    ['Paquito el Chocolatero', 'Gustavo Pascual Falcó'], ['Mi gran noche', 'Raphael'], ['Y nos dieron las diez', 'Joaquín Sabina'],
    ['La Macarena', 'Los del Río'], ['Danza Kuduro', 'Don Omar, Lucenzo'], ['Mamma Mia', 'ABBA'], ['Don\'t Stop Me Now', 'Queen'],
    ['Happy', 'Pharrell Williams'], ['Gasolina', 'Daddy Yankee'], ['Hips Don\'t Lie', 'Shakira'], ['Waka Waka', 'Shakira'],
    ['Corazón contento', 'Marisol'], ['Sweet Caroline', 'Neil Diamond'], ['Twist and Shout', 'The Beatles'], ['Can\'t Help Falling in Love', 'Elvis Presley'],
    ['Baby Shark', 'Pinkfong'], ['Here Comes the Sun', 'The Beatles'], ['Levitating', 'Dua Lipa'], ['Blinding Lights', 'The Weeknd'],
    ['Pepas', 'Farruko'], ['Titi Me Preguntó', 'Bad Bunny']
  ].map(([name, artists], i) => ({ id: `demo${i + 1}`, uri: `spotify:track:demo${i + 1}`, name, artists, album: '', image: '', durationMs: 170000 + (i * 7919) % 90000, explicit: ['Gasolina', 'Pepas', 'Titi Me Preguntó'].includes(name), url: '' }));

  // ------------------------------------------------------------ datos
  function seed() {
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const ev = (o) => ({ id: rid(), createdAt: now(), shareToken: rid(12), playlistId: '', playlistUrl: '', archived: false, visibility: 'public', access: 'open', code: '', requestsOpen: true, allowExplicit: true, showQueue: true, autoQueue: false, maxPerGuest: 5, time: '', venue: '', description: '', ...o });
    const boda = ev({ name: 'Boda de Lucía y Marcos', slug: 'boda-de-lucia-y-marcos', type: 'Boda', date: day(37), time: '19:00', venue: 'Finca El Olivar, Sevilla', description: '¡Pide la canción que quieres bailar con nosotros!', autoQueue: true });
    const baby = ev({ name: 'Babyshower de Ana', slug: 'babyshower-de-ana', type: 'Babyshower', date: day(24), venue: 'Jardines del Río', access: 'code', code: 'BEBE', allowExplicit: false, description: 'Código para entrar: BEBE (solo en la demostración).' });
    const comu = ev({ name: 'Comunión de Pablo', slug: 'comunion-de-pablo', type: 'Comunión', date: day(190), venue: 'Restaurante La Alameda', visibility: 'private', maxPerGuest: 3 });
    const song = (n) => SONGS.find((s) => s.name === n);
    const req = (e, track, guest, extra = {}) => ({ id: rid(), eventId: e.id, key: track.id, track, guestId: guest, guestName: '', message: '', status: 'pending', voters: [guest], createdAt: now(), queuedAt: '', inPlaylist: false, ...extra });
    const requests = [
      req(boda, song('Perfect'), 'g-lucia', { guestName: 'Lucía', message: 'Nuestra canción ♥', status: 'approved', voters: ['g-lucia', 'g2', 'g3', 'g4'], queuedAt: now() }),
      req(boda, song('Bailando'), 'g-carmen', { guestName: 'Tía Carmen', message: '¡Vivan los novios!', voters: ['g-carmen', 'g5'] }),
      req(boda, song('La Bamba'), 'g-javi', { guestName: 'Primo Javi', status: 'played' }),
      req(boda, song('September'), 'g6', { voters: ['g6', 'g7', 'g8'] }),
      req(boda, { id: '', uri: '', name: 'Canción de nuestra pandilla', artists: 'Los Amigos del Barrio', album: '', image: '', durationMs: 0, explicit: false, url: '' }, 'g9', { key: 'manual', guestName: 'Rocío', message: 'Para los del instituto' }),
      req(baby, song('Baby Shark'), 'g10', { guestName: 'Abuela Pilar' }),
      req(baby, song('Here Comes the Sun'), 'g11', { status: 'approved' })
    ];
    const pyro = D.pyroCatalog();
    const lines = [{ itemId: 'vertical', qty: 4, colorId: 'dorado', durationId: '60', moment: 'Primer baile' }, { itemId: 'cascada', qty: 3, colorId: 'plata', durationId: '30', moment: 'Entrada' }];
    const calc = computeQuote(pyro, lines, { distanceKm: 45 });
    delete calc.errors;
    const quote = { id: rid(), viewToken: rid(12), number: `GP-${new Date().getFullYear()}-0001`, createdAt: now(), status: 'nuevo', adminNotes: '',
      customer: { name: 'Lucía García', email: 'lucia@example.com', phone: '600 123 456' }, event: { type: 'Boda', date: boda.date, place: 'Finca El Olivar', indoor: 'exterior', guests: 140 }, distanceKm: 45, notes: 'Nos gustaría la cascada en la entrada y las fuentes en el primer baile.', ...calc };
    const company = { ...D.company(), phone: '+34 600 000 000', whatsapp: '+34 600 000 000', email: 'hola@guspira.example', address: 'Dirección de ejemplo · cámbiala en Admin → Ajustes' };
    const messages = [{ id: rid(), createdAt: new Date(Date.now() - 3 * 3600000).toISOString(), status: 'nuevo', adminNotes: '', name: 'Marta Ruiz', email: 'marta@example.com', phone: '', eventType: 'Boda', date: day(240), guests: 180, services: ['Música', 'Pirotecnia'], message: 'Hola, nos casamos el año que viene y nos encantaría la cascada de chispas para el primer baile. ¿Tenéis disponibilidad?' }];
    return { admin: false, settings: { spotifyClientId: '0123456789abcdef0123456789abcdef', market: 'ES' }, spotify: { name: 'DJ Guspira (simulado)', product: 'premium' }, events: [boda, baby, comu], requests, pyro, quotes: [quote], messages, company, counters: { quote: 1 } };
  }

  let db;
  try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { db = null; }
  if (!db || !Array.isArray(db.events)) db = seed();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* sin almacenamiento */ } };
  // Guardado que avisa si el navegador se queda sin espacio (fotos de la galería).
  const saveStrict = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); return true; } catch { return false; } };
  db.gallery = db.gallery || [];
  db.testimonials = db.testimonials || [];
  save();
  window.GuspiraDemoReset = () => { db = seed(); save(); };

  // ------------------------------------------------------------ utilidades (igual que el servidor)
  class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const slugify = (s) => str(s, 80).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'evento';
  const uniqueSlug = (base, exceptId) => { let slug = slugify(base); let n = 2; while (db.events.some((e) => e.slug === slug && e.id !== exceptId)) slug = `${slugify(base)}-${n++}`; return slug; };
  const guestToken = (e) => hash(`${e.id}|${e.shareToken}|${e.access}|${e.code}|${e.visibility}`);
  const eventLink = (e) => `${BASE}/e/${e.slug}${e.visibility === 'private' ? `?k=${e.shareToken}` : ''}`;
  const requireAdmin = () => { if (!db.admin) throw new HttpError(401, 'Inicia sesión como administrador.'); };

  function guestAccess(event, headers, url) {
    if (!event || event.archived) return { visible: false, authorized: false };
    const tokenOk = headers['X-Guest-Token'] === guestToken(event);
    const visible = tokenOk || event.visibility === 'public' || (url.searchParams.get('k') || '') === event.shareToken;
    return { visible, authorized: visible && (event.access === 'open' || tokenOk) };
  }
  const publicEvent = (e) => ({ slug: e.slug, name: e.name, type: e.type, date: e.date, time: e.time, venue: e.venue, description: e.description, locked: e.access === 'code', requestsOpen: e.requestsOpen, allowExplicit: e.allowExplicit, showQueue: e.showQueue, maxPerGuest: e.maxPerGuest, showNowPlaying: e.showNowPlaying !== false });
  const guestView = (r, g) => ({ id: r.id, track: r.track, guestName: r.guestName, message: r.message, status: r.status, votes: r.voters.length, voted: Boolean(g) && r.voters.includes(g), mine: Boolean(g) && r.guestId === g, createdAt: r.createdAt });
  const order = (r) => ({ approved: 0, pending: 1, played: 2 }[r.status] ?? 3);
  function adminEvent(e) {
    const reqs = db.requests.filter((r) => r.eventId === e.id);
    const c = (s) => reqs.filter((r) => r.status === s).length;
    return { ...e, link: eventLink(e), stats: { total: reqs.length, pending: c('pending'), approved: c('approved'), played: c('played'), rejected: c('rejected') } };
  }
  function eventFromBody(body, existing) {
    const e = existing ? { ...existing } : { id: rid(), createdAt: now(), shareToken: rid(12), playlistId: '', playlistUrl: '', archived: false };
    if (body.name !== undefined) e.name = str(body.name, 120);
    if (!e.name) throw new HttpError(400, 'El evento necesita un nombre.');
    e.slug = body.slug ? uniqueSlug(body.slug, e.id) : (e.slug || uniqueSlug(e.name, e.id));
    for (const k of ['type', 'date', 'time', 'venue']) if (body[k] !== undefined) e[k] = str(body[k], 120);
    if (body.description !== undefined) e.description = str(body.description, 1000);
    if (body.visibility !== undefined) e.visibility = body.visibility === 'private' ? 'private' : 'public';
    if (body.access !== undefined) e.access = body.access === 'code' ? 'code' : 'open';
    if (body.code !== undefined) e.code = str(body.code, 40);
    if (e.access === 'code' && !e.code) throw new HttpError(400, 'Indica el código de acceso de los invitados.');
    for (const k of ['requestsOpen', 'allowExplicit', 'showQueue', 'autoQueue', 'archived', 'showNowPlaying']) if (body[k] !== undefined) e[k] = Boolean(body[k]);
    if (body.maxPerGuest !== undefined) e.maxPerGuest = Math.max(0, Math.min(50, Math.floor(Number(body.maxPerGuest)) || 0));
    e.visibility ||= 'public'; e.access ||= 'open'; e.code ||= '';
    e.requestsOpen ??= true; e.allowExplicit ??= true; e.showQueue ??= true; e.autoQueue ??= false; e.maxPerGuest ??= 5; e.showNowPlaying ??= true;
    return e;
  }
  const publicCatalog = () => {
    const items = db.pyro.items.filter((i) => i.active !== false);
    const active = new Set(items.map((i) => i.id));
    const packs = (db.pyro.packs || []).map((k) => ({ ...k, lines: k.lines.filter((l) => active.has(l.itemId)) })).filter((k) => k.lines.length);
    return { colors: db.pyro.colors, fees: db.pyro.fees, items, packs, eventTypes: D.eventTypes, moments: D.moments };
  };
  const publicQuote = (q) => { const { adminNotes, viewToken, ...rest } = q; return { ...rest, link: `${BASE}/presupuesto/${q.id}?t=${viewToken}` }; };
  const findEvent = (slug) => db.events.find((e) => e.slug === slug);
  function authorized(slug, headers, url) {
    const e = findEvent(slug);
    const a = guestAccess(e, headers, url);
    if (!a.visible) throw new HttpError(404, 'Este evento no existe o el enlace no es válido.');
    if (!a.authorized) throw new HttpError(401, 'Introduce el código del evento.');
    return e;
  }
  const adminFind = (id) => { const e = db.events.find((x) => x.id === id); if (!e) throw new HttpError(404, 'Evento no encontrado.'); return e; };
  function queueReq(r) {
    if (!r.track.uri) throw new HttpError(400, 'Esta petición se escribió a mano: búscala en Spotify para ponerla en cola.');
    r.queuedAt = now();
  }

  // ------------------------------------------------------------ rutas
  const routes = [];
  const route = (method, pattern, fn) => {
    const keys = [];
    routes.push({ method, keys, fn, re: new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$') });
  };

  route('GET', '/api/status', () => ({ admin: db.admin, setupNeeded: false, spotifySearch: true, spotifyConnected: Boolean(db.spotify), publicUrl: BASE }));
  route('GET', '/api/events', () => {
    const today = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    return db.events.filter((e) => e.visibility === 'public' && !e.archived && (!e.date || e.date >= today)).sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999'))).map(publicEvent);
  });
  route('GET', '/api/events/:slug', ({ slug }, { headers, url }) => {
    const e = findEvent(slug);
    const a = guestAccess(e, headers, url);
    if (!a.visible) throw new HttpError(404, 'Este evento no existe o el enlace no es válido.');
    const g = headers['X-Guest-Id'];
    const out = { event: publicEvent(e), authorized: a.authorized, spotify: true };
    if (a.authorized) {
      const reqs = db.requests.filter((r) => r.eventId === e.id && r.status !== 'rejected');
      out.requests = (e.showQueue ? reqs : reqs.filter((r) => r.guestId === g)).sort((x, y) => order(x) - order(y) || y.voters.length - x.voters.length || x.createdAt.localeCompare(y.createdAt)).map((r) => guestView(r, g));
      out.myCount = reqs.filter((r) => r.guestId === g).length;
    }
    return out;
  });
  // Simulación de lo que suena: rota cada minuto entre las canciones aprobadas o sonadas del evento.
  function simulatedNow(eventId) {
    const pool = db.requests.filter((r) => (!eventId || r.eventId === eventId) && ['approved', 'played'].includes(r.status) && r.track.uri).map((r) => r.track);
    const list = pool.length ? pool : SONGS.slice(0, 8);
    const minute = Math.floor(Date.now() / 60000);
    const track = list[minute % list.length];
    return { active: true, isPlaying: true, track, progressMs: (Date.now() % 60000) / 60000 * track.durationMs };
  }
  route('GET', '/api/events/:slug/now', ({ slug }, { headers, url }) => {
    const e = authorized(slug, headers, url);
    if (e.showNowPlaying === false || !db.spotify) return { active: false };
    return simulatedNow(e.id);
  });
  route('POST', '/api/events/:slug/unlock', ({ slug }, { body, headers, url }) => {
    const e = findEvent(slug);
    if (body.k) url.searchParams.set('k', body.k);
    if (!guestAccess(e, headers, url).visible) throw new HttpError(404, 'Este evento no existe o el enlace no es válido.');
    if (e.access === 'code' && str(body.code, 40).toLowerCase() !== e.code.toLowerCase()) throw new HttpError(403, 'Código incorrecto.');
    return { token: guestToken(e) };
  });
  route('GET', '/api/events/:slug/search', ({ slug }, { headers, url }) => {
    const e = authorized(slug, headers, url);
    const q = str(url.searchParams.get('q'), 100).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (q.length < 2) return [];
    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return SONGS.filter((t) => norm(`${t.name} ${t.artists}`).includes(q)).filter((t) => e.allowExplicit || !t.explicit).slice(0, 10);
  });
  route('POST', '/api/events/:slug/requests', ({ slug }, { body, headers, url }) => {
    const e = authorized(slug, headers, url);
    if (!e.requestsOpen) throw new HttpError(409, 'Las peticiones de este evento están cerradas.');
    const g = headers['X-Guest-Id'];
    let track;
    if (body.trackId) {
      track = SONGS.find((t) => t.id === body.trackId);
      if (!track) throw new HttpError(400, 'Canción no encontrada.');
      if (track.explicit && !e.allowExplicit) throw new HttpError(400, 'En este evento no se aceptan canciones con contenido explícito.');
    } else {
      const name = str(body.title, 120);
      if (!name) throw new HttpError(400, 'Escribe el título de la canción.');
      track = { id: '', uri: '', name, artists: str(body.artist, 120), album: '', image: '', durationMs: 0, explicit: false, url: '' };
    }
    const key = track.id || `${track.name}|${track.artists}`.toLowerCase().replace(/\s+/g, ' ');
    const existing = db.requests.find((r) => r.eventId === e.id && r.key === key && r.status !== 'rejected');
    if (existing) { if (!existing.voters.includes(g)) existing.voters.push(g); save(); return { duplicate: true, request: guestView(existing, g) }; }
    const mine = db.requests.filter((r) => r.eventId === e.id && r.guestId === g).length;
    if (e.maxPerGuest && mine >= e.maxPerGuest) throw new HttpError(409, `Puedes pedir un máximo de ${e.maxPerGuest} canciones en este evento.`);
    const r = { id: rid(), eventId: e.id, key, track, guestId: g, guestName: str(body.guestName, 60), message: str(body.message, 200), status: 'pending', voters: [g], createdAt: now(), queuedAt: '', inPlaylist: false };
    db.requests.push(r); save();
    return { duplicate: false, request: guestView(r, g) };
  });
  route('POST', '/api/events/:slug/requests/:rid/vote', ({ slug, rid: id }, { headers, url }) => {
    const e = authorized(slug, headers, url);
    const g = headers['X-Guest-Id'];
    const r = db.requests.find((x) => x.id === id && x.eventId === e.id && x.status !== 'rejected');
    if (!r) throw new HttpError(404, 'Petición no encontrada.');
    const i = r.voters.indexOf(g);
    if (i >= 0) r.voters.splice(i, 1); else r.voters.push(g);
    save();
    return guestView(r, g);
  });

  route('GET', '/api/pyro/catalog', () => publicCatalog());
  route('POST', '/api/pyro/estimate', (_, { body }) => computeQuote(publicCatalog(), body.lines, { distanceKm: body.distanceKm }));
  route('POST', '/api/pyro/quotes', (_, { body }) => {
    const c = body.customer || {}; const ev = body.event || {};
    const input = {
      customer: { name: str(c.name, 100), email: str(c.email, 120), phone: str(c.phone, 30) },
      event: { type: str(ev.type, 40), date: str(ev.date, 20), place: str(ev.place, 160), indoor: ev.indoor === 'exterior' ? 'exterior' : 'interior', guests: Math.max(0, Math.floor(Number(ev.guests)) || 0) },
      distanceKm: Math.min(2000, Math.max(0, Number(body.distanceKm) || 0)), notes: str(body.notes, 1000)
    };
    if (!input.customer.name) throw new HttpError(400, 'Indica tu nombre.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customer.email) && input.customer.phone.replace(/\D/g, '').length < 9) throw new HttpError(400, 'Indica un correo o un teléfono de contacto válido.');
    if (!input.event.date) throw new HttpError(400, 'Indica la fecha del evento.');
    if (body.privacy !== true) throw new HttpError(400, 'Debes aceptar la política de privacidad.');
    const calc = computeQuote(publicCatalog(), body.lines, { distanceKm: input.distanceKm });
    if (calc.errors.length) throw new HttpError(400, calc.errors.join(' '));
    if (!calc.lines.length) throw new HttpError(400, 'Añade al menos un efecto pirotécnico.');
    delete calc.errors;
    db.counters.quote += 1;
    const q = { id: rid(), viewToken: rid(12), number: `GP-${new Date().getFullYear()}-${String(db.counters.quote).padStart(4, '0')}`, createdAt: now(), status: 'nuevo', adminNotes: '', ...input, ...calc };
    db.quotes.push(q); save();
    return publicQuote(q);
  });
  route('POST', '/api/pyro/quotes/:qid/accept', ({ qid }, { body }) => {
    const q = db.quotes.find((x) => x.id === qid);
    if (!q || str(body.t, 40) !== q.viewToken) throw new HttpError(404, 'Presupuesto no encontrado.');
    if (q.status === 'descartado') throw new HttpError(409, 'Este presupuesto ya no está disponible. Escríbenos y te preparamos uno nuevo.');
    if (q.status !== 'aceptado') { q.status = 'aceptado'; q.acceptedAt = now(); q.acceptedBy = 'cliente'; save(); }
    return publicQuote(q);
  });
  route('GET', '/api/site', () => ({ ...db.company }));
  const galleryView = (g) => ({ id: g.id, caption: g.caption, width: g.width, height: g.height, url: g.data });
  route('GET', '/api/gallery', () => db.gallery.map(galleryView));
  route('POST', '/api/admin/gallery', (_, { body }) => {
    requireAdmin();
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(String(body.image || ''))) throw new HttpError(400, 'Formato de imagen no válido. Usa JPG, PNG o WebP.');
    const item = { id: rid(), data: body.image, caption: str(body.caption, 140), width: Number(body.width) || 1200, height: Number(body.height) || 800, createdAt: now() };
    db.gallery.push(item);
    if (!saveStrict()) { db.gallery.pop(); throw new HttpError(507, 'En la demostración el navegador no tiene más espacio para fotos. En la web real no hay este límite.'); }
    return galleryView(item);
  });
  route('PATCH', '/api/admin/gallery/:gid', ({ gid }, { body }) => { requireAdmin(); const g = db.gallery.find((x) => x.id === gid); if (!g) throw new HttpError(404, 'Foto no encontrada.'); if (body.caption !== undefined) g.caption = str(body.caption, 140); save(); return galleryView(g); });
  route('POST', '/api/admin/gallery/order', (_, { body }) => { requireAdmin(); const ids = Array.isArray(body.ids) ? body.ids : []; db.gallery.sort((a, b) => (ids.indexOf(a.id) + 1 || 1e9) - (ids.indexOf(b.id) + 1 || 1e9)); save(); return db.gallery.map(galleryView); });
  route('DELETE', '/api/admin/gallery/:gid', ({ gid }) => { requireAdmin(); db.gallery = db.gallery.filter((x) => x.id !== gid); save(); return { ok: true }; });
  const testimonialFromBody = (body, cur = {}) => {
    const t = { ...cur };
    for (const [k, max] of [['name', 80], ['event', 80], ['text', 600]]) if (body[k] !== undefined) t[k] = str(body[k], max);
    if (body.rating !== undefined) t.rating = Math.max(1, Math.min(5, Math.round(Number(body.rating)) || 5));
    t.rating ||= 5;
    if (!t.name || !t.text) throw new HttpError(400, 'La opinión necesita el nombre y el texto.');
    return t;
  };
  route('GET', '/api/testimonials', () => db.testimonials.map(({ id, name, event, text, rating }) => ({ id, name, event, text, rating })));
  route('POST', '/api/admin/testimonials', (_, { body }) => { requireAdmin(); const t = testimonialFromBody(body, { id: rid(), createdAt: now() }); db.testimonials.push(t); save(); return t; });
  route('PUT', '/api/admin/testimonials/:tid', ({ tid }, { body }) => { requireAdmin(); const i = db.testimonials.findIndex((x) => x.id === tid); if (i < 0) throw new HttpError(404, 'Opinión no encontrada.'); db.testimonials[i] = testimonialFromBody(body, db.testimonials[i]); save(); return db.testimonials[i]; });
  route('DELETE', '/api/admin/testimonials/:tid', ({ tid }) => { requireAdmin(); db.testimonials = db.testimonials.filter((x) => x.id !== tid); save(); return { ok: true }; });
  route('POST', '/api/contact', (_, { body }) => {
    const m = { id: rid(), createdAt: now(), status: 'nuevo', adminNotes: '', name: str(body.name, 100), email: str(body.email, 120), phone: str(body.phone, 30), eventType: str(body.eventType, 40), date: str(body.date, 20), guests: Math.max(0, Math.floor(Number(body.guests)) || 0), services: (Array.isArray(body.services) ? body.services : []).map((x) => str(x, 40)).filter(Boolean).slice(0, 6), message: str(body.message, 2000) };
    if (!m.name) throw new HttpError(400, 'Indica tu nombre.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email) && m.phone.replace(/\D/g, '').length < 9) throw new HttpError(400, 'Indica un correo o un teléfono de contacto válido.');
    if (!m.message && !m.services.length) throw new HttpError(400, 'Cuéntanos qué necesitas.');
    if (body.privacy !== true) throw new HttpError(400, 'Debes aceptar la política de privacidad.');
    db.messages.push(m); save();
    return { ok: true };
  });
  route('GET', '/api/admin/overview', () => {
    requireAdmin();
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = db.events.filter((e) => !e.archived && e.date && e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const sum = (list) => Math.round(list.reduce((n, q) => n + q.total, 0) * 100) / 100;
    const activity = [
      ...db.requests.map((r) => ({ kind: 'request', at: r.createdAt, title: r.track.name, detail: (db.events.find((e) => e.id === r.eventId) || {}).name || '', ref: r.eventId })),
      ...db.quotes.map((q) => ({ kind: 'quote', at: q.acceptedAt || q.createdAt, title: `${q.number} · ${q.customer.name}`, detail: q.acceptedAt ? 'Aceptado por el cliente' : `Nuevo presupuesto · ${q.total.toFixed(2)} €`, ref: q.id })),
      ...db.messages.map((m) => ({ kind: 'message', at: m.createdAt, title: m.name, detail: m.eventType || 'Mensaje de contacto', ref: m.id }))
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
    return {
      counts: {
        upcomingEvents: upcoming.length,
        pendingRequests: db.requests.filter((r) => r.status === 'pending' && !(db.events.find((e) => e.id === r.eventId) || {}).archived).length,
        newQuotes: db.quotes.filter((q) => q.status === 'nuevo').length,
        newMessages: db.messages.filter((m) => m.status === 'nuevo').length
      },
      money: { open: sum(db.quotes.filter((q) => ['nuevo', 'contactado'].includes(q.status))), accepted: sum(db.quotes.filter((q) => q.status === 'aceptado')) },
      upcoming: upcoming.slice(0, 5).map((e) => ({ id: e.id, name: e.name, date: e.date, time: e.time, venue: e.venue, pending: db.requests.filter((r) => r.eventId === e.id && r.status === 'pending').length })),
      activity,
      agenda: [
        ...db.events.filter((e) => !e.archived && e.date).map((e) => ({ date: e.date, kind: 'event', title: e.name, detail: [e.time, e.venue].filter(Boolean).join(' · '), status: 'event', ref: e.id })),
        ...db.quotes.filter((q) => q.status !== 'descartado' && q.event && q.event.date).map((q) => ({ date: q.event.date, kind: 'quote', title: `${q.number} · ${q.customer.name}`, detail: [q.event.type, q.event.place].filter(Boolean).join(' · '), status: q.status, ref: q.id, total: q.total }))
      ].sort((x, y) => x.date.localeCompare(y.date))
    };
  });
  route('GET', '/api/pyro/availability', (_, { url }) => {
    const date = str(url.searchParams.get('date'), 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Fecha no válida.');
    return { date, booked: db.quotes.filter((q) => q.status === 'aceptado' && q.event && q.event.date === date).length };
  });
  route('GET', '/api/admin/messages', () => { requireAdmin(); return db.messages.slice().reverse(); });
  route('PATCH', '/api/admin/messages/:mid', ({ mid }, { body }) => {
    requireAdmin();
    const m = db.messages.find((x) => x.id === mid);
    if (!m) throw new HttpError(404, 'Mensaje no encontrado.');
    if (body.status !== undefined) m.status = body.status;
    if (body.adminNotes !== undefined) m.adminNotes = str(body.adminNotes, 2000);
    save();
    return { ok: true };
  });
  route('DELETE', '/api/admin/messages/:mid', ({ mid }) => { requireAdmin(); db.messages = db.messages.filter((m) => m.id !== mid); save(); return { ok: true }; });
  route('GET', '/api/admin/company', () => { requireAdmin(); return db.company; });
  route('PUT', '/api/admin/company', (_, { body }) => {
    requireAdmin();
    for (const k of ['name', 'legalName', 'taxId', 'phone', 'whatsapp', 'email', 'instagram', 'address', 'conditions']) if (body[k] !== undefined) db.company[k] = str(body[k], k === 'conditions' ? 2000 : 200);
    if (!db.company.name) db.company.name = 'Guspira Events';
    save();
    return db.company;
  });

  route('GET', '/api/pyro/quotes/:qid', ({ qid }, { url }) => {
    const q = db.quotes.find((x) => x.id === qid);
    if (!q || !(db.admin || url.searchParams.get('t') === q.viewToken)) throw new HttpError(404, 'Presupuesto no encontrado.');
    return publicQuote(q);
  });

  route('POST', '/api/admin/login', (_, { body }) => { if (String(body.password) !== ADMIN_PASSWORD) throw new HttpError(403, 'Contraseña incorrecta. En la demostración es guspira2026.'); db.admin = true; save(); return { ok: true }; });
  route('POST', '/api/admin/logout', () => { db.admin = false; save(); return { ok: true }; });
  route('POST', '/api/admin/password', () => { requireAdmin(); throw new HttpError(400, 'En la demostración la contraseña no se puede cambiar.'); });
  route('GET', '/api/admin/events', () => { requireAdmin(); return db.events.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(adminEvent); });
  route('POST', '/api/admin/events', (_, { body }) => { requireAdmin(); const e = eventFromBody(body); db.events.push(e); save(); return adminEvent(e); });
  route('PUT', '/api/admin/events/:eid', ({ eid }, { body }) => { requireAdmin(); const cur = adminFind(eid); const u = eventFromBody(body, cur); db.events[db.events.indexOf(cur)] = u; save(); return adminEvent(u); });
  route('DELETE', '/api/admin/events/:eid', ({ eid }) => { requireAdmin(); adminFind(eid); db.events = db.events.filter((e) => e.id !== eid); db.requests = db.requests.filter((r) => r.eventId !== eid); save(); return { ok: true }; });
  route('POST', '/api/admin/events/:eid/new-link', ({ eid }) => { requireAdmin(); const e = adminFind(eid); e.shareToken = rid(12); save(); return adminEvent(e); });
  route('GET', '/api/admin/events/:eid/requests', ({ eid }) => {
    requireAdmin(); adminFind(eid);
    return db.requests.filter((r) => r.eventId === eid).sort((a, b) => b.voters.length - a.voters.length || a.createdAt.localeCompare(b.createdAt)).map((r) => ({ ...guestView(r), queuedAt: r.queuedAt, inPlaylist: r.inPlaylist }));
  });
  route('PATCH', '/api/admin/requests/:rid', ({ rid: id }, { body }) => {
    requireAdmin();
    const r = db.requests.find((x) => x.id === id);
    if (!r) throw new HttpError(404, 'Petición no encontrada.');
    if (!['pending', 'approved', 'rejected', 'played'].includes(body.status)) throw new HttpError(400, 'Estado no válido.');
    r.status = body.status;
    const e = db.events.find((x) => x.id === r.eventId);
    if (r.status === 'approved' && e && e.autoQueue && db.spotify && r.track.uri && !r.queuedAt) r.queuedAt = now();
    save();
    return { ok: true, warning: '', queuedAt: r.queuedAt };
  });
  route('POST', '/api/admin/requests/:rid/queue', ({ rid: id }) => {
    requireAdmin();
    const r = db.requests.find((x) => x.id === id);
    if (!r) throw new HttpError(404, 'Petición no encontrada.');
    if (!db.spotify) throw new HttpError(409, 'Conecta una cuenta de Spotify desde el panel de administración.');
    queueReq(r);
    if (r.status === 'pending') r.status = 'approved';
    save();
    return { ok: true, queuedAt: r.queuedAt };
  });
  route('DELETE', '/api/admin/requests/:rid', ({ rid: id }) => { requireAdmin(); db.requests = db.requests.filter((r) => r.id !== id); save(); return { ok: true }; });
  route('POST', '/api/admin/events/:eid/playlist', ({ eid }) => {
    requireAdmin();
    if (!db.spotify) throw new HttpError(409, 'Conecta una cuenta de Spotify desde el panel de administración.');
    const pending = db.requests.filter((r) => r.eventId === eid && ['approved', 'played'].includes(r.status) && r.track.uri && !r.inPlaylist);
    pending.forEach((r) => { r.inPlaylist = true; });
    save();
    return { ok: true, added: pending.length, playlistUrl: '' };
  });
  route('GET', '/api/admin/settings', () => { requireAdmin(); return { spotifyClientId: db.settings.spotifyClientId, hasSecret: false, fromEnv: false, market: db.settings.market, redirectUri: `${BASE}/api/spotify/callback`, connected: db.spotify }; });
  route('PUT', '/api/admin/settings', (_, { body }) => {
    requireAdmin();
    if (body.spotifyClientId !== undefined) {
      const cid = str(body.spotifyClientId, 64).replace(/\s+/g, '');
      if (cid && !/^[0-9a-zA-Z]{32}$/.test(cid)) throw new HttpError(400, 'El Client ID de Spotify tiene 32 letras y números. Cópialo de nuevo desde Spotify for Developers.');
      if (cid !== db.settings.spotifyClientId) db.spotify = null;
      db.settings.spotifyClientId = cid;
    }
    if (body.market) db.settings.market = str(body.market, 2).toUpperCase();
    save();
    return { ok: true };
  });
  route('GET', '/api/admin/spotify/connect', () => {
    requireAdmin();
    if (!db.settings.spotifyClientId) throw new HttpError(409, 'Guarda primero el Client ID de tu app de Spotify.');
    db.spotify = { name: 'DJ Guspira (simulado)', product: 'premium' }; save();
    throw new HttpError(409, 'En la demostración Spotify está simulado: ya aparece como conectado. En la web real se abre Spotify para que autorices la conexión.');
  });
  route('POST', '/api/admin/events/:eid/export', ({ eid }, { body }) => {
    requireAdmin();
    const e = adminFind(eid);
    if (!db.spotify) throw new HttpError(409, 'Conecta tu cuenta de Spotify en Ajustes para exportar la lista.');
    const allowed = body.scope === 'approved' || !body.scope ? ['approved', 'played'] : ['approved', 'played', 'pending'];
    const picked = db.requests.filter((r) => r.eventId === eid && allowed.includes(r.status)).sort((a, b) => (a.status === 'pending') - (b.status === 'pending') || b.voters.length - a.voters.length);
    const uris = []; const unmatched = [];
    const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const r of picked) {
      let uri = r.track.uri;
      if (!uri && body.matchManual !== false) { const f = SONGS.find((t) => norm(t.name) === norm(r.track.name)); if (f) uri = f.uri; }
      if (uri) { if (!uris.includes(uri)) uris.push(uri); } else unmatched.push(`${r.track.name}${r.track.artists ? ` — ${r.track.artists}` : ''}`);
    }
    if (!uris.length) throw new HttpError(400, 'No hay canciones que exportar con ese filtro.');
    picked.forEach((r) => { if (r.track.uri) r.inPlaylist = true; });
    save();
    return { ok: true, added: uris.length, unmatched, playlistUrl: '', total: picked.length };
  });
  route('POST', '/api/admin/spotify/disconnect', () => { requireAdmin(); db.spotify = null; save(); return { ok: true }; });
  route('GET', '/api/admin/spotify/now', () => {
    requireAdmin();
    if (!db.spotify) return { active: false, connected: false };
    return { connected: true, device: 'Portátil del DJ (simulado)', ...simulatedNow(null) };
  });
  route('GET', '/api/admin/pyro/catalog', () => { requireAdmin(); return db.pyro; });
  route('PUT', '/api/admin/pyro/catalog', (_, { body }) => {
    requireAdmin();
    if ((body.items || []).some((i) => !(i.colorIds || []).length)) throw new HttpError(400, 'Cada producto necesita al menos un color.');
    db.pyro = JSON.parse(JSON.stringify({ colors: body.colors, items: body.items, fees: body.fees, packs: (body.packs || []).filter((k) => k.name && k.lines && k.lines.length) }));
    save();
    return db.pyro;
  });
  route('POST', '/api/admin/pyro/catalog/reset', () => { requireAdmin(); db.pyro = D.pyroCatalog(); save(); return db.pyro; });
  route('GET', '/api/admin/quotes', () => { requireAdmin(); return db.quotes.slice().reverse().map((q) => ({ ...publicQuote(q), adminNotes: q.adminNotes })); });
  route('PATCH', '/api/admin/quotes/:qid', ({ qid }, { body }) => {
    requireAdmin();
    const q = db.quotes.find((x) => x.id === qid);
    if (!q) throw new HttpError(404, 'Presupuesto no encontrado.');
    if (body.status !== undefined) q.status = body.status;
    if (body.adminNotes !== undefined) q.adminNotes = str(body.adminNotes, 2000);
    save();
    return { ok: true };
  });
  route('DELETE', '/api/admin/quotes/:qid', ({ qid }) => { requireAdmin(); db.quotes = db.quotes.filter((q) => q.id !== qid); save(); return { ok: true }; });

  // ------------------------------------------------------------ sustituto de fetch
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async (input, init = {}) => {
    const url = new URL(String(input), 'http://demo');
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init.method || 'GET').toUpperCase();
    const headers = init.headers || {};
    let body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch { body = {}; }
    await new Promise((r) => setTimeout(r, 60));
    let status = 200;
    let data;
    try {
      const r = routes.find((x) => x.method === method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, 'Ruta no encontrada.');
      const m = url.pathname.match(r.re);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      data = r.fn(params, { body, headers, url });
    } catch (err) {
      status = err.status || 500;
      data = { error: err.message };
    }
    return new Response(JSON.stringify(data ?? {}), { status, headers: { 'Content-Type': 'application/json' } });
  };
})();
