// Cliente mínimo de la Web API de Spotify (sin dependencias).
// - Conexión con solo el Client ID: OAuth «Authorization Code con PKCE» (no hace falta el Client Secret).
// - Búsqueda para invitados, cola y playlists: con la cuenta del administrador conectada.
// - Si además hay un Client Secret (opcional, por variable de entorno), la búsqueda usa credenciales de la app.
const crypto = require('node:crypto');

const SCOPES = [
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-modify-private',
  'playlist-modify-public'
].join(' ');

class SpotifyError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function createSpotify({ getCredentials, getUserAuth, saveUserAuth, apiBase, accountsBase }) {
  const API = apiBase || 'https://api.spotify.com/v1';
  const ACCOUNTS = accountsBase || 'https://accounts.spotify.com';
  let appToken = null;

  const configured = () => Boolean(getCredentials().clientId);
  const hasSecret = () => Boolean(getCredentials().clientSecret);

  // PKCE: verificador aleatorio y su desafío SHA-256 en base64url.
  function pkcePair() {
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  }

  function basicAuth() {
    const c = getCredentials();
    return 'Basic ' + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64');
  }

  async function tokenRequest(params) {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    const body = new URLSearchParams(params);
    if (hasSecret()) headers.Authorization = basicAuth();
    else body.set('client_id', getCredentials().clientId);
    const res = await fetch(`${ACCOUNTS}/api/token`, { method: 'POST', headers, body: body.toString() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new SpotifyError(data.error_description || data.error || 'Spotify rechazó las credenciales.', res.status);
    return data;
  }

  async function getAppToken() {
    if (!hasSecret()) throw new SpotifyError('Sin Client Secret: se usa la cuenta conectada.', 409);
    if (appToken && appToken.expiresAt > Date.now() + 30_000) return appToken.value;
    const data = await tokenRequest({ grant_type: 'client_credentials' });
    appToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return appToken.value;
  }

  async function getUserToken() {
    const auth = getUserAuth();
    if (!auth || !auth.refreshToken) throw new SpotifyError('Conecta una cuenta de Spotify desde el panel de administración.', 409);
    if (auth.accessToken && auth.expiresAt > Date.now() + 30_000) return auth.accessToken;
    const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refreshToken });
    saveUserAuth({
      ...auth,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || auth.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000
    });
    return data.access_token;
  }

  async function call(token, method, path, body) {
    const res = await fetch(path.startsWith('http') ? path : API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 204) return null;
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      const msg = (data && data.error && (data.error.message || data.error)) || `Error ${res.status} de Spotify`;
      throw new SpotifyError(String(msg), res.status);
    }
    return data;
  }

  function mapTrack(t) {
    const images = (t.album && t.album.images) || [];
    const image = (images.find((i) => i.width && i.width <= 320) || images[images.length - 1] || images[0] || {}).url || '';
    return {
      id: t.id,
      uri: t.uri,
      name: t.name,
      artists: (t.artists || []).map((a) => a.name).join(', '),
      album: (t.album && t.album.name) || '',
      image,
      durationMs: t.duration_ms || 0,
      explicit: Boolean(t.explicit),
      url: (t.external_urls && t.external_urls.spotify) || ''
    };
  }

  // Token para búsquedas: el de la app si hay Client Secret; si no, el de la cuenta conectada.
  async function searchToken() {
    if (hasSecret()) {
      try { return await getAppToken(); } catch (err) { return getUserToken().catch(() => { throw err; }); }
    }
    return getUserToken();
  }

  async function search(q, market) {
    const token = await searchToken();
    const params = new URLSearchParams({ q, type: 'track', limit: '10', market: market || 'ES' });
    const data = await call(token, 'GET', `/search?${params}`);
    return ((data && data.tracks && data.tracks.items) || []).filter(Boolean).map(mapTrack);
  }

  async function getTrack(id, market) {
    const token = await searchToken();
    return mapTrack(await call(token, 'GET', `/tracks/${encodeURIComponent(id)}?market=${market || 'ES'}`));
  }

  function authorizeUrl(redirectUri, state, codeChallenge) {
    const c = getCredentials();
    const params = new URLSearchParams({ response_type: 'code', client_id: c.clientId, scope: SCOPES, redirect_uri: redirectUri, state, show_dialog: 'true' });
    if (codeChallenge) { params.set('code_challenge_method', 'S256'); params.set('code_challenge', codeChallenge); }
    return `${ACCOUNTS}/authorize?${params}`;
  }

  async function exchangeCode(code, redirectUri, codeVerifier) {
    const params = { grant_type: 'authorization_code', code, redirect_uri: redirectUri };
    if (codeVerifier) params.code_verifier = codeVerifier;
    const data = await tokenRequest(params);
    const me = await call(data.access_token, 'GET', '/me').catch(() => ({}));
    const auth = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      user: { id: me.id || '', name: me.display_name || me.id || 'Cuenta de Spotify', product: me.product || '' }
    };
    saveUserAuth(auth);
    return auth;
  }

  async function queue(uri) {
    const token = await getUserToken();
    await call(token, 'POST', `/me/player/queue?uri=${encodeURIComponent(uri)}`);
  }

  async function nowPlaying() {
    const token = await getUserToken();
    const data = await call(token, 'GET', '/me/player?market=ES');
    if (!data) return { active: false };
    return {
      active: true,
      isPlaying: Boolean(data.is_playing),
      device: (data.device && data.device.name) || '',
      track: data.item && data.item.type === 'track' ? mapTrack(data.item) : null,
      progressMs: data.progress_ms || 0
    };
  }

  async function createPlaylist(name, description, isPublic = false) {
    const token = await getUserToken();
    const body = { name, description, public: Boolean(isPublic) };
    let data;
    try {
      data = await call(token, 'POST', '/me/playlists', body);
    } catch (err) {
      if (err.status !== 404 && err.status !== 405) throw err;
      const auth = getUserAuth();
      data = await call(token, 'POST', `/users/${encodeURIComponent(auth.user.id)}/playlists`, body);
    }
    return { id: data.id, url: (data.external_urls && data.external_urls.spotify) || '' };
  }

  async function addToPlaylist(playlistId, uris) {
    const token = await getUserToken();
    for (let i = 0; i < uris.length; i += 100) {
      const chunk = uris.slice(i, i + 100);
      try {
        await call(token, 'POST', `/playlists/${encodeURIComponent(playlistId)}/items`, { uris: chunk });
      } catch (err) {
        if (err.status !== 404 && err.status !== 405) throw err;
        await call(token, 'POST', `/playlists/${encodeURIComponent(playlistId)}/tracks`, { uris: chunk });
      }
    }
  }

  // Sustituye el contenido de una playlist (las primeras 100 con PUT y el resto con POST).
  async function replacePlaylist(playlistId, uris) {
    const token = await getUserToken();
    const first = uris.slice(0, 100);
    try {
      await call(token, 'PUT', `/playlists/${encodeURIComponent(playlistId)}/items`, { uris: first });
    } catch (err) {
      if (err.status !== 404 && err.status !== 405) throw err;
      await call(token, 'PUT', `/playlists/${encodeURIComponent(playlistId)}/tracks`, { uris: first });
    }
    if (uris.length > 100) await addToPlaylist(playlistId, uris.slice(100));
  }

  return { configured, hasSecret, pkcePair, replacePlaylist, search, getTrack, authorizeUrl, exchangeCode, queue, nowPlaying, createPlaylist, addToPlaylist, resetAppToken: () => { appToken = null; } };
}

module.exports = { createSpotify, SpotifyError };
