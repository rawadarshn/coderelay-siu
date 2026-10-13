/* CodeRelay OT core — shared by the server (require) and the browser (<script>).
   An operation is an array of components over a document:
     positive integer n = keep n characters, string = insert it, negative integer -n = delete n characters.
   Positions are UTF-16 code units, the same unit textarea selections and JS strings use. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CROT = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function push(op, c) {
    if (c === 0 || c === "") return;
    const last = op.length - 1;
    if (last >= 0) {
      const l = op[last];
      if (typeof c === "string" && typeof l === "string") { op[last] = l + c; return; }
      if (typeof c === "number" && typeof l === "number" && (c > 0) === (l > 0)) { op[last] = l + c; return; }
      // keep inserts before deletes at the same spot so equal ops look equal
      if (typeof c === "string" && typeof l === "number" && l < 0) {
        const p = last - 1;
        if (p >= 0 && typeof op[p] === "string") { op[p] += c; return; }
        op.splice(last, 0, c); return;
      }
    }
    op.push(c);
  }
  function trim(op) {
    while (op.length && typeof op[op.length - 1] === "number" && op[op.length - 1] > 0) op.pop();
    return op;
  }
  const len = c => (typeof c === "string" ? c.length : Math.abs(c));

  function validate(op, docLength, maxInsert) {
    if (!Array.isArray(op) || op.length > 2000) return false;
    let base = 0, ins = 0;
    for (const c of op) {
      if (typeof c === "string") { ins += c.length; if (ins > maxInsert) return false; }
      else if (Number.isInteger(c) && c !== 0) base += Math.abs(c);
      else return false;
    }
    return base <= docLength;
  }
  function apply(doc, op) {
    let out = "", i = 0;
    for (const c of op) {
      if (typeof c === "string") out += c;
      else if (c > 0) { out += doc.slice(i, i + c); i += c; }
      else i += -c;
    }
    return out + doc.slice(i);
  }
  function makeIter(op) {
    let i = 0, off = 0;
    return {
      has: () => i < op.length,
      peek: () => (i < op.length ? op[i] : null),
      remaining: () => (i < op.length ? len(op[i]) - off : Infinity),
      isInsert: () => i < op.length && typeof op[i] === "string",
      isDelete: () => i < op.length && typeof op[i] === "number" && op[i] < 0,
      isRetain: () => i >= op.length || (typeof op[i] === "number" && op[i] > 0),
      take(n) {
        if (i >= op.length) return n === Infinity ? Infinity : n; // implicit retain
        const c = op[i], total = len(c), rest = total - off;
        const m = Math.min(n, rest);
        let piece;
        if (typeof c === "string") piece = c.slice(off, off + m);
        else piece = c > 0 ? m : -m;
        off += m;
        if (off >= total) { i++; off = 0; }
        return piece;
      }
    };
  }
  function compose(a, b) {
    const A = makeIter(a), B = makeIter(b), out = [];
    while (A.has() || B.has()) {
      if (B.isInsert()) { push(out, B.take(Infinity)); continue; }
      if (A.isDelete()) { push(out, A.take(Infinity)); continue; }
      const n = Math.min(A.remaining(), B.remaining());
      if (n === Infinity) break;
      const x = A.take(n), y = B.take(n);
      if (typeof x === "string") { if (typeof y === "number" && y > 0) push(out, x); /* delete cancels insert */ }
      else if (typeof y === "number" && y < 0) push(out, -n);
      else push(out, n);
    }
    return trim(out);
  }
  /* a' = a transformed over b, where a and b were made on the same document and b is already applied.
     side "left": a's insert wins the tie (goes first); "right": b's insert goes first. */
  function transform(a, b, side) {
    const A = makeIter(a), B = makeIter(b), out = [];
    while (A.has()) {
      if (A.isInsert() && (side === "left" || !B.isInsert())) { push(out, A.take(Infinity)); continue; }
      if (B.isInsert()) { push(out, B.take(Infinity).length); continue; }
      const n = Math.min(A.remaining(), B.remaining());
      const x = A.take(n), y = B.take(n);
      const aDel = typeof x === "number" && x < 0, bDel = typeof y === "number" && y < 0;
      if (bDel) continue;
      push(out, aDel ? -n : n);
    }
    return trim(out);
  }
  /* where does a caret at index idx land after op? */
  function transformIndex(idx, op, stickAfter) {
    let pos = 0, shift = 0;
    for (const c of op) {
      if (pos > idx) break;
      if (typeof c === "string") { if (pos < idx || (pos === idx && stickAfter)) shift += c.length; }
      else if (c > 0) pos += c;
      else { shift -= Math.min(-c, Math.max(0, idx - pos)); pos += -c; }
    }
    return Math.max(0, idx + shift);
  }
  /* smallest single replace that turns oldText into newText */
  function fromDiff(oldText, newText) {
    let p = 0;
    const max = Math.min(oldText.length, newText.length);
    while (p < max && oldText.charCodeAt(p) === newText.charCodeAt(p)) p++;
    let s = 0;
    while (s < max - p && oldText.charCodeAt(oldText.length - 1 - s) === newText.charCodeAt(newText.length - 1 - s)) s++;
    const hi = c => c >= 0xd800 && c <= 0xdbff, lo = c => c >= 0xdc00 && c <= 0xdfff;
    if (p > 0 && p < oldText.length && hi(oldText.charCodeAt(p - 1)) && lo(oldText.charCodeAt(p))) p--;
    if (s > 0 && lo(oldText.charCodeAt(oldText.length - s)) && hi(oldText.charCodeAt(oldText.length - s - 1))) s--;
    const del = oldText.length - p - s, ins = newText.slice(p, newText.length - s);
    const op = [];
    push(op, p); push(op, -del); push(op, ins);
    return trim(op);
  }
  /* split an op into single changes: [{pos, del, ins}], each relative to the text after the earlier ones */
  function hunks(doc, op) {
    const out = []; let cur = doc, cursor = 0, h = null;
    const close = () => {
      if (!h) return;
      const del = cur.slice(cursor, cursor + h.delLen);
      out.push({ pos: cursor, del, ins: h.ins });
      cur = cur.slice(0, cursor) + h.ins + cur.slice(cursor + h.delLen);
      cursor += h.ins.length; h = null;
    };
    for (const c of op) {
      if (typeof c === "number" && c > 0) { close(); cursor += c; }
      else { h = h || { delLen: 0, ins: "" }; if (typeof c === "string") h.ins += c; else h.delLen += -c; }
    }
    close();
    return out;
  }

  /* Client side of the sync protocol (one op in flight, one buffered).
     Remote changes can be held back ("live updates off") and shown later. */
  function Client(opts) {
    this.rev = opts.rev || 0;
    this.send = opts.send;      // (rev, op)
    this.apply = opts.apply;    // (op) change what the person sees
    this.inflight = null; this.buffer = null; this.held = []; this.live = opts.live !== false;
  }
  Client.prototype.local = function (opL) {           // opL is relative to what the person sees
    let opM = opL;
    if (this.held.length) { opM = transform(opL, this.held, "left"); this.held = transform(this.held, opL, "right"); }
    if (!opM.length) return;
    if (!this.inflight) { this.inflight = opM; this.send(this.rev, opM); }
    else this.buffer = this.buffer ? compose(this.buffer, opM) : opM;
  };
  Client.prototype.ack = function (rev) {
    this.rev = rev;
    if (this.buffer) { this.inflight = this.buffer; this.buffer = null; this.send(this.rev, this.inflight); }
    else this.inflight = null;
  };
  Client.prototype.remote = function (rev, op) {
    this.rev = rev;
    let r = op;
    if (this.inflight) { const i = this.inflight; this.inflight = transform(i, r, "right"); r = transform(r, i, "left"); }
    if (this.buffer) { const b = this.buffer; this.buffer = transform(b, r, "right"); r = transform(r, b, "left"); }
    if (this.live) this.apply(r);
    else this.held = compose(this.held, r);
  };
  Client.prototype.setLive = function (on) { this.live = on; if (on) this.showHeld(); };
  Client.prototype.showHeld = function () { if (this.held.length) { const h = this.held; this.held = []; this.apply(h); } };
  Client.prototype.pending = function () { return this.held.length > 0; };
  Client.prototype.reset = function (rev) { this.rev = rev; this.inflight = this.buffer = null; this.held = []; };

  return { apply, compose, transform, transformIndex, fromDiff, hunks, validate, Client };
});
