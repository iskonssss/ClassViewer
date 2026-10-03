// ClassView Helper — main process.
// Shares the primary screen with the trainer and, only while the learner has
// approved it, turns the trainer's mouse/keyboard messages into real input.
const { app, BrowserWindow, ipcMain, desktopCapturer, session, screen,
        systemPreferences, shell, globalShortcut, Notification } = require("electron");
const path = require("path");

const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";

let robot = null, robotErr = null;
try {
  robot = require("@jitsi/robotjs");
  robot.setMouseDelay(0);
  robot.setKeyboardDelay(0);
} catch (e) { robotErr = String(e && e.message || e); }

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null, bar = null, controlling = false, trainerPlatform = "win";

// The portable Windows .exe unpacks to a temp folder each run; PORTABLE_EXECUTABLE_FILE is the real file.
const EXE_PATH = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
const LAUNCHED_AT_STARTUP = process.argv.includes("--startup") || (IS_MAC && app.getLoginItemSettings().wasOpenedAtLogin);
const ICON = path.join(__dirname, "icon.png");

function createWindow() {
  win = new BrowserWindow({
    width: 480, height: 760, minWidth: 380, minHeight: 560,
    title: "ClassView Helper",
    icon: ICON,
    show: !LAUNCHED_AT_STARTUP,
    backgroundColor: "#eef1f3",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, "app.html"));
  if (LAUNCHED_AT_STARTUP) win.once("ready-to-show", () => { win.showInactive(); win.minimize(); });
  if (process.env.CLASSVIEW_DEBUG) {
    win.webContents.on("console-message", (e) => console.log("[renderer]", e.level, e.message));
    win.webContents.on("preload-error", (_e, p, err) => console.log("[preload-error]", p, err));
    win.webContents.on("did-fail-load", (_e, c, d) => console.log("[fail-load]", c, d));
  }
  win.on("closed", () => { win = null; endControl(); eyesOff(); try { pointWin && pointWin.destroy(); } catch {} app.quit(); });
}

function createBar() {
  if (bar) return bar;
  const wa = screen.getPrimaryDisplay().workArea;
  const W = 380, H = 46;
  bar = new BrowserWindow({
    width: W, height: H, x: wa.x + wa.width - W - 16, y: wa.y + wa.height - H - 16,
    frame: false, resizable: false, movable: true, minimizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, hasShadow: true,
    backgroundColor: "#7a3fd0",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  bar.setAlwaysOnTop(true, "screen-saver");
  if (IS_MAC) bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bar.loadFile(path.join(__dirname, "bar.html"));
  bar.on("closed", () => { bar = null; });
  return bar;
}

app.whenReady().then(() => {
  // Always share the whole primary screen, without a picker.
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
      const primary = String(screen.getPrimaryDisplay().id);
      const src = sources.find(s => s.display_id === primary) || sources[0];
      cb(src ? { video: src } : {});
    } catch (e) { cb({}); }
  });
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(["media", "display-capture", "notifications", "clipboard-sanitized-write"].includes(perm)));
  createWindow();
  createBar();
});
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => { try { globalShortcut.unregisterAll(); } catch {} releaseAll(); eyesOff(); try { pointWin && pointWin.destroy(); } catch {} });

// ---------- permissions ----------
function permissions() {
  if (!IS_MAC) return { screen: "granted", accessibility: true };
  let scr = "unknown";
  try { scr = systemPreferences.getMediaAccessStatus("screen"); } catch {}
  let acc = false;
  try { acc = systemPreferences.isTrustedAccessibilityClient(false); } catch {}
  return { screen: scr, accessibility: acc };
}

