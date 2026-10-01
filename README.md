# ClassView

Classroom screen viewing and hands-on help for Forgecraft's Fusion 360 and Tinkercad lessons.

- **`index.html`** — the website. Trainers click *Start a class*; learners join with the class code.
  Learners can join in the browser (view only) or with the ClassView Helper app (adds remote control,
  full-screen "Eyes on me" and "Point").
- **`helper/`** — the ClassView Helper desktop app (Electron) for Windows and Mac.
- **`.github/workflows/build-helper.yml`** — builds the Helper on GitHub's Windows and Mac machines.
  Push a tag like `v0.1.1` to publish a new release; the website's download buttons always point at
  the latest release.

## Hosting the website
Settings → Pages → Build and deployment → Source: *Deploy from a branch* → `main` / `/ (root)`.
The site then lives at `https://iskonssss.github.io/ClassViewer/` (a custom domain can be added on the same page).

## Connection server
Learners and trainer find each other through the free public PeerJS server; video goes directly between
laptops where the network allows, otherwise via PeerJS's relay. For a self-hosted server, add
`?peerhost=…&peerport=…&peerpath=…` to the URL (website) or set `CLASSVIEW_PEERHOST` etc. (Helper).

© Forgecraft Pte Ltd. All rights reserved.
