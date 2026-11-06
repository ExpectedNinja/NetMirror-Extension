(function () {
  const BASE = 'https://net27.cc/api/embed-tmdb/';
  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
  const REFERER = 'https://videodownloader.site/';
  const cache = {};

  async function json(url, headers) {
    if (cache[url] && cache[url].until > Date.now()) return cache[url].value;
    const response = await fetch(url, { headers: headers });
    if (!response || !response.ok) throw new Error('HTTP ' + (response ? response.status : 'unknown'));
    const body = await response.json();
    cache[url] = { value: body, until: Date.now() + 90000 };
    return body;
  }

  function absolute(url) {
    if (!url) return null;
    return url.indexOf('http') === 0 ? url : 'https://net27.cc' + url;
  }

  async function getStreams(tmdbId, mediaType, season, episode) {
    const id = String(tmdbId || '').replace(/^tmdb[:/-]/i, '');
    if (!/^\d+$/.test(id)) return [];

    const isTv = mediaType === 'tv' || mediaType === 'series' || mediaType === 'show';
    let url = BASE + encodeURIComponent(id);
    if (isTv) {
      url += '?type=tv&s=' + (season || 1) + '&e=' + (episode || 1);
    }

    let payload;
    try {
      payload = await json(url, {
        'User-Agent': UA,
        Referer: REFERER,
        Accept: 'application/json'
      });
    } catch (e) {
      return [];
    }

    if (!payload || !payload.ok || !payload.streams || !payload.streams.length) return [];

    const subtitles = (payload.captions || [])
      .map(function (caption) {
        return {
          url: absolute(caption.url),
          lang: caption.lang || 'und',
          label: caption.name || caption.lang || 'Subtitle'
        };
      })
      .filter(function (caption) {
        return caption.url;
      });

    return payload.streams
      .filter(function (stream) {
        return stream && stream.url;
      })
      .sort(function (a, b) {
        return (b.resolution || 0) - (a.resolution || 0);
      })
      .map(function (stream) {
        const resolution = stream.resolution || payload.resolution || 0;
        return {
          url: stream.url,
          name: 'NetMirror',
          title: resolution ? resolution + 'p' : 'Auto',
          quality: resolution ? resolution + 'p' : 'Auto',
          headers: { 'User-Agent': UA, Referer: REFERER },
          subtitles: subtitles.length ? subtitles : undefined
        };
      });
  }

  globalThis.getStreams = getStreams;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams: getStreams };
  }
})();
