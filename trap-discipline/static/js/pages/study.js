// Study Hall: library, guide reader with section progress, quizzes and flashcards.
import { api } from '../api.js';
import { h, icon, clear, svg, toast, confetti, sound, put } from '../ui.js';
import { VOI } from '../study/voi.js';
import { SCHWAGER } from '../study/schwager.js';

const GUIDES = [VOI, SCHWAGER];
let root = null; let ctxRef = null; let prog = {};

export async function render(el, ctx) {
  root = el; ctxRef = ctx;
  prog = await api.get('/api/study');
  const [gid, sec] = ctx.params;
  const g = GUIDES.find(x => x.id === gid);
  if (g) reader(g, sec); else library();
}

function done(g, s) { return !!prog[`${g.id}:${s}`]; }
function pct(g) { return g.sections.filter(s => done(g, s.id)).length / g.sections.length; }

function cover(g) {
  const s = svg('svg', { viewBox: '0 0 300 150', preserveAspectRatio: 'xMidYMid slice' });
  const defs = svg('defs', {}, svg('linearGradient', { id: `cg-${g.id}`, x1: 0, y1: 0, x2: 1, y2: 1 }, svg('stop', { offset: '0', 'stop-color': g.accent, 'stop-opacity': '.55' }), svg('stop', { offset: '1', 'stop-color': '#0a0f16' })));
  put(s, defs, svg('rect', { width: 300, height: 150, fill: `url(#cg-${g.id})` }));
  let x = 10; let y = 90;
  for (let i = 0; i < 26; i++) {
    const d = Math.sin(i * (g.id === 'voi' ? 0.7 : 1.1)) * 12 + (i > 15 && g.id !== 'voi' ? -(i - 15) * 3 : 0);
    const o = y; const c = 90 + d;
    put(s, svg('line', { x1: x, x2: x, y1: Math.min(o, c) - 6, y2: Math.max(o, c) + 6, stroke: 'rgba(255,255,255,.45)' }));
    put(s, svg('rect', { x: x - 3, y: Math.min(o, c), width: 6, height: Math.max(2, Math.abs(o - c)), fill: c < o ? 'rgba(25,158,112,.9)' : 'rgba(230,103,103,.9)' }));
    y = c; x += 11;
  }
  if (g.id === 'voi') for (let i = 0; i < 26; i++) put(s, svg('rect', { x: 7 + i * 11, y: 150 - (8 + Math.abs(Math.sin(i * 1.3)) * 22), width: 6, height: 8 + Math.abs(Math.sin(i * 1.3)) * 22, fill: 'rgba(57,135,229,.6)' }));
  return s;
}

function library() {
  clear(root);
  put(root, 
    h('div.page-head', h('div', h('div.eyebrow', 'Study Hall'), h('h1', 'Get sharper between sessions'),
      h('div.sub', 'Each finished section is +15 XP; passing a quiz is +50, a perfect score +25 more. Good use of the time between setups.'))),
    h('div.lib', GUIDES.map(g => {
      const p = pct(g); const q = prog[`${g.id}:quiz`];
      return h('div.card.book', { onclick: () => ctxRef.go(`study/${g.id}`) },
        h('div.cover', cover(g)),
        h('div.bd', h('h3', g.title), h('div.muted', { style: { fontSize: '12.5px', margin: '4px 0 12px' } }, g.subtitle),
          h('div.row.between', { style: { fontSize: '12px' } }, h('span.dim', `${g.sections.length} sections · ~${g.minutes} min`), h('span.dim', q ? `Quiz best ${q.best}/${q.total}` : 'Quiz not taken')),
          h('div.bar.accent', { style: { marginTop: '8px' } }, h('i', { style: { width: `${Math.round(p * 100)}%` } }))));
    }),
    h('div.card', { style: { display: 'grid', placeItems: 'center', textAlign: 'center', borderStyle: 'dashed', minHeight: '260px' } },
      h('div', icon('lightbulb', 'xl'), h('h3', { style: { marginTop: '8px' } }, 'More guides coming'), h('p.muted', { style: { fontSize: '13px', maxWidth: '240px' } }, 'Ideas: position sizing math, funding and basis, the psychology of the stop, liquidation mechanics.')))));
}