ipcMain.handle("env", () => ({
  platform: process.platform,
  version: app.getVersion(),
  robotOk: !!robot, robotErr,
  peer: process.env.CLASSVIEW_PEERHOST ? {
    host: process.env.CLASSVIEW_PEERHOST,
    port: Number(process.env.CLASSVIEW_PEERPORT || 443),
    path: process.env.CLASSVIEW_PEERPATH || "/",
    secure: process.env.CLASSVIEW_PEERSECURE !== "0",
  } : null,
  autoJoin: process.env.CLASSVIEW_AUTOJOIN || null,
  startup: LAUNCHED_AT_STARTUP,
  testAutoAllow: process.env.CLASSVIEW_TEST_AUTOALLOW === "1",
}));
ipcMain.handle("permissions", () => permissions());
// "Start when this computer starts" (opt-in, per laptop)
function loginOpts(on){ return IS_WIN ? { openAtLogin: on, path: EXE_PATH, args: ["--startup"] } : { openAtLogin: on }; }
ipcMain.handle("startup-get", () => {
  try { const s = IS_WIN ? app.getLoginItemSettings({ path: EXE_PATH, args: ["--startup"] }) : app.getLoginItemSettings(); return !!s.openAtLogin; } catch { return false; }
});
ipcMain.handle("startup-set", (_e, on) => { try { app.setLoginItemSettings(loginOpts(!!on)); return true; } catch { return false; } });
ipcMain.handle("ask-accessibility", () => { if (IS_MAC) { try { return systemPreferences.isTrustedAccessibilityClient(true); } catch { return false; } } return true; });
ipcMain.handle("open-settings", (_e, which) => {
  if (!IS_MAC) return;
  const pane = which === "screen" ? "Privacy_ScreenCapture" : "Privacy_Accessibility";
  shell.openExternal("x-apple.systempreferences:com.apple.preference.security?" + pane);
});
ipcMain.handle("relaunch", () => { app.relaunch(); app.exit(0); });
ipcMain.handle("minimize", () => { if (win && !win.isMinimized()) win.minimize(); });
ipcMain.handle("attention", (_e, text) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  win.setAlwaysOnTop(true); setTimeout(() => win && win.setAlwaysOnTop(false), 1500);
  if (IS_MAC) { try { app.dock.bounce("critical"); } catch {} } else { win.flashFrame(true); }
  try { if (Notification.isSupported()) new Notification({ title: "ClassView Helper", body: text || "Your trainer is asking to control your laptop" }).show(); } catch {}
});

// ---------- control session ----------
ipcMain.handle("control-start", (_e, platform) => {
  releaseAll();
  controlling = true;
  lastInputAt = Date.now();
  trainerPlatform = platform === "mac" ? "mac" : "win";
  const b = createBar();
  const show = () => { if (bar) bar.showInactive(); };
  if (b.webContents.isLoading()) b.webContents.once("did-finish-load", show); else show();
  try {
    globalShortcut.register("CommandOrControl+Shift+X", () => { if (win) win.webContents.send("stop-hotkey"); });
  } catch {}
  if (win) win.minimize();
  return true;
});
ipcMain.handle("control-end", () => { endControl(); return true; });
ipcMain.on("bar-stop", () => { if (win) win.webContents.send("stop-hotkey"); });

