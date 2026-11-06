// Guspira Events: peticiones de canciones con Spotify y presupuestos de pirotecnia.
// Servidor Node sin dependencias externas. Ejecuta: node server.cjs
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { createSpotify } = require('./lib/spotify.cjs');
const defaults = require('./lib/defaults.cjs');
const { computeQuote } = require('./public/pyro-calc.js');

loadDotEnv(path.join(__dirname, '.env'));
const env = process.env;
const PORT = Number(env.PORT || 4321);
const HOST = env.HOST || '127.0.0.1';
const PUBLIC_URL = (env.PUBLIC_URL || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const DATA_DIR = path.resolve(env.GUSPIRA_DATA_DIR || path.join(__dirname, 'data'));
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const GALLERY_DIR = path.join(DATA_DIR, 'gallery');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SECURE_COOKIE = PUBLIC_URL.startsWith('https://');
const SESSION_MS = 7 * 24 * 3600 * 1000;

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

// ---------------------------------------------------------------- almacenamiento
const id = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');
let db = loadDb();

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let saved = {};
  if (fs.existsSync(DATA_FILE)) saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const data = {
    secret: saved.secret || crypto.randomBytes(32).toString('hex'),
    admin: saved.admin || null,
    settings: { spotifyClientId: '', spotifyClientSecret: '', market: 'ES', ...(saved.settings || {}) },
    spotifyAuth: saved.spotifyAuth || null,
    events: Array.isArray(saved.events) ? saved.events : [],
    requests: Array.isArray(saved.requests) ? saved.requests : [],
    pyro: saved.pyro || defaults.pyroCatalog(),
    quotes: Array.isArray(saved.quotes) ? saved.quotes : [],
    messages: Array.isArray(saved.messages) ? saved.messages : [],
    gallery: Array.isArray(saved.gallery) ? saved.gallery : [],
    testimonials: Array.isArray(saved.testimonials) ? saved.testimonials : [],
    company: { ...defaults.company(), ...(saved.company || {}) },
    counters: { quote: 0, ...(saved.counters || {}) }
  };
  if (!Array.isArray(data.pyro.packs)) data.pyro.packs = defaults.pyroCatalog().packs;
  if (!saved.secret) writeDb(data);
  return data;
}

function writeDb(data) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
function save() {
  writeDb(db);
}

// ---------------------------------------------------------------- Spotify
const spotify = createSpotify({
  getCredentials: () => ({
    clientId: env.SPOTIFY_CLIENT_ID || db.settings.spotifyClientId,
    clientSecret: env.SPOTIFY_CLIENT_SECRET || ''
  }),
  getUserAuth: () => db.spotifyAuth,
  saveUserAuth: (auth) => { db.spotifyAuth = auth; save(); },
  apiBase: env.SPOTIFY_API_BASE,
  accountsBase: env.SPOTIFY_ACCOUNTS_BASE
});
const SPOTIFY_REDIRECT = `${PUBLIC_URL}/api/spotify/callback`;
const oauthStates = new Map();
// La búsqueda para invitados funciona con Client Secret (opcional) o con la cuenta de Spotify conectada.
const searchAvailable = () => spotify.configured() && (spotify.hasSecret() || Boolean(db.spotifyAuth));

// ---------------------------------------------------------------- utilidades HTTP
class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(payload);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Petición demasiado grande.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'JSON no válido.')); }
    });
    req.on('error', reject);
  });
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function clientIp(req) {
  return (env.TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
}

const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { count: 1, reset: now + windowMs }); return; }
  b.count += 1;
  if (b.count > max) throw new HttpError(429, 'Demasiados intentos. Espera un momento y vuelve a probar.');
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
  for (const [k, s] of sessions) if (s.expires < now) sessions.delete(k);
  for (const [k, s] of oauthStates) if (s.expires < now) oauthStates.delete(k);
}, 60_000).unref();

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ---------------------------------------------------------------- administración
const sessions = new Map();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function isAdmin(req) {
  const token = cookies(req).gs_admin;
  const s = token && sessions.get(token);
  return Boolean(s && s.expires > Date.now());
}

function requireAdmin(req) {
  if (!isAdmin(req)) throw new HttpError(401, 'Inicia sesión como administrador.');
}

function sessionCookie(token, maxAge) {
  return `gs_admin=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE_COOKIE ? '; Secure' : ''}`;
}

// Contraseña inicial opcional desde el entorno.
if (!db.admin && env.GUSPIRA_ADMIN_PASSWORD) { db.admin = hashPassword(env.GUSPIRA_ADMIN_PASSWORD); save(); }

// ---------------------------------------------------------------- eventos y acceso de invitados
const slugify = (s) => str(s, 80).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'evento';

function uniqueSlug(base, exceptId) {
  let slug = slugify(base);
  let n = 2;
  while (db.events.some((e) => e.slug === slug && e.id !== exceptId)) slug = `${slugify(base)}-${n++}`;
  return slug;
}

function guestToken(event) {
  return crypto.createHmac('sha256', db.secret).update(`${event.id}|${event.shareToken}|${event.access}|${event.code}|${event.visibility}`).digest('base64url').slice(0, 32);
}

function eventLink(event) {
  return `${PUBLIC_URL}/e/${event.slug}${event.visibility === 'private' ? `?k=${event.shareToken}` : ''}`;
}

// Devuelve { visible, authorized } para el invitado que hace la petición.
function guestAccess(event, req, url) {
  if (!event || event.archived) return { visible: false, authorized: false };
  const token = req.headers['x-guest-token'];
  const tokenOk = Boolean(token) && safeEqual(token, guestToken(event));
  const linkOk = event.visibility === 'public' || safeEqual(url.searchParams.get('k') || '', event.shareToken);
  const visible = tokenOk || linkOk;
  const authorized = visible && (event.access === 'open' || tokenOk);
  return { visible, authorized };
}

function findEventBySlug(slug) {
  return db.events.find((e) => e.slug === slug);
}