function reader(g, secId) {
  clear(root);
  const idx = Math.max(0, g.sections.findIndex(s => s.id === secId));
  const mode = secId === 'quiz' ? 'quiz' : secId === 'cards' ? 'cards' : 'read';
  const sec = g.sections[idx];
  const main = h('div.prose');
  put(root, 
    h('div.page-head', h('div', h('a', { href: '#/study' }, icon('chevron-left', 'sm'), ' Study Hall'), h('h1', { style: { marginTop: '6px' } }, g.title), h('div.sub', g.subtitle)),
      h('div.actions', g.pdf ? h('a.btn', { href: g.pdf, target: '_blank', rel: 'noopener' }, icon('external-link', 'sm'), 'Original PDF') : null,
        h('button.btn', { onclick: () => ctxRef.go(`study/${g.id}/cards`) }, icon('layers', 'sm'), 'Flashcards'),
        h('button.btn.xp', { onclick: () => ctxRef.go(`study/${g.id}/quiz`) }, icon('graduation-cap', 'sm'), 'Take the quiz'))),
    h('div.reader',
      h('div.card.pad-s.toc', h('div.eyebrow', { style: { padding: '4px 10px 8px' } }, `${Math.round(pct(g) * 100)}% complete`),
        g.sections.map((s, i) => h(`a${mode === 'read' && i === idx ? '.cur' : ''}`, { href: `#/study/${g.id}/${s.id}` }, h('span.mono', { style: { fontSize: '11px', color: 'var(--ink-3)' } }, String(i + 1).padStart(2, '0')), s.title, done(g, s.id) ? h('span.ok', icon('check', 'sm')) : null)),
        h('div.sep'),
        h(`a${mode === 'cards' ? '.cur' : ''}`, { href: `#/study/${g.id}/cards` }, icon('layers', 'sm'), 'Flashcards'),
        h(`a${mode === 'quiz' ? '.cur' : ''}`, { href: `#/study/${g.id}/quiz` }, icon('graduation-cap', 'sm'), 'Quiz', prog[`${g.id}:quiz`] ? h('span.ok', `${prog[`${g.id}:quiz`].best}/${prog[`${g.id}:quiz`].total}`) : null)),
      h('div.card', { style: { padding: '26px 30px' } }, main)));
  if (mode === 'quiz') return quiz(g, main);
  if (mode === 'cards') return cards(g, main);
  put(main, sec.body(),
    h('div.row', { style: { marginTop: '28px', paddingTop: '18px', borderTop: '1px solid var(--line)' } },
      idx > 0 ? h('button.btn', { onclick: () => ctxRef.go(`study/${g.id}/${g.sections[idx - 1].id}`) }, icon('chevron-left', 'sm'), 'Previous') : null,
      h('div', { style: { flex: 1 } }),
      h(`button.btn.${done(g, sec.id) ? 'ghost' : 'xp'}`, { onclick: async (e) => {
        if (!done(g, sec.id)) {
          const r = await api.post('/api/study/section', { guide: g.id, section: sec.id });
          prog[`${g.id}:${sec.id}`] = { done: true };
          ctxRef.celebrateXP(r.data.xp, e.target);
          if (r.data.xp) toast('Section complete', `+${r.data.xp} XP banked.`, 'xp');
        }
        const next = g.sections[idx + 1];
        ctxRef.go(next ? `study/${g.id}/${next.id}` : `study/${g.id}/quiz`);
      } }, done(g, sec.id) ? 'Next' : 'Mark complete & continue (+15 XP)', icon('chevron-right', 'sm'))));
  document.getElementById('view').scrollTop = 0;
}

function shuffled(qs) {
  // deterministic per-day shuffle so the right answer is not always in the same slot
  let seed = Math.floor(Date.now() / 86400000) * 2654435761 % 2147483647;
  const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  return qs.map(q => {
    const idx = q.o.map((_, j) => j);
    for (let k = idx.length - 1; k > 0; k--) { const m = Math.floor(rnd() * (k + 1)); [idx[k], idx[m]] = [idx[m], idx[k]]; }
    return { ...q, o: idx.map(j => q.o[j]), a: idx.indexOf(q.a) };
  });
}

