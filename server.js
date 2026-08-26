const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// ---------- Persistence ----------
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { users: {}, groups: {}, messages: {} };
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return { users: {}, groups: {}, messages: {} };
  }
}
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}
let db = loadData();

// Seed the admin account on first run
(function seedAdmin() {
  const hasAdmin = Object.values(db.users).some((u) => u.isAdmin);
  if (!hasAdmin) {
    const id = crypto.randomBytes(8).toString("hex");
    db.users[id] = {
      id,
      username: ADMIN_USERNAME,
      passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      isAdmin: true,
      createdAt: Date.now(),
    };
    saveData();
    console.log(`Admin account ready -> username: "${ADMIN_USERNAME}"  password: "${ADMIN_PASSWORD}"`);
    console.log("Isay pehli fursat me ADMIN_USERNAME/ADMIN_PASSWORD env vars se change kar dein.");
  }
})();

// ---------- Tiny cookie-based sessions (no extra deps) ----------
const sessions = new Map(); // token -> userId

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function currentUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.relay_session;
  const userId = token && sessions.get(token);
  return userId ? db.users[userId] : null;
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "not_authenticated" });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: "not_admin" });
  next();
}

// ---------- Static + body parsing ----------
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Any route just serves the single-page app; the frontend figures out
// which screen to show based on /api/me.
app.get(["/", "/room/*"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- Auth ----------
app.post("/api/register", (req, res) => {
  const username = (req.body.username || "").trim().slice(0, 30);
  const password = req.body.password || "";
  if (username.length < 3) return res.status(400).json({ error: "Username kam se kam 3 characters ka ho." });
  if (password.length < 4) return res.status(400).json({ error: "Password kam se kam 4 characters ka ho." });

  const exists = Object.values(db.users).some((u) => u.username.toLowerCase() === username.toLowerCase());
  if (exists) return res.status(400).json({ error: "Ye username pehle se le liya gaya hy." });

  const id = crypto.randomBytes(8).toString("hex");
  db.users[id] = {
    id,
    username,
    passwordHash: bcrypt.hashSync(password, 10),
    isAdmin: false,
    createdAt: Date.now(),
  };
  saveData();
  startSession(res, id);
  res.json({ ok: true });
});

app.post("/api/login", (req, res) => {
  const username = (req.body.username || "").trim();
  const password = req.body.password || "";
  const user = Object.values(db.users).find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(400).json({ error: "Username ya password ghalat hy." });
  }
  startSession(res, user.id);
  res.json({ ok: true });
});

app.post("/api/logout", requireAuth, (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  sessions.delete(cookies.relay_session);
  res.clearCookie("relay_session");
  res.json({ ok: true });
});

function startSession(res, userId) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, userId);
  res.cookie ? null : null;
  res.setHeader("Set-Cookie", `relay_session=${token}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`);
}

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, isAdmin: req.user.isAdmin });
});

// ---------- Groups the logged-in user can see ----------
app.get("/api/my/groups", requireAuth, (req, res) => {
  const groups = Object.values(db.groups)
    .filter((g) => req.user.isAdmin || g.memberIds.includes(req.user.id))
    .map((g) => ({ id: g.id, name: g.name, memberCount: g.memberIds.length }));
  res.json(groups);
});

// ---------- Admin: manage users & groups ----------
app.get("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  res.json(Object.values(db.users).map((u) => ({ id: u.id, username: u.username, isAdmin: u.isAdmin })));
});

app.get("/api/admin/groups", requireAuth, requireAdmin, (req, res) => {
  res.json(Object.values(db.groups));
});

app.post("/api/admin/groups", requireAuth, requireAdmin, (req, res) => {
  const name = (req.body.name || "Untitled group").trim().slice(0, 60);
  const id = crypto.randomBytes(6).toString("hex");
  db.groups[id] = { id, name, memberIds: [], createdAt: Date.now() };
  db.messages[id] = [];
  saveData();
  res.json(db.groups[id]);
});

app.delete("/api/admin/groups/:id", requireAuth, requireAdmin, (req, res) => {
  delete db.groups[req.params.id];
  delete db.messages[req.params.id];
  saveData();
  io.to(`group:${req.params.id}`).emit("group-removed", req.params.id);
  res.json({ ok: true });
});

app.post("/api/admin/groups/:id/members", requireAuth, requireAdmin, (req, res) => {
  const group = db.groups[req.params.id];
  if (!group) return res.status(404).json({ error: "not_found" });
  const userId = req.body.userId;
  if (!db.users[userId]) return res.status(404).json({ error: "user_not_found" });
  if (!group.memberIds.includes(userId)) group.memberIds.push(userId);
  saveData();
  notifyUserGroupsChanged(userId);
  res.json(group);
});

app.delete("/api/admin/groups/:id/members/:userId", requireAuth, requireAdmin, (req, res) => {
  const group = db.groups[req.params.id];
  if (!group) return res.status(404).json({ error: "not_found" });
  group.memberIds = group.memberIds.filter((m) => m !== req.params.userId);
  saveData();
  notifyUserGroupsChanged(req.params.userId);
  res.json(group);
});

function notifyUserGroupsChanged(userId) {
  for (const [, s] of io.sockets.sockets) {
    if (s.data.userId === userId) s.emit("your-groups-changed");
  }
}

// ---------- Realtime chat ----------
io.use((socket, next) => {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  const userId = sessions.get(cookies.relay_session);
  const user = userId && db.users[userId];
  if (!user) return next(new Error("unauthenticated"));
  socket.data.userId = user.id;
  socket.data.username = user.username;
  socket.data.isAdmin = user.isAdmin;
  next();
});

function canAccessGroup(socket, groupId) {
  const group = db.groups[groupId];
  if (!group) return false;
  return socket.data.isAdmin || group.memberIds.includes(socket.data.userId);
}

io.on("connection", (socket) => {
  socket.on("open-group", (groupId) => {
    if (!canAccessGroup(socket, groupId)) return;
    socket.join(`group:${groupId}`);
    socket.emit("group-history", {
      groupId,
      messages: (db.messages[groupId] || []).slice(-150),
    });
  });

  socket.on("chat-message", ({ groupId, text }) => {
    if (!canAccessGroup(socket, groupId)) return;
    if (!text || !text.trim()) return;
    const message = {
      id: crypto.randomBytes(6).toString("hex"),
      userId: socket.data.userId,
      name: socket.data.username,
      text: text.trim().slice(0, 2000),
      ts: Date.now(),
    };
    if (!db.messages[groupId]) db.messages[groupId] = [];
    db.messages[groupId].push(message);
    if (db.messages[groupId].length > 500) db.messages[groupId] = db.messages[groupId].slice(-500);
    saveData();
    io.to(`group:${groupId}`).emit("chat-message", { groupId, message });
  });
});

server.listen(PORT, () => {
  console.log(`Relay platform running on port ${PORT}`);
});
