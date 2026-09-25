// Progress: level, ranks, badges, streaks, quests, and exactly how XP is earned.
import { api } from '../api.js';
import { h, icon, fmt, clear, ring, put } from '../ui.js';

let root = null; let ctxRef = null;
const XP_LABELS = {
  checkin: 'Daily pre-session check-in', checklist: 'Run the pre-trade checklist (cap 6/day)', skip_logged: 'Log a skipped setup (cap 8/day)',
  journal_complete: 'Journal a closed trade', fresh_log: 'Bonus: logged within 10 minutes', late_log_hour: 'Bonus: logged within the hour',
  calibration: 'Fill all three orange calibration fields', clean_trade: 'Trade with no major rule finding', violation_major: 'Each major rule finding',
  walk_away: 'Hit the daily loss limit and take nothing else', honored_no_go: 'Honor a NO TRADE verdict for an hour', monthly_review: 'Complete the monthly review',
  study_section: 'Finish a study section', quiz_pass: 'Pass a study quiz (80%+)', quiz_perfect: 'Perfect quiz', weekly_quest: 'Complete a weekly quest',
};

export async function render(el, ctx) {
  root = el; ctxRef = ctx;
  const G = await api.get('/api/game');
  draw(G);
  api.post('/api/badges/seen');
}

function draw(G) {
  clear(root);
  const lv = G.level; const st = G.streaks;
  const earned = G.badges.filter(b => b.unlocked_at).length;
  put(root, 
    h('div.page-head', h('div', h('div.eyebrow', 'Progress'), h('h1', 'Earned by process, never by profit'),
      h('div.sub', 'Nothing here pays you to trade more or to make money. It pays you to follow the plan, log honestly, sit on your hands, and study.'))),
    h('div.grid', { style: { gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)' } },
      h('div.card.xpglow', h('div.row', { style: { gap: '26px' } },
        h('div.hex', { style: { width: '110px', height: '124px', fontSize: '48px' } }, lv.level),
        h('div', { style: { flex: 1 } }, h('div.eyebrow', 'Rank'), h('h1', { style: { fontSize: '32px' } }, lv.rank),
          h('div.row.between', { style: { marginTop: '12px', fontSize: '13px' } }, h('span.dim', `${fmt.num(lv.xp, 0)} XP total`), h('span.muted', `${fmt.num(lv.next - lv.xp, 0)} to level ${lv.level + 1}`)),
          h('div.bar', { style: { height: '10px', marginTop: '6px' } }, h('i', { style: { width: `${Math.round(lv.progress * 100)}%` } })))),
        h('div.grid.g4', { style: { marginTop: '18px', gap: '10px' } },
          box('flame', 'Check-in streak', st.checkin, `best ${st.best_checkin}`), box('shield-check', 'Clean streak', st.clean, `best ${st.best_clean}`),
          box('clock-3', 'Fresh-log streak', st.fresh, 'in a row'), box('medal', 'Badges', `${earned}/${G.badges.length}`, 'unlocked'))),
      h('div.card', h('div.card-h', h('h3', icon('gauge'), 'Discipline score')),
        h('div.row', { style: { gap: '20px' } }, ring(G.discipline.score ?? 0, { label: G.discipline.score ?? '—', sub: 'last 20', color: 'var(--accent)' }),
          h('div', { style: { flex: 1 } }, h('div.dim', { style: { fontSize: '13px' } }, 'Average process score of your last 20 closed trades. 100 minus 25 per major finding, 10 per minor, 3 per note, 10 if the journal row is incomplete.'),
            h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '3px', height: '54px', marginTop: '12px' } }, (G.discipline.trend || []).map(s => h('div', { title: s, style: { flex: 1, height: `${Math.max(6, s)}%`, borderRadius: '3px 3px 0 0', background: s >= 85 ? 'var(--s3)' : s >= 60 ? 'var(--s1)' : 'var(--s8)' } }))))))),
    h('h2', { style: { margin: '26px 0 12px' } }, 'Rank ladder'),
    h('div.card', h('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${G.ranks.length}, 1fr)`, gap: '6px' } }, G.ranks.map(r => {
      const reached = lv.level >= r.from_level;
      return h('div', { style: { textAlign: 'center', padding: '10px 4px', borderRadius: '10px', background: reached ? 'rgba(139,123,255,.14)' : 'rgba(var(--ov),0.018)', border: `1px solid ${r.rank === lv.rank ? 'var(--xp)' : 'var(--line)'}` } },
        h('div', { style: { fontSize: '10.5px', color: 'var(--ink-3)', fontFamily: 'var(--mono)' } }, `L${r.from_level}`),
        h('div', { style: { fontSize: '11.5px', fontWeight: 600, color: reached ? 'var(--ink)' : 'var(--ink-3)', marginTop: '4px', lineHeight: 1.25 } }, r.rank));
    }))),
    h('h2', { style: { margin: '26px 0 12px' } }, 'Badges'),
    h('div.badges', G.badges.map(b => h(`div.medal.t${b.tier}${b.unlocked_at ? '' : '.locked'}${b.unlocked_at && !b.seen ? '.new' : ''}`, { title: b.unlocked_at ? `Unlocked ${fmt.local(b.unlocked_at)}` : 'Locked' },
      h('div.disc', icon(b.icon)), h('div.nm', b.name), h('div.ds', b.desc)))),
    h('div.grid.g2', { style: { marginTop: '22px' } },
      h('div.card', h('div.card-h', h('h3', icon('target'), 'This week\'s quests')), G.quests.map(q => h('div', { style: { padding: '10px 0', borderBottom: '1px solid var(--line)' } },
        h('div.row', icon(q.done ? 'check-circle-2' : 'circle-dot'), h('b', q.title), h('span.chip.xp', { style: { marginLeft: 'auto' } }, `+${q.xp}`)),
        h('div.muted', { style: { fontSize: '12px', margin: '4px 0 6px' } }, q.desc), h('div.bar.accent', h('i', { style: { width: `${q.progress / q.goal * 100}%` } }))))),
      h('div.card', h('div.card-h', h('h3', icon('sparkles'), 'How XP works')),
        h('table.tbl', h('tbody', Object.entries(G.xp_table).map(([k, v]) => h('tr', h('td', XP_LABELS[k] || k), h('td.num', { class: v < 0 ? 'bad' : '' }, v > 0 ? `+${v}` : v))))),
        h('div.help', { style: { marginTop: '8px' } }, 'Zero XP for profit. Zero XP for trade count. The only way to level fast is to be boringly consistent.'))),
    h('div.card', { style: { marginTop: '16px' } }, h('div.card-h', h('h3', icon('activity'), 'Recent XP')),
      G.recent_xp.length ? h('table.tbl', h('tbody', G.recent_xp.map(x => h('tr', h('td.mono', fmt.local(x.ts)), h('td', XP_LABELS[x.kind] || x.kind), h('td.muted', x.note || ''), h('td.num', { class: x.xp < 0 ? 'bad' : 'accent' }, x.xp > 0 ? `+${x.xp}` : x.xp))))) : h('div.muted', 'No XP yet. Start with the daily check-in.')));
}
function box(ic, label, val, foot) {
  return h('div', { style: { padding: '12px', borderRadius: '12px', background: 'rgba(var(--ov),0.027)', border: '1px solid var(--line)' } },
    h('div.eyebrow', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, icon(ic, 'sm'), label),
    h('div', { style: { fontFamily: 'var(--display)', fontSize: '24px', fontWeight: 700, marginTop: '4px' } }, val), h('div.muted', { style: { fontSize: '11.5px' } }, foot));
}
