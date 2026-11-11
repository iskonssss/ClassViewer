// ClassView Keys — shows the keys and mouse buttons the trainer presses, with a label from the
// active shortcut set, in a small always-on-top overlay that can be dragged anywhere.
const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, globalShortcut, systemPreferences, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const C = require("./combo");
const DEFAULTS = require("./defaults");

const IS_MAC = process.platform === "darwin";
const TEST = process.env.CLASSVIEW_KEYS_TEST === "1";
if (!app.requestSingleInstanceLock()) { app.exit(0); }
if (process.env.CLASSVIEW_KEYS_USERDATA) app.setPath("userData", process.env.CLASSVIEW_KEYS_USERDATA);

// ---------- settings, saved as JSON in the app's data folder ----------
const CFG_FILE = () => path.join(app.getPath("userData"), "keys-config.json");
const clone = o => JSON.parse(JSON.stringify(o));
function defaultCfg() {
  return { activeSet: DEFAULTS[0].id, mode: "combos", fadeMs: 2200, scale: 1, pinned: true, visible: true, pos: null, sets: clone(DEFAULTS) };
}
let cfg = defaultCfg(), cfgLoaded = false;
function loadCfg() {
  try {
    const c = JSON.parse(fs.readFileSync(CFG_FILE(), "utf8"));
    if (c && Array.isArray(c.sets) && c.sets.length) cfg = Object.assign(defaultCfg(), c);
  } catch {}
  if (!cfg.sets.find(s => s.id === cfg.activeSet)) cfg.activeSet = cfg.sets[0].id;
  cfgLoaded = true;
}
let saveT = null;
function saveNow() { clearTimeout(saveT); fs.mkdirSync(app.getPath("userData"), { recursive: true }); fs.writeFileSync(CFG_FILE(), JSON.stringify(cfg, null, 2)); }
function saveCfg() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { fs.mkdirSync(app.getPath("userData"), { recursive: true }); fs.writeFileSync(CFG_FILE(), JSON.stringify(cfg, null, 2)); } catch {} }, 300);
}
const activeSet = () => cfg.sets.find(s => s.id === cfg.activeSet) || cfg.sets[0];

// ---------- windows ----------
let overlay = null, settingsWin = null, tray = null, closedOnce = false;
const BASE_W = 900, BASE_H = 150;

function createOverlay() {
  const s = cfg.scale || 1;
  const wa = screen.getPrimaryDisplay().workArea;
  const w = Math.round(BASE_W * s), h = Math.round(BASE_H * s);
  let pos = cfg.pos;
  const onScreen = p => p && screen.getAllDisplays().some(d => p.x >= d.bounds.x - 50 && p.y >= d.bounds.y - 50 && p.x < d.bounds.x + d.bounds.width - 60 && p.y < d.bounds.y + d.bounds.height - 40);
  if (!onScreen(pos)) pos = { x: wa.x + 24, y: wa.y + wa.height - h - 24 };
  overlay = new BrowserWindow({
    x: pos.x, y: pos.y, width: w, height: h,
    frame: false, transparent: true, resizable: false, movable: true, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, focusable: false, alwaysOnTop: !!cfg.pinned, show: false,
    backgroundColor: "#00000000",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  if (cfg.pinned) overlay.setAlwaysOnTop(true, "screen-saver");
  if (IS_MAC) overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, "overlay.html"));
  overlay.once("ready-to-show", () => { if (cfg.visible) overlay.showInactive(); pushState(); });
  overlay.on("closed", () => { overlay = null; });
}

function openSettings() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 980, height: 760, minWidth: 720, minHeight: 520, title: "ClassView Keys — Settings",
    icon: path.join(__dirname, "icon.png"), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  settingsWin.loadFile(path.join(__dirname, "settings.html"));
  settingsWin.on("closed", () => { settingsWin = null; recording = false; if (!closedOnce) { closedOnce = true; flash("Still running · click here to quit"); } });
}

// Everything the windows need to draw themselves
function state() {
  return { cfg, isMac: IS_MAC, platform: process.platform, version: app.getVersion(), trusted: inputAllowed(), hookOk, hookErr,
    startup: startupGet() };
}
function pushState() {
  const st = state();
  for (const w of [overlay, settingsWin]) if (w && !w.isDestroyed()) w.webContents.send("state", st);
  buildTray();
}

