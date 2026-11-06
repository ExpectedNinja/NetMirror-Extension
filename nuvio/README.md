# Nuvio native scraper

No Node.js, server or Docker is required. Nuvio runs `providers/netmirror.js` in its QuickJS scraper runtime.

## Install

Add this repository in **Settings → Content & Discovery → Plugins**:

```
https://raw.githubusercontent.com/ExpectedNinja/NetMirror-Extension/master/nuvio/
```

Enable **NetMirror**.

## How it works

Nuvio passes a TMDB ID (`getStreams(tmdbId, mediaType, season, episode)`). The scraper calls NetMirror's `embed-tmdb` API and returns the direct MP4/HLS links, required headers and subtitle tracks.
