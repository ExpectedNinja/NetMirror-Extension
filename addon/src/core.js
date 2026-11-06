import { setTimeout as sleep } from 'node:timers/promises';

const TAG = '[netmirror]';
const MIN_GAP_MS = 250;
const MAX_CONCURRENT = 3;
const MAX_ATTEMPTS = 4;

const NEWTV_HEADERS = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
  'X-Requested-With': 'NetmirrorNewTV v1.0',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0',
  Accept: 'application/json, text/plain, */*',
};

const PLAYER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

const NEWTV_DOMAINS = [
  'aHR0cHM6Ly9tb2JpbGVkZXRlY3RzLmNvbQ==',
  'aHR0cHM6Ly9tb2JpbGVkZXRlY3QuYXBw',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0LmFydA==',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0LmNj',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0LmNsaWNr',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0Lmluaw==',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0LmxpdmU=',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0LnBybw==',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0LnNob3A=',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0LnNpdGU=',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0LnNwYWNl',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0LnN0b3Jl',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0LnZpcA==',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0Lndpa2k=',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0Lnh5eg==',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0cy5hcnQ=',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0cy5jYw==',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbmZv',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0cy5pbms=',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0cy5saXZl',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0cy5wcm8=',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0cy5zdG9yZQ==',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0cy50b3A=',
  'aHR0cHM6Ly9tb2JpZGV0ZWN0cy54eXo=',
];

const OTT_LABELS = {
  nf: 'Netflix',
  pv: 'Prime Video',
  hs: 'Hotstar',
};

const cache = new Map();
const inflight = new Map();

let apiBase = null;
let baseResolvedAt = 0;
let basePromise = null;
let nextRequestAt = 0;
let activeRequests = 0;
const waitingRequests = [];

function decodeBase64(value) {
  return Buffer.from(value, 'base64').toString('utf8').trim();
}

function isRateLimited(body) {
  const lower = body.toLowerCase();
  return (
    lower.includes('too many request') ||
    lower.includes('rate limit') ||
    lower.includes('slow down')
  );
}

function acquireSlot() {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waitingRequests.push(resolve));
}

function releaseSlot() {
  const next = waitingRequests.shift();
  if (next) next();
  else activeRequests--;
}

async function throttled(fn) {
  await acquireSlot();
  try {
    const wait = nextRequestAt - Date.now();
    if (wait > 0) await sleep(wait);
    nextRequestAt = Date.now() + MIN_GAP_MS;
    return await fn();
  } finally {
    releaseSlot();
  }
}

async function fetchText(url, headers = {}, { attempts = MAX_ATTEMPTS } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await throttled(() =>
        fetch(url, { headers, redirect: 'follow' })
      );
      const body = await response.text();
      if (response.ok && body && !isRateLimited(body)) {
        return { body, status: response.status, headers: response.headers };
      }
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (response.status === 403) {
        throw new Error('HTTP 403');
      }
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 160)}`);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      const backoff = Math.min(8000, 700 * 2 ** (attempt - 1));
      await sleep(backoff + Math.floor(Math.random() * 400));
    }
  }
  throw lastError ?? new Error(`Request failed: ${url}`);
}

async function cached(key, ttlMs, producer) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    try {
      const value = await producer();
      cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

export async function resolveBase(force = false) {
  if (!force && apiBase && Date.now() - baseResolvedAt < 12 * 60 * 60 * 1000) {
    return apiBase;
  }
  if (!force && basePromise) return basePromise;

  basePromise = (async () => {
    let lastError;
    for (const encoded of NEWTV_DOMAINS) {
      const base = decodeBase64(encoded).replace(/\/+$/, '');
      try {
        const { body } = await fetchText(`${base}/checknewtv.php`, NEWTV_HEADERS, {
          attempts: 2,
        });
        const token = JSON.parse(body);
        const resolved = decodeBase64(token.token_hash).replace(/\/+$/, '');
        if (/^https?:\/\//.test(resolved)) {
          apiBase = resolved;
          baseResolvedAt = Date.now();
          console.log(`${TAG} API base ${resolved}`);
          return resolved;
        }
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Failed to resolve NewTV API base: ${lastError?.message ?? 'unknown'}`);
  })();

  try {
    return await basePromise;
  } finally {
    basePromise = null;
  }
}

