const test = require('node:test');
const assert = require('node:assert');
const FB = require('./core.js');

const hdr = 'RANK\tPLAYER\tPOS\tTEAM\tGP\tMPG\tFG%\tFT%\t3PM\tPTS\tTREB\tAST\tSTL\tBLK\tTO';
// Deliberately awkward cells: "pct (attempts)" shooting format, leading-dot percents.
const row = (n, fg, ft, tpm, pts, reb, ast, stl, blk, to) =>
  `1\t${n}\tPG\tAAA\t70\t30\t${fg}\t${ft}\t${tpm}\t${pts}\t${reb}\t${ast}\t${stl}\t${blk}\t${to}`;

function sample() {
  const lines = [hdr];
  for (let i = 0; i < 40; i++) lines.push(row('P' + i, `.${450 + i} (${10 + (i % 5)})`, `.${700 + i} (${3 + (i % 3)})`, i % 4, 10 + i, 3 + (i % 8), i % 7, i % 3, i % 4, 1 + (i % 4)));
  return lines.join('\n');
}

test('parses pct+attempts cells and header aliases', () => {
  const { players, warnings } = FB.parseProjections(sample());
  assert.strictEqual(players.length, 40);
  assert.ok(Math.abs(players[0].fgp - 0.45) < 1e-9);
  assert.strictEqual(players[0].fga, 10);
  assert.strictEqual(warnings.length, 0);
});

test('warns when attempts are missing', () => {
  const txt = 'PLAYER,FG%,FT%,3PM,PTS,REB,AST,STL,BLK,TO\nA,48.0,80.0,2,20,5,5,1,1,2\nB,45.0,70.0,1,15,8,2,1,2,1';
  const { players, warnings } = FB.parseProjections(txt);
  assert.strictEqual(players.length, 2);
  assert.ok(warnings.some((w) => /estimated/.test(w)));
  assert.ok(Math.abs(players[0].fgp - 0.48) < 1e-9);
});

test('turnovers are inverted and z-scores are centred', () => {
  const { players } = FB.parseProjections(sample());
  FB.computeZ(players, 40);
  const hi = players.reduce((a, b) => (a.to > b.to ? a : b));
  const lo = players.reduce((a, b) => (a.to < b.to ? a : b));
  assert.ok(hi.z.to < lo.z.to);
  const mean = players.reduce((a, p) => a + p.z.pts, 0) / players.length;
  assert.ok(Math.abs(mean) < 1e-9);
});

test('punted categories are ignored; need weights favour weak cats', () => {
  const { players } = FB.parseProjections(sample());
  FB.computeZ(players, 40);
  const p = players[5];
  const all = FB.buildScore(p, []);
  assert.ok(Math.abs(FB.buildScore(p, ['ast']) - (all - p.z.ast)) < 1e-9);
  // roster of only high-PTS players should weight PTS below AST
  const roster = [...players].sort((a, b) => b.pts - a.pts).slice(0, 3);
  const w = FB.needWeights(roster, []);
  assert.strictEqual(FB.needWeights(roster, ['ast']).ast, 0);
  assert.ok(w.pts < w.ast || w.pts < w.reb);
});

test('recommend excludes nothing it is given and sorts descending', () => {
  const { players } = FB.parseProjections(sample());
  FB.computeZ(players, 40);
  const recs = FB.recommend(players.slice(3), players.slice(0, 3), ['ft'], 5);
  assert.strictEqual(recs.length, 5);
  for (let i = 1; i < recs.length; i++) assert.ok(recs[i - 1].score >= recs[i].score);
});
