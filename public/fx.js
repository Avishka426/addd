// Shared effects: sounds, bubbling, floating emojis, toasts, results.
const FX = (() => {
  const cache = {};
  let ctx = null;
  let unlocked = false;

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctx.resume();
    } catch {}
    // prime a few <audio> elements so iOS lets us play them later
    ['pop1.mp3', 'pop2.mp3', 'pop3.mp3', 'drop.mp3'].forEach((f) => {
      const a = get(f); a.muted = true; a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
    });
  }
  ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { once: false, passive: true }));

  function get(file) {
    if (!cache[file]) { cache[file] = new Audio('/sounds/' + file); cache[file].preload = 'auto'; }
    return cache[file];
  }
  function play(file, volume = 1) {
    try {
      const a = get(file).cloneNode();
      a.volume = volume;
      const p = a.play();
      if (p) p.catch(() => {});
      return a;
    } catch { return null; }
  }
  function playAndWait(file, volume = 1, maxMs = 6000) {
    return new Promise((resolve) => {
      const a = play(file, volume);
      if (!a) return resolve();
      const t = setTimeout(resolve, maxMs);
      a.addEventListener('ended', () => { clearTimeout(t); resolve(); });
      a.addEventListener('error', () => { clearTimeout(t); resolve(); });
    });
  }

  // Synthesised "blub blub" bubbles layered over a pop sample.
  function bubbles(count = 5) {
    play(['pop1.mp3', 'pop2.mp3', 'pop3.mp3', 'drop.mp3'][Math.floor(Math.random() * 4)], 0.7);
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (let i = 0; i < count; i++) {
      const t = t0 + i * (0.05 + Math.random() * 0.07);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = 300 + Math.random() * 500;
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * (2.2 + Math.random()), t + 0.08);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.12);
    }
  }

  function layer() {
    let el = document.getElementById('fx');
    if (!el) { el = document.createElement('div'); el.id = 'fx'; document.body.appendChild(el); }
    return el;
  }
  function floatEmoji(emoji, opts = {}) {
    const el = document.createElement('div');
    el.className = 'float';
    el.textContent = emoji;
    const size = opts.size || 28 + Math.random() * 36;
    el.style.fontSize = size + 'px';
    el.style.left = (opts.x != null ? opts.x : 5 + Math.random() * 90) + 'vw';
    el.style.setProperty('--dx', (Math.random() * 30 - 15) + 'vw');
    el.style.setProperty('--rot', (Math.random() * 80 - 40) + 'deg');
    el.style.setProperty('--dur', (2.4 + Math.random() * 1.8) + 's');
    layer().appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }
  function shower(emojis, n = 12, spread = 1200) {
    for (let i = 0; i < n; i++) {
      setTimeout(() => floatEmoji(emojis[Math.floor(Math.random() * emojis.length)]), Math.random() * spread);
    }
  }
  function burst(x, y, emojis, n = 10) {
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'burst';
      el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const dist = 80 + Math.random() * 90;
      el.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      el.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      el.style.setProperty('--rot', (Math.random() * 120 - 60) + 'deg');
      layer().appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }
  }

  function toast(text) {
    let stack = document.querySelector('.toast-stack');
    if (!stack) { stack = document.createElement('div'); stack.className = 'toast-stack'; document.body.appendChild(stack); }
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    stack.prepend(t);
    while (stack.children.length > 3) stack.lastChild.remove();
    setTimeout(() => t.remove(), 3100);
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function renderResults(container, question, state) {
    const total = state.results.reduce((a, b) => a + b, 0) || 1;
    const w = question.options[state.winner];
    const order = question.options.map((o, i) => i).sort((a, b) => state.results[b] - state.results[a]);
    container.innerHTML = `
      <div class="card winner-card">
        ${w.img ? `<img src="${w.img}" alt="">` : w.emoji ? `<div style="font-size:90px">${w.emoji}</div>` : ''}
        <div class="name">${esc(w.label)}</div>
        <div class="line">${esc(state.revealLine)}</div>
      </div>
      ${order.map((i) => {
        const o = question.options[i];
        const pct = Math.round((state.results[i] / total) * 100);
        return `<div class="result ${i === state.winner ? 'win' : ''}">
          <div class="bar" data-w="${pct}"></div>
          <div class="row">
            ${o.img ? `<img src="${o.img}" alt="">` : `<span>${o.emoji || ''}</span>`}
            <span class="lbl">${esc(o.label)}</span>
            <span class="pct">${pct}%</span>
          </div></div>`;
      }).join('')}`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      container.querySelectorAll('.bar').forEach((b) => { b.style.width = b.dataset.w + '%'; });
    }));
  }

  // `withEmojis`: only the host (projector) screen showers emojis; phones just play the sounds
  async function revealShow(state, withEmojis = false) {
    const emojis = withEmojis && state.revealEmojis && state.revealEmojis.length ? state.revealEmojis : null;
    if (emojis) shower(emojis, 40, 2500);
    for (const s of state.revealSounds) await playAndWait(s, 1, 5000);
    play('laugh.mp3', 0.6);
    if (emojis) shower(emojis, 20, 1500);
  }

  function fmt(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  return { unlock, play, playAndWait, bubbles, floatEmoji, shower, burst, toast, renderResults, revealShow, fmt, esc, get unlocked() { return unlocked; } };
})();