async function newtv(path, ott, extraHeaders = {}, ttlMs = 60_000) {
  const key = `newtv|${ott}|${path}`;
  return cached(key, ttlMs, async () => {
    const base = await resolveBase();
    const url = `${base}/newtv/${path}`;
    const headers = { ...NEWTV_HEADERS, Ott: ott, ...extraHeaders };
    try {
      const { body } = await fetchText(url, headers);
      return JSON.parse(body);
    } catch (error) {
      if (String(error.message).includes('403')) {
        await resolveBase(true);
        const retryBase = await resolveBase();
        const { body } = await fetchText(`${retryBase}/newtv/${path}`, headers);
        return JSON.parse(body);
      }
      throw error;
    }
  });
}

export const main = (ott) =>
  newtv(
    'main.php',
    ott,
    { Page: 'all', Recentplay: '', Watchlist: '', Usertoken: '' },
    5 * 60_000
  );

export const search = (ott, query) =>
  newtv(
    `search.php?s=${encodeURIComponent(query)}`,
    ott,
    {},
    10 * 60_000
  );

export const post = (ott, id) =>
  newtv(
    `post.php?id=${encodeURIComponent(id)}`,
    ott,
    { Lastep: '', Usertoken: '' },
    15 * 60_000
  );

export const episodes = (ott, seasonId, page = 1) =>
  newtv(
    `episodes.php?id=${encodeURIComponent(seasonId)}&page=${page}`,
    ott,
    {},
    30 * 60_000
  );

export const player = (ott, id) =>
  newtv(
    `player.php?id=${encodeURIComponent(id)}`,
    ott,
    { Usertoken: '' },
    60_000
  );

export function buildPoster(template, id) {
  if (!template) return null;
  return template.includes('------------------')
    ? template.replace('------------------', id)
    : `${template.replace(/\/+$/, '')}/${id}.jpg`;
}

export function detailValue(detail, ...keys) {
  const pairs = detail?.moredetails ?? [];
  const pair = pairs.find((item) =>
    keys.some((key) => String(item.k).toLowerCase() === key.toLowerCase())
  );
  return pair?.v ?? null;
}

export function detailMeta(detail) {
  return {
    cast: detailValue(detail, 'Cast'),
    rating: detailValue(detail, 'IMDB Rating')?.replace(/^IMDb\s*/i, ''),
    genres: detailValue(
      detail,
      'IMDB Genres',
      'Genres',
      'Netflix Genres',
      'HotStar Genres',
      'Prime Video Genres',
      'PrimeVideo Genres'
    ),
    director: detailValue(detail, 'Director', 'Creator'),
  };
}

export function normalizeTitle(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scoreTitle(candidate, wanted) {
  const a = normalizeTitle(candidate);
  const b = normalizeTitle(wanted);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.startsWith(b) || b.startsWith(a)) return 80;
  if (a.includes(b) || b.includes(a)) return 60;
  const aWords = new Set(a.split(' '));
  const bWords = b.split(' ').filter(Boolean);
  const overlap = bWords.filter((word) => aWords.has(word)).length;
  return bWords.length ? Math.round((overlap / bWords.length) * 50) : 0;
}

export async function cinemeta(type, imdbId) {
  const key = `cinemeta|${type}|${imdbId}`;
  return cached(key, 24 * 60 * 60_000, async () => {
    try {
      const { body } = await fetchText(
        `https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(imdbId)}.json`,
        { Accept: 'application/json' }
      );
      return JSON.parse(body)?.meta ?? null;
    } catch (error) {
      console.warn(`${TAG} cinemeta ${type}/${imdbId}: ${error.message}`);
      return null;
    }
  });
}

export async function net27(tmdbId, type, season, episode) {
  const key = `net27|${tmdbId}|${type}|${season}|${episode}`;
  return cached(key, 90_000, async () => {
    const params = new URLSearchParams();
    if (type === 'series') {
      params.set('type', 'tv');
      params.set('s', String(season || 1));
      params.set('e', String(episode || 1));
    }
    const suffix = params.toString() ? `?${params}` : '';
    const url = `https://net27.cc/api/embed-tmdb/${encodeURIComponent(tmdbId)}${suffix}`;
    try {
      const { body } = await fetchText(url, {
        'User-Agent': PLAYER_UA,
        Referer: 'https://videodownloader.site/',
        Accept: 'application/json',
      });
      const parsed = JSON.parse(body);
      if (!parsed?.ok) return null;
      return parsed;
    } catch (error) {
      console.warn(`${TAG} net27 ${tmdbId}: ${error.message}`);
      return null;
    }
  });
}

