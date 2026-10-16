const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const QUESTIONS = require('./questions');

const PORT = Number(process.env.PORT) || 3000;
const VOTE_MS = (Number(process.env.VOTE_SECONDS) || 180) * 1000;
const DATA_FILE = path.join(__dirname, 'data.json');

// ---------- persistence ----------
// Votes never reach the server: phones only keep their choice locally, the result is
// decided in questions.js. The server just runs the timer and tells every screen what to show.
function freshQuestionState() {
  return { status: 'idle', endsAt: null, shown: null };
}
let db = { adminKey: crypto.randomBytes(3).toString('hex'), q: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }; } catch {}
if (process.env.ADMIN_KEY) db.adminKey = process.env.ADMIN_KEY;
for (const q of QUESTIONS) db.q[q.id] = db.q[q.id] || freshQuestionState();

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), () => {}), 200);
}

// ---------- helpers ----------
function lanIp() {
  if (process.env.LAN_IP) return process.env.LAN_IP;
  // prefer the real Wi-Fi / Ethernet adapter over VPN, WSL and virtual adapters
  const all = Object.entries(os.networkInterfaces()).flatMap(([name, list]) =>
    (list || []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => ({ name, address: i.address })));
  const real = all.filter((i) => !/vethernet|wsl|tun|tap|vpn|virtual|vmware|vbox|hyper-v|bluetooth/i.test(i.name));
  const pick = real.find((i) => /wi-?fi|wlan|wireless/i.test(i.name)) || real.find((i) => /ethernet|eth/i.test(i.name)) || real[0] || all[0];
  return pick ? pick.address : 'localhost';
}
const BASE_URL = (process.env.PUBLIC_URL || `http://${lanIp()}:${PORT}`).replace(/\/$/, '');
const voteUrl = (id) => `${BASE_URL}/v/${id}`;
const findQ = (id) => QUESTIONS.find((q) => q.id === id);

// Public view of a question – never includes `winner`.
function publicQuestion(q) {
  return {
    id: q.id, title: q.title, prompt: q.prompt, type: q.type,
    options: q.options, emojis: q.emojis, lines: q.lines, url: voteUrl(q.id),
  };
}

// Made-up percentages (summing to 100): the configured winner gets a clear lead,
// the rest is spread fairly evenly over the other options, none of them at 0%.
function fakePercents(q) {
  const n = q.options.length;
  const w = q.winner;
  const base = 100 / n;
  const win = Math.round(base * 1.5 + Math.random() * base * 0.4);
  const others = q.options.map((_, i) => i).filter((i) => i !== w);
  const weights = others.map(() => 0.6 + Math.random() * 0.8);
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((x) => ((100 - win) * x) / sum);
  const p = raw.map(Math.floor);
  // hand out the rounding leftovers to the largest remainders so the total is exactly 100
  let left = 100 - win - p.reduce((a, b) => a + b, 0);
  raw.map((r, k) => [r - p[k], k]).sort((a, b) => b[0] - a[0]).forEach(([, k]) => { if (left > 0) { p[k]++; left--; } });
  const out = q.options.map(() => 0);
  out[w] = win;
  others.forEach((i, k) => { out[i] = p[k]; });
  // safety: winner must stay strictly on top
  for (const i of others) while (out[i] >= out[w]) { out[i]--; out[w]++; }
  return out;
}

function stateFor(qid) {
  const q = findQ(qid);
  const s = db.q[qid];
  const out = { q: qid, status: s.status, endsAt: s.endsAt, now: Date.now() };
  if (s.status === 'revealed') {
    out.results = s.shown;
    out.winner = q.winner;
    out.revealLine = q.revealLine;
    out.revealSounds = q.revealSounds;
  }
  return out;
}

// ---------- http ----------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/questions', (req, res) => res.json({ base: BASE_URL, questions: QUESTIONS.map(publicQuestion) }));
app.get('/api/questions/:id', (req, res) => {
  const q = findQ(req.params.id);
  if (!q) return res.status(404).json({ error: 'not found' });
  res.json(publicQuestion(q));
});
app.get('/qr/:id.png', async (req, res) => {
  const q = findQ(req.params.id);
  if (!q) return res.sendStatus(404);
  const png = await QRCode.toBuffer(voteUrl(q.id), {
    width: 600, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#8a0046', light: '#ffffff' },
  });
  res.type('png').send(png);
});
app.get('/v/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'vote.html')));
app.get('/host/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));

// ---------- realtime ----------
const server = http.createServer(app);
const io = new Server(server);
const endTimers = {};

function broadcastState(qid) {
  io.to(qid).emit('state', stateFor(qid));
}

function scheduleEnd(qid) {
  clearTimeout(endTimers[qid]);
  const s = db.q[qid];
  if (s.status !== 'voting') return;
  endTimers[qid] = setTimeout(() => endVoting(qid), Math.max(0, s.endsAt - Date.now()));
}
function endVoting(qid) {
  const s = db.q[qid];
  if (s.status !== 'voting') return;
  s.status = 'ended';
  s.endsAt = Date.now();
  save();
  io.to(qid).emit('ended');
  broadcastState(qid);
}
function reveal(qid) {
  const s = db.q[qid];
  if (s.status !== 'ended') return;
  s.status = 'revealed';
  s.shown = fakePercents(findQ(qid));
  save();
  broadcastState(qid);
}
for (const q of QUESTIONS) scheduleEnd(q.id); // resume timers after a restart

io.on('connection', (sock) => {
  const { q: qid, role, key } = sock.handshake.auth || {};
  if (!findQ(qid)) return sock.disconnect();
  sock.data.host = role === 'host' && key === db.adminKey;
  sock.join(qid);
  sock.emit('state', stateFor(qid));
  if (role === 'host' && !sock.data.host) sock.emit('badkey');

  // voters only listen – nothing they send is handled (no votes, no reactions)
  const hostOnly = (fn) => (...args) => { if (sock.data.host) fn(...args); };
  sock.on('start', hostOnly(() => {
    const s = db.q[qid];
    if (s.status !== 'idle') return;
    s.status = 'voting';
    s.endsAt = Date.now() + VOTE_MS;
    save();
    scheduleEnd(qid);
    io.to(qid).emit('started');
    broadcastState(qid);
  }));
  sock.on('end', hostOnly(() => endVoting(qid)));
  sock.on('drumroll', hostOnly(() => {
    if (db.q[qid].status === 'ended') io.to(qid).emit('drumroll');
  }));
  sock.on('reveal', hostOnly(() => reveal(qid)));
  sock.on('reset', hostOnly(() => {
    clearTimeout(endTimers[qid]);
    db.q[qid] = freshQuestionState();
    save();
    io.to(qid).emit('reset');
    broadcastState(qid);
  }));
});

server.listen(PORT, () => {
  console.log('\n💖  Beast Vote is live!\n');
  console.log(`  QR sheet (all questions):  ${BASE_URL}/`);
  for (const q of QUESTIONS) {
    console.log(`  ${q.id}  host screen:  ${BASE_URL}/host/${q.id}?key=${db.adminKey}`);
    console.log(`      voter link:   ${voteUrl(q.id)}`);
  }
  console.log(`\n  Admin key: ${db.adminKey}  (keep the host links to yourself)\n`);
});
