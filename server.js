require("dotenv").config();
const express = require("express");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });
const PORT = process.env.PORT || 3000;
const MAX_CODE_LENGTH = 80000;
const SAVE_DELAY_MS = 500;      // batch rapid typing into one write
const EVICT_AFTER_MS = 5 * 60 * 1000; // drop idle rooms from memory (they stay in Supabase)
const ROOM_ID_RE = /^[A-Za-z0-9_-]{6,40}$/;

// ---------- Supabase ----------
const db = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;
if (!db) {
  console.error("\n[CodeRelay] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.");
  console.error("[CodeRelay] Copy .env.example to .env and fill them in. Workspaces cannot be created until then.\n");
}

// In-memory cache of active rooms. Supabase is the source of truth.
const rooms = new Map();
const loading = new Map();

app.use(express.json({ limit: "100kb" }));

// ---------- Favicon: auto-detected from ./favicon ----------
const FAVICON_DIR = path.join(__dirname, "favicon");
const FAVICON_TYPES = {
  ".ico": "image/x-icon", ".png": "image/png", ".svg": "image/svg+xml",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"
};
const DEFAULT_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1f1f23"/><g fill="none" stroke="#d9303e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M25 20 13 32l12 12"/><path d="M39 20l12 12-12 12"/></g></svg>`;
function findFavicon() {
  try {
    const files = fs.readdirSync(FAVICON_DIR)
      .filter(f => !f.startsWith(".") && FAVICON_TYPES[path.extname(f).toLowerCase()])
      .sort((a, b) => Number(b.toLowerCase().startsWith("favicon")) - Number(a.toLowerCase().startsWith("favicon")) || a.localeCompare(b));
    return files.length ? path.join(FAVICON_DIR, files[0]) : null;
  } catch { return null; }
}
app.get(["/favicon", "/favicon.ico"], (_req, res) => {
  res.set("Cache-Control", "no-cache");
  const file = findFavicon();
  if (file) return res.type(FAVICON_TYPES[path.extname(file).toLowerCase()]).sendFile(file);
  res.type("image/svg+xml").send(DEFAULT_FAVICON);
});

app.use(express.static(path.join(__dirname, "public")));

// ---------- Helpers ----------
function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest();
}
function isOwnerToken(room, token) {
  if (!room || typeof token !== "string" || !token) return false;
  const actual = tokenHash(token);
  return actual.length === room.ownerTokenHash.length && crypto.timingSafeEqual(actual, room.ownerTokenHash);
}
function publicState(id, room, socket) {
  return {
    id, code: room.code, language: room.language,
    participants: room.sockets.size, locked: room.locked,
    isOwner: Boolean(socket && socket.data.isOwner)
  };
}

// ---------- Persistence ----------
async function loadRoom(id) {
  if (rooms.has(id)) return rooms.get(id);
  if (!db || !ROOM_ID_RE.test(id)) return null;
  if (loading.has(id)) return loading.get(id);
  const job = (async () => {
    const { data, error } = await db.from("rooms").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const cached = rooms.get(id);
    if (cached) return cached;
    const room = {
      code: data.code, language: data.language, locked: data.locked,
      ownerTokenHash: Buffer.from(data.owner_token_hash, "hex"),
      createdAt: new Date(data.created_at).getTime(),
      sockets: new Set(), dirty: false, saveTimer: null, evictTimer: null
    };
    rooms.set(id, room);
    return room;
  })().finally(() => loading.delete(id));
  loading.set(id, job);
  return job;
}

