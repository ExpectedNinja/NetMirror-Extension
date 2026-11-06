(function () {
  const DOMAINS = [
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
    'aHR0cHM6Ly9tb2JpZGV0ZWN0cy54eXo='
  ];

  const BASE_HEADERS = {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Requested-With': 'NetmirrorNewTV v1.0',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0 /OS.GatuNewTV v1.0',
    Accept: 'application/json, text/plain, */*'
  };

  const LABELS = { nf: 'Netflix', pv: 'Prime Video', hs: 'Hotstar' };
  const GAP_MS = 300;
  const cache = {};
  let apiBase = null;
  let baseAt = 0;
  let lastRequest = 0;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function decode(value) {
    return atob(value).replace(/\/+$/, '');
  }

  function currentOtt() {
    var id =
      typeof manifest !== 'undefined' && manifest && manifest.providerId
        ? manifest.providerId
        : 'nf';
    return LABELS[id] ? id : 'nf';
  }

  function poster(template, id) {
    if (!template) return '';
    return template.indexOf('------------------') >= 0
      ? template.replace('------------------', id)
      : template.replace(/\/+$/, '') + '/' + id + '.jpg';
  }

  function pairs(detail) {
    return (detail && detail.moredetails) || [];
  }

  function value(detail, keys) {
    var list = pairs(detail);
    for (var i = 0; i < list.length; i++) {
      for (var j = 0; j < keys.length; j++) {
        if (String(list[i].k).toLowerCase() === keys[j].toLowerCase()) {
          return list[i].v;
        }
      }
    }
    return null;
  }

  function minutes(runtime) {
    var total = 0;
    String(runtime || '')
      .split(' ')
      .forEach(function (part) {
        if (part.slice(-1) === 'h') total += (parseInt(part, 10) || 0) * 60;
        if (part.slice(-1) === 'm') total += parseInt(part, 10) || 0;
      });
    return total || undefined;
  }

  function episodeRuntime(info) {
    var list = info || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i]).slice(-1) === 'm') {
        return parseInt(list[i], 10) || undefined;
      }
    }
    return undefined;
  }

  async function request(url, headers) {
    var wait = GAP_MS - (Date.now() - lastRequest);
    if (wait > 0) await sleep(wait);
    lastRequest = Date.now();
    var response = await http_get(url, headers || {});
    if (!response || response.status < 200 || response.status >= 300) {
      throw new Error('HTTP ' + (response ? response.status : 'unknown'));
    }
    return response.body;
  }

  async function resolveBase() {
    if (apiBase && Date.now() - baseAt < 12 * 60 * 60 * 1000) return apiBase;
    for (var i = 0; i < DOMAINS.length; i++) {
      var base = decode(DOMAINS[i]);
      try {
        var body = await request(base + '/checknewtv.php', BASE_HEADERS);
        var token = JSON.parse(body);
        var resolved = decode(token.token_hash);
        if (/^https?:\/\//.test(resolved)) {
          apiBase = resolved;
          baseAt = Date.now();
          return resolved;
        }
      } catch (e) {}
    }
    throw new Error('Failed to resolve NewTV API base');
  }

  async function newtv(path, ott, extra, ttl) {
    var key = ott + '|' + path;
    if (cache[key] && cache[key].until > Date.now()) return cache[key].value;
    var base = await resolveBase();
    var headers = {};
    Object.keys(BASE_HEADERS).forEach(function (k) {
      headers[k] = BASE_HEADERS[k];
    });
    headers.Ott = ott;
    if (extra) {
      Object.keys(extra).forEach(function (k) {
        headers[k] = extra[k];
      });
    }
    var body = await request(base + '/newtv/' + path, headers);
    var parsed = JSON.parse(body);
    cache[key] = { value: parsed, until: Date.now() + (ttl || 60000) };
    return parsed;
  }

  function main(ott) {
    return newtv(
      'main.php',
      ott,
      { Page: 'all', Recentplay: '', Watchlist: '', Usertoken: '' },
      5 * 60 * 1000
    );
  }

  function search(ott, query) {
    return newtv('search.php?s=' + encodeURIComponent(query), ott, {}, 10 * 60 * 1000);
  }

  function post(ott, id) {
    return newtv(
      'post.php?id=' + encodeURIComponent(id),
      ott,
      { Lastep: '', Usertoken: '' },
      15 * 60 * 1000
    );
  }

  function episodes(ott, seasonId, page) {
    return newtv(
      'episodes.php?id=' + encodeURIComponent(seasonId) + '&page=' + (page || 1),
      ott,
      {},
      30 * 60 * 1000
    );
  }

  function player(ott, id) {
    return newtv(
      'player.php?id=' + encodeURIComponent(id),
      ott,
      { Usertoken: '' },
      60000
    );
  }

  function makeItem(ott, id, detail) {
    var referer = detail.img_referer || 'https://net52.cc';
    var rating = value(detail, ['IMDB Rating']);
    var genres = value(detail, [
      'IMDB Genres',
      'Genres',
      'Netflix Genres',
      'HotStar Genres',
      'Prime Video Genres',
      'PrimeVideo Genres'
    ]);
    var cast = value(detail, ['Cast']);
    return new MultimediaItem({
      title: detail.title || id,
      url: 'netmirror:' + ott + ':' + id,
      posterUrl: poster(detail.main_poster, id),
      type: detail.type === 't' ? 'series' : 'movie',
      bannerUrl: poster(detail.main_poster, id),
      description: detail.desc || undefined,
      year: parseInt(detail.year, 10) || undefined,
      score: parseFloat(String(rating || '').replace(/[^0-9.]/g, '')) || undefined,
      duration: minutes(detail.runtime),
      contentRating: detail.ua || undefined,
      tags: genres
        ? genres
            .split(',')
            .map(function (g) {
              return g.trim();
            })
            .filter(Boolean)
        : undefined,
      cast: cast
        ? cast
            .split(',')
            .map(function (name) {
              return new Actor({ name: name.trim() });
            })
            .filter(function (a) {
              return a.name;
            })
        : undefined,
      headers: { Referer: referer }
    });
  }

  async function mapLimit(items, limit, fn) {
    var out = [];
    for (var i = 0; i < items.length; i += limit) {
      var batch = items.slice(i, i + limit);
      var results = await Promise.all(batch.map(fn));
      out = out.concat(results);
      if (i + limit < items.length) await sleep(200);
    }
    return out;
  }

  async function getHome(cb) {
    try {
      var ott = currentOtt();
      var data = await main(ott);
      var categories = (data.post || []).slice(0, 6);
      var output = {};
      for (var i = 0; i < categories.length; i++) {
        var category = categories[i];
        var ids = String(category.ids || '')
          .split(',')
          .map(function (v) {
            return v.trim();
          })
          .filter(Boolean)
          .slice(0, 8);
        var details = await mapLimit(ids, 4, function (id) {
          return post(ott, id).catch(function () {
            return null;
          });
        });
        var items = [];
        for (var j = 0; j < details.length; j++) {
          if (details[j] && details[j].title) items.push(makeItem(ott, ids[j], details[j]));
        }
        if (items.length) output[category.cate || 'NetMirror'] = items;
      }
      cb({ success: true, data: output });
    } catch (e) {
      cb({ success: false, errorCode: 'HOME_ERROR', message: String(e && e.message ? e.message : e) });
    }
  }

  async function searchItems(query, cb) {
    try {
      var ott = currentOtt();
      var data = await search(ott, query);
      var results = (data.searchResult || []).slice(0, 12);
      var details = await mapLimit(results, 4, function (item) {
        return post(ott, item.id).catch(function () {
          return null;
        });
      });
      var items = [];
      for (var i = 0; i < details.length; i++) {
        if (details[i] && details[i].title) items.push(makeItem(ott, results[i].id, details[i]));
      }
      cb({ success: true, data: items });
    } catch (e) {
      cb({ success: false, errorCode: 'SEARCH_ERROR', message: String(e && e.message ? e.message : e) });
    }
  }

  function parseUrl(url) {
    var parts = String(url || '').split(':');
    return { ott: parts[1] || currentOtt(), id: parts[2] || '' };
  }

  async function buildEpisodes(ott, detail) {
    var out = [];
    var seasons = detail.season || [];
    var selectedIndex = -1;
    for (var i = 0; i < seasons.length; i++) {
      if (seasons[i].selected) {
        selectedIndex = i;
        break;
      }
    }
    if (selectedIndex < 0 && seasons.length) selectedIndex = 0;
    var selected = selectedIndex >= 0 ? seasons[selectedIndex] : null;

    function add(list, seasonNumber) {
      for (var k = 0; k < (list || []).length; k++) {
        var ep = list[k];
        if (!ep) continue;
        out.push(
          new Episode({
            name: ep.t || 'Episode ' + ep.ep,
            url: 'netmirror:' + ott + ':' + ep.id,
            season: parseInt(String(ep.s || '').replace(/\D/g, ''), 10) || seasonNumber || 1,
            episode: parseInt(String(ep.ep || '').replace(/\D/g, ''), 10) || undefined,
            runtime: episodeRuntime(ep.info),
            posterUrl: poster(detail.ep_poster, ep.id)
          })
        );
      }
    }

    add(detail.episodes, selectedIndex + 1);

    if (selected) {
      if (detail.nextPageShow === 1) {
        for (var page = 2; page < 50; page++) {
          var more = await episodes(ott, selected.id, page);
          add(more.episodes, selectedIndex + 1);
          if (more.nextPageShow !== 1) break;
        }
      }
      for (var s = 0; s < seasons.length; s++) {
        if (!seasons[s].id || seasons[s].id === selected.id) continue;
        for (var p = 1; p < 50; p++) {
          var seasonData = await episodes(ott, seasons[s].id, p);
          add(seasonData.episodes, s + 1);
          if (seasonData.nextPageShow !== 1) break;
        }
      }
    }

    var seen = {};
    return out.filter(function (ep) {
      if (seen[ep.url]) return false;
      seen[ep.url] = true;
      return true;
    });
  }

  async function load(url, cb) {
    try {
      var parsed = parseUrl(url);
      var detail = await post(parsed.ott, parsed.id);
      var item = makeItem(parsed.ott, parsed.id, detail);
      if (detail.type === 't' || (detail.episodes && detail.episodes.length)) {
        item.episodes = await buildEpisodes(parsed.ott, detail);
      }
      cb({ success: true, data: item });
    } catch (e) {
      cb({ success: false, errorCode: 'LOAD_ERROR', message: String(e && e.message ? e.message : e) });
    }
  }

  async function loadStreams(url, cb) {
    try {
      var parsed = parseUrl(url);
      var response = await player(parsed.ott, parsed.id);
      if (!response || !response.video_link) {
        cb({ success: true, data: [] });
        return;
      }
      cb({
        success: true,
        data: [
          new StreamResult({
            url: response.video_link,
            source: 'NetMirror â€¢ ' + LABELS[parsed.ott],
            quality: response.video_link.indexOf('.m3u8') >= 0 ? 'Auto' : undefined,
            headers: { Referer: response.referer || 'https://net52.cc' }
          })
        ]
      });
    } catch (e) {
      cb({ success: false, errorCode: 'STREAM_ERROR', message: String(e && e.message ? e.message : e) });
    }
  }

  globalThis.getHome = getHome;
  globalThis.search = searchItems;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();

