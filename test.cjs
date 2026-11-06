// Pruebas de extremo a extremo de la API con un Spotify simulado. Ejecuta: node test.cjs
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

const queued = [];
const playlists = {};
const tokenCalls = [];
let playlistCount = 0;
function mockSpotify() {
  const track = (id, name, explicit = false) => ({ id, uri: `spotify:track:${id}`, name, explicit, duration_ms: 200000, artists: [{ name: 'Artista Demo' }], album: { name: 'Álbum', images: [{ url: 'https://i.scdn.co/image/x', width: 300 }] }, external_urls: { spotify: `https://open.spotify.com/track/${id}` } });
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const json = (s, d) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(d === undefined ? '' : JSON.stringify(d)); };
      if (url.pathname === '/api/token') {
        const p = new URLSearchParams(body);
        tokenCalls.push({ grant: p.get('grant_type'), auth: req.headers.authorization || '', clientId: p.get('client_id'), verifier: p.get('code_verifier') });
        if (p.get('grant_type') === 'client_credentials' && !req.headers.authorization) return json(401, { error: 'invalid_client' });
        if (p.get('grant_type') === 'authorization_code' && (p.get('code') !== 'good' || (!req.headers.authorization && !p.get('code_verifier')))) return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: 'tok', refresh_token: 'ref', expires_in: 3600 });
      }
      if (url.pathname === '/v1/search') {
        const q = (url.searchParams.get('q') || '').toLowerCase();
        if (q.includes('bailando')) return json(200, { tracks: { items: [track('t5', 'Bailando')] } });
        if (q.includes('inexistente')) return json(200, { tracks: { items: [] } });
        return json(200, { tracks: { items: [track('t1', 'Perfect'), track('t2', 'Canción explícita', true)] } });
      }
      if (url.pathname.startsWith('/v1/tracks/')) {
        const id = url.pathname.split('/').pop();
        return json(200, id === 't2' ? track('t2', 'Canción explícita', true) : track(id, 'Perfect'));
      }
      if (url.pathname === '/v1/me') return json(200, { id: 'dj', display_name: 'DJ Guspira', product: 'premium' });
      if (url.pathname === '/v1/me/player/queue') { queued.push(url.searchParams.get('uri')); res.writeHead(204); return res.end(); }
      if (url.pathname === '/v1/me/player') return json(200, { is_playing: true, device: { name: 'Portátil DJ' }, item: { type: 'track', ...track('t9', 'Sonando') }, progress_ms: 1000 });
      if (url.pathname === '/v1/me/playlists' && req.method === 'POST') { const pid = `pl${++playlistCount}`; playlists[pid] = { name: JSON.parse(body).name, public: JSON.parse(body).public, uris: [] }; return json(201, { id: pid, external_urls: { spotify: `https://open.spotify.com/playlist/${pid}` } }); }
      const m = url.pathname.match(/^\/v1\/playlists\/(\w+)\/items$/);
      if (m && req.method === 'POST') { playlists[m[1]].uris.push(...JSON.parse(body).uris); return json(201, { snapshot_id: 's' }); }
      if (m && req.method === 'PUT') { playlists[m[1]].uris = [...JSON.parse(body).uris]; return json(200, { snapshot_id: 's' }); }
      json(404, { error: { message: 'not found' } });
    });
  });
}

