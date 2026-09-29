// Pure logic: parsing projections, z-scores, punt builds, recommendations.
// Works in the browser (window.FB) and in Node (module.exports) so it can be tested.
(function (root) {
  // `inv` = lower is better. `pct` = percentage cat, valued by volume-weighted impact.
  const CATS = [
    { key: 'fg', label: 'FG%', pct: true },
    { key: 'ft', label: 'FT%', pct: true },
    { key: 'tpm', label: '3PM' },
    { key: 'pts', label: 'PTS' },
    { key: 'reb', label: 'REB' },
    { key: 'ast', label: 'AST' },
    { key: 'stl', label: 'STL' },
    { key: 'blk', label: 'BLK' },
    { key: 'to', label: 'TO', inv: true },
  ];
  const CAT_KEYS = CATS.map((c) => c.key);

  const BUILDS = [
    { id: 'balanced', name: 'Balanced (no punt)', punt: [] },
    { id: 'ft', name: 'Punt FT%', punt: ['ft'] },
    { id: 'fg', name: 'Punt FG%', punt: ['fg'] },
    { id: 'ast', name: 'Punt AST', punt: ['ast'] },
    { id: 'to', name: 'Punt TO', punt: ['to'] },
    { id: 'tpm', name: 'Punt 3PM', punt: ['tpm'] },
    { id: 'pts', name: 'Punt PTS', punt: ['pts'] },
    { id: 'reb', name: 'Punt REB', punt: ['reb'] },
    { id: 'stl', name: 'Punt STL', punt: ['stl'] },
    { id: 'blk', name: 'Punt BLK', punt: ['blk'] },
    { id: 'ftast', name: 'Punt FT% + AST (bigs)', punt: ['ft', 'ast'] },
    { id: 'fgto', name: 'Punt FG% + TO', punt: ['fg', 'to'] },
    { id: 'rebblk', name: 'Punt REB + BLK (guards)', punt: ['reb', 'blk'] },
  ];

  // ---------- parsing ----------
  const ALIASES = {
    name: ['player', 'name', 'playername'],
    pos: ['pos', 'position'],
    team: ['team', 'tm'],
    gp: ['gp', 'games'],
    mpg: ['mpg', 'min', 'mp'],
    fg: ['fg', 'fgpct', 'fgp'],
    ft: ['ft', 'ftpct', 'ftp'],
    fgm: ['fgm'],
    fga: ['fga'],
    ftm: ['ftm'],
    fta: ['fta'],
    tpm: ['3pm', '3ptm', '3s', 'threes', 'fg3m', '3pt'],
    pts: ['pts', 'points'],
    reb: ['treb', 'reb', 'trb', 'rebounds', 'rebs'],
    ast: ['ast', 'assists', 'asts'],
    stl: ['stl', 'steals', 'stls'],
    blk: ['blk', 'blocks', 'blks'],
    to: ['to', 'tov', 'turnovers'],
  };

  function splitLine(line, delim) {
    if (delim === '\t') return line.split('\t');
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
      } else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const num = (s) => {
    const m = String(s == null ? '' : s).replace(/,/g, '').match(/-?\d*\.?\d+/);
    return m ? parseFloat(m[0]) : NaN;
  };
  const pct = (v) => (v > 1 ? v / 100 : v);

  // Some sites show "0.485 (11.2)" (pct + attempts) or "5.2/10.1" (made/attempted).
  function parseShooting(cell) {
    const s = String(cell == null ? '' : cell).trim();
    // "0.573(10.5/18.3)" = pct (made/attempted)
    let m = s.match(/^(-?\d*\.?\d+)\s*\(\s*\d*\.?\d+\s*\/\s*(\d*\.?\d+)\s*\)/);
    if (m) return { pct: pct(parseFloat(m[1])), att: parseFloat(m[2]) };
    m = s.match(/^(-?\d*\.?\d+)\s*\(\s*(\d*\.?\d+)\s*\)/);
    if (m) return { pct: pct(parseFloat(m[1])), att: parseFloat(m[2]) };
    m = s.match(/^(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)/);
    if (m) {
      const made = parseFloat(m[1]), att = parseFloat(m[2]);
      return { pct: att > 0 ? made / att : NaN, att };
    }
    const p = num(s);
    return { pct: isNaN(p) ? NaN : pct(p), att: NaN };
  }

  // Returns { players, warnings }.
  function parseProjections(text) {
    const warnings = [];
    let lines = String(text).split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return { players: [], warnings: ['No data rows found.'] };
    const delim = lines[0].includes('\t') ? '\t' : ',';
    if (delim === '\t') {
      // Copying from some sites wraps a row's trailing cells onto their own lines.
      // A line with 2+ tabs starts a record; tab-free lines continue the previous one.
      const merged = [];
      for (const l of lines) {
        if (merged.length && (l.match(/\t/g) || []).length < 2) merged[merged.length - 1] += '\t' + l.trim();
        else merged.push(l);
      }
      lines = merged;
    }
    // Find the header row: first line containing a player-name column alias.
    let h = lines.findIndex((l) => splitLine(l, delim).some((c) => ALIASES.name.includes(norm(c))));
    if (h < 0) return { players: [], warnings: ['Could not find a PLAYER column in the header.'] };
    const head = splitLine(lines[h], delim).map(norm);
    const col = {};
    for (const [field, names] of Object.entries(ALIASES)) {
      const i = head.findIndex((c) => names.includes(c));
      if (i >= 0) col[field] = i;
    }
    const missing = ['tpm', 'pts', 'reb', 'ast', 'stl', 'blk', 'to', 'fg', 'ft'].filter((f) => !(f in col));
    if (missing.length) warnings.push('Missing columns: ' + missing.join(', ') + ' (those categories will be 0).');

    const players = [];
    let estimated = false;
    for (const line of lines.slice(h + 1)) {
      const c = splitLine(line, delim);
      const name = (c[col.name] || '').trim();
      if (!name || norm(name) === 'player') continue; // repeated header rows
      const g = (f) => (f in col ? num(c[col[f]]) : NaN);
      const fgS = 'fg' in col ? parseShooting(c[col.fg]) : { pct: NaN, att: NaN };
      const ftS = 'ft' in col ? parseShooting(c[col.ft]) : { pct: NaN, att: NaN };
      let fga = !isNaN(g('fga')) ? g('fga') : fgS.att;
      let fta = !isNaN(g('fta')) ? g('fta') : ftS.att;
      let fgp = fgS.pct, ftp = ftS.pct;
      if (isNaN(fgp) && !isNaN(g('fgm')) && fga > 0) fgp = g('fgm') / fga;
      if (isNaN(ftp) && !isNaN(g('ftm')) && fta > 0) ftp = g('ftm') / fta;
      const pts = g('pts') || 0;
      if (isNaN(fga)) { fga = pts * 0.85; estimated = true; }
      if (isNaN(fta)) { fta = pts * 0.22; estimated = true; }
      players.push({
        id: name + '|' + (col.team != null ? (c[col.team] || '').trim() : ''),
        name,
        pos: col.pos != null ? (c[col.pos] || '').trim() : '',
        team: col.team != null ? (c[col.team] || '').trim() : '',
        gp: g('gp'), mpg: g('mpg'),
        fgp: isNaN(fgp) ? 0 : fgp, fga, ftp: isNaN(ftp) ? 0 : ftp, fta,
        tpm: g('tpm') || 0, pts, reb: g('reb') || 0, ast: g('ast') || 0,
        stl: g('stl') || 0, blk: g('blk') || 0, to: g('to') || 0,
      });
    }
    if (players.length && players.every((p) => !p.pts && !p.reb && !p.ast))
      warnings.unshift('ERROR: every stat read as 0 — the columns did not line up. Paste the first rows to the developer.');
    if (estimated)
      warnings.push('FG/FT attempts not found; estimated from points. FG%/FT% values are less accurate — include FGA/FTA columns if you can.');
    return { players, warnings };
  }

  // ---------- z-scores ----------
  function rawValues(p, lg) {
    return {
      fg: p.fga * (p.fgp - lg.fg), // impact: makes above/below league-average FG% on this volume
      ft: p.fta * (p.ftp - lg.ft),
      tpm: p.tpm, pts: p.pts, reb: p.reb, ast: p.ast, stl: p.stl, blk: p.blk, to: p.to,
    };
  }

  function stats(players, poolIds) {
    const pool = players.filter((p) => poolIds.has(p.id));
    const sum = (f) => pool.reduce((a, p) => a + f(p), 0);
    const lg = {
      fg: sum((p) => p.fga * p.fgp) / (sum((p) => p.fga) || 1),
      ft: sum((p) => p.fta * p.ftp) / (sum((p) => p.fta) || 1),
    };
    const vals = pool.map((p) => rawValues(p, lg));
    const mean = {}, sd = {};
    for (const k of CAT_KEYS) {
      const xs = vals.map((v) => v[k]);
      const m = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
      mean[k] = m;
      sd[k] = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length || 1)) || 1;
    }
    return { lg, mean, sd };
  }

  // Adds p.z = {cat: z} and p.total. Pool = top `poolSize` players by total z (iterated twice).
  function computeZ(players, poolSize) {
    let ids = new Set(players.map((p) => p.id));
    for (let pass = 0; pass < 3; pass++) {
      const st = stats(players, ids);
      for (const p of players) {
        const v = rawValues(p, st.lg);
        p.z = {};
        p.total = 0;
        for (const c of CATS) {
          const z = ((v[c.key] - st.mean[c.key]) / st.sd[c.key]) * (c.inv ? -1 : 1);
          p.z[c.key] = z;
          p.total += z;
        }
      }
      ids = new Set([...players].sort((a, b) => b.total - a.total).slice(0, poolSize).map((p) => p.id));
    }
    return players;
  }

  // ---------- roster + recommendations ----------
  function rosterTotals(roster) {
    const t = {};
    for (const k of CAT_KEYS) t[k] = roster.reduce((a, p) => a + p.z[k], 0);
    return t;
  }

  const NEED_STRENGTH = 0.5; // max +/-50% weight swing for team need
  const NEED_SCALE = 3; // z-sum gap at which the swing saturates

  // Weight per active category: >1 where the roster is behind its own active-cat average.
  function needWeights(roster, punt) {
    const active = CAT_KEYS.filter((k) => !punt.includes(k));
    const t = rosterTotals(roster);
    const mean = active.reduce((a, k) => a + t[k], 0) / (active.length || 1);
    const w = {};
    for (const k of CAT_KEYS) {
      if (punt.includes(k)) { w[k] = 0; continue; }
      const gap = Math.max(-1, Math.min(1, (mean - t[k]) / NEED_SCALE));
      w[k] = 1 + NEED_STRENGTH * gap;
    }
    return w;
  }

  function buildScore(p, punt) {
    return CAT_KEYS.reduce((a, k) => a + (punt.includes(k) ? 0 : p.z[k]), 0);
  }

  function recommend(candidates, roster, punt, n = 10) {
    const w = needWeights(roster, punt);
    return candidates
      .map((p) => ({
        player: p,
        base: buildScore(p, punt),
        score: CAT_KEYS.reduce((a, k) => a + w[k] * p.z[k], 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, n);
  }

  // How well the current roster suits each build (sum of z over its non-punted cats).
  function buildFit(roster) {
    const t = rosterTotals(roster);
    return BUILDS.map((b) => ({
      build: b,
      fit: CAT_KEYS.reduce((a, k) => a + (b.punt.includes(k) ? 0 : t[k]), 0),
    })).sort((a, b) => b.fit - a.fit);
  }

  const api = { CATS, CAT_KEYS, BUILDS, parseProjections, computeZ, rosterTotals, needWeights, buildScore, recommend, buildFit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FB = api;
})(typeof window !== 'undefined' ? window : globalThis);
