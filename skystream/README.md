# SkyStream native plugin

No Node.js, server or Docker is required. SkyStream runs `plugin.js` in its own JavaScript engine.

## Install

Add this repository in **Settings → Extensions → Add Repository**:

```
https://raw.githubusercontent.com/ExpectedNinja/NetMirror-Extension/master/skystream/repo.json
```

Install **NetMirror**, then enable Netflix, Prime Video and/or Hotstar in the plugin settings.

## Files

- `netmirror/plugin.json` — plugin manifest with three sub-providers (`nf`, `pv`, `hs`)
- `netmirror/plugin.js` — `getHome`, `search`, `load`, `loadStreams`
- `dist/plugins.json` — repository index fetched by SkyStream
- `dist/com.sushan64.netmirror.sky` — packaged plugin zip (`plugin.json` + `plugin.js`)

## Repackage after editing

```powershell
Compress-Archive `
  -Path skystream/netmirror/plugin.json, skystream/netmirror/plugin.js `
  -DestinationPath skystream/dist/com.sushan64.netmirror.sky `
  -CompressionLevel Optimal
```

The zip must contain `plugin.json` and `plugin.js` at its root.
