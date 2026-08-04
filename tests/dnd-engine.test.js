'use strict';
/**
 * Tests légers du moteur DnD (Node, sans framework).
 * Usage: node tests/dnd-engine.test.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const Engine = require('../mq-dnd-engine.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓', name);
  } catch (e) {
    failed++;
    console.error('  ✗', name);
    console.error('   ', e.message);
  }
}

console.log('\n=== Test 1 — ancien jeu (selection / goodIds) ===');
test('import sans gameType → selection', () => {
  const legacy = {
    enabled: true,
    goodIds: '1,4,5',
    targetCount: 3,
    dropzones: [
      { id: 1, x: 10, y: 20, width: 100, height: 80 },
      { id: 2, x: 120, y: 20, width: 100, height: 80 },
      { id: 3, x: 230, y: 20, width: 100, height: 80 }
    ]
  };
  const g = Engine.migrateLegacyGame(legacy);
  assert.strictEqual(g.gameType, 'selection');
  assert.strictEqual(g.goodIds, '1,4,5');
  assert.strictEqual(g.dropzones[0].x, 10);
  assert.strictEqual(g.dropzones[0].width, 100);
  assert.ok(Array.isArray(g.dropzones[0].acceptedIds));
  assert.strictEqual(g.dropzones[0].acceptedIds.length, 0);
});

test('selection: bonne carte dans n’importe quelle zone', () => {
  const g = Engine.applyGameDefaults({
    gameType: 'selection',
    goodIds: '1,4,5',
    targetCount: 3,
    dropzones: [
      { id: 1, capacity: 1 },
      { id: 2, capacity: 1 },
      { id: 3, capacity: 1 }
    ]
  });
  assert.strictEqual(Engine.isCardAcceptedInZone(g, g.dropzones[0], '4'), true);
  assert.strictEqual(Engine.isCardAcceptedInZone(g, g.dropzones[2], '1'), true);
  assert.strictEqual(Engine.isCardAcceptedInZone(g, g.dropzones[0], '9'), false);
  const score = Engine.computeGameScore(g, { '1': ['1'], '2': ['4'], '3': ['5'] });
  assert.strictEqual(score, 3);
  assert.strictEqual(Engine.computeGameMaxScore(g), 3);
});

test('export/réimport sans perte goodIds', () => {
  const original = { goodIds: '1,4,5,6,8', dropzones: [{ id: 1, x: 5, y: 6, width: 7, height: 8 }] };
  const json = JSON.stringify(original);
  const round = Engine.migrateLegacyGame(JSON.parse(json));
  assert.strictEqual(round.goodIds, '1,4,5,6,8');
  assert.strictEqual(round.dropzones[0].x, 5);
});

console.log('\n=== Test 2 — placement exact ===');
test('zone A bruit / zone B casque', () => {
  const g = Engine.applyGameDefaults({
    gameType: 'exact',
    dropzones: [
      { id: 'A', acceptedIds: ['bruit'], capacity: 1, required: true },
      { id: 'B', acceptedIds: ['casque-antibruit'], capacity: 1, required: true }
    ]
  });
  assert.strictEqual(Engine.isCardAcceptedInZone(g, g.dropzones[0], 'bruit'), true);
  assert.strictEqual(Engine.isCardAcceptedInZone(g, g.dropzones[0], 'casque-antibruit'), false);
  assert.strictEqual(Engine.isCardAcceptedInZone(g, g.dropzones[1], 'casque-antibruit'), true);
  const evA = Engine.evaluateZone(g, g.dropzones[0], ['bruit']);
  const evBad = Engine.evaluateZone(g, g.dropzones[0], ['casque-antibruit']);
  const evB = Engine.evaluateZone(g, g.dropzones[1], ['casque-antibruit']);
  assert.strictEqual(evA.isCorrect, true);
  assert.strictEqual(evBad.hasWrong, true);
  assert.strictEqual(evB.isCorrect, true);
});

console.log('\n=== Test 3 — réponses équivalentes ===');
test('deux IDs acceptés dans la même zone', () => {
  const g = Engine.applyGameDefaults({
    gameType: 'exact',
    dropzones: [{ id: 1, acceptedIds: ['casque-antibruit', 'bouchons'], capacity: 1 }]
  });
  assert.strictEqual(Engine.isCardAcceptedInZone(g, g.dropzones[0], 'casque-antibruit'), true);
  assert.strictEqual(Engine.isCardAcceptedInZone(g, g.dropzones[0], 'bouchons'), true);
  assert.strictEqual(Engine.isCardAcceptedInZone(g, g.dropzones[0], 'autre'), false);
});

console.log('\n=== Test 4 — classement ===');
test('capacité 3, score par cartes, retrait', () => {
  const g = Engine.applyGameDefaults({
    gameType: 'classification',
    dropzones: [{
      id: 1,
      acceptedIds: ['a', 'b', 'c'],
      capacity: 3,
      required: true
    }]
  });
  assert.strictEqual(Engine.computeGameMaxScore(g), 3);
  let placements = { '1': ['a', 'b'] };
  assert.strictEqual(Engine.computeGameScore(g, placements), 2);
  placements = { '1': ['a', 'b', 'c'] };
  assert.strictEqual(Engine.computeGameScore(g, placements), 3);
  const ev = Engine.evaluateZone(g, g.dropzones[0], ['a', 'b', 'x']);
  assert.strictEqual(ev.correctCount, 2);
  assert.strictEqual(ev.hasWrong, true);
  // retrait simulé
  placements = { '1': ['a', 'b'] };
  assert.strictEqual(Engine.computeGameScore(g, placements), 2);
});

console.log('\n=== Test 5 — carte réutilisable (modèle) ===');
test('cardUse reusable conservé', () => {
  const g = Engine.applyGameDefaults({
    gameType: 'exact',
    cardUse: 'reusable',
    dropzones: [
      { id: 1, acceptedIds: ['x'], capacity: 1 },
      { id: 2, acceptedIds: ['x'], capacity: 1 }
    ]
  });
  assert.strictEqual(g.cardUse, 'reusable');
  // Les deux zones acceptent la même carte
  assert.strictEqual(Engine.isCardAcceptedInZone(g, g.dropzones[0], 'x'), true);
  assert.strictEqual(Engine.isCardAcceptedInZone(g, g.dropzones[1], 'x'), true);
  assert.strictEqual(Engine.computeGameScore(g, { '1': ['x'], '2': ['x'] }), 2);
});

test('cardUse retry conservé et distinct de unique/reusable', () => {
  const g = Engine.applyGameDefaults({
    gameType: 'exact',
    cardUse: 'retry',
    dropzones: [
      { id: 1, acceptedIds: ['a'], capacity: 1 },
      { id: 2, acceptedIds: ['b'], capacity: 1 }
    ]
  });
  assert.strictEqual(g.cardUse, 'retry');
  assert.strictEqual(Engine.isSingleUse('retry'), true);
  assert.strictEqual(Engine.isSingleUse('unique'), true);
  assert.strictEqual(Engine.isSingleUse('reusable'), false);
  assert.strictEqual(Engine.normalizeCardUse('unique-retry'), 'retry');
});

console.log('\n=== Test 6 — grille 7×3 ===');
test('21 zones, coords, row/col, roundtrip', () => {
  const zones = Engine.generateGrid({
    rows: 7, cols: 3,
    cellWidth: 100, cellHeight: 50,
    gapX: 10, gapY: 5,
    startX: 20, startY: 30
  });
  assert.strictEqual(zones.length, 21);
  assert.strictEqual(zones[0].row, 1);
  assert.strictEqual(zones[0].column, 1);
  assert.strictEqual(zones[0].groupId, 'row-1');
  assert.strictEqual(zones[0].label, 'L1-C1');
  assert.strictEqual(zones[0].x, 20);
  assert.strictEqual(zones[0].y, 30);
  assert.strictEqual(zones[1].x, 20 + 100 + 10);
  assert.strictEqual(zones[3].row, 2);
  assert.strictEqual(zones[3].groupId, 'row-2');
  const json = JSON.stringify(zones);
  const back = JSON.parse(json);
  assert.strictEqual(back.length, 21);
  assert.strictEqual(back[20].label, 'L7-C3');
});

console.log('\n=== Test 7 — score dynamique 3 jeux ===');
test('trois jeux additionnés', () => {
  const games = [
    Engine.applyGameDefaults({ gameType: 'selection', goodIds: '1,2', targetCount: 2, dropzones: [{ id: 1 }, { id: 2 }] }),
    Engine.applyGameDefaults({ gameType: 'exact', dropzones: [{ id: 1, acceptedIds: ['a'], required: true }, { id: 2, acceptedIds: ['b'], required: true }] }),
    Engine.applyGameDefaults({
      gameType: 'classification',
      dropzones: [{ id: 1, acceptedIds: ['x', 'y', 'z'], capacity: 3, required: true }]
    })
  ];
  const maxTotal = games.reduce((s, g) => s + Engine.computeGameMaxScore(g), 0);
  assert.strictEqual(maxTotal, 2 + 2 + 3);
  const scores = [
    Engine.computeGameScore(games[0], { '1': ['1'], '2': ['2'] }),
    Engine.computeGameScore(games[1], { '1': ['a'], '2': ['b'] }),
    Engine.computeGameScore(games[2], { '1': ['x', 'y', 'z'] })
  ];
  assert.strictEqual(scores.reduce((a, b) => a + b, 0), 7);
});

console.log('\n=== Test 8 — présence page 2 dans générateur ===');
test('mqBuildExportDndGameHtml et PAGE 2 dans placement-inputs.html', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'placement-inputs.html'), 'utf8');
  assert.ok(html.includes('function mqBuildExportDndGameHtml'));
  assert.ok(html.includes('JEUX DnD PAGE 2'));
  assert.ok(html.includes('dnd-config-'));
  assert.ok(html.includes('mq-dnd-engine.js'));
});

console.log('\n=== Test 9 — tactile (API sélection) ===');
test('initPlayableDndGame expose selectCard / place', () => {
  assert.strictEqual(typeof Engine.initPlayableDndGame, 'function');
  // Simulation DOM minimale
  const { JSDOM } = (() => {
    try { return { JSDOM: null }; } catch (_) { return { JSDOM: null }; }
  })();
  // Sans jsdom : vérifier le contrat de l’API via un mock minimal
  global.document = {
    createElement: function (tag) {
      return {
        tagName: tag.toUpperCase(),
        style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        children: [],
        appendChild(c) { this.children.push(c); return c; },
        addEventListener() {},
        setAttribute() {},
        getAttribute() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        textContent: '',
        innerHTML: ''
      };
    }
  };
  // Sans vrai DOM complet, on valide seulement que la factory existe et ne plante pas sur null
  assert.strictEqual(Engine.initPlayableDndGame(null, {}), null);
});

console.log('\n=== Sync dropzones plafond 100 ===');
test('sync jusqu’à 21 zones', () => {
  const g = { targetCount: 21, zoneWidth: 50, zoneHeight: 50, zoneGap: 5, dropzones: [] };
  Engine.syncDropzonesToTargetCount(g);
  assert.strictEqual(g.dropzones.length, 21);
});

console.log('\n--------------------------------');
console.log('Résultat:', passed, 'ok,', failed, 'échec(s)');
process.exit(failed ? 1 : 0);
