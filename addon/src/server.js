import http from 'node:http';
import { URL } from 'node:url';
import {
  OTT_LABELS,
  buildPoster,
  cinemeta,
  detailMeta,
  episodes,
  findEpisodeFor,
  findEverywhere,
  main,
  net27,
  net27Streams,
  newtvStream,
  player,
  post,
  resolveForImdb,
  search,
} from './core.js';

const PORT = Number(process.env.PORT || 7000);
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const TMDB_TOKEN = process.env.TMDB_READ_TOKEN || '';
const CATALOG_LIMIT = Number(process.env.CATALOG_LIMIT || 8);

const CATALOGS = [
  { ott: 'nf', type: 'movie', name: 'Netflix Movies' },
  { ott: 'nf', type: 'series', name: 'Netflix Series' },
  { ott: 'pv', type: 'movie', name: 'Prime Video Movies' },
  { ott: 'pv', type: 'series', name: 'Prime Video Series' },
  { ott: 'hs', type: 'movie', name: 'Hotstar Movies' },
  { ott: 'hs', type: 'series', name: 'Hotstar Series' },
];

const MANIFEST = {
  id: 'org.netmirror.universal',
  version: '1.0.0',
  name: 'NetMirror',
  description:
    'Netflix, Prime Video and Hotstar streams for Stremio, Nuvio, SkyStream and any Stremio-compatible app.',
  types: ['movie', 'series'],
  resources: [
    { name: 'catalog', types: ['movie', 'series'], idPrefixes: ['netmirror'] },
    { name: 'meta', types: ['movie', 'series'], idPrefixes: ['netmirror'] },
    { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb', 'netmirror'] },
  ],
  catalogs: CATALOGS.map((catalog) => ({
    type: catalog.type,
    id: `netmirror_${catalog.ott}_${catalog.type}`,
    name: catalog.name,
    extra: [
      { name: 'search', isRequired: false },
      { name: 'skip', isRequired: false },
    ],
  })),
  idPrefixes: ['tt', 'tmdb', 'netmirror'],
  behaviorHints: { configurable: false, configurationRequired: false },
};

function json(res, status, payload, cacheSeconds = 0) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': cacheSeconds
      ? `public, max-age=${cacheSeconds}, stale-while-revalidate=60`
      : 'no-store',
  });
  res.end(body);
}

function html(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300',
  });
  res.end(body);
}

function metaType(detail) {
  return detail?.type === 't' ? 'series' : 'movie';
}

function metaPreview(ott, id, detail) {
  const meta = detailMeta(detail);
  const type = metaType(detail);
  return {
    id: `netmirror:${ott}:${id}`,
    type,
    name: detail?.title || id,
    poster: buildPoster(detail?.main_poster, id),
    background: buildPoster(detail?.main_poster, id),
    description: detail?.desc || undefined,
    releaseInfo: detail?.year || undefined,
    imdbRating: meta.rating || undefined,
    genres: meta.genres
      ? meta.genres.split(',').map((value) => value.trim()).filter(Boolean)
      : undefined,
    runtime: detail?.runtime || undefined,
  };
}

function videoFor(ott, episode) {
  if (!episode?.id) return null;
  const info = episode.info ?? [];
  return {
    id: `netmirror:${ott}:${episode.id}`,
    title: episode.t || `Episode ${episode.ep}`,
    season: Number(String(episode.s || 'S1').replace(/\D/g, '')) || 1,
    episode: Number(String(episode.ep || '1').replace(/\D/g, '')) || 1,
    released: info[1] ? new Date(info[1]).toISOString() : undefined,
    overview: info.join(' â€¢ ') || undefined,
  };
}

