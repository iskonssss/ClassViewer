// Turning raw key/mouse events into shortcut strings like "Ctrl+Shift+G" or "Shift+Right Drag",
// and matching them against the shortcut list. Pure functions, no Electron, so they can be tested.

const MODS = ["Ctrl", "Alt", "Shift", "Cmd"];   // "Cmd" = the ⌘ key on a Mac, the Windows key on a PC

// Canonical names for keys (by uiohook name) — what the overlay shows and what the list stores.
const KEY_NAME = {
  Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/",
  NumpadAdd: "Num +", NumpadSubtract: "Num -", NumpadMultiply: "Num *", NumpadDivide: "Num /",
  NumpadDecimal: "Num .", NumpadEnter: "Enter",
  NumpadEnd: "End", NumpadHome: "Home", NumpadPageUp: "PageUp", NumpadPageDown: "PageDown",
  NumpadInsert: "Insert", NumpadDelete: "Delete",
  NumpadArrowUp: "ArrowUp", NumpadArrowDown: "ArrowDown", NumpadArrowLeft: "ArrowLeft", NumpadArrowRight: "ArrowRight",
};
for (let i = 0; i <= 9; i++) KEY_NAME["Numpad" + i] = "Num " + i;

// Words people might type by hand in Settings, mapped to the canonical names.
const ALIAS = {
  control: "Ctrl", ctl: "Ctrl", ctrl: "Ctrl", cmd: "Cmd", command: "Cmd", meta: "Cmd", win: "Cmd", windows: "Cmd", super: "Cmd", "⌘": "Cmd",
  option: "Alt", opt: "Alt", alt: "Alt", shift: "Shift",
  esc: "Escape", escape: "Escape", del: "Delete", delete: "Delete", backspace: "Backspace", bksp: "Backspace",
  return: "Enter", enter: "Enter", space: "Space", spacebar: "Space", tab: "Tab", capslock: "CapsLock",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
  arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight",
  "↑": "ArrowUp", "↓": "ArrowDown", "←": "ArrowLeft", "→": "ArrowRight",
  pageup: "PageUp", pgup: "PageUp", pagedown: "PageDown", pgdn: "PageDown", home: "Home", end: "End", insert: "Insert", ins: "Insert",
  plus: "=", equals: "=", minus: "-", dash: "-",
  "left click": "Left Click", "right click": "Right Click", "middle click": "Middle Click", "double click": "Double Click",
  click: "Left Click", "left drag": "Left Drag", "right drag": "Right Drag", "middle drag": "Middle Drag",
  "right click drag": "Right Drag", "middle click drag": "Middle Drag", "left click drag": "Left Drag",
  scroll: "Scroll", wheel: "Scroll", "scroll wheel": "Scroll",
};
const MOUSE = new Set(["Left Click", "Right Click", "Middle Click", "Double Click", "Left Drag", "Right Drag", "Middle Drag", "Scroll"]);

function canonPart(p) {
  const t = String(p).trim();
  if (!t) return "";
  const a = ALIAS[t.toLowerCase()];
  if (a) return a;
  if (/^f\d{1,2}$/i.test(t)) return t.toUpperCase();
  if (/^num ?[0-9+\-*/.]$/i.test(t)) return "Num " + t.slice(-1);
  if (t.length === 1) return t.toUpperCase();
  return t.replace(/\b\w/g, c => c.toUpperCase());
}

// "ctrl + shift + g" → "Ctrl+Shift+G"; modifiers sorted; "" if nothing usable.
function normalize(str) {
  let s = String(str || "").trim();
  if (!s) return "";
  // allow a literal "+" key: "Ctrl++" or "Ctrl+ +"
  const parts = [];
  let rest = s;
  if (/\+\s*\+$/.test(rest)) { parts.push("="); rest = rest.replace(/\+\s*\+$/, ""); }
  for (const p of rest.split("+")) { const c = canonPart(p); if (c) parts.unshift(c); }
  const mods = MODS.filter(m => parts.includes(m));
  const main = parts.filter(p => !MODS.includes(p));
  if (main.length > 1) main.splice(1); // one main key/action per shortcut
  return [...mods, ...main].join("+");
}

function isMouse(main) { return MOUSE.has(main); }
// Keys that normally type text, so "combos only" mode hides them when pressed alone (or with just Shift)
function isTyping(main) { return main.length === 1 || main === "Space" || /^Num [0-9.]$/.test(main); }

// Find the shortcut-list entry for a combo. On a Mac, "Ctrl" in the list also matches Cmd.
function findItem(items, combo, isMac) {
  const c = normalize(combo);
  const tries = [c];
  if (isMac && c.includes("Cmd")) tries.push(normalize(c.replace("Cmd", "Ctrl")));
  for (const t of tries) for (const it of items || []) if (normalize(it.keys) === t) return it;
  return null;
}

// Decide whether to show a combo in the given mode: "listed" | "combos" | "all".
function shouldShow(mode, combo, listed) {
  if (mode === "all") return true;
  if (listed) return true;
  if (mode === "listed") return false;
  const parts = combo.split("+"), main = parts[parts.length - 1];
  const strongMod = parts.some(p => p === "Ctrl" || p === "Alt" || p === "Cmd");
  if (strongMod) return true;
  if (isMouse(main)) {
    if (main === "Left Click" || main === "Double Click" || main === "Left Drag" || main === "Scroll") return parts.includes("Shift");
    return true; // right / middle clicks and drags
  }
  if (MODS.includes(main)) return false;
  return !isTyping(main);
}

// How a canonical part is drawn on a keycap.
function capLabel(part, isMac) {
  if (part === "Cmd") return isMac ? "⌘ Cmd" : "⊞ Win";
  if (part === "Alt") return isMac ? "⌥ Option" : "Alt";
  if (part === "Ctrl") return isMac ? "Control" : "Ctrl";
  return { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc", Backspace: "⌫ Backspace", Enter: "Enter ⏎", Delete: "Del" }[part] || part;
}

module.exports = { MODS, KEY_NAME, normalize, findItem, shouldShow, capLabel, isMouse };
