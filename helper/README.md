# ClassView Helper (source)

Electron app that shares the learner's main screen with the ClassView trainer page
and, only after the learner clicks Allow, turns the trainer's mouse and keyboard into
real input (via @jitsi/robotjs, MIT licence).

Build:
  npm install
  npx electron-builder --win portable --x64      # Windows single-file .exe
  npx electron-builder --mac dir --arm64 --x64   # macOS .app (sign on a Mac for release)

Dev/testing env vars: CLASSVIEW_PEERHOST / PEERPORT / PEERPATH / PEERSECURE (self-hosted
PeerJS server), CLASSVIEW_DEBUG=1 (log renderer console), CLASSVIEW_AUTOJOIN=CODE:Name.
