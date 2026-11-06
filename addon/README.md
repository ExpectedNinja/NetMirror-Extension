# NetMirror addon

Stremio-protocol addon that resolves Netflix, Prime Video and Hotstar links from NetMirror. It works in Stremio, Nuvio, SkyStream and any other app that supports Stremio addons, on every platform those apps run on.

## Run

```bash
npm start
```

Default port: `7000`.

Add the manifest URL in your app:

```
http://<host>:7000/manifest.json
```

## Docker

```bash
docker build -t netmirror-addon .
docker run -p 7000:7000 netmirror-addon
```

## Environment

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `7000` | HTTP port |
| `PUBLIC_URL` | request host | Public base URL used on the landing page |
| `TMDB_READ_TOKEN` | empty | Optional TMDB v3 read token. Enables the faster IMDb â†’ TMDB â†’ `embed-tmdb` path. |
| `CATALOG_LIMIT` | `8` | Maximum items returned per catalog request |

## Endpoints

- `GET /manifest.json`
- `GET /catalog/{movie|series}/{catalogId}.json`
- `GET /meta/{movie|series}/{id}.json`
- `GET /stream/{movie|series}/{id}.json`
- `GET /health`

Supported stream IDs:

- `tt0137523` and `tt0944947:1:1`
- `tmdb:550` and `tmdb:1399:1:1`
- `netmirror:nf:26004747` and `netmirror:hs:1971002880:1:1`

## Rate-limit behaviour

All NetMirror requests go through one queue with a 300 ms gap. Responses are cached with TTLs (main 5 min, search 10 min, post 15 min, episodes 30 min, player 60 s) and duplicate in-flight requests are coalesced. `429`, `5xx` and `403` responses are retried with exponential backoff; a `403` also re-resolves the NewTV API base.