// ---------- "Point": a ring on the learner's screen, click-through, no control ----------
let pointWin = null, pointHideT = null, pointReady = null;
function getPointWin() {
  if (pointWin) return pointWin;
  const d = screen.getPrimaryDisplay();
  pointWin = new BrowserWindow({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    transparent: true, frame: false, resizable: false, movable: false, focusable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false, enableLargerThanScreen: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  pointWin.setIgnoreMouseEvents(true);
  pointWin.setAlwaysOnTop(true, "screen-saver");
  if (IS_MAC) pointWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pointReady = new Promise(r => pointWin.webContents.once("did-finish-load", r));
  pointWin.loadFile(path.join(__dirname, "point.html"));
  pointWin.on("closed", () => { pointWin = null; });
  return pointWin;
}
ipcMain.handle("point", async (_e, x, y) => {
  const w = getPointWin();
  await pointReady;
  w.setBounds(screen.getPrimaryDisplay().bounds);
  w.webContents.send("point", { x: Number(x) || 0, y: Number(y) || 0 });
  w.showInactive();
  clearTimeout(pointHideT);
  pointHideT = setTimeout(() => { if (pointWin) pointWin.hide(); }, 4500);
  return true;
});

// ---------- "Eyes on me": cover every display until the trainer releases ----------
let eyesWins = [], eyesTimer = null;
ipcMain.handle("eyes", (_e, on, text) => { if (on) eyesOn(String(text || "")); else eyesOff(); return true; });
function eyesOn(text) {
  eyesOff();
  for (const d of screen.getAllDisplays()) {
    const w = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, closable: false,
      fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, show: false, backgroundColor: "#10161b",
      enableLargerThanScreen: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    w.setAlwaysOnTop(true, "screen-saver");
    if (IS_MAC) w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    w.loadFile(path.join(__dirname, "eyes.html"), { query: { text } });
    w.once("ready-to-show", () => { w.setBounds(d.bounds); w.show(); w.focus(); });
    eyesWins.push(w);
  }
  // Safety net: never leave a screen covered for more than 15 minutes.
  eyesTimer = setTimeout(eyesOff, 15 * 60 * 1000);
}
function eyesOff() {
  clearTimeout(eyesTimer); eyesTimer = null;
  for (const w of eyesWins) { try { w.setClosable(true); w.destroy(); } catch {} }
  eyesWins = [];
}

function endControl() {
  const was = controlling;
  controlling = false;
  releaseAll();
  try { globalShortcut.unregister("CommandOrControl+Shift+X"); } catch {}
  if (bar) bar.hide();
  // Stay out of the learner's way: the window was minimized when control started, so leave it there.
}

// ---------- input injection ----------
const buttons = new Set();     // mouse buttons currently held
const mods = new Set();        // robot modifier names currently held
const keysDown = new Set();    // robot key names currently held
let size = null, sizeAt = 0;
function screenSize() {
  const now = Date.now();
  if (!size || now - sizeAt > 3000) { try { size = robot.getScreenSize(); } catch { size = { width: 1920, height: 1080 }; } sizeAt = now; }
  return size;
}
function pt(nx, ny) {
  const s = screenSize();
  const c = v => Math.min(1, Math.max(0, Number(v) || 0));
  return [Math.round(c(nx) * (s.width - 1)), Math.round(c(ny) * (s.height - 1))];
}

const CODE_MAP = {
  Enter: "enter", NumpadEnter: "enter", Backspace: "backspace", Tab: "tab", Escape: "escape", Space: "space",
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  Home: "home", End: "end", PageUp: "pageup", PageDown: "pagedown", Delete: "delete", Insert: "insert",
  CapsLock: "capslock", ContextMenu: "menu", PrintScreen: "printscreen",
  Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";",
  Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`", IntlBackslash: "\\",
  NumpadAdd: "numpad_+", NumpadSubtract: "numpad_-", NumpadMultiply: "numpad_*", NumpadDivide: "numpad_/", NumpadDecimal: "numpad_.",
};
// Modifier keys, with Ctrl/Cmd swapped when trainer and learner use different systems,
// so the trainer's usual shortcuts (copy, undo…) do the expected thing on the learner's laptop.
function modName(code) {
  const learnerMac = IS_MAC, trainerMac = trainerPlatform === "mac";
  if (code.startsWith("Shift")) return "shift";
  if (code.startsWith("Alt")) return "alt";
  if (code.startsWith("Control")) return (!trainerMac && learnerMac) ? "command" : "control";
  if (code.startsWith("Meta") || code.startsWith("OS")) {
    if (trainerMac && !learnerMac) return "control";
    return "command";
  }
  return null;
}
function keyName(code) {
  if (!code) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return "numpad_" + code.slice(6);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code.toLowerCase();
  return CODE_MAP[code] || null;
}

function releaseAll() {
  if (!robot) return;
  for (const b of buttons) { try { robot.mouseToggle("up", b); } catch {} }
  buttons.clear();
  for (const k of keysDown) { try { robot.keyToggle(k, "up"); } catch {} }
  keysDown.clear();
  for (const m of mods) { try { robot.keyToggle(m, "up"); } catch {} }
  mods.clear();
}

// Safety net: if the trainer's connection hiccups and a "release" message is lost, never leave a
// mouse button or key held down on the learner's laptop for more than a few seconds of silence.
let lastInputAt = 0;
setInterval(() => {
  if ((buttons.size || mods.size || keysDown.size) && Date.now() - lastInputAt > 6000) releaseAll();
}, 1000);

ipcMain.on("input", (_e, m) => {
  if (!controlling || !robot || !m || typeof m !== "object") return;
  lastInputAt = Date.now();
  try {
    switch (m.e) {
      case "mm": {
        const [x, y] = pt(m.x, m.y);
        if (buttons.size) robot.dragMouse(x, y, [...buttons][0]); else robot.moveMouse(x, y);
        break;
      }
      case "md": {
        if (!["left", "right", "middle"].includes(m.b)) return;
        const [x, y] = pt(m.x, m.y);
        robot.moveMouse(x, y);
        robot.mouseToggle("down", m.b);
        buttons.add(m.b);
        break;
      }
      case "mu": {
        if (!["left", "right", "middle"].includes(m.b)) return;
        const [x, y] = pt(m.x, m.y);
        if (buttons.size) robot.dragMouse(x, y, m.b); else robot.moveMouse(x, y);
        robot.mouseToggle("up", m.b);
        buttons.delete(m.b);
        break;
      }
      case "wh": {
        const n = Math.max(-20, Math.min(20, Number(m.n) || 0));
        if (m.x != null) { const [x, y] = pt(m.x, m.y); robot.moveMouse(x, y); }
        if (IS_WIN) robot.scrollMouse(0, Math.round(n * 120));
        else if (IS_MAC) robot.scrollMouse(0, Math.round(n * 24));
        else robot.scrollMouse(0, Math.round(n) || Math.sign(n));
        break;
      }
      case "kd":
      case "ku": {
        const dir = m.e === "kd" ? "down" : "up";
        const mod = modName(String(m.code || ""));
        if (mod) {
          robot.keyToggle(mod, dir);
          if (dir === "down") mods.add(mod); else mods.delete(mod);
          return;
        }
        const k = keyName(String(m.code || ""));
        if (!k) return;
        if (IS_MAC) robot.keyToggle(k, dir, [...mods]); else robot.keyToggle(k, dir);
        if (dir === "down") keysDown.add(k); else keysDown.delete(k);
        break;
      }
      case "allup": releaseAll(); break;
    }
  } catch (e) { /* ignore a single bad event */ }
});
