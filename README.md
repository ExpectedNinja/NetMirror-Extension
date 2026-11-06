### 🕹 Tools and Programming languages used :
<p align="left">
  <a href="https://skillicons.dev">
    <img src="https://skillicons.dev/icons?i=kotlin,androidstudio,gradle,github,githubactions&theme=light&perline=5" />
  </a>
</p>

### Requirements

Cloud Stream ( To install : [View Docs](https://recloudstream.github.io/csdocs/) )

### To Install Repo

1) Manual Install (Copy and Paste in add Repo of Cloud Stream) :

        https://raw.githubusercontent.com/ExpectedNinja/NetMirror-Extension/refs/heads/builds/Netflix.json

### What changed

- Fixed "too many requests": providers now share one rate-limited NewTV client with caching and 429/5xx retry/backoff.
- Fixed playback links (`status: "otp"`) and updated the new season/episode/metadata fields.
- Removed the separate Disney provider; Hotstar already includes Disney+ content.
- Added native SkyStream and Nuvio plugins that run without Node:
  - SkyStream repo: `https://raw.githubusercontent.com/ExpectedNinja/NetMirror-Extension/master/skystream/repo.json`
  - Nuvio repo: `https://raw.githubusercontent.com/ExpectedNinja/NetMirror-Extension/master/nuvio/`
- Added a Stremio addon (Node 18+) for Stremio and other Stremio-compatible apps; see `addon/README.md`.

### License
[![GNU GPLv3 Image](https://www.gnu.org/graphics/gplv3-127x51.png)](http://www.gnu.org/licenses/gpl-3.0.en.html)

These extensions are Free: You can use, study, share and modify it at your will. They can be redistributed and/or modified under the terms of the
[GNU General Public License](https://www.gnu.org/licenses/gpl.html) version 3 or later published by the Free Software Foundation.


### DMCA
We hereby issue this notice to inform you that these extensions just function like an ordinary browser (like your browser) that fetch video files from internet,
and do not violate the provisions of the Digital Millennium Copyright Act (DMCA). 
The Content these extensions may access is not hosted by us or the Cloudstream 3 application but the websites they are browsing in their autonomous mode. It is sole responsibility 
of the user and his/her countries' or states' law. If you think they are violating any intellectual property then please contact the actual file hosts not the owners of this repository or the CloudStream 3 app.

Thank You.