function publicEvent(e) {
  return {
    slug: e.slug, name: e.name, type: e.type, date: e.date, time: e.time, venue: e.venue,
    description: e.description, locked: e.access === 'code', requestsOpen: e.requestsOpen,
    allowExplicit: e.allowExplicit, showQueue: e.showQueue, maxPerGuest: e.maxPerGuest, showNowPlaying: e.showNowPlaying !== false
  };
}

function guestRequestView(r, guestId) {
  return {
    id: r.id, track: r.track, guestName: r.guestName, message: r.message, status: r.status,
    votes: r.voters.length, voted: Boolean(guestId) && r.voters.includes(guestId), mine: Boolean(guestId) && r.guestId === guestId,
    createdAt: r.createdAt
  };
}

function eventFromBody(body, existing) {
  const e = existing ? { ...existing } : { id: id(), createdAt: new Date().toISOString(), shareToken: id(12), playlistId: '', playlistUrl: '', archived: false };
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

function adminEvent(e) {
  const reqs = db.requests.filter((r) => r.eventId === e.id);
  const count = (s) => reqs.filter((r) => r.status === s).length;
  return { ...e, link: eventLink(e), stats: { total: reqs.length, pending: count('pending'), approved: count('approved'), played: count('played'), rejected: count('rejected') } };
}

async function queueRequest(r) {
  if (!r.track.uri) throw new HttpError(400, 'Esta petición se escribió a mano: búscala en Spotify para ponerla en cola.');
  try {
    await spotify.queue(r.track.uri);
  } catch (err) {
    if (err.status === 404) throw new HttpError(409, 'No hay ningún dispositivo de Spotify reproduciendo. Abre Spotify y empieza a reproducir algo.');
    if (err.status === 403) throw new HttpError(409, 'Spotify no permite controlar la reproducción con esta cuenta (requiere Spotify Premium).');
    throw new HttpError(err.status === 409 ? 409 : 502, err.message);
  }
  r.queuedAt = new Date().toISOString();
}

// ---------------------------------------------------------------- pirotecnia
function publicCatalog() {
  const p = db.pyro;
  const items = p.items.filter((i) => i.active !== false);
  const active = new Set(items.map((i) => i.id));
  const packs = (p.packs || []).map((k) => ({ ...k, lines: k.lines.filter((l) => active.has(l.itemId)) })).filter((k) => k.lines.length);
  return { colors: p.colors, fees: p.fees, items, packs, eventTypes: defaults.eventTypes, moments: defaults.moments };
}

function validateCatalog(body) {
  const colors = (Array.isArray(body.colors) ? body.colors : []).map((c) => ({
    id: slugify(c.id || c.name), name: str(c.name, 40), hex: str(c.hex, 20) || '#cccccc', surcharge: Math.max(0, Number(c.surcharge) || 0)
  })).filter((c) => c.name);
  const colorIds = new Set(colors.map((c) => c.id));
  const items = (Array.isArray(body.items) ? body.items : []).map((i) => {
    const durations = (Array.isArray(i.durations) ? i.durations : []).map((d) => ({
      id: str(d.id || d.label, 20) || id(4), label: str(d.label, 40), multiplier: Math.max(0.1, Number(d.multiplier) || 1)
    })).filter((d) => d.label);
    return {
      id: slugify(i.id || i.name), kind: str(i.kind, 20) || 'otro', name: str(i.name, 80), description: str(i.description, 400),
      unitPrice: Math.max(0, Number(i.unitPrice) || 0), unitLabel: str(i.unitLabel, 20) || 'unidad',
      minQty: Math.max(1, Math.floor(Number(i.minQty)) || 1), maxQty: Math.max(1, Math.floor(Number(i.maxQty)) || 99),
      active: i.active !== false, colorIds: (i.colorIds || []).filter((c) => colorIds.has(c)),
      durations: durations.length ? durations : [{ id: 'std', label: 'Estándar', multiplier: 1 }]
    };
  }).filter((i) => i.name);
  if (new Set(items.map((i) => i.id)).size !== items.length) throw new HttpError(400, 'Hay dos productos con el mismo identificador.');
  if (items.some((i) => !i.colorIds.length)) throw new HttpError(400, 'Cada producto necesita al menos un color.');
  const f = body.fees || {};
  const fees = {
    setup: Math.max(0, Number(f.setup) || 0), freeKm: Math.max(0, Number(f.freeKm) || 0), perKm: Math.max(0, Number(f.perKm) || 0),
    vatRate: Math.min(1, Math.max(0, Number(f.vatRate) || 0)),
    discounts: (Array.isArray(f.discounts) ? f.discounts : []).map((d) => ({ min: Math.max(0, Number(d.min) || 0), pct: Math.min(90, Math.max(0, Number(d.pct) || 0)) })).filter((d) => d.pct > 0)
  };
  const itemIds = new Set(items.map((i) => i.id));
  const packs = (Array.isArray(body.packs) ? body.packs : []).map((p) => ({
    id: slugify(p.id || p.name), name: str(p.name, 60), tag: str(p.tag, 40), description: str(p.description, 300),
    lines: (Array.isArray(p.lines) ? p.lines : []).filter((l) => itemIds.has(l.itemId)).slice(0, 12).map((l) => ({
      itemId: l.itemId, qty: Math.max(1, Math.floor(Number(l.qty)) || 1), colorId: str(l.colorId, 40), durationId: str(l.durationId, 20), moment: str(l.moment, 60)
    }))
  })).filter((p) => p.name && p.lines.length);
  return { colors, items, fees, packs };
}

const COMPANY_FIELDS = { name: 80, legalName: 120, taxId: 20, phone: 30, whatsapp: 30, email: 120, instagram: 60, address: 200, conditions: 2000 };
const publicCompany = () => ({ ...db.company });

function quoteInput(body) {
  const c = body.customer || {};
  const ev = body.event || {};
  return {
    customer: { name: str(c.name, 100), email: str(c.email, 120), phone: str(c.phone, 30) },
    event: { type: str(ev.type, 40), date: str(ev.date, 20), place: str(ev.place, 160), indoor: ev.indoor === 'exterior' ? 'exterior' : 'interior', guests: Math.max(0, Math.floor(Number(ev.guests)) || 0) },
    distanceKm: Math.min(2000, Math.max(0, Number(body.distanceKm) || 0)),
    notes: str(body.notes, 1000)
  };
}

// ---------------------------------------------------------------- rutas
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

// --- estado general
route('GET', '/api/site', () => publicCompany());

route('POST', '/api/contact', async (req) => {
  rateLimit(`contact:${clientIp(req)}`, 6, 60 * 60_000);
  const body = await readBody(req);
  const m = {
    id: id(), createdAt: new Date().toISOString(), status: 'nuevo', adminNotes: '',
    name: str(body.name, 100), email: str(body.email, 120), phone: str(body.phone, 30),
    eventType: str(body.eventType, 40), date: str(body.date, 20), guests: Math.max(0, Math.floor(Number(body.guests)) || 0),
    services: (Array.isArray(body.services) ? body.services : []).map((x) => str(x, 40)).filter(Boolean).slice(0, 6),
    message: str(body.message, 2000)
  };
  if (!m.name) throw new HttpError(400, 'Indica tu nombre.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email) && m.phone.replace(/\D/g, '').length < 9) throw new HttpError(400, 'Indica un correo o un teléfono de contacto válido.');
  if (!m.message && !m.services.length) throw new HttpError(400, 'Cuéntanos qué necesitas.');
  if (body.privacy !== true) throw new HttpError(400, 'Debes aceptar la política de privacidad.');
  db.messages.push(m);
  save();
  return { ok: true };
});

route('GET', '/api/status', (req) => ({
  admin: isAdmin(req), setupNeeded: !db.admin, spotifySearch: searchAvailable(),
  spotifyConnected: Boolean(db.spotifyAuth), publicUrl: PUBLIC_URL
}));

// --- eventos públicos e invitados
route('GET', '/api/events', () => {
  const today = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return db.events
    .filter((e) => e.visibility === 'public' && !e.archived && (!e.date || e.date >= today))
    .sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')))
    .map(publicEvent);
});

route('GET', '/api/events/:slug', (req, { slug }, url) => {
  const event = findEventBySlug(slug);
  const access = guestAccess(event, req, url);
  if (!access.visible) throw new HttpError(404, 'Este evento no existe o el enlace no es válido.');
  const guestId = str(req.headers['x-guest-id'], 40);
  const out = { event: publicEvent(event), authorized: access.authorized, spotify: searchAvailable() };
  if (access.authorized) {
    const reqs = db.requests.filter((r) => r.eventId === event.id && r.status !== 'rejected');
    out.requests = (event.showQueue ? reqs : reqs.filter((r) => r.guestId === guestId))
      .sort((a, b) => order(a) - order(b) || b.voters.length - a.voters.length || a.createdAt.localeCompare(b.createdAt))
      .map((r) => guestRequestView(r, guestId));
    out.myCount = reqs.filter((r) => r.guestId === guestId).length;
  }
  return out;
});
const order = (r) => ({ approved: 0, pending: 1, played: 2 }[r.status] ?? 3);

// Lo que suena ahora, para invitados y para la pantalla del evento (con caché para no saturar Spotify).
let nowCache = { at: 0, data: null };
route('GET', '/api/events/:slug/now', async (req, { slug }, url) => {
  const event = authorizedEvent(req, slug, url);
  if (event.showNowPlaying === false || !db.spotifyAuth) return { active: false };
  if (Date.now() - nowCache.at > 8000) {
    try { nowCache = { at: Date.now(), data: await spotify.nowPlaying() }; } catch { nowCache = { at: Date.now(), data: { active: false } }; }
  }
  const n = nowCache.data || { active: false };
  return n.active && n.track ? { active: true, isPlaying: n.isPlaying, track: n.track, progressMs: n.progressMs } : { active: false };
});

route('POST', '/api/events/:slug/unlock', async (req, { slug }, url) => {
  rateLimit(`unlock:${clientIp(req)}`, 10, 10 * 60_000);
  const event = findEventBySlug(slug);
  const body = await readBody(req);
  if (body.k) url.searchParams.set('k', body.k);
  const access = guestAccess(event, req, url);
  if (!access.visible) throw new HttpError(404, 'Este evento no existe o el enlace no es válido.');
  if (event.access === 'code' && !safeEqual(str(body.code, 40).toLowerCase(), event.code.toLowerCase())) throw new HttpError(403, 'Código incorrecto.');
  return { token: guestToken(event) };
});

function authorizedEvent(req, slug, url) {
  const event = findEventBySlug(slug);
  const access = guestAccess(event, req, url);
  if (!access.visible) throw new HttpError(404, 'Este evento no existe o el enlace no es válido.');
  if (!access.authorized) throw new HttpError(401, 'Introduce el código del evento.');
  return event;
}

route('GET', '/api/events/:slug/search', async (req, { slug }, url) => {
  const event = authorizedEvent(req, slug, url);
  rateLimit(`search:${clientIp(req)}`, 40, 60_000);
  const q = str(url.searchParams.get('q'), 100);
  if (q.length < 2) return [];
  if (!searchAvailable()) throw new HttpError(503, 'La búsqueda en Spotify no está conectada. Escribe la canción a mano.');
  try {
    const tracks = await spotify.search(q, db.settings.market);
    return event.allowExplicit ? tracks : tracks.filter((t) => !t.explicit);
  } catch (err) {
    throw new HttpError(502, 'Spotify no responde ahora mismo. Prueba a escribir la canción a mano.');
  }
});

route('POST', '/api/events/:slug/requests', async (req, { slug }, url) => {
  const event = authorizedEvent(req, slug, url);
  rateLimit(`request:${clientIp(req)}`, 20, 10 * 60_000);
  if (!event.requestsOpen) throw new HttpError(409, 'Las peticiones de este evento están cerradas.');
  const body = await readBody(req);
  const guestId = str(req.headers['x-guest-id'], 40);
  if (guestId.length < 8) throw new HttpError(400, 'Falta el identificador del invitado.');
  let track;
  if (body.trackId) {
    if (!searchAvailable()) throw new HttpError(503, 'La búsqueda en Spotify no está conectada.');
    try { track = await spotify.getTrack(str(body.trackId, 40), db.settings.market); } catch { throw new HttpError(502, 'No se pudo comprobar la canción en Spotify.'); }
    if (track.explicit && !event.allowExplicit) throw new HttpError(400, 'En este evento no se aceptan canciones con contenido explícito.');
  } else {
    const name = str(body.title, 120);
    const artists = str(body.artist, 120);
    if (!name) throw new HttpError(400, 'Escribe el título de la canción.');
    track = { id: '', uri: '', name, artists, album: '', image: '', durationMs: 0, explicit: false, url: '' };
  }
  const key = track.id || `${track.name}|${track.artists}`.toLowerCase().replace(/\s+/g, ' ');
  const existing = db.requests.find((r) => r.eventId === event.id && r.key === key && r.status !== 'rejected');
  if (existing) {
    if (!existing.voters.includes(guestId)) existing.voters.push(guestId);
    save();
    return { duplicate: true, request: guestRequestView(existing, guestId) };
  }
  const mine = db.requests.filter((r) => r.eventId === event.id && r.guestId === guestId).length;
  if (event.maxPerGuest && mine >= event.maxPerGuest) throw new HttpError(409, `Puedes pedir un máximo de ${event.maxPerGuest} canciones en este evento.`);
  const r = {
    id: id(), eventId: event.id, key, track, guestId, guestName: str(body.guestName, 60), message: str(body.message, 200),
    status: 'pending', voters: [guestId], createdAt: new Date().toISOString(), queuedAt: '', inPlaylist: false
  };
  db.requests.push(r);
  save();
  return { duplicate: false, request: guestRequestView(r, guestId) };
});

route('POST', '/api/events/:slug/requests/:rid/vote', (req, { slug, rid }, url) => {
  const event = authorizedEvent(req, slug, url);
  const guestId = str(req.headers['x-guest-id'], 40);
  if (guestId.length < 8) throw new HttpError(400, 'Falta el identificador del invitado.');
  const r = db.requests.find((x) => x.id === rid && x.eventId === event.id && x.status !== 'rejected');
  if (!r) throw new HttpError(404, 'Petición no encontrada.');
  const i = r.voters.indexOf(guestId);
  if (i >= 0) r.voters.splice(i, 1); else r.voters.push(guestId);
  save();
  return guestRequestView(r, guestId);
});

// --- pirotecnia (público)
route('GET', '/api/pyro/catalog', () => publicCatalog());

route('POST', '/api/pyro/estimate', async (req) => {
  const body = await readBody(req);
  return computeQuote(publicCatalog(), body.lines, { distanceKm: body.distanceKm });
});

route('POST', '/api/pyro/quotes', async (req) => {
  rateLimit(`quote:${clientIp(req)}`, 8, 60 * 60_000);
  const body = await readBody(req);
  const input = quoteInput(body);
  if (!input.customer.name) throw new HttpError(400, 'Indica tu nombre.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customer.email) && input.customer.phone.replace(/\D/g, '').length < 9) throw new HttpError(400, 'Indica un correo o un teléfono de contacto válido.');
  if (!input.event.date) throw new HttpError(400, 'Indica la fecha del evento.');
  if (body.privacy !== true) throw new HttpError(400, 'Debes aceptar la política de privacidad.');
  const calc = computeQuote(publicCatalog(), body.lines, { distanceKm: input.distanceKm });
  if (calc.errors.length) throw new HttpError(400, calc.errors.join(' '));
  if (!calc.lines.length) throw new HttpError(400, 'Añade al menos un efecto pirotécnico.');
  db.counters.quote += 1;
  const year = new Date().getFullYear();
  const quote = {
    id: id(), viewToken: id(12), number: `GP-${year}-${String(db.counters.quote).padStart(4, '0')}`,
    createdAt: new Date().toISOString(), status: 'nuevo', adminNotes: '', ...input, ...calc
  };
  delete quote.errors;
  db.quotes.push(quote);
  save();
  return publicQuote(quote);
});

function publicQuote(q) {
  const { adminNotes, viewToken, ...rest } = q;
  return { ...rest, link: `${PUBLIC_URL}/presupuesto/${q.id}?t=${viewToken}` };
}

route('POST', '/api/pyro/quotes/:qid/accept', async (req, { qid }) => {
  const body = await readBody(req);
  const q = db.quotes.find((x) => x.id === qid);
  if (!q || !safeEqual(str(body.t, 40), q.viewToken)) throw new HttpError(404, 'Presupuesto no encontrado.');
  if (q.status === 'descartado') throw new HttpError(409, 'Este presupuesto ya no está disponible. Escríbenos y te preparamos uno nuevo.');
  if (Date.now() - new Date(q.createdAt).getTime() > 30 * 86400000 && q.status !== 'aceptado') throw new HttpError(409, 'Este presupuesto ha caducado. Escríbenos y lo actualizamos.');
  if (q.status !== 'aceptado') { q.status = 'aceptado'; q.acceptedAt = new Date().toISOString(); q.acceptedBy = 'cliente'; save(); }
  return publicQuote(q);
});

route('GET', '/api/pyro/quotes/:qid', (req, { qid }, url) => {
  const q = db.quotes.find((x) => x.id === qid);
  if (!q || !(isAdmin(req) || safeEqual(url.searchParams.get('t') || '', q.viewToken))) throw new HttpError(404, 'Presupuesto no encontrado.');
  return publicQuote(q);
});

// --- administración: sesión
route('POST', '/api/admin/setup', async (req) => {
  if (db.admin) throw new HttpError(409, 'El administrador ya está configurado.');
  const body = await readBody(req);
  const password = String(body.password || '');
  if (password.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres.');
  db.admin = hashPassword(password);
  save();
  return login(password);
});

function login(password) {
  const h = hashPassword(password, db.admin.salt);
  if (!safeEqual(h.hash, db.admin.hash)) throw new HttpError(403, 'Contraseña incorrecta.');
  const token = id(32);
  sessions.set(token, { expires: Date.now() + SESSION_MS });
  return { __headers: { 'Set-Cookie': sessionCookie(token, SESSION_MS / 1000) }, ok: true };
}

route('POST', '/api/admin/login', async (req) => {
  rateLimit(`login:${clientIp(req)}`, 8, 15 * 60_000);
  if (!db.admin) throw new HttpError(409, 'Primero crea la contraseña del administrador.');
  const body = await readBody(req);
  return login(String(body.password || ''));
});

route('POST', '/api/admin/logout', (req) => {
  sessions.delete(cookies(req).gs_admin);
  return { __headers: { 'Set-Cookie': sessionCookie('', 0) }, ok: true };
});

route('POST', '/api/admin/password', async (req) => {
  requireAdmin(req);
  const body = await readBody(req);
  if (!safeEqual(hashPassword(String(body.current || ''), db.admin.salt).hash, db.admin.hash)) throw new HttpError(403, 'La contraseña actual no es correcta.');
  if (String(body.password || '').length < 8) throw new HttpError(400, 'La nueva contraseña debe tener al menos 8 caracteres.');
  db.admin = hashPassword(String(body.password));
  save();
  return { ok: true };
});

// --- administración: eventos
route('GET', '/api/admin/events', (req) => {
  requireAdmin(req);
  return db.events.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map(adminEvent);
});

route('POST', '/api/admin/events', async (req) => {
  requireAdmin(req);
  const e = eventFromBody(await readBody(req));
  db.events.push(e);
  save();
  return adminEvent(e);
});

function adminFindEvent(eid) {
  const e = db.events.find((x) => x.id === eid);
  if (!e) throw new HttpError(404, 'Evento no encontrado.');
  return e;
}

route('PUT', '/api/admin/events/:eid', async (req, { eid }) => {
  requireAdmin(req);
  const current = adminFindEvent(eid);
  const updated = eventFromBody(await readBody(req), current);
  db.events[db.events.indexOf(current)] = updated;
  save();
  return adminEvent(updated);
});

route('DELETE', '/api/admin/events/:eid', (req, { eid }) => {
  requireAdmin(req);
  adminFindEvent(eid);
  db.events = db.events.filter((e) => e.id !== eid);
  db.requests = db.requests.filter((r) => r.eventId !== eid);
  save();
  return { ok: true };
});

route('POST', '/api/admin/events/:eid/new-link', (req, { eid }) => {
  requireAdmin(req);
  const e = adminFindEvent(eid);
  e.shareToken = id(12);
  save();
  return adminEvent(e);
});

route('GET', '/api/admin/events/:eid/requests', (req, { eid }) => {
  requireAdmin(req);
  adminFindEvent(eid);
  return db.requests.filter((r) => r.eventId === eid)
    .sort((a, b) => b.voters.length - a.voters.length || a.createdAt.localeCompare(b.createdAt))
    .map((r) => ({ ...guestRequestView(r), queuedAt: r.queuedAt, inPlaylist: r.inPlaylist }));
});

route('PATCH', '/api/admin/requests/:rid', async (req, { rid }) => {
  requireAdmin(req);
  const r = db.requests.find((x) => x.id === rid);
  if (!r) throw new HttpError(404, 'Petición no encontrada.');
  const body = await readBody(req);
  if (!['pending', 'approved', 'rejected', 'played'].includes(body.status)) throw new HttpError(400, 'Estado no válido.');
  const event = db.events.find((e) => e.id === r.eventId);
  r.status = body.status;
  let warning = '';
  if (r.status === 'approved' && event && event.autoQueue && db.spotifyAuth && r.track.uri && !r.queuedAt) {
    try { await queueRequest(r); } catch (err) { warning = `Aprobada, pero no se pudo añadir a la cola: ${err.message}`; }
  }
  save();
  return { ok: true, warning, queuedAt: r.queuedAt };
});

route('POST', '/api/admin/requests/:rid/queue', async (req, { rid }) => {
  requireAdmin(req);
  const r = db.requests.find((x) => x.id === rid);
  if (!r) throw new HttpError(404, 'Petición no encontrada.');
  await queueRequest(r);
  if (r.status === 'pending') r.status = 'approved';
  save();
  return { ok: true, queuedAt: r.queuedAt };
});

route('DELETE', '/api/admin/requests/:rid', (req, { rid }) => {
  requireAdmin(req);
  db.requests = db.requests.filter((r) => r.id !== rid);
  save();
  return { ok: true };
});

route('POST', '/api/admin/events/:eid/playlist', async (req, { eid }) => {
  requireAdmin(req);
  const e = adminFindEvent(eid);
  const pending = db.requests.filter((r) => r.eventId === eid && ['approved', 'played'].includes(r.status) && r.track.uri && !r.inPlaylist);
  try {
    if (!e.playlistId) {
      const p = await spotify.createPlaylist(`${e.name} · Guspira Events`, `Canciones pedidas por los invitados${e.date ? ` (${e.date})` : ''}.`);
      e.playlistId = p.id; e.playlistUrl = p.url;
      save();
    }
    if (pending.length) await spotify.addToPlaylist(e.playlistId, pending.map((r) => r.track.uri));
  } catch (err) {
    throw new HttpError(err.status === 409 ? 409 : 502, err.message);
  }
  pending.forEach((r) => { r.inPlaylist = true; });
  save();
  return { ok: true, added: pending.length, playlistUrl: e.playlistUrl };
});

// Exporta las peticiones de un evento a una playlist de Spotify. Las canciones escritas a mano se buscan en Spotify.
route('POST', '/api/admin/events/:eid/export', async (req, { eid }) => {
  requireAdmin(req);
  const e = adminFindEvent(eid);
  if (!db.spotifyAuth) throw new HttpError(409, 'Conecta tu cuenta de Spotify en Ajustes para exportar la lista.');
  const body = await readBody(req);
  const scope = ['approved', 'approved-pending', 'all'].includes(body.scope) ? body.scope : 'approved';
  const allowed = { approved: ['approved', 'played'], 'approved-pending': ['approved', 'played', 'pending'], all: ['approved', 'played', 'pending'] }[scope];
  const picked = db.requests.filter((r) => r.eventId === eid && allowed.includes(r.status))
    .sort((a, b) => (a.status === 'pending') - (b.status === 'pending') || b.voters.length - a.voters.length || a.createdAt.localeCompare(b.createdAt));
  const uris = [];
  const unmatched = [];
  for (const r of picked) {
    let uri = r.track.uri || r.matchedUri || '';
    if (!uri && body.matchManual !== false) {
      try {
        const found = await spotify.search(`${r.track.name} ${r.track.artists}`.trim(), db.settings.market);
        if (found[0]) { uri = found[0].uri; r.matchedUri = uri; r.matchedName = `${found[0].name} — ${found[0].artists}`; }
      } catch { /* se informa como no encontrada */ }
    }
    if (uri) { if (!uris.includes(uri)) uris.push(uri); } else unmatched.push(`${r.track.name}${r.track.artists ? ` — ${r.track.artists}` : ''}`);
  }
  if (!uris.length) throw new HttpError(400, 'No hay canciones que exportar con ese filtro.');
  const name = str(body.name, 100) || `${e.name} · Guspira Events`;
  const description = `Canciones pedidas por los invitados${e.date ? ` (${e.date})` : ''}. Creada con Guspira Events.`;
  let playlistId = '';
  let playlistUrl = '';
  try {
    if (body.mode === 'update' && e.playlistId) {
      await spotify.replacePlaylist(e.playlistId, uris);
      playlistId = e.playlistId; playlistUrl = e.playlistUrl;
    } else {
      const p = await spotify.createPlaylist(name, description, body.isPublic === true);
      await spotify.addToPlaylist(p.id, uris);
      playlistId = p.id; playlistUrl = p.url;
    }
  } catch (err) {
    throw new HttpError(err.status === 409 ? 409 : 502, `Spotify no ha podido crear la playlist: ${err.message}`);
  }
  e.playlistId = playlistId; e.playlistUrl = playlistUrl;
  for (const r of picked) if (r.track.uri || r.matchedUri) r.inPlaylist = true;
  save();
  return { ok: true, added: uris.length, unmatched, playlistUrl, total: picked.length };
});

// --- administración: Spotify
route('GET', '/api/admin/overview', (req) => {
  requireAdmin(req);
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
    agenda: agenda()
  };
});

// Agenda: eventos de canciones y presupuestos de pirotecnia con fecha (sin los descartados).
function agenda() {
  return [
    ...db.events.filter((e) => !e.archived && e.date).map((e) => ({ date: e.date, kind: 'event', title: e.name, detail: [e.time, e.venue].filter(Boolean).join(' · '), status: 'event', ref: e.id })),
    ...db.quotes.filter((q) => q.status !== 'descartado' && q.event && q.event.date).map((q) => ({ date: q.event.date, kind: 'quote', title: `${q.number} · ${q.customer.name}`, detail: [q.event.type, q.event.place].filter(Boolean).join(' · '), status: q.status, ref: q.id, total: q.total }))
  ].sort((a, b) => a.date.localeCompare(b.date));
}

// Disponibilidad orientativa para el formulario de pirotecnia: solo cuenta reservas aceptadas, sin datos personales.
route('GET', '/api/pyro/availability', (req, _p, url) => {
  rateLimit(`avail:${clientIp(req)}`, 60, 60_000);
  const date = str(url.searchParams.get('date'), 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Fecha no válida.');
  return { date, booked: db.quotes.filter((q) => q.status === 'aceptado' && q.event && q.event.date === date).length };
});

route('GET', '/api/admin/messages', (req) => { requireAdmin(req); return db.messages.slice().reverse(); });

route('PATCH', '/api/admin/messages/:mid', async (req, { mid }) => {
  requireAdmin(req);
  const m = db.messages.find((x) => x.id === mid);
  if (!m) throw new HttpError(404, 'Mensaje no encontrado.');
  const body = await readBody(req);
  if (body.status !== undefined) {
    if (!['nuevo', 'respondido', 'archivado'].includes(body.status)) throw new HttpError(400, 'Estado no válido.');
    m.status = body.status;
  }
  if (body.adminNotes !== undefined) m.adminNotes = str(body.adminNotes, 2000);
  save();
  return { ok: true };
});

route('DELETE', '/api/admin/messages/:mid', (req, { mid }) => {
  requireAdmin(req);
  db.messages = db.messages.filter((m) => m.id !== mid);
  save();
  return { ok: true };
});

route('GET', '/api/admin/company', (req) => { requireAdmin(req); return db.company; });

// --- galería de fotos (archivos en data/gallery) y opiniones de clientes
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const galleryView = (g) => ({ id: g.id, caption: g.caption, width: g.width, height: g.height, url: `/media/gallery/${g.file}` });
route('GET', '/api/gallery', () => db.gallery.map(galleryView));

route('POST', '/api/admin/gallery', async (req) => {
  requireAdmin(req);
  if (db.gallery.length >= 60) throw new HttpError(409, 'La galería admite como máximo 60 fotos. Borra alguna antes de subir más.');
  const body = await readBody(req, 4 * 1024 * 1024);
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ''));
  if (!m) throw new HttpError(400, 'Formato de imagen no válido. Usa JPG, PNG o WebP.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) throw new HttpError(413, 'La imagen es demasiado grande (máximo 3 MB).');
  const ok = m[1] === 'image/png' ? buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    : m[1] === 'image/jpeg' ? buf[0] === 0xff && buf[1] === 0xd8
      : buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
  if (!ok) throw new HttpError(400, 'El archivo no parece una imagen válida.');
  fs.mkdirSync(GALLERY_DIR, { recursive: true });
  const item = { id: id(), file: '', caption: str(body.caption, 140), width: Math.max(1, Math.min(10000, Math.round(Number(body.width)) || 1200)), height: Math.max(1, Math.min(10000, Math.round(Number(body.height)) || 800)), createdAt: new Date().toISOString() };
  item.file = `${item.id}.${IMAGE_TYPES[m[1]]}`;
  fs.writeFileSync(path.join(GALLERY_DIR, item.file), buf);
  db.gallery.push(item);
  save();
  return galleryView(item);
});

route('PATCH', '/api/admin/gallery/:gid', async (req, { gid }) => {
  requireAdmin(req);
  const g = db.gallery.find((x) => x.id === gid);
  if (!g) throw new HttpError(404, 'Foto no encontrada.');
  const body = await readBody(req);
  if (body.caption !== undefined) g.caption = str(body.caption, 140);
  save();
  return galleryView(g);
});

route('POST', '/api/admin/gallery/order', async (req) => {
  requireAdmin(req);
  const body = await readBody(req);
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  db.gallery.sort((a, b) => (ids.indexOf(a.id) + 1 || 1e9) - (ids.indexOf(b.id) + 1 || 1e9));
  save();
  return db.gallery.map(galleryView);
});

route('DELETE', '/api/admin/gallery/:gid', (req, { gid }) => {
  requireAdmin(req);
  const g = db.gallery.find((x) => x.id === gid);
  if (!g) throw new HttpError(404, 'Foto no encontrada.');
  db.gallery = db.gallery.filter((x) => x.id !== gid);
  try { fs.unlinkSync(path.join(GALLERY_DIR, g.file)); } catch { /* ya no existía */ }
  save();
  return { ok: true };
});

const testimonialFromBody = (body, current = {}) => {
  const t = { ...current };
  for (const [k, max] of [['name', 80], ['event', 80], ['text', 600]]) if (body[k] !== undefined) t[k] = str(body[k], max);
  if (body.rating !== undefined) t.rating = Math.max(1, Math.min(5, Math.round(Number(body.rating)) || 5));
  t.rating ||= 5;
  if (!t.name || !t.text) throw new HttpError(400, 'La opinión necesita el nombre y el texto.');
  return t;
};
route('GET', '/api/testimonials', () => db.testimonials.map(({ id: tid, name, event, text, rating }) => ({ id: tid, name, event, text, rating })));
route('POST', '/api/admin/testimonials', async (req) => {
  requireAdmin(req);
  const t = testimonialFromBody(await readBody(req), { id: id(), createdAt: new Date().toISOString() });
  db.testimonials.push(t);
  save();
  return t;
});
route('PUT', '/api/admin/testimonials/:tid', async (req, { tid }) => {
  requireAdmin(req);
  const i = db.testimonials.findIndex((x) => x.id === tid);
  if (i < 0) throw new HttpError(404, 'Opinión no encontrada.');
  db.testimonials[i] = testimonialFromBody(await readBody(req), db.testimonials[i]);
  save();
  return db.testimonials[i];
});
route('DELETE', '/api/admin/testimonials/:tid', (req, { tid }) => {
  requireAdmin(req);
  db.testimonials = db.testimonials.filter((x) => x.id !== tid);
  save();
  return { ok: true };
});

route('PUT', '/api/admin/company', async (req) => {
  requireAdmin(req);
  const body = await readBody(req);
  for (const [k, max] of Object.entries(COMPANY_FIELDS)) if (body[k] !== undefined) db.company[k] = str(body[k], max);
  if (!db.company.name) db.company.name = 'Guspira Events';
  save();
  return db.company;
});

route('GET', '/api/admin/settings', (req) => {
  requireAdmin(req);
  return {
    spotifyClientId: env.SPOTIFY_CLIENT_ID || db.settings.spotifyClientId,
    hasSecret: spotify.hasSecret(),
    fromEnv: Boolean(env.SPOTIFY_CLIENT_ID),
    market: db.settings.market,
    redirectUri: SPOTIFY_REDIRECT,
    connected: db.spotifyAuth ? db.spotifyAuth.user : null
  };
});

route('PUT', '/api/admin/settings', async (req) => {
  requireAdmin(req);
  const body = await readBody(req);
  if (body.spotifyClientId !== undefined && !env.SPOTIFY_CLIENT_ID) {
    const cid = str(body.spotifyClientId, 64).replace(/\s+/g, '');
    if (cid && !/^[0-9a-zA-Z]{32}$/.test(cid)) throw new HttpError(400, 'El Client ID de Spotify tiene 32 letras y números. Cópialo de nuevo desde Spotify for Developers.');
    // Si cambia la app, la cuenta conectada deja de valer.
    if (cid !== db.settings.spotifyClientId) db.spotifyAuth = null;
    db.settings.spotifyClientId = cid;
  }
  delete db.settings.spotifyClientSecret;
  if (body.market) db.settings.market = str(body.market, 2).toUpperCase();
  spotify.resetAppToken();
  save();
  return { ok: true };
});

route('GET', '/api/admin/spotify/connect', (req) => {
  requireAdmin(req);
  if (!spotify.configured()) throw new HttpError(409, 'Guarda primero el Client ID de tu app de Spotify.');
  const state = id(16);
  // Sin Client Secret se usa PKCE: el verificador se guarda aquí y nunca sale del servidor.
  const pkce = spotify.hasSecret() ? null : spotify.pkcePair();
  oauthStates.set(state, { expires: Date.now() + 10 * 60_000, verifier: pkce ? pkce.verifier : '' });
  return { url: spotify.authorizeUrl(SPOTIFY_REDIRECT, state, pkce ? pkce.challenge : '') };
});

route('GET', '/api/spotify/callback', async (req, _p, url) => {
  const state = url.searchParams.get('state') || '';
  const back = (msg) => ({ __redirect: `/admin?spotify=${encodeURIComponent(msg)}` });
  const pending = oauthStates.get(state);
  if (!pending || pending.expires < Date.now()) return back('La conexión con Spotify caducó. Inténtalo de nuevo.');
  oauthStates.delete(state);
  if (!isAdmin(req)) return back('Inicia sesión como administrador antes de conectar Spotify.');
  if (url.searchParams.get('error')) return back('Has cancelado la conexión con Spotify.');
  try {
    await spotify.exchangeCode(url.searchParams.get('code') || '', SPOTIFY_REDIRECT, pending.verifier);
    return back('ok');
  } catch (err) {
    return back(`Spotify rechazó la conexión: ${err.message}`);
  }
});

route('POST', '/api/admin/spotify/disconnect', (req) => {
  requireAdmin(req);
  db.spotifyAuth = null;
  save();
  return { ok: true };
});

route('GET', '/api/admin/spotify/now', async (req) => {
  requireAdmin(req);
  if (!db.spotifyAuth) return { active: false, connected: false };
  try { return { connected: true, ...(await spotify.nowPlaying()) }; } catch (err) { return { connected: true, active: false, error: err.message }; }
});

// --- administración: pirotecnia
route('GET', '/api/admin/pyro/catalog', (req) => { requireAdmin(req); return db.pyro; });

route('PUT', '/api/admin/pyro/catalog', async (req) => {
  requireAdmin(req);
  db.pyro = validateCatalog(await readBody(req, 256 * 1024));
  save();
  return db.pyro;
});

route('POST', '/api/admin/pyro/catalog/reset', (req) => {
  requireAdmin(req);
  db.pyro = defaults.pyroCatalog();
  save();
  return db.pyro;
});

route('GET', '/api/admin/quotes', (req) => {
  requireAdmin(req);
  return db.quotes.slice().reverse().map((q) => ({ ...publicQuote(q), adminNotes: q.adminNotes }));
});

route('PATCH', '/api/admin/quotes/:qid', async (req, { qid }) => {
  requireAdmin(req);
  const q = db.quotes.find((x) => x.id === qid);
  if (!q) throw new HttpError(404, 'Presupuesto no encontrado.');
  const body = await readBody(req);
  if (body.status !== undefined) {
    if (!['nuevo', 'contactado', 'aceptado', 'descartado'].includes(body.status)) throw new HttpError(400, 'Estado no válido.');
    q.status = body.status;
  }
  if (body.adminNotes !== undefined) q.adminNotes = str(body.adminNotes, 2000);
  save();
  return { ok: true };
});

route('DELETE', '/api/admin/quotes/:qid', (req, { qid }) => {
  requireAdmin(req);
  db.quotes = db.quotes.filter((q) => q.id !== qid);
  save();
  return { ok: true };
});

// ---------------------------------------------------------------- ficheros estáticos
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json; charset=utf-8', '.ico': 'image/x-icon' };
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob: https://i.scdn.co https://*.spotifycdn.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};

function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(pathname)) { res.writeHead(404, SECURITY_HEADERS); return res.end('No encontrado'); }
    file = path.join(PUBLIC_DIR, 'index.html'); // Rutas de la aplicación (SPA)
  }
  const ext = path.extname(file);
  const stat = fs.statSync(file);
  const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
  const headers = {
    ...SECURITY_HEADERS, ETag: etag, Vary: 'Accept-Encoding',
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : ['.webp', '.png', '.jpg'].includes(ext) ? 'public, max-age=86400' : 'public, max-age=300'
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  // Comprime texto (HTML, CSS, JS, manifiesto) cuando el navegador lo admite.
  const compressible = ['.html', '.js', '.css', '.svg', '.webmanifest'].includes(ext);
  if (compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file).pipe(zlib.createGzip({ level: 6 })).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------- servidor
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_URL);
  if (url.pathname.startsWith('/media/gallery/')) {
    const name = path.basename(decodeURIComponent(url.pathname));
    const entry = /^[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(name) && db.gallery.find((g) => g.file === name);
    const file = entry && path.join(GALLERY_DIR, name);
    if (!file || !fs.existsSync(file)) { res.writeHead(404, SECURITY_HEADERS); return res.end('No encontrado'); }
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[path.extname(name)] || 'image/jpeg', 'Cache-Control': 'public, max-age=604800, immutable' });
    return fs.createReadStream(file).pipe(res);
  }
  if (!url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, url.pathname);
  }
  try {
    // Protección CSRF: las mutaciones deben llegar como JSON desde la propia web.
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-requested-with'] !== 'guspira') throw new HttpError(403, 'Petición no permitida.');
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const result = await r.handler(req, params, url);
      if (result && result.__redirect) { res.writeHead(302, { Location: result.__redirect }); return res.end(); }
      const headers = (result && result.__headers) || {};
      if (result && result.__headers) delete result.__headers;
      return send(res, 200, result, { ...SECURITY_HEADERS, ...headers });
    }
    throw new HttpError(404, 'Ruta no encontrada.');
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    const status = err instanceof HttpError ? err.status : 500;
    send(res, status, { error: err instanceof HttpError ? err.message : 'Error interno del servidor.' }, SECURITY_HEADERS);
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Guspira Events en ${PUBLIC_URL} (escuchando en ${HOST}:${PORT})`);
    if (!db.admin) console.log(`Abre ${PUBLIC_URL}/admin para crear la contraseña del administrador.`);
  });
}

module.exports = { server };