async function allVideos(ott, detail) {
  const videos = [];
  const seasons = detail?.season ?? [];
  const selected =
    seasons.find((season) => season.selected) ?? seasons[0] ?? null;

  for (const episode of (detail?.episodes ?? []).filter(Boolean)) {
    const video = videoFor(ott, episode);
    if (video) videos.push(video);
  }

  if (selected) {
    if (detail?.nextPageShow === 1) {
      let page = 2;
      for (let guard = 0; guard < 50; guard++) {
        const data = await episodes(ott, selected.id, page);
        for (const episode of (data?.episodes ?? []).filter(Boolean)) {
          const video = videoFor(ott, episode);
          if (video) videos.push(video);
        }
        if (data?.nextPageShow !== 1) break;
        page++;
      }
    }

    for (const [index, season] of seasons.entries()) {
      if (!season?.id || season.id === selected.id) continue;
      let page = 1;
      for (let guard = 0; guard < 50; guard++) {
        const data = await episodes(ott, season.id, page);
        for (const episode of (data?.episodes ?? []).filter(Boolean)) {
          const video = videoFor(ott, episode);
          if (video) {
            if (!video.season) video.season = index + 1;
            videos.push(video);
          }
        }
        if (data?.nextPageShow !== 1) break;
        page++;
      }
    }
  }

  const seen = new Set();
  return videos.filter((video) => {
    if (seen.has(video.id)) return false;
    seen.add(video.id);
    return true;
  });
}

async function catalogMetas(ott, requestedType, searchQuery, skip = 0) {
  let candidates;
  if (searchQuery) {
    const data = await search(ott, searchQuery);
    candidates = (data?.searchResult ?? []).slice(0, skip + CATALOG_LIMIT);
  } else {
    const data = await main(ott);
    const movieHints = /movie|film|cinema/i;
    const seriesHints = /series|show|drama|anime|\btv\b|k-drama/i;
    const preferred = [];
    const fallback = [];
    const seen = new Set();

    for (const category of data?.post ?? []) {
      const label = String(category.cate ?? '');
      const looksMovie = movieHints.test(label);
      const looksSeries = seriesHints.test(label);
      const matches =
        requestedType === 'movie'
          ? looksMovie || !looksSeries
          : looksSeries || !looksMovie;
      const bucket = matches ? preferred : fallback;

      for (const id of String(category.ids ?? '').split(',')) {
        const trimmed = id.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        bucket.push({ id: trimmed, t: '' });
      }
    }
    candidates = [...preferred, ...fallback].slice(0, (skip + CATALOG_LIMIT) * 5);
  }

  const metas = [];
  let attempts = 0;
  for (const candidate of candidates) {
    if (attempts++ >= (skip + CATALOG_LIMIT) * 2) break;
    try {
      const detail = await post(ott, candidate.id);
      if (!detail?.title) continue;
      if (requestedType && metaType(detail) !== requestedType) continue;
      metas.push(metaPreview(ott, candidate.id, detail));
      if (metas.length >= skip + CATALOG_LIMIT) break;
    } catch (error) {
      console.warn(`[catalog] ${ott}/${candidate.id}: ${error.message}`);
    }
  }
  return metas.slice(skip, skip + CATALOG_LIMIT);
}

async function tmdbFind(imdbId, type) {
  if (!TMDB_TOKEN) return null;
  const url = `https://api.themoviedb.org/3/find/${encodeURIComponent(
    imdbId
  )}?external_source=imdb_id&language=en-US`;
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TMDB_TOKEN}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const results = type === 'series' ? data.tv_results : data.movie_results;
    return results?.[0]?.id ?? null;
  } catch (error) {
    console.warn(`[tmdb] find ${imdbId}: ${error.message}`);
    return null;
  }
}