function quiz(g, main) {
  const qs = shuffled(g.quiz); let i = 0; let score = 0; let answered = false;
  const draw = () => {
    clear(main);
    if (i >= qs.length) {
      const pass = score >= Math.ceil(qs.length * 0.8);
      api.post('/api/study/quiz', { guide: g.id, score, total: qs.length }).then(r => { if (r.data.xp) ctxRef.celebrateXP(r.data.xp); ctxRef.refresh(); });
      if (pass) { confetti({ particleCount: 150, spread: 100 }); sound('level'); } else sound('warn');
      put(main, h('div', { style: { textAlign: 'center', padding: '30px 0' } },
        h('div', { class: `stamp ${pass ? 'go' : 'no'}` }, `${score}/${qs.length}`),
        h('h2', { style: { marginTop: '20px' } }, pass ? (score === qs.length ? 'Perfect.' : 'Passed.') : 'Not yet.'),
        h('p.dim', pass ? 'XP awarded once per guide. Retake any time to keep it fresh.' : 'You need 80% to pass. Reread the sections you missed and try again.'),
        h('div.row', { style: { justifyContent: 'center', gap: '10px', marginTop: '14px' } }, h('button.btn', { onclick: () => { i = 0; score = 0; draw(); } }, icon('refresh-cw', 'sm'), 'Retake'), h('button.btn.primary', { onclick: () => ctxRef.go('study') }, 'Back to the library'))));
      return;
    }
    const q = qs[i]; answered = false;
    const expl = h('div');
    const opts = q.o.map((o, j) => {
      const b = h('button.opt', { onclick: () => {
        if (answered) return; answered = true;
        const right = j === q.a; if (right) { score++; sound('chime'); } else sound('warn');
        b.classList.add(right ? 'right' : 'wrong'); opts[q.a].classList.add('right');
        put(expl, h(`div.callout.${right ? 'key' : 'warnbox'}`, { style: { marginTop: '12px' } }, icon(right ? 'check-circle-2' : 'info'), h('div', h('b', right ? 'Right. ' : 'Not quite. '), q.why)),
          h('div.row', { style: { marginTop: '12px' } }, h('div', { style: { flex: 1 } }), h('button.btn.primary', { onclick: () => { i++; draw(); } }, i === qs.length - 1 ? 'See score' : 'Next question', icon('chevron-right', 'sm'))));
      } }, o);
      return b;
    });
    put(main, h('div.quiz', h('div.row.between', h('div.eyebrow', `Question ${i + 1} of ${qs.length}`), h('span.chip', `Score ${score}`)),
      h('div.bar.accent', { style: { margin: '10px 0 20px' } }, h('i', { style: { width: `${i / qs.length * 100}%` } })),
      h('div.q', q.q), opts, expl));
  };
  draw();
}

function cards(g, main) {
  let i = 0;
  const draw = () => {
    clear(main);
    const [f, b] = g.cards[i];
    const card = h('div.flash', { onclick: () => { card.classList.toggle('flip'); sound('tick'); } }, h('div.inner', h('div.face', h('div', h('div.eyebrow', 'Prompt'), h('h2', { style: { marginTop: '10px' } }, f))), h('div.face.back', h('div', h('div.eyebrow', 'Answer'), h('div', { style: { marginTop: '10px', fontSize: '18px' } }, b)))));
    put(main, h('div.eyebrow', `Card ${i + 1} of ${g.cards.length} · click the card to flip`), h('div', { style: { margin: '14px 0' } }, card),
      h('div.row', h('button.btn', { onclick: () => { i = (i - 1 + g.cards.length) % g.cards.length; draw(); } }, icon('chevron-left', 'sm'), 'Previous'), h('div', { style: { flex: 1 } }),
        h('button.btn', { onclick: () => { i = Math.floor(Math.random() * g.cards.length); draw(); } }, icon('refresh-cw', 'sm'), 'Shuffle'),
        h('button.btn.primary', { onclick: () => { i = (i + 1) % g.cards.length; draw(); } }, 'Next', icon('chevron-right', 'sm'))));
  };
  draw();
}