(async () => {
  const mock = mockSpotify();
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const mockBase = `http://127.0.0.1:${mock.address().port}`;
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guspira-test-'));
  Object.assign(process.env, {
    PORT: String(port), PUBLIC_URL: `http://127.0.0.1:${port}`, GUSPIRA_DATA_DIR: dataDir,
    SPOTIFY_API_BASE: `${mockBase}/v1`, SPOTIFY_ACCOUNTS_BASE: mockBase, SPOTIFY_CLIENT_ID: '', SPOTIFY_CLIENT_SECRET: '', GUSPIRA_ADMIN_PASSWORD: ''
  });
  const { server } = require('./server.cjs');
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const base = `http://127.0.0.1:${port}`;

  let adminCookie = '';
  async function call(method, p, body, { admin = false, headers = {}, raw = false } = {}) {
    const res = await fetch(base + p, {
      method, redirect: 'manual',
      headers: { 'X-Requested-With': 'guspira', 'X-Guest-Id': 'invitado-1234', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(admin ? { Cookie: adminCookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    if (raw) return res;
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data, headers: res.headers };
  }
  let passed = 0;
  const step = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };

  try {
    await step('sirve la web y las rutas de la aplicación', async () => {
      for (const p of ['/', '/pirotecnia', '/e/lo-que-sea', '/admin']) {
        const res = await call('GET', p, null, { raw: true });
        assert.equal(res.status, 200);
        assert.match(await res.text(), /<main id="app"/);
      }
      assert.equal((await call('GET', '/../server.cjs', null, { raw: true })).status, 404);
      const css = await fetch(base + '/styles.css', { headers: { 'Accept-Encoding': 'gzip' } });
      assert.equal(css.headers.get('content-encoding'), 'gzip');
      const etag = css.headers.get('etag');
      assert.ok(etag);
      assert.equal((await fetch(base + '/styles.css', { headers: { 'If-None-Match': etag } })).status, 304);
      assert.equal((await call('GET', '/no-existe.js', null, { raw: true })).status, 404);
    });

    await step('configura el administrador y protege el panel', async () => {
      assert.equal((await call('GET', '/api/admin/events')).status, 401);
      assert.equal((await call('POST', '/api/admin/setup', { password: 'corta' })).status, 400);
      const r = await call('POST', '/api/admin/setup', { password: 'contraseña-segura' });
      assert.equal(r.status, 200);
      adminCookie = r.headers.get('set-cookie').split(';')[0];
      assert.equal((await call('POST', '/api/admin/setup', { password: 'otra-contraseña' })).status, 409);
      assert.equal((await call('POST', '/api/admin/login', { password: 'mala' })).status, 403);
      assert.equal((await call('GET', '/api/status', null, { admin: true })).data.admin, true);
      const csrf = await fetch(base + '/api/admin/events', { method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'application/json' }, body: '{"name":"x"}' });
      assert.equal(csrf.status, 403, 'las mutaciones sin cabecera propia se rechazan');
    });

    let publicOpen, publicCode, privateEv, privateCode;
    await step('crea eventos públicos, con código y privados', async () => {
      assert.equal((await call('POST', '/api/admin/events', { name: 'Sin código', access: 'code' }, { admin: true })).status, 400);
      publicOpen = (await call('POST', '/api/admin/events', { name: 'Boda de Lucía y Marcos', type: 'Boda', date: '2099-06-20' }, { admin: true })).data;
      publicCode = (await call('POST', '/api/admin/events', { name: 'Babyshower Ana', type: 'Babyshower', access: 'code', code: 'Bebe2099', date: '2099-05-01', allowExplicit: false }, { admin: true })).data;
      privateEv = (await call('POST', '/api/admin/events', { name: 'Fiesta privada', visibility: 'private', maxPerGuest: 1, autoQueue: true }, { admin: true })).data;
      privateCode = (await call('POST', '/api/admin/events', { name: 'Fiesta privada', visibility: 'private', access: 'code', code: 'XYZ' }, { admin: true })).data;
      assert.equal(publicOpen.slug, 'boda-de-lucia-y-marcos');
      assert.equal(privateCode.slug, 'fiesta-privada-2');
      assert.match(privateEv.link, /\?k=/);
      const list = (await call('GET', '/api/events')).data;
      assert.deepEqual(list.map((e) => e.slug), ['babyshower-ana', 'boda-de-lucia-y-marcos'], 'solo eventos públicos, ordenados por fecha');
      assert.equal(list[0].locked, true);
      assert.ok(!JSON.stringify(list).includes('Bebe2099'), 'el código no se filtra');
      assert.ok(!JSON.stringify(list).includes(privateEv.shareToken));
    });

    await step('controla el acceso de invitados', async () => {
      const open = (await call('GET', `/api/events/${publicOpen.slug}`)).data;
      assert.equal(open.authorized, true);
      const locked = (await call('GET', `/api/events/${publicCode.slug}`)).data;
      assert.equal(locked.authorized, false);
      assert.equal(locked.requests, undefined);
      assert.equal((await call('POST', `/api/events/${publicCode.slug}/requests`, { title: 'x' })).status, 401);
      assert.equal((await call('POST', `/api/events/${publicCode.slug}/unlock`, { code: 'mal' })).status, 403);
      const tok = (await call('POST', `/api/events/${publicCode.slug}/unlock`, { code: 'bebe2099' })).data.token;
      assert.ok(tok);
      assert.equal((await call('GET', `/api/events/${publicCode.slug}`, null, { headers: { 'X-Guest-Token': tok } })).data.authorized, true);
      assert.equal((await call('GET', `/api/events/${privateEv.slug}`)).status, 404, 'privado sin enlace');
      assert.equal((await call('GET', `/api/events/${privateEv.slug}?k=incorrecto`)).status, 404);
      assert.equal((await call('GET', `/api/events/${privateEv.slug}?k=${privateEv.shareToken}`)).data.authorized, true);
      assert.equal((await call('GET', `/api/events/${privateCode.slug}?k=${privateCode.shareToken}`)).data.authorized, false, 'privado con código');
      assert.equal((await call('POST', `/api/events/${privateCode.slug}/unlock`, { code: 'XYZ' })).status, 404, 'sin enlace no se desbloquea');
      const t2 = (await call('POST', `/api/events/${privateCode.slug}/unlock`, { code: 'xyz', k: privateCode.shareToken })).data.token;
      assert.equal((await call('GET', `/api/events/${privateCode.slug}`, null, { headers: { 'X-Guest-Token': t2 } })).data.authorized, true);
      // Al cambiar el código, los accesos anteriores dejan de valer.
      await call('PUT', `/api/admin/events/${privateCode.id}`, { code: 'NUEVO' }, { admin: true });
      assert.equal((await call('GET', `/api/events/${privateCode.slug}`, null, { headers: { 'X-Guest-Token': t2 } })).status, 404);
      // Al regenerar el enlace, el antiguo deja de funcionar.
      const renewed = (await call('POST', `/api/admin/events/${privateEv.id}/new-link`, {}, { admin: true })).data;
      assert.equal((await call('GET', `/api/events/${privateEv.slug}?k=${privateEv.shareToken}`)).status, 404);
      privateEv = renewed;
    });

    await step('recibe peticiones a mano, evita duplicados y limita por invitado', async () => {
      const p = `/api/events/${publicOpen.slug}/requests`;
      assert.equal((await call('POST', p, { title: '' })).status, 400);
      const a = (await call('POST', p, { title: 'Bailando', artist: 'Enrique Iglesias', guestName: 'Tía Carmen', message: '¡Por los novios!' })).data;
      assert.equal(a.duplicate, false);
      const b = (await call('POST', p, { title: 'bailando', artist: 'enrique  iglesias' }, { headers: { 'X-Guest-Id': 'invitado-5678' } })).data;
      assert.equal(b.duplicate, true);
      assert.equal(b.request.votes, 2);
      const v = (await call('POST', `${p}/${a.request.id}/vote`, {})).data;
      assert.equal(v.votes, 1, 'votar de nuevo quita el voto');
      const pv = `/api/events/${privateEv.slug}/requests?k=${privateEv.shareToken}`;
      assert.equal((await call('POST', pv, { title: 'Una' })).status, 200);
      assert.equal((await call('POST', pv, { title: 'Dos' })).status, 409, 'máximo 1 por invitado');
    });

    await step('conecta Spotify solo con el Client ID (PKCE) y busca con la cuenta conectada', async () => {
      assert.equal((await call('GET', `/api/events/${publicOpen.slug}/search?q=perfect`)).status, 503, 'sin Spotify configurado');
      assert.equal((await call('PUT', '/api/admin/settings', { spotifyClientId: 'corto' }, { admin: true })).status, 400, 'Client ID con formato incorrecto');
      await call('PUT', '/api/admin/settings', { spotifyClientId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', spotifyClientSecret: 'no-se-usa' }, { admin: true });
      const s = (await call('GET', '/api/admin/settings', null, { admin: true })).data;
      assert.equal(s.hasSecret, false, 'no se guarda ningún Client Secret');
      assert.equal(s.spotifyClientId, 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
      assert.equal((await call('GET', `/api/events/${publicOpen.slug}/search?q=perfect`)).status, 503, 'sin cuenta conectada todavía no se busca');
      assert.equal((await call('GET', `/api/events/${publicOpen.slug}`)).data.spotify, false);

      const { url } = (await call('GET', '/api/admin/spotify/connect', null, { admin: true })).data;
      const au = new URL(url);
      assert.equal(au.searchParams.get('code_challenge_method'), 'S256', 'usa PKCE');
      assert.match(au.searchParams.get('code_challenge'), /^[\w-]{43}$/);
      assert.equal(au.searchParams.get('client_id'), 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
      assert.match(url, /redirect_uri=http%3A%2F%2F127\.0\.0\.1/);
      const bad = await call('GET', `/api/spotify/callback?state=otro&code=good`, null, { admin: true, raw: true });
      assert.match(bad.headers.get('location'), /caduc/);
      const cb = await call('GET', `/api/spotify/callback?state=${au.searchParams.get('state')}&code=good`, null, { admin: true, raw: true });
      assert.equal(cb.headers.get('location'), '/admin?spotify=ok');
      const exchange = tokenCalls.find((t) => t.grant === 'authorization_code');
      assert.equal(exchange.auth, '', 'sin cabecera de Client Secret');
      assert.equal(exchange.clientId, 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
      assert.ok(exchange.verifier && exchange.verifier.length >= 43, 'envía el code_verifier');
      assert.equal((await call('GET', '/api/admin/settings', null, { admin: true })).data.connected.name, 'DJ Guspira');

      // Con la cuenta conectada, los invitados ya pueden buscar.
      assert.equal((await call('GET', `/api/events/${publicOpen.slug}`)).data.spotify, true);
      assert.equal((await call('GET', `/api/events/${publicOpen.slug}/search?q=perfect`)).data.length, 2);
      assert.ok(!tokenCalls.some((t) => t.grant === 'client_credentials'), 'nunca pide credenciales de la app');
      const tok = (await call('POST', `/api/events/${publicCode.slug}/unlock`, { code: 'BEBE2099' })).data.token;
      const filtered = (await call('GET', `/api/events/${publicCode.slug}/search?q=perfect`, null, { headers: { 'X-Guest-Token': tok } })).data;
      assert.deepEqual(filtered.map((t) => t.id), ['t1']);
      assert.equal((await call('POST', `/api/events/${publicCode.slug}/requests`, { trackId: 't2' }, { headers: { 'X-Guest-Token': tok } })).status, 400);
      const ok = await call('POST', `/api/events/${publicOpen.slug}/requests`, { trackId: 't1', guestName: 'Pablo' });
      assert.equal(ok.data.request.track.uri, 'spotify:track:t1');
    });

    await step('gestiona la cola y exporta la lista a una playlist de Spotify', async () => {
      assert.equal((await call('GET', '/api/admin/spotify/now', null, { admin: true })).data.track.name, 'Sonando');
      const guestNow = (await call('GET', `/api/events/${publicOpen.slug}/now`)).data;
      assert.equal(guestNow.track.name, 'Sonando', 'los invitados ven lo que suena');
      assert.equal(guestNow.device, undefined, 'sin datos del dispositivo del DJ');
      assert.equal((await call('GET', `/api/events/${publicCode.slug}/now`)).status, 401, 'requiere acceso al evento');
      await call('PUT', `/api/admin/events/${publicOpen.id}`, { showNowPlaying: false }, { admin: true });
      assert.equal((await call('GET', `/api/events/${publicOpen.slug}/now`)).data.active, false);

      const reqs = (await call('GET', `/api/admin/events/${publicOpen.id}/requests`, null, { admin: true })).data;
      const spotifyReq = reqs.find((r) => r.track.uri);
      const manual = reqs.find((r) => !r.track.uri);
      assert.equal((await call('POST', `/api/admin/requests/${manual.id}/queue`, {}, { admin: true })).status, 400);
      assert.equal((await call('POST', `/api/admin/requests/${spotifyReq.id}/queue`, {}, { admin: true })).status, 200);
      assert.deepEqual(queued, ['spotify:track:t1']);
      assert.equal((await call('PATCH', `/api/admin/requests/${manual.id}`, { status: 'played' }, { admin: true })).status, 200);
      assert.equal((await call('PATCH', `/api/admin/requests/${manual.id}`, { status: 'otro' }, { admin: true })).status, 400);

      // Exportar: «Bailando» se escribió a mano y se encuentra en Spotify automáticamente.
      const exp = (await call('POST', `/api/admin/events/${publicOpen.id}/export`, { scope: 'approved', name: 'Boda L&M', isPublic: false }, { admin: true })).data;
      assert.equal(exp.added, 2);
      assert.deepEqual(exp.unmatched, []);
      assert.equal(playlists.pl1.name, 'Boda L&M');
      assert.equal(playlists.pl1.public, false);
      assert.deepEqual(playlists.pl1.uris.sort(), ['spotify:track:t1', 'spotify:track:t5']);
      // Una petición a mano que no existe en Spotify se informa y el resto se exporta.
      await call('POST', `/api/events/${publicOpen.slug}/requests`, { title: 'Canción inexistente', artist: 'Nadie' }, { headers: { 'X-Guest-Id': 'invitado-4444' } });
      const upd = (await call('POST', `/api/admin/events/${publicOpen.id}/export`, { scope: 'all', mode: 'update' }, { admin: true })).data;
      assert.equal(upd.playlistUrl, 'https://open.spotify.com/playlist/pl1', 'actualiza la misma playlist');
      assert.deepEqual(upd.unmatched, ['Canción inexistente — Nadie']);
      assert.equal(playlists.pl1.uris.length, 2, 'sustituye el contenido sin duplicar');
      assert.equal(playlistCount, 1);
      const fresh = (await call('POST', `/api/admin/events/${publicOpen.id}/export`, { scope: 'approved', mode: 'new', isPublic: true }, { admin: true })).data;
      assert.equal(fresh.playlistUrl, 'https://open.spotify.com/playlist/pl2');
      assert.equal(playlists.pl2.public, true);
      assert.equal((await call('POST', `/api/admin/events/${privateCode.id}/export`, {}, { admin: true })).status, 400, 'evento sin canciones');
      assert.equal((await call('POST', `/api/admin/events/${publicOpen.id}/playlist`, {}, { admin: true })).status, 200, 'el botón antiguo sigue funcionando');

      // Aprobación con cola automática.
      const priv = (await call('GET', `/api/admin/events/${privateEv.id}/requests`, null, { admin: true })).data;
      const r2 = await call('POST', `/api/events/${privateEv.slug}/requests?k=${privateEv.shareToken}`, { trackId: 't7' }, { headers: { 'X-Guest-Id': 'invitado-9999' } });
      assert.equal(r2.status, 200);
      const res = (await call('PATCH', `/api/admin/requests/${r2.data.request.id}`, { status: 'approved' }, { admin: true })).data;
      assert.ok(res.queuedAt);
      assert.equal(queued.at(-1), 'spotify:track:t7');
      assert.equal(priv.length, 1);

      // Los invitados ven el estado y las rechazadas desaparecen de su lista.
      await call('PATCH', `/api/admin/requests/${spotifyReq.id}`, { status: 'rejected' }, { admin: true });
      const guestView = (await call('GET', `/api/events/${publicOpen.slug}`)).data;
      assert.ok(guestView.requests.every((r) => r.status !== 'rejected'));
      assert.ok(guestView.requests.every((r) => !('guestId' in r) && !('voters' in r)), 'no se exponen identificadores de otros invitados');
    });

    await step('calcula y guarda presupuestos de pirotecnia con precios del servidor', async () => {
      const cat = (await call('GET', '/api/pyro/catalog')).data;
      assert.ok(['vertical', 'abanico', 'cascada'].every((k) => cat.items.some((i) => i.kind === k)));
      const lines = [
        { itemId: 'vertical', qty: 4, colorId: 'rosa', durationId: '60', unitPrice: 0.01 },
        { itemId: 'cascada', qty: 3, colorId: 'dorado', durationId: '30' }
      ];
      const est = (await call('POST', '/api/pyro/estimate', { lines, distanceKm: 50 })).data;
      // vertical: (45 + 8) * 1.6 = 84.8 → 339.2 ; cascada: 95 * 3 = 285 → 624.2 (5% dto)
      assert.equal(est.lines[0].unitPrice, 84.8);
      assert.equal(est.itemsTotal, 624.2);
      assert.equal(est.discount, 31.21);
      assert.equal(est.travel, 12);
      assert.equal(est.base, 624.2 - 31.21 + 150 + 12);
      assert.equal(est.total, Math.round((est.base * 1.21) * 100) / 100);
      assert.equal((await call('POST', '/api/pyro/quotes', { lines, customer: { name: 'Ana' }, event: { date: '2099-01-01' }, privacy: true })).status, 400, 'sin contacto');
      assert.equal((await call('POST', '/api/pyro/quotes', { lines: [{ itemId: 'vertical', qty: 999 }], customer: { name: 'Ana', phone: '600123123' }, event: { date: '2099-01-01' }, privacy: true })).status, 400);
      assert.equal((await call('POST', '/api/pyro/quotes', { lines, customer: { name: 'Ana', email: 'ana@example.com' }, event: { date: '2099-01-01' } })).status, 400, 'sin aceptar la privacidad');
      const q = (await call('POST', '/api/pyro/quotes', { lines, distanceKm: 50, privacy: true, customer: { name: 'Ana', email: 'ana@example.com' }, event: { type: 'Boda', date: '2099-01-01', place: 'Finca' } })).data;
      assert.match(q.number, /^GP-\d{4}-0001$/);
      assert.equal(q.total, est.total);
      assert.equal(q.viewToken, undefined);
      const t = new URL(q.link).searchParams.get('t');
      assert.equal((await call('GET', `/api/pyro/quotes/${q.id}?t=${t}`)).data.number, q.number);
      assert.equal((await call('GET', `/api/pyro/quotes/${q.id}?t=mal`)).status, 404);
      assert.equal((await call('POST', `/api/pyro/quotes/${q.id}/accept`, { t: 'mal' })).status, 404);
      const accepted = (await call('POST', `/api/pyro/quotes/${q.id}/accept`, { t })).data;
      assert.equal(accepted.status, 'aceptado');
      assert.ok(accepted.acceptedAt);
      const list = (await call('GET', '/api/admin/quotes', null, { admin: true })).data;
      assert.equal(list.length, 1);
      assert.equal((await call('PATCH', `/api/admin/quotes/${q.id}`, { status: 'aceptado', adminNotes: 'Llamar el lunes' }, { admin: true })).status, 200);
    });

    await step('recibe mensajes de contacto y muestra el resumen del panel', async () => {
      assert.equal((await call('POST', '/api/contact', { name: 'Marta', email: 'marta@example.com', message: 'Hola' })).status, 400, 'sin privacidad');
      assert.equal((await call('POST', '/api/contact', { name: 'Marta', message: 'Hola', privacy: true })).status, 400, 'sin contacto');
      assert.equal((await call('POST', '/api/contact', { name: 'Marta', phone: '600 111 222', eventType: 'Boda', services: ['Pirotecnia', 'Música'], message: 'Boda en junio', privacy: true })).status, 200);
      const msgs = (await call('GET', '/api/admin/messages', null, { admin: true })).data;
      assert.equal(msgs.length, 1);
      assert.deepEqual(msgs[0].services, ['Pirotecnia', 'Música']);
      assert.equal((await call('PATCH', `/api/admin/messages/${msgs[0].id}`, { status: 'respondido' }, { admin: true })).status, 200);
      assert.equal((await call('GET', '/api/admin/messages')).status, 401);
      const ov = (await call('GET', '/api/admin/overview', null, { admin: true })).data;
      assert.equal(ov.counts.upcomingEvents, 2);
      assert.ok(ov.counts.pendingRequests >= 1);
      assert.ok(ov.money.accepted > 0);
      assert.ok(ov.activity.length > 0);
      assert.ok(ov.agenda.some((x) => x.kind === 'event') && ov.agenda.some((x) => x.kind === 'quote'), 'agenda con eventos y presupuestos');
      assert.equal((await call('GET', '/api/pyro/availability?date=2099-01-01')).data.booked, 1, 'la reserva aceptada ocupa la fecha');
      assert.equal((await call('GET', '/api/pyro/availability?date=2099-01-02')).data.booked, 0);
      assert.equal((await call('GET', '/api/pyro/availability?date=mal')).status, 400);
      // Datos de la empresa
      assert.equal((await call('GET', '/api/site')).data.name, 'Guspira Events');
      await call('PUT', '/api/admin/company', { phone: '+34 600 000 000', email: 'hola@guspira.example', name: '' }, { admin: true });
      const site = (await call('GET', '/api/site')).data;
      assert.equal(site.phone, '+34 600 000 000');
      assert.equal(site.name, 'Guspira Events', 'el nombre nunca queda vacío');
    });

    await step('gestiona la galería de fotos y las opiniones', async () => {
      // PNG de 1×1 píxel
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
      assert.equal((await call('POST', '/api/admin/gallery', { image: png })).status, 401);
      assert.equal((await call('POST', '/api/admin/gallery', { image: 'data:image/png;base64,QUJDRA==' }, { admin: true })).status, 400, 'contenido que no es imagen');
      assert.equal((await call('POST', '/api/admin/gallery', { image: 'data:text/html;base64,PGgxPg==' }, { admin: true })).status, 400);
      const a = (await call('POST', '/api/admin/gallery', { image: png, caption: 'Primer baile', width: 1, height: 1 }, { admin: true })).data;
      const b2 = (await call('POST', '/api/admin/gallery', { image: png, caption: 'Cascada', width: 1, height: 1 }, { admin: true })).data;
      assert.match(a.url, /^\/media\/gallery\/[\w-]+\.png$/);
      const img = await fetch(base + a.url);
      assert.equal(img.status, 200);
      assert.equal(img.headers.get('content-type'), 'image/png');
      assert.equal((await fetch(base + '/media/gallery/..%2Fdb.json')).status, 404, 'no se puede salir de la carpeta');
      await call('POST', '/api/admin/gallery/order', { ids: [b2.id, a.id] }, { admin: true });
      assert.deepEqual((await call('GET', '/api/gallery')).data.map((g) => g.caption), ['Cascada', 'Primer baile']);
      await call('PATCH', `/api/admin/gallery/${a.id}`, { caption: 'Entrada' }, { admin: true });
      assert.equal((await call('DELETE', `/api/admin/gallery/${b2.id}`, null, { admin: true })).status, 200);
      assert.equal((await fetch(base + b2.url)).status, 404, 'el archivo borrado ya no se sirve');
      assert.deepEqual((await call('GET', '/api/gallery')).data.map((g) => g.caption), ['Entrada']);
      assert.equal((await call('POST', '/api/admin/testimonials', { name: '', text: 'x' }, { admin: true })).status, 400);
      const t = (await call('POST', '/api/admin/testimonials', { name: 'Lucía y Marcos', event: 'Boda', text: 'Todo perfecto', rating: 9 }, { admin: true })).data;
      assert.equal(t.rating, 5, 'la puntuación se limita a 5');
      await call('PUT', `/api/admin/testimonials/${t.id}`, { text: 'Todo salió perfecto' }, { admin: true });
      assert.equal((await call('GET', '/api/testimonials')).data[0].text, 'Todo salió perfecto');
    });

    await step('edita el catálogo desde el panel', async () => {
      const cat = (await call('GET', '/api/admin/pyro/catalog', null, { admin: true })).data;
      cat.items[0].unitPrice = 50;
      cat.items[1].active = false;
      cat.fees.setup = 100;
      const saved = await call('PUT', '/api/admin/pyro/catalog', cat, { admin: true });
      assert.equal(saved.status, 200);
      const pub = (await call('GET', '/api/pyro/catalog')).data;
      assert.equal(pub.items.find((i) => i.id === 'vertical').unitPrice, 50);
      assert.ok(!pub.items.some((i) => i.id === 'abanico'), 'los productos ocultos no se muestran');
      assert.equal((await call('POST', '/api/pyro/estimate', { lines: [{ itemId: 'abanico', qty: 1 }] })).data.errors.length, 1);
      assert.ok(pub.packs.length >= 3, 'paquetes recomendados');
      for (const pack of pub.packs) {
        const est = (await call('POST', '/api/pyro/estimate', { lines: pack.lines })).data;
        assert.ok(est.lines.length > 0, `el paquete ${pack.id} tiene líneas válidas`);
      }
      cat.items[0].colorIds = [];
      assert.equal((await call('PUT', '/api/admin/pyro/catalog', cat, { admin: true })).status, 400);
    });

    await step('persiste los datos en disco y cierra sesión', async () => {
      const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
      assert.equal(db.events.length, 4);
      assert.ok(db.admin.hash && !JSON.stringify(db.admin).includes('contraseña-segura'));
      await call('POST', `/api/admin/logout`, {}, { admin: true });
      assert.equal((await call('GET', '/api/admin/events', null, { admin: true })).status, 401);
    });

    console.log(`\n${passed} comprobaciones superadas.`);
  } finally {
    server.close();
    mock.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((err) => { console.error(err); process.exit(1); });
