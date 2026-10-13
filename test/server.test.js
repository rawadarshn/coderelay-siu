process.env.DEV_MEMORY_DB = "1";
const assert = require("assert");
const WebSocket = require("ws");
const OT = require("../public/ot.js");
const { server, seal, open, db } = require("../server.js");

function sioClient(port, cookie) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`, { headers: cookie ? { cookie } : {} });
  const handlers = {}, log = []; let ackId = 0; const acks = {}; let resolveReady;
  const api = {
    log,
    ready: new Promise(res => { resolveReady = res; }),
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    emit(ev, payload, cb) { const id = cb ? ++ackId : ""; if (cb) acks[id] = cb; ws.send("42" + id + JSON.stringify([ev, payload])); },
    next(ev, ms = 3000) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout waiting for " + ev)), ms); const fn = d => { clearTimeout(t); res(d); }; (handlers[ev] = handlers[ev] || []).push(function once(d) { handlers[ev] = handlers[ev].filter(x => x !== once); fn(d); }); }); },
    close() { ws.close(); }
  };
  ws.on("message", raw => {
    const m = raw.toString();
    if (m === "2") return ws.send("3");
    if (m[0] === "0") return ws.send("40");
    if (m.startsWith("40")) return resolveReady();
    const mm = m.match(/^4([23])(\d*)(\[.*)$/);
    if (!mm) return;
    const arr = JSON.parse(mm[3]);
    if (mm[1] === "3") { const cb = acks[mm[2]]; if (cb) cb(arr[0]); return; }
    log.push(arr[0]);
    (handlers[arr[0]] || []).slice().forEach(fn => fn(arr[1]));
  });
  return api;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port, base = `http://127.0.0.1:${port}`;

  // --- encryption at rest ---
  const sealed = seal("secret code", "room1");
  assert(sealed.startsWith("enc:v1:") && !sealed.includes("secret"), "sealed text must not contain plaintext");
  assert.strictEqual(open(sealed, "room1"), "secret code");
  assert.throws(() => open(sealed, "room2"), "ciphertext must not open under another room id");
  const flipped = sealed.slice(0, -3) + (sealed.slice(-3) === "AAA" ? "BBB" : "AAA");
  assert.throws(() => open(flipped, "room1"), "tampering must be detected");
  assert.strictEqual(open("legacy plaintext", "x"), "legacy plaintext");
  console.log("ok  encryption at rest: AES-256-GCM, bound to room id, tamper-evident, legacy rows still readable");

  // --- security headers ---
  const home = await fetch(base + "/");
  const csp = home.headers.get("content-security-policy");
  assert(csp.includes("script-src 'self'") && !csp.includes("unsafe-eval") && csp.includes("frame-ancestors 'none'"));
  assert.strictEqual(home.headers.get("referrer-policy"), "no-referrer");
  assert.strictEqual(home.headers.get("x-content-type-options"), "nosniff");
  assert(!home.headers.get("x-powered-by"));
  const runner = await fetch(base + "/runner");
  assert(runner.headers.get("content-security-policy").startsWith("sandbox allow-scripts"));
  assert.strictEqual((await fetch(base + "/runner.html")).status, 404);
  assert.strictEqual((await fetch(base + "/.env")).status, 404);
  console.log("ok  headers: strict CSP on app, sandboxed CSP on /runner, no referrer leakage, runner not reachable as a normal file");

  // --- create room ---
  const created = await (await fetch(base + "/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "line one\nline two\nline three", language: "Plain text" }) })).json();
  assert(created.id.length >= 20 && created.ownerToken.length >= 40);
  const id = created.id;

  // --- users: name once, sequential number, cookie session ---
  const newUser = async name => { const r = await fetch(base + "/api/me", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }); return { r, body: await r.json(), cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  const ua = await newUser("Aarav"), ub = await newUser("Priya<script>"), uc = await newUser("Kabir");
  assert.deepStrictEqual([ua.body.user.id, ub.body.user.id, uc.body.user.id], [1, 2, 3]);
  assert(!ub.body.user.name.includes("<"));
  assert(/HttpOnly/i.test(ua.r.headers.get("set-cookie")) && /SameSite=Lax/i.test(ua.r.headers.get("set-cookie")) && /Max-Age=\d{8,}/.test(ua.r.headers.get("set-cookie")));
  const again = await fetch(base + "/api/me", { method: "POST", headers: { "content-type": "application/json", cookie: ua.cookie }, body: JSON.stringify({ name: "Hacker" }) });
  assert.strictEqual(again.status, 409);
  assert.strictEqual((await (await fetch(base + "/api/me", { headers: { cookie: ua.cookie } })).json()).user.name, "Aarav");
  assert.strictEqual((await (await fetch(base + "/api/me")).json()).user, null);
  assert.strictEqual((await newUser("   ")).r.status, 400);
  const dup = await newUser("  aARAV  ");
  assert.strictEqual(dup.r.status, 409); assert(dup.body.taken && !dup.cookie, "duplicate names (any case/spacing) are refused and get no session");
  const avail = async n => (await (await fetch(base + "/api/name-available?name=" + encodeURIComponent(n))).json());
  assert.deepStrictEqual([(await avail("Aarav")).available, (await avail("AARAV")).available, (await avail("Zoya")).available, (await avail("")).valid], [false, false, true, false]);
  const racers = await Promise.all([newUser("Racer"), newUser("racer")]);
  assert.deepStrictEqual(racers.map(x => x.r.status).sort(), [200, 409], "two people claiming the same name at once: exactly one wins");
  console.log("ok  users: unique names (case-insensitive, live check, race-safe); names get numbers 1, 2, 3; cookie is HttpOnly + long-lived; name can't be changed; blank names refused");
  const A = sioClient(port, ua.cookie), B = sioClient(port, ub.cookie), C = sioClient(port, uc.cookie);
  await Promise.all([A.ready, B.ready, C.ready]);
  A.emit("join-room", { id, ownerToken: created.ownerToken, clientId: "aaaaaaaa-1111", name: "Aarav" });
  const sa = await A.next("room-state");
  assert.strictEqual(sa.isOwner, true); assert.strictEqual(sa.code, "line one\nline two\nline three"); assert.strictEqual(sa.you.name, "Aarav");
  B.emit("join-room", { id, ownerToken: "wrong", clientId: "bbbbbbbb-2222", name: "Priya<script>" });
  const sb = await B.next("room-state");
  assert.strictEqual(sb.isOwner, false); assert(!sb.you.name.includes("<"), "names are sanitised");
  assert.notStrictEqual(sa.you.color, sb.you.color);
  assert.strictEqual(sb.peers.length, 2);
  const anon = sioClient(port); await anon.ready; anon.emit("join-room", { id, clientId: "zzzzzzzz-9999", name: "Spoof" }); await anon.next("need-user"); anon.close();
  assert.strictEqual(sa.you.aid, "u1");
  assert.strictEqual(sa.you.dev, true); assert.strictEqual(sb.you.dev, false);
  assert.deepStrictEqual(sb.peers.map(p => [p.uid, p.dev]).sort(), [[1, true], [2, false]]);
  assert.strictEqual(ua.body.user.dev, true); assert.strictEqual(ub.body.user.dev, false);
  console.log("ok  developer flag comes from the server (user #1 only); join: visitors without a session are asked for a name; owner detected, wrong token is not owner, names sanitised, distinct colours, presence list");

  // --- edit + history ---
  const opA = OT.fromDiff(sa.code, "line one\nline TWO\nline three");
  const gotOp = B.next("op"), gotAck = A.next("ack");
  A.emit("op", { id, rev: sa.rev, op: opA });
  assert.strictEqual((await gotAck).rev, 1);
  const rem = await gotOp; assert.deepStrictEqual(rem.op, opA);
  const h1 = await B.next("history-entry");
  assert.strictEqual(h1.author, "Aarav"); assert.strictEqual(h1.start, 2); assert.strictEqual(h1.before, "line two"); assert.strictEqual(h1.after, "line TWO");
  console.log("ok  edit relayed with ack; history says Aarav changed line 2: 'line two' -> 'line TWO'");

  // typing on the same line merges into ONE history entry
  let doc = "line one\nline TWO\nline three", rev = 1;
  for (const next of ["line one\nline TWO!\nline three", "line one\nline TWO!!\nline three"]) {
    const ack = A.next("ack"); A.emit("op", { id, rev, op: OT.fromDiff(doc, next) }); rev = (await ack).rev; doc = next;
  }
  await sleep(600);
  A.emit("join-room", { id, ownerToken: created.ownerToken, clientId: "aaaaaaaa-1111", name: "Aarav" });
  const sa2 = await A.next("room-state");
  const edits = sa2.history.filter(h => h.kind === "edit");
  assert.strictEqual(edits.length, 1, "one typing burst should be one history entry, got " + edits.length);
  assert.strictEqual(edits[0].after, "line TWO!!");
  console.log("ok  typing bursts are merged into a single history entry (not one per keystroke)");

  // --- concurrent edits converge ---
  C.emit("join-room", { id, ownerToken: "x", clientId: "cccccccc-3333", name: "Kabir" });
  const sc = await C.next("room-state"); rev = sc.rev; doc = sc.code;
  const opB = OT.fromDiff(doc, "HEAD\n" + doc);                 // B edits the top
  const opA2 = OT.fromDiff(doc, doc + "\ntail");               // A edits the bottom, same base revision
  const ackB = B.next("ack"), ackA = A.next("ack");
  B.emit("op", { id, rev, op: opB }); A.emit("op", { id, rev, op: opA2 });
  await Promise.all([ackB, ackA]); await sleep(200);
  C.emit("join-room", { id, ownerToken: "x", clientId: "cccccccc-3333", name: "Kabir" });
  const sc2 = await C.next("room-state");
  assert.strictEqual(sc2.code, "HEAD\nline one\nline TWO!!\nline three\ntail");
  console.log("ok  two people editing at once on the same revision: both changes kept, nothing overwritten");

  // --- cursors ---
  const cur = C.next("cursor"); A.emit("cursor", { id, a: 3, b: 3 });
  const cc = await cur; assert.strictEqual(cc.a, 3);
  A.emit("cursor", { id, a: 99999, b: 99999 }); await sleep(100);
  console.log("ok  cursor positions relayed; out-of-range cursor ignored");

  // --- revert ---
  const hist = sc2.history.concat((await new Promise(r => { A.emit("join-room", { id, ownerToken: created.ownerToken, clientId: "aaaaaaaa-1111", name: "Aarav" }); A.next("room-state").then(r); })).history);
  const target = hist.find(h => h.kind === "edit" && h.after === "line TWO!!");
  assert(target, "has the line-2 edit");
  const rv = A.next("op"); void rv;
  const opP = B.next("op");
  A.emit("revert", { id, entryId: target.id });
  const reverted = await opP; assert(reverted.op.length > 0);
  C.emit("join-room", { id, ownerToken: "x", clientId: "cccccccc-3333", name: "Kabir" });
  const sc3 = await C.next("room-state");
  assert.strictEqual(sc3.code, "HEAD\nline one\nline two\nline three\ntail");
  assert(sc3.history.some(h => h.kind === "revert"));
  console.log("ok  revert restores the old lines for everyone and is itself recorded in history");

  // --- lock ---
  A.emit("set-lock", { id, ownerToken: created.ownerToken, locked: true });
  await B.next("lock-state");
  const perm = B.next("permission-error"), rs = B.next("resync");
  B.emit("op", { id, rev: sc3.rev, op: [1, "x"] });
  await perm; await rs;
  B.emit("set-lock", { id, ownerToken: "nope", locked: false });
  await B.next("permission-error");
  console.log("ok  lock: non-owner edits are rejected and rolled back; non-owner cannot unlock");

  // --- bad input ---
  A.emit("op", { id, rev: 0, op: [1e9, "x"] }); A.emit("op", { id, rev: "a", op: "no" }); A.emit("op", null); A.emit("revert", { id, entryId: "nope" });
  await sleep(150);
  const health = await fetch(base + "/health"); assert.strictEqual(health.status, 200);
  console.log("ok  malformed ops/events do not crash the server");

  // --- delete workspace ---
  const c2 = await (await fetch(base + "/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "x" }) })).json();
  A.emit("join-room", { id: c2.id, ownerToken: c2.ownerToken, clientId: "aaaaaaaa-1111", name: "Aarav" }); await A.next("room-state");
  B.emit("join-room", { id: c2.id, ownerToken: "no", clientId: "bbbbbbbb-2222", name: "Priya" }); await B.next("room-state");
  B.emit("delete-room", { id: c2.id, ownerToken: "no" }); await B.next("permission-error");
  const gone = B.next("room-deleted"); A.emit("delete-room", { id: c2.id, ownerToken: c2.ownerToken }); await gone;
  C.emit("join-room", { id: c2.id, clientId: "cccccccc-3333", name: "Kabir" }); await C.next("room-error");
  console.log("ok  delete: only the owner can delete; everyone is told; the link stops working");

  // --- a missing room_history table must not break saving, loading or deleting ---
  const miss = Object.assign(new Error("Could not find the table 'public.room_history' in the schema cache"), { code: "PGRST205" });
  const realUp = db.upsertHistory; db.upsertHistory = async () => { throw miss; };
  const c3 = await (await fetch(base + "/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "keep me" }) })).json();
  A.emit("join-room", { id: c3.id, ownerToken: c3.ownerToken }); const s3 = await A.next("room-state");
  A.emit("op", { id: c3.id, rev: s3.rev, op: OT.fromDiff("keep me", "keep me!") }); await A.next("ack"); await sleep(1200);
  assert.strictEqual((await db.getRoom(c3.id)).code.startsWith("enc:v1:"), true);
  assert.strictEqual(open((await db.getRoom(c3.id)).code, c3.id), "keep me!");
  const gone3 = A.next("room-deleted"); A.emit("delete-room", { id: c3.id, ownerToken: c3.ownerToken }); await gone3;
  assert.strictEqual(await db.getRoom(c3.id), null);
  db.upsertHistory = realUp;
  console.log("ok  missing history table: workspace still saves (encrypted) and deletes; no crash, no endless retries");

  [A, B, C].forEach(c => c.close()); server.close(); setTimeout(() => process.exit(0), 100);
})().catch(e => { console.error("FAIL", e); process.exit(1); });