export async function findOnOtt(ott, title, year, wantedType) {
  const data = await search(ott, title);
  const results = data?.searchResult ?? [];
  if (!results.length) return null;

  const ranked = results
    .map((item) => ({ item, score: scoreTitle(item.t, title) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  for (const { item, score } of ranked) {
    if (score < 45) continue;
    try {
      const detail = await post(ott, item.id);
      if (!detail?.title) continue;
      const detailType = detail.type === 't' ? 'series' : 'movie';
      const detailScore = scoreTitle(detail.title, title);
      const titleOk = detailScore >= 55;
      const yearOk =
        !year ||
        !detail.year ||
        Math.abs(Number(detail.year) - Number(year)) <= 1 ||
        detailScore >= 85;
      const typeOk = !wantedType || detailType === wantedType;
      if (titleOk && yearOk && typeOk) {
        return { ott, id: item.id, detail };
      }
    } catch (error) {
      console.warn(`${TAG} ${ott} post failed for ${item.id}: ${error.message}`);
    }
  }
  return null;
}

export async function findEverywhere(title, year, wantedType) {
  const found = [];
  for (const ott of Object.keys(OTT_LABELS)) {
    try {
      const match = await findOnOtt(ott, title, year, wantedType);
      if (match) found.push(match);
    } catch (error) {
      console.warn(`${TAG} ${ott} search failed: ${error.message}`);
    }
  }
  return found;
}

export function findEpisode(detail, season, episode) {
  const items = (detail?.episodes ?? []).filter(Boolean);
  if (!items.length) return null;
  const seasonNumber = Number(season || 1);
  const episodeNumber = Number(episode || 1);
  return (
    items.find(
      (item) =>
        Number(String(item.s).replace(/\D/g, '') || seasonNumber) === seasonNumber &&
        Number(String(item.ep).replace(/\D/g, '')) === episodeNumber
    ) ?? items[0]
  );
}

export async function findEpisodeFor(ott, detail, season, episode) {
  const seasonNumber = Number(season || 1);
  const episodeNumber = Number(episode || 1);
  const matches = (item) =>
    Number(String(item.s).replace(/\D/g, '') || seasonNumber) === seasonNumber &&
    Number(String(item.ep).replace(/\D/g, '')) === episodeNumber;

  const items = (detail?.episodes ?? []).filter(Boolean);
  const direct = items.find(matches);
  if (direct) return direct;

  const seasons = detail?.season ?? [];
  let index = seasons.findIndex(
    (item) => Number(String(item.s).match(/\d+/)?.[0]) === seasonNumber
  );
  if (index < 0) index = seasonNumber - 1;
  const target = seasons[index];
  if (!target?.id) return items[0] ?? null;

  for (let page = 1; page < 50; page++) {
    const data = await episodes(ott, target.id, page);
    const found = (data?.episodes ?? []).filter(Boolean).find(matches);
    if (found) return found;
    if (data?.nextPageShow !== 1) break;
  }
  return null;
}

export async function resolveForImdb(imdbId, type, season, episode) {
  const meta = await cinemeta(type, imdbId);
  if (!meta?.name) return { meta: null, matches: [] };
  const year = String(meta.year ?? meta.releaseInfo ?? '').match(/\d{4}/)?.[0];
  const matches = await findEverywhere(meta.name, year, type);
  return { meta, matches };
}

export function newtvStream(link, referer, source) {
  if (!link) return null;
  const headers = { 'User-Agent': PLAYER_UA };
  if (referer) headers.Referer = referer;
  return {
    name: source,
    title: link.includes('.m3u8') ? 'Auto (HLS)' : 'Auto',
    url: link,
    headers,
    behaviorHints: {
      proxyHeaders: { request: headers },
      notWebReady: true,
    },
  };
}

export function net27Streams(payload, source) {
  if (!payload?.streams?.length) return [];
  const referer = 'https://videodownloader.site/';
  const headers = { 'User-Agent': PLAYER_UA, Referer: referer };
  const subtitles = (payload.captions ?? [])
    .filter((caption) => caption?.url)
    .map((caption) => ({
      url: caption.url.startsWith('http')
        ? caption.url
        : `https://net27.cc${caption.url}`,
      lang: caption.lang || 'und',
      name: caption.name || caption.lang || 'Subtitle',
    }));

  return payload.streams
    .filter((stream) => stream?.url)
    .sort((a, b) => Number(b.resolution || 0) - Number(a.resolution || 0))
    .map((stream) => ({
      name: source,
      title: `${stream.resolution || payload.resolution || 'Auto'}p`,
      url: stream.url,
      headers,
      subtitles: subtitles.length ? subtitles : undefined,
      behaviorHints: {
        proxyHeaders: { request: headers },
        notWebReady: true,
      },
    }));
}

export { OTT_LABELS };