async function saveRoom(id, room) {
  const { error } = await db.from("rooms").upsert({
    id, code: room.code, language: room.language, locked: room.locked,
    owner_token_hash: room.ownerTokenHash.toString("hex"),
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
}

function scheduleSave(id, room, delay = SAVE_DELAY_MS) {
  if (!db) return;
  room.dirty = true;
  clearTimeout(room.saveTimer);
  room.saveTimer = setTimeout(() => flushRoom(id, room), delay);
}

async function flushRoom(id, room) {
  clearTimeout(room.saveTimer);
  if (!room.dirty || !db) return;
  room.dirty = false;
  try {
    await saveRoom(id, room);
  } catch (err) {
    console.error(`[CodeRelay] Save failed for room ${id}:`, err.message || err);
    room.dirty = true;
    room.saveTimer = setTimeout(() => flushRoom(id, room), 3000); // retry
  }
}

function maybeEvict(id, room) {
  clearTimeout(room.evictTimer);
  if (room.sockets.size > 0) return;
  room.evictTimer = setTimeout(async () => {
    if (room.sockets.size > 0) return;
    await flushRoom(id, room);
    if (!room.dirty && room.sockets.size === 0) rooms.delete(id);
  }, EVICT_AFTER_MS);
}

async function flushAll() {
  await Promise.all([...rooms].map(([id, room]) => flushRoom(id, room)));
}

// ---------- HTTP API ----------
app.get("/health", (_req, res) => res.json({ ok: true, database: Boolean(db) }));

app.post("/api/rooms", async (req, res) => {
  if (!db) return res.status(503).json({ error: "Database is not configured on the server." });
  const code = typeof req.body.code === "string" ? req.body.code : "";
  const language = typeof req.body.language === "string" ? req.body.language.slice(0, 60) : "Plain text";
  if (code.length > MAX_CODE_LENGTH) return res.status(413).json({ error: "Code is too large. Maximum is 80,000 characters." });

  const id = crypto.randomBytes(9).toString("base64url");
  const ownerToken = crypto.randomBytes(32).toString("base64url");
  const room = {
    code, language, ownerTokenHash: tokenHash(ownerToken), locked: false,
    createdAt: Date.now(), sockets: new Set(), dirty: false, saveTimer: null, evictTimer: null
  };
  try {
    // Saved before the link is handed out, so a shared link always survives a restart.
    await saveRoom(id, room);
  } catch (err) {
    console.error("[CodeRelay] Create failed:", err.message || err);
    return res.status(500).json({ error: "Could not save the workspace. Please try again." });
  }
  rooms.set(id, room);
  // The owner token is returned once and stored only in that owner's browser.
  res.json({ id, ownerToken, shareUrl: `/room/${id}` });
});

app.get("/api/rooms/:id", async (req, res) => {
  try {
    const room = await loadRoom(req.params.id);
    if (!room) return res.status(404).json({ error: "This workspace does not exist. Create a new one." });
    res.json({ id: req.params.id, code: room.code, language: room.language, participants: room.sockets.size, locked: room.locked });
  } catch {
    res.status(500).json({ error: "Could not load the workspace." });
  }
});

app.get("/api/qr", async (req, res) => {
  const target = String(req.query.url || "");
  try {
    const parsed = new URL(target);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.host !== req.get("host")) {
      return res.status(400).json({ error: "Invalid workspace URL." });
    }
    const svg = await QRCode.toString(target, { type: "svg", margin: 1, width: 240, color: { dark: "#161618", light: "#ffffff" } });
    res.type("image/svg+xml").send(svg);
  } catch {
    res.status(400).json({ error: "Could not create QR code." });
  }
});

app.get("/room/:id", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// ---------- Realtime ----------
io.on("connection", socket => {
  socket.on("join-room", async ({ id, ownerToken } = {}) => {
    let room;
    try {
      room = await loadRoom(id);
    } catch (err) {
      console.error("[CodeRelay] Load failed:", err.message || err);
      socket.emit("room-error", "Could not load this workspace right now. Please retry in a moment.");
      return;
    }
    if (!room) {
      socket.emit("room-error", "This workspace does not exist. Check the link or create a new one.");
      return;
    }
    if (socket.data.roomId && socket.data.roomId !== id) {
      const old = rooms.get(socket.data.roomId);
      if (old) { old.sockets.delete(socket.id); maybeEvict(socket.data.roomId, old); }
      socket.leave(socket.data.roomId);
    }
    clearTimeout(room.evictTimer);
    socket.data.roomId = id;
    socket.data.isOwner = isOwnerToken(room, ownerToken);
    room.sockets.add(socket.id);
    socket.join(id);
    socket.emit("room-state", publicState(id, room, socket));
    io.to(id).emit("presence", { participants: room.sockets.size });
  });

  socket.on("set-lock", ({ id, ownerToken, locked } = {}) => {
    const room = rooms.get(id);
    if (!room || socket.data.roomId !== id || !isOwnerToken(room, ownerToken)) {
      socket.emit("permission-error", "Only the workspace owner can change the editing lock.");
      return;
    }
    room.locked = Boolean(locked);
    scheduleSave(id, room, 0);
    for (const socketId of room.sockets) {
      const peer = io.sockets.sockets.get(socketId);
      if (peer) peer.emit("lock-state", { locked: room.locked, isOwner: Boolean(peer.data.isOwner) });
    }
  });

  socket.on("edit", ({ id, code, language } = {}) => {
    const room = rooms.get(id);
    if (!room || socket.data.roomId !== id || (room.locked && !socket.data.isOwner) || typeof code !== "string" || code.length > MAX_CODE_LENGTH) {
      if (room && socket.data.roomId === id && room.locked && !socket.data.isOwner) {
        socket.emit("permission-error", "This workspace is locked by its owner. You can still view and copy the code.");
      }
      return;
    }
    room.code = code;
    if (typeof language === "string") room.language = language.slice(0, 60);
    scheduleSave(id, room);
    // Only the latest state is kept; there is no edit history.
    socket.to(id).emit("remote-edit", { code: room.code, language: room.language, from: socket.id });
  });

  socket.on("disconnect", () => {
    const id = socket.data.roomId;
    const room = id && rooms.get(id);
    if (room) {
      room.sockets.delete(socket.id);
      io.to(id).emit("presence", { participants: room.sockets.size });
      if (room.sockets.size === 0) flushRoom(id, room).then(() => maybeEvict(id, room));
    }
  });
});

// Flush pending edits when the server is stopped or redeployed.
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await flushAll();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(PORT, () => console.log(`CodeRelay running at http://localhost:${PORT}`));