async function tmdbDetail(tmdbId, type) {
  if (!TMDB_TOKEN) return null;
  const media = type === 'series' ? 'tv' : 'movie';
  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/${media}/${encodeURIComponent(
        tmdbId
      )}?language=en-US`,
      {
        headers: {
          Authorization: `Bearer ${TMDB_TOKEN}`,
          Accept: 'application/json',
        },
      }
    );
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    console.warn(`[tmdb] detail ${tmdbId}: ${error.message}`);
    return null;
  }
}

function dedupeStreams(streams) {
  const seen = new Set();
  return streams.filter((stream) => {
    if (!stream?.url || seen.has(stream.url)) return false;
    seen.add(stream.url);
    return true;
  });
}

async function streamsForImdb(imdbId, type, season, episode) {
  const streams = [];
  const tmdbId = await tmdbFind(imdbId, type);
  if (tmdbId) {
    const payload = await net27(tmdbId, type, season, episode);
    streams.push(...net27Streams(payload, `NetMirror • TMDB ${tmdbId}`));
    if (streams.length) return dedupeStreams(streams);
  }

  const { matches } = await resolveForImdb(imdbId, type, season, episode);
  for (const match of matches) {
    const episodeItem =
      type === 'series' ? await findEpisodeFor(match.ott, match.detail, season, episode) : null;
    if (type === 'series' && !episodeItem) continue;
    const response = await player(
      match.ott,
      episodeItem ? episodeItem.id : match.detail.main_id || match.id
    );
    const stream = newtvStream(
      response?.video_link,
      response?.referer || 'https://net52.cc',
      `NetMirror â€¢ ${OTT_LABELS[match.ott]}`
    );
    if (stream) streams.push(stream);
  }
  return dedupeStreams(streams);
}

async function streamsForTmdb(tmdbId, type, season, episode) {
  const streams = [];
  const payload = await net27(tmdbId, type, season, episode);
  streams.push(...net27Streams(payload, 'NetMirror â€¢ TMDB'));

  if (!streams.length) {
    const detail = await tmdbDetail(tmdbId, type);
    if (detail?.title || detail?.name) {
      const year = String(detail.release_date || detail.first_air_date || '').slice(0, 4);
      const matches = await findEverywhere(
        detail.title || detail.name,
        year,
        type
      );
      for (const match of matches) {
        const episodeItem =
          type === 'series' ? await findEpisodeFor(match.ott, match.detail, season, episode) : null;
        if (type === 'series' && !episodeItem) continue;
        const response = await player(
          match.ott,
          episodeItem ? episodeItem.id : match.detail.main_id || match.id
        );
        const stream = newtvStream(
          response?.video_link,
          response?.referer || 'https://net52.cc',
          `NetMirror â€¢ ${OTT_LABELS[match.ott]}`
        );
        if (stream) streams.push(stream);
      }
    }
  }
  return dedupeStreams(streams);
}

async function streamsForNetmirror(ott, id, season, episode) {
  if (!OTT_LABELS[ott]) return [];

  let response = null;
  if (season && episode) {
    const detail = await post(ott, id);
    const episodeItem = await findEpisodeFor(ott, detail, season, episode);
    if (episodeItem) response = await player(ott, episodeItem.id);
  }

  if (!response) {
    response = await player(ott, id);
  }

  if (!response?.video_link) {
    const detail = await post(ott, id);
    const first = (detail?.episodes ?? []).filter(Boolean)[0];
    if (first) response = await player(ott, first.id);
  }

  const stream = newtvStream(
    response?.video_link,
    response?.referer || 'https://net52.cc',
    `NetMirror â€¢ ${OTT_LABELS[ott]}`
  );
  return stream ? [stream] : [];
}

async function handleStream(type, rawId) {
  const id = decodeURIComponent(rawId);
  let match = id.match(/^netmirror:(nf|pv|hs):([^:]+)(?::(\d+):(\d+))?$/);
  if (match) {
    return streamsForNetmirror(match[1], match[2], match[3], match[4]);
  }

  match = id.match(/^(tt\d+)(?::(\d+):(\d+))?$/);
  if (match) {
    return streamsForImdb(match[1], type, match[2], match[3]);
  }

  match = id.match(/^(?:tmdb[:/-])?(\d+)(?::(\d+):(\d+))?$/);
  if (match) {
    return streamsForTmdb(match[1], type, match[2], match[3]);
  }

  return [];
}

async function handleMeta(type, rawId) {
  const id = decodeURIComponent(rawId);
  const match = id.match(/^netmirror:(nf|pv|hs):([^:]+)$/);
  if (match) {
    const [, ott, contentId] = match;
    const detail = await post(ott, contentId);
    if (!detail?.title) return null;
    const meta = detailMeta(detail);
    return {
      id,
      type: metaType(detail),
      name: detail.title,
      poster: buildPoster(detail.main_poster, contentId),
      background: buildPoster(detail.main_poster, contentId),
      description: detail.desc || undefined,
      releaseInfo: detail.year || undefined,
      imdbRating: meta.rating || undefined,
      genres: meta.genres
        ? meta.genres.split(',').map((value) => value.trim()).filter(Boolean)
        : undefined,
      cast: meta.cast
        ? meta.cast.split(',').map((value) => value.trim()).filter(Boolean)
        : undefined,
      runtime: detail.runtime || undefined,
      videos:
        metaType(detail) === 'series' ? await allVideos(ott, detail) : undefined,
    };
  }

  if (/^tt\d+/.test(id)) {
    const baseId = id.split(':')[0];
    const meta = await cinemeta(type, baseId);
    if (meta) return { ...meta, id };
  }

  return null;
}

async function handleCatalog(type, rawId, url) {
  const decoded = decodeURIComponent(rawId);
  const [baseId, ...extraParts] = decoded.split('/');
  const match = baseId.match(/^netmirror_(nf|pv|hs)_(movie|series)$/);
  if (!match) return [];
  const [, ott, catalogType] = match;
  const extra = new URLSearchParams(extraParts.join('&'));
  const searchQuery =
    extra.get('search') || url.searchParams.get('search') || '';
  const skip = Number(extra.get('skip') || url.searchParams.get('skip') || 0);
  return catalogMetas(ott, type || catalogType, searchQuery, skip);
}

function landingPage(host) {
  const base = PUBLIC_URL || `http://${host}`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NetMirror Addon</title>
<style>
body{font-family:system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;background:#101114;color:#e8e8ea}
code{background:#1d1f24;padding:2px 6px;border-radius:4px;word-break:break-all}
a{color:#6ea8fe}
.card{background:#17191e;border:1px solid #2a2d34;border-radius:12px;padding:20px;margin:18px 0}
</style></head><body>
<h1>NetMirror universal addon</h1>
<p>Works with Stremio, Nuvio, SkyStream and any Stremio-compatible app on Android, iOS, Windows, macOS, Linux and TV.</p>
<div class="card">
<h2>Install</h2>
<p>Paste this manifest URL in your app:</p>
<p><code>${base}/manifest.json</code></p>
<p>Stremio direct link: <a href="stremio://${host}/manifest.json">stremio://${host}/manifest.json</a></p>
</div>
<div class="card">
<h2>Catalogs</h2>
<p>Netflix, Prime Video and Hotstar movies/series, plus search. Streams also resolve from IMDb and TMDB IDs used by Stremio and Nuvio.</p>
</div>
<div class="card">
<h2>Health</h2>
<p><a href="${base}/health">${base}/health</a></p>
</div>
</body></html>`;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  try {
    if (path === '/' || path === '') {
      html(res, 200, landingPage(req.headers.host || 'localhost'));
      return;
    }

    if (path === '/manifest.json') {
      json(res, 200, MANIFEST, 300);
      return;
    }

    if (path === '/health') {
      json(res, 200, { ok: true, service: 'netmirror-addon' });
      return;
    }

    let match = path.match(/^\/catalog\/(movie|series)\/(.+)\.json$/);
    if (match) {
      const metas = await handleCatalog(match[1], match[2], url);
      json(res, 200, { metas }, 300);
      return;
    }

    match = path.match(/^\/meta\/(movie|series)\/(.+)\.json$/);
    if (match) {
      const meta = await handleMeta(match[1], match[2]);
      json(res, 200, { meta }, 300);
      return;
    }

    match = path.match(/^\/stream\/(movie|series)\/(.+)\.json$/);
    if (match) {
      const streams = await handleStream(match[1], match[2]);
      json(res, 200, { streams }, 60);
      return;
    }

    json(res, 404, { error: 'not found' });
  } catch (error) {
    console.error('[server]', error);
    json(res, 500, { error: error.message || 'internal error' });
  }
});

server.listen(PORT, () => {
  console.log(`[netmirror] addon listening on http://0.0.0.0:${PORT}`);
  console.log(`[netmirror] manifest: ${PUBLIC_URL || `http://localhost:${PORT}`}/manifest.json`);
});