// ---------- global keyboard + mouse capture ----------
let hook = null, hookOk = false, hookErr = "";
const held = new Set();          // keycodes currently down (to ignore auto-repeat)
let mouse = null;                // { button, x, y, mods, dragged }
let recording = false;

function inputAllowed() {
  if (!IS_MAC) return true;
  try { return systemPreferences.isTrustedAccessibilityClient(false); } catch { return false; }
}
function modsOf(e) { return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Cmd"].filter(Boolean); }

function startHook() {
  if (hookOk) return;
  if (!inputAllowed()) { hookErr = "permission"; return; }
  try {
    const { uIOhook, UiohookKey } = require("uiohook-napi");
    const NAME = {}; for (const [k, v] of Object.entries(UiohookKey)) if (NAME[v] === undefined) NAME[v] = k;
    const MODKEY = { Ctrl: "Ctrl", CtrlRight: "Ctrl", Alt: "Alt", AltRight: "Alt", Shift: "Shift", ShiftRight: "Shift", Meta: "Cmd", MetaRight: "Cmd" };
    uIOhook.on("keydown", e => {
      if (held.has(e.keycode)) return; // auto-repeat
      held.add(e.keycode);
      const raw = NAME[e.keycode];
      if (!raw) return;
      if (MODKEY[raw]) { emit([...new Set([...modsOf(e), MODKEY[raw]])].sort((a, b) => C.MODS.indexOf(a) - C.MODS.indexOf(b)).join("+"), true); return; }
      const key = C.KEY_NAME[raw] || raw;
      emit([...modsOf(e), key].join("+"));
    });
    uIOhook.on("keyup", e => { held.delete(e.keycode); });
    const BTN = { 1: "Left", 2: "Right", 3: "Middle" };
    uIOhook.on("mousedown", e => {
      const b = BTN[e.button]; if (!b) return;
      mouse = { button: b, x: e.x, y: e.y, mods: modsOf(e), dragged: false, clicks: e.clicks };
    });
    const onMove = e => {
      if (dragWin) moveDrag();
      if (!mouse || mouse.dragged) return;
      if (Math.hypot(e.x - mouse.x, e.y - mouse.y) > 10) { mouse.dragged = true; emit([...mouse.mods, mouse.button + " Drag"].join("+")); }
    };
    uIOhook.on("mousemove", onMove);
    uIOhook.on("mousedrag", onMove);
    uIOhook.on("mouseup", e => {
      if (dragWin) endDrag();
      const m = mouse; mouse = null;
      if (!m || m.dragged) return;
      const what = m.button === "Left" && (e.clicks || m.clicks) >= 2 ? "Double Click" : m.button + " Click";
      emit([...m.mods, what].join("+"));
    });
    uIOhook.on("wheel", e => { emit([...modsOf(e), "Scroll"].join("+")); });
    uIOhook.start();
    hookOk = true; hookErr = "";
  } catch (e) { hookOk = false; hookErr = String((e && e.message) || e); }
}

let lastEmit = { combo: "", at: 0 };
function emit(combo, modifierOnly) {
  const set = activeSet();
  if (recording && settingsWin && !modifierOnly) { recording = false; settingsWin.webContents.send("recorded", combo); }
  const item = modifierOnly ? null : C.findItem(set.items, combo, IS_MAC);
  if (modifierOnly ? cfg.mode !== "all" : !C.shouldShow(cfg.mode, combo, !!item)) return;
  const now = Date.now();
  // scroll and repeated combos just keep the current display alive
  const repeat = combo === lastEmit.combo && now - lastEmit.at < cfg.fadeMs;
  lastEmit = { combo, at: now };
  if (TEST) console.log("SHOW " + combo + (item ? " = " + item.label : ""));
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send("show", { combo, label: item ? item.label : "", listed: !!item, repeat });
}

// ---------- dragging the overlay (done here, so the overlay never has to take focus) ----------
let dragWin = null;
ipcMain.on("drag-start", () => {
  if (!overlay) return;
  const c = screen.getCursorScreenPoint(), b = overlay.getBounds();
  dragWin = { dx: c.x - b.x, dy: c.y - b.y, sx: c.x, sy: c.y, moved: false, timer: setInterval(moveDrag, 16) };
});
function moveDrag() {
  if (!dragWin || !overlay) return;
  const c = screen.getCursorScreenPoint();
  if (Math.hypot(c.x - dragWin.sx, c.y - dragWin.sy) > 4) dragWin.moved = true;
  if (dragWin.moved) overlay.setPosition(Math.round(c.x - dragWin.dx), Math.round(c.y - dragWin.dy));
}
function endDrag() {
  if (!dragWin) return;
  clearInterval(dragWin.timer);
  const moved = dragWin.moved; dragWin = null;
  if (moved && overlay) { const [x, y] = overlay.getPosition(); cfg.pos = { x, y }; saveCfg(); }
  else popupMenu();
}
ipcMain.on("drag-end", endDrag);   // fallback when the global hook isn't running
ipcMain.on("mouse-ignore", (_e, ignore) => { if (overlay) overlay.setIgnoreMouseEvents(!!ignore, { forward: true }); });

// ---------- menu (click the overlay badge, or the tray icon) ----------
function menuTemplate() {
  const mk = (label, accel) => ({ label, accelerator: accel, registerAccelerator: false });
  return [
    ...cfg.sets.map(s => ({ label: s.name, type: "radio", checked: s.id === cfg.activeSet, click: () => setActive(s.id) })),
    { type: "separator" },
    { label: "Show", submenu: [
      { label: "Only my listed shortcuts", type: "radio", checked: cfg.mode === "listed", click: () => setMode("listed") },
      { label: "Shortcuts and combos (hide typing)", type: "radio", checked: cfg.mode === "combos", click: () => setMode("combos") },
      { label: "Every key and click", type: "radio", checked: cfg.mode === "all", click: () => setMode("all") },
    ] },
    { label: "Keep on top", type: "checkbox", checked: !!cfg.pinned, click: () => setPinned(!cfg.pinned) },
    { ...mk(cfg.visible ? "Hide overlay" : "Show overlay", IS_MAC ? "Cmd+Alt+K" : "Ctrl+Alt+K"), click: toggleVisible },
    { ...mk("Next shortcut set", IS_MAC ? "Cmd+Alt+N" : "Ctrl+Alt+N"), click: nextSet },
    { type: "separator" },
    { label: "Edit shortcuts and settings…", click: openSettings },
    { label: "Quit ClassView Keys", click: quitApp },
  ];
}
function popupMenu() { Menu.buildFromTemplate(menuTemplate()).popup({ window: overlay || undefined }); }
function buildTray() {
  if (!tray) return;
  tray.setToolTip("ClassView Keys — " + activeSet().name);
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

function setActive(id) { if (cfg.sets.find(s => s.id === id)) { cfg.activeSet = id; saveCfg(); pushState(); flash(activeSet().name); } }
function nextSet() { const i = cfg.sets.findIndex(s => s.id === cfg.activeSet); setActive(cfg.sets[(i + 1) % cfg.sets.length].id); }
function setMode(m) { cfg.mode = m; saveCfg(); pushState(); }
function setPinned(on) { cfg.pinned = !!on; if (overlay) { overlay.setAlwaysOnTop(cfg.pinned, "screen-saver"); } saveCfg(); pushState(); }
function toggleVisible() { cfg.visible = !cfg.visible; if (overlay) cfg.visible ? overlay.showInactive() : overlay.hide(); saveCfg(); pushState(); }
function flash(text) { if (overlay) overlay.webContents.send("flash", text); }

// ---------- requests from the Settings window ----------
ipcMain.handle("get-state", () => state());
ipcMain.handle("save-cfg", (_e, next) => {
  if (!next || !Array.isArray(next.sets) || !next.sets.length) return false;
  const oldScale = cfg.scale;
  cfg = Object.assign(cfg, {
    sets: next.sets.map(s => ({ id: String(s.id), name: String(s.name || "Untitled").slice(0, 60),
      items: (s.items || []).map(it => ({ keys: String(it.keys || "").slice(0, 80), label: String(it.label || "").slice(0, 120) })) })),
    activeSet: String(next.activeSet), mode: ["listed", "combos", "all"].includes(next.mode) ? next.mode : "combos",
    fadeMs: Math.max(600, Math.min(15000, Number(next.fadeMs) || 2200)), scale: Math.max(0.6, Math.min(2, Number(next.scale) || 1)),
  });
  if (!cfg.sets.find(s => s.id === cfg.activeSet)) cfg.activeSet = cfg.sets[0].id;
  if (Boolean(next.pinned) !== cfg.pinned) setPinned(next.pinned);
  saveCfg();
  if (overlay && oldScale !== cfg.scale) { const [x, y] = overlay.getPosition(); overlay.setBounds({ x, y, width: Math.round(BASE_W * cfg.scale), height: Math.round(BASE_H * cfg.scale) }); }
  pushState();
  return true;
});
ipcMain.handle("record", (_e, on) => { recording = !!on; return true; });
ipcMain.handle("normalize", (_e, s) => C.normalize(s));
ipcMain.handle("defaults", () => clone(DEFAULTS));
ipcMain.handle("export", async () => {
  const r = await dialog.showSaveDialog(settingsWin, { defaultPath: "classview-keys-shortcuts.json", filters: [{ name: "JSON", extensions: ["json"] }] });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, JSON.stringify({ sets: cfg.sets }, null, 2)); return true;
});
ipcMain.handle("import", async () => {
  const r = await dialog.showOpenDialog(settingsWin, { properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  try { const d = JSON.parse(fs.readFileSync(r.filePaths[0], "utf8")); return Array.isArray(d.sets) ? d.sets : null; } catch { return null; }
});
ipcMain.handle("ask-permission", () => { if (IS_MAC) { try { systemPreferences.isTrustedAccessibilityClient(true); } catch {} shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"); } return true; });
ipcMain.handle("relaunch", () => { app.relaunch(); app.exit(0); });

// Start with the computer (optional). The portable Windows .exe runs from a temp folder, so use its real path.
const EXE_PATH = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
function startupGet() { try { return !!app.getLoginItemSettings(IS_MAC ? {} : { path: EXE_PATH }).openAtLogin; } catch { return false; } }
ipcMain.handle("startup-set", (_e, on) => { try { app.setLoginItemSettings(IS_MAC ? { openAtLogin: !!on } : { openAtLogin: !!on, path: EXE_PATH }); } catch {} pushState(); return startupGet(); });

// ---------- start ----------
app.whenReady().then(() => {
  loadCfg();
  if (IS_MAC && app.dock) app.dock.hide();   // lives in the menu bar; keeps the overlay above full-screen apps
  createOverlay();
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, IS_MAC ? "trayTemplate.png" : "icon.png")).resize({ width: 16, height: 16 });
    if (IS_MAC) img.setTemplateImage(true);
    tray = new Tray(img);
    tray.on("click", () => { if (!IS_MAC) tray.popUpContextMenu(); });
  } catch {}
  buildTray();
  globalShortcut.register(IS_MAC ? "Command+Alt+K" : "Control+Alt+K", toggleVisible);
  globalShortcut.register(IS_MAC ? "Command+Alt+N" : "Control+Alt+N", nextSet);
  startHook();
  if (!hookOk || !process.argv.includes("--startup")) { if (!hookOk || !fs.existsSync(CFG_FILE())) openSettings(); }
  saveCfg();
  // on a Mac, notice when the permission has been granted
  if (IS_MAC && !hookOk) { const t = setInterval(() => { if (inputAllowed()) { clearInterval(t); pushState(); } }, 2000); }
});
app.on("second-instance", openSettings);
app.on("window-all-closed", e => { /* keep running in the tray */ });
// Quit for real, straight away. Ending the process also removes the keyboard/mouse hook, so we don't
// wait on the hook to stop (that wait is what can leave the app stuck in Task Manager).
function quitApp() {
  try { if (cfgLoaded) saveNow(); } catch {}
  try { globalShortcut.unregisterAll(); } catch {}
  try { tray && tray.destroy(); } catch {}
  app.exit(0);
  setTimeout(() => process.exit(0), 500);
}
ipcMain.handle("quit", () => quitApp());
app.on("before-quit", e => { e.preventDefault(); quitApp(); });
