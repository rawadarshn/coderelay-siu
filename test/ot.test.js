const OT = require("../public/ot.js");
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const ri = n => Math.floor(rnd() * n);
const alpha = "ab\nc é😀"; // includes newline, accents, a surrogate pair
const rtext = n => { let s = ""; for (let i = 0; i < n; i++) s += alpha[ri(alpha.length)]; return s; };
function randomOp(doc) {
  // a few changes spread across the doc
  const op = []; let i = 0; const changes = 1 + ri(3);
  for (let k = 0; k < changes && i <= doc.length; k++) {
    const keep = ri(Math.max(1, doc.length - i + 1)); if (keep) op.push(keep); i += keep;
    if (ri(2)) op.push(rtext(1 + ri(4)));
    const del = ri(Math.min(4, doc.length - i + 1)); if (del) { op.push(-del); i += del; }
  }
  return OT.compose([], op);
}
let n = 0;
for (let t = 0; t < 20000; t++, n++) {
  const doc = rtext(ri(25)), a = randomOp(doc), b = randomOp(doc);
  const l = OT.apply(OT.apply(doc, a), OT.transform(b, a, "right"));
  const r = OT.apply(OT.apply(doc, b), OT.transform(a, b, "left"));
  if (l !== r) { console.log("TP1 FAIL", JSON.stringify({ doc, a, b, l, r })); process.exit(1); }
  const c = randomOp(OT.apply(doc, a));
  if (OT.apply(OT.apply(doc, a), c) !== OT.apply(doc, OT.compose(a, c))) { console.log("COMPOSE FAIL", JSON.stringify({ doc, a, c })); process.exit(1); }
  const d2 = rtext(ri(25)), diff = OT.fromDiff(doc, d2);
  if (OT.apply(doc, diff) !== d2) { console.log("DIFF FAIL", JSON.stringify({ doc, d2 })); process.exit(1); }
  // hunks rebuild the same result
  let cur = doc; for (const h of OT.hunks(doc, a)) cur = cur.slice(0, h.pos) + h.ins + cur.slice(h.pos + h.del.length);
  if (cur !== OT.apply(doc, a)) { console.log("HUNKS FAIL", JSON.stringify({ doc, a })); process.exit(1); }
}
console.log("pair properties ok:", n, "random cases");

// Full simulation: server + clients, random network delays, some clients pause live updates.
for (let round = 0; round < 300; round++) {
  let server = rtext(ri(30)), rev = 0; const log = [];
  const clients = [];
  const net = []; // queued messages {at, run}
  let now = 0, counter = 0;
  const post = (fn) => net.push({ at: now + 1 + ri(8), n: counter++, run: fn });
  const serverReceive = (cl, baseRev, op) => {
    let o = op; for (let k = baseRev; k < log.length; k++) o = OT.transform(o, log[k], "right");
    server = OT.apply(server, o); log.push(o); rev = log.length;
    const myRev = rev;
    post(() => cl.client.ack(myRev));
    for (const other of clients) if (other !== cl) post(() => other.client.remote(myRev, o));
  };
  for (let i = 0; i < 3; i++) {
    const cl = { doc: server };
    cl.client = new OT.Client({ rev: 0, live: true,
      send: (r, op) => post(() => serverReceive(cl, r, op)),
      apply: op => { cl.doc = OT.apply(cl.doc, op); } });
    clients.push(cl);
  }
  // Each message type must stay in order per sender/receiver pair, so make delivery order = send order per pair
  let steps = 40 + ri(40);
  const flush = (all) => { // deliver in FIFO order per direction (sort by creation but allow interleaving)
    while (net.length) { net.sort((x, y) => x.n - y.n); const m = net.shift(); m.run(); if (!all) break; }
  };
  for (let s = 0; s < steps; s++) {
    const cl = clients[ri(3)];
    const act = ri(10);
    if (act === 0) cl.client.setLive(!cl.client.live);
    else if (act === 1) cl.client.showHeld();
    else { const op = randomOp(cl.doc); cl.doc = OT.apply(cl.doc, op); cl.client.local(op); }
    for (let k = ri(4); k > 0 && net.length; k--) flush(false);
  }
  flush(true);
  for (const c of clients) { c.client.setLive(true); }
  flush(true);
  for (const c of clients) if (c.doc !== server) { console.log("SIM FAIL round", round, JSON.stringify({ server, c: c.doc })); process.exit(1); }
}
console.log("client/server convergence ok: 300 simulated sessions (3 clients, delays, live-updates toggling)");
