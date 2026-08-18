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

console.log('\n=== Test instructions ===');
test('applyGameDefaults instructions', () => {
  const g = Engine.applyGameDefaults({ gameType: 'selection', goodIds: '1', targetCount: 1, dropzones: [{ id: 1 }] });
  assert.strictEqual(g.instructions, '');
  assert.strictEqual(g.showInstructions, true);
  assert.strictEqual(g.enableSteps, false);
  assert.ok(Array.isArray(g.steps));
  const g2 = Engine.applyGameDefaults({ instructions: '  Placez les cartes  ', showInstructions: false });
  assert.strictEqual(g2.instructions, '  Placez les cartes  ');
  assert.strictEqual(g2.showInstructions, false);
});

test('UI consignes dans placement-inputs.html', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'placement-inputs.html'), 'utf8');
  assert.ok(html.includes('Instructions'));
  assert.ok(html.includes('ShowInstructions'));
  assert.ok(html.includes('dnd-instructions'));
  assert.ok(html.includes('Consignes (affichées pendant le jeu)'));
  assert.ok(html.includes('EnableSteps'));
  assert.ok(html.includes('Jeu par étapes'));
  assert.ok(html.includes('StepsList'));
  assert.ok(html.includes('InstrW'));
  assert.ok(html.includes('instructionsBox'));
  assert.ok(html.includes('Disposition consignes'));
});

console.log('\n=== Test étapes / consignes ===');
test('normalizeInstructionsBox', () => {
  const box = Engine.normalizeInstructionsBox({ x: 10, y: 20, width: 300, height: 50, fontSize: 18 }, { width: 800, height: 400 });
  assert.strictEqual(box.x, 10);
  assert.strictEqual(box.y, 20);
  assert.strictEqual(box.width, 300);
  assert.strictEqual(box.fontSize, 18);
  assert.ok(box.bgColor);
  const def = Engine.normalizeInstructionsBox(null, { width: 800, titleBox: { x: 0, y: 0, height: 80 } });
  assert.strictEqual(def.y, 90);
});

test('normalizeStep + evaluateStep zones', () => {
  const g = Engine.applyGameDefaults({
    gameType: 'exact',
    enableSteps: true,
    dropzones: [
      { id: '1', acceptedIds: ['a'], capacity: 1, required: true },
      { id: '2', acceptedIds: ['b'], capacity: 1, required: true }
    ],
    steps: [
      { title: 'Étape 1', instructions: 'Placez A', zoneIds: ['1'] },
      { title: 'Étape 2', instructions: 'Placez B', zoneIds: ['2'] }
    ]
  });
  assert.strictEqual(g.steps.length, 2);
  const s1 = Engine.evaluateStep(g, g.steps[0], { '1': ['a'] });
  assert.strictEqual(s1.isComplete, true);
  assert.strictEqual(s1.hasCriteria, true);
  const s2empty = Engine.evaluateStep(g, g.steps[1], { '1': ['a'] });
  assert.strictEqual(s2empty.isComplete, false);
  const st = Engine.getStepsState(g, { '1': ['a'] });
  assert.strictEqual(st.currentIndex, 1);
  assert.strictEqual(st.active.instructions, 'Placez B');
  assert.strictEqual(st.allComplete, false);
  const stDone = Engine.getStepsState(g, { '1': ['a'], '2': ['b'] });
  assert.strictEqual(stDone.allComplete, true);
});

test('étape sans critère → needsManualNext', () => {
  const g = Engine.applyGameDefaults({
    enableSteps: true,
    steps: [{ title: 'Intro', instructions: 'Lisez…', zoneIds: [], goodIds: '', linkPairs: [] }]
  });
  const ev = Engine.evaluateStep(g, g.steps[0], {});
  assert.strictEqual(ev.hasCriteria, false);
  assert.strictEqual(ev.needsManualNext, true);
  assert.strictEqual(ev.isComplete, false);
});

test('activité linking / dnd + Relier gating helpers', () => {
  const dnd = Engine.normalizeStep({ title: 'A', zoneIds: ['1'], activity: 'dnd' }, 0);
  assert.strictEqual(dnd.activity, 'dnd');
  assert.strictEqual(Engine.stepNeedsRelier(dnd), false);
  assert.strictEqual(Engine.stepAutoLinkMode(dnd), false);
  const link = Engine.normalizeStep({ title: 'B', linkPairs: [{ from: '1', to: '2' }], activity: 'linking' }, 1);
  assert.strictEqual(link.activity, 'linking');
  assert.strictEqual(Engine.stepNeedsRelier(link), true);
  assert.strictEqual(Engine.stepAutoLinkMode(link), true);
  const both = Engine.normalizeStep({ title: 'C', activity: 'both', zoneIds: ['1'], linkPairs: [{ from: 'a', to: 'b' }] }, 2);
  assert.strictEqual(Engine.stepNeedsRelier(both), true);
  assert.strictEqual(Engine.stepAutoLinkMode(both), false);
  const inferred = Engine.normalizeStep({ title: 'D', linkPairs: [{ from: 'a', to: 'b' }] }, 3);
  assert.strictEqual(inferred.activity, 'linking');
  const byMap = Engine.normalizeStep({ title: 'E', zoneMap: { '19': ['4'] } }, 4);
  assert.strictEqual(byMap.activity, 'dnd');
  assert.strictEqual(Engine.stepAutoLinkMode(byMap), false);
  const mapAndLinks = Engine.normalizeStep({
    title: 'F',
    zoneMap: { '19': ['4'] },
    linkPairs: [{ from: 'a', to: 'b' }]
  }, 5);
  assert.strictEqual(mapAndLinks.activity, 'both');
  assert.strictEqual(Engine.stepAutoLinkMode(mapAndLinks), false);
});

test('DnD puis Relier : étapes successives', () => {
  const g = Engine.applyGameDefaults({
    gameType: 'exact',
    enableSteps: true,
    enableLinking: true,
    dropzones: [{ id: '1', acceptedIds: ['a'], capacity: 1, required: true }],
    steps: [
      { title: 'Déposer', instructions: 'Placez A', activity: 'dnd', zoneIds: ['1'] },
      { title: 'Relier', instructions: 'Reliez', activity: 'linking', linkPairs: [{ from: '1', to: '2' }] }
    ]
  });
  const st0 = Engine.getStepsState(g, {});
  assert.strictEqual(st0.currentIndex, 0);
  assert.strictEqual(Engine.stepNeedsRelier(st0.active), false);
  const st1 = Engine.getStepsState(g, { '1': ['a'] });
  assert.strictEqual(st1.currentIndex, 1);
  assert.strictEqual(Engine.stepNeedsRelier(st1.active), true);
  const stDone = Engine.getStepsState(g, { '1': ['a'], links: [{ from: '1', to: '2' }] });
  assert.strictEqual(stDone.allComplete, true);
  assert.strictEqual(Engine.shouldHideUsedStepSources(st0), false);
  assert.strictEqual(Engine.shouldHideUsedStepSources(st1), true);
  assert.strictEqual(Engine.shouldHideUsedStepSources(stDone), true);
});

test('zoneMap sans zoneIds → critères de fin d’étape', () => {
  const g = Engine.applyGameDefaults({
    gameType: 'exact',
    enableSteps: true,
    dropzones: [
      { id: '19', acceptedIds: ['4'], capacity: 1, required: true },
      { id: '20', acceptedIds: ['5'], capacity: 1, required: true }
    ],
    steps: [
      { title: 'Étape 1', instructions: 'Placez 4', zoneMap: { '19': ['4'] } },
      { title: 'Étape 2', instructions: 'Placez 5', zoneMap: { '20': ['5'] } }
    ]
  });
  assert.deepStrictEqual(Engine.effectiveStepZoneIds(g.steps[0]), ['19']);
  const st0 = Engine.getStepsState(g, {});
  assert.strictEqual(st0.active.instructions, 'Placez 4');
  const st1 = Engine.getStepsState(g, { '19': ['4'] });
  assert.strictEqual(st1.currentIndex, 1);
  assert.strictEqual(st1.active.instructions, 'Placez 5');
});

test('requireNextButton bloque le passage auto', () => {
  const g = Engine.applyGameDefaults({
    gameType: 'exact',
    enableSteps: true,
    dropzones: [{ id: '1', acceptedIds: ['a'], capacity: 1, required: true }],
    steps: [{ title: 'A', activity: 'dnd', zoneIds: ['1'], requireNextButton: true }]
  });
  const ev = Engine.evaluateStep(g, g.steps[0], { '1': ['a'] });
  assert.strictEqual(ev.criteriaMet, true);
  assert.strictEqual(ev.needsManualNext, true);
  assert.strictEqual(ev.isComplete, false);
});

test('normalizeStep conserve zoneMap et stepGameType', () => {
  const s = Engine.normalizeStep({
    title: 'A',
    zoneIds: ['19', '20'],
    zoneMap: { '19': '4', '20': ['5', '6'] },
    stepGameType: 'exact'
  }, 0);
  assert.deepStrictEqual(s.zoneMap['19'], ['4']);
  assert.deepStrictEqual(s.zoneMap['20'], ['5', '6']);
  assert.strictEqual(s.stepGameType, 'exact');
});

test('normalizeZoneMapIds accepte chaîne CSV et tableaux', () => {
  assert.deepStrictEqual(Engine.normalizeZoneMapIds('4, 5'), ['4', '5']);
  assert.deepStrictEqual(Engine.normalizeZoneMapIds(['7', '8']), ['7', '8']);
  assert.deepStrictEqual(Engine.normalizeZoneMap({ '19': '4', '20': '5,6' }), { '19': ['4'], '20': ['5', '6'] });
});

test('applyStepZoneMapsToDropzones copie zoneMap vers acceptedIds', () => {
  const g = Engine.applyGameDefaults({
    enableSteps: true,
    gameType: 'exact',
    dropzones: [
      { id: 19, acceptedIds: [] },
      { id: 20, acceptedIds: [] }
    ],
    steps: [{
      zoneIds: ['19', '20'],
      zoneMap: { '19': ['4', '5'], '20': '6' }
    }]
  });
  assert.deepStrictEqual(g.dropzones[0].acceptedIds, ['4', '5']);
  assert.deepStrictEqual(g.dropzones[1].acceptedIds, ['6']);
});

test('enableSteps seed depuis instructions', () => {
  const g = Engine.applyGameDefaults({
    enableSteps: true,
    instructions: 'Consigne unique',
    goodIds: '1,2',
    allowedLinks: [{ from: 'a', to: 'b' }],
    steps: []
  });
  assert.strictEqual(g.steps.length, 1);
  assert.strictEqual(g.steps[0].instructions, 'Consigne unique');
  assert.strictEqual(g.steps[0].activity, 'dnd');
  assert.strictEqual(g.steps[0].linkPairs.length, 0);
});

test('selection + cartes cochées sur la zone → validation par zone', () => {
  const g = Engine.applyGameDefaults({
    gameType: 'selection',
    goodIds: '',
    dropzones: [
      { id: 1, acceptedIds: ['bruit'], capacity: 1, required: true },
      { id: 2, acceptedIds: ['casque'], capacity: 1, required: true }
    ]
  });
  assert.strictEqual(Engine.usesZoneAcceptedIds(g), true);
  assert.strictEqual(Engine.isCardAcceptedInZone(g, g.dropzones[0], 'bruit'), true);
  assert.strictEqual(Engine.isCardAcceptedInZone(g, g.dropzones[0], 'casque'), false);
  assert.strictEqual(Engine.isCardAcceptedInZone(g, g.dropzones[1], 'casque'), true);
  const ev = Engine.evaluateGame(g, { '1': ['bruit'], '2': ['casque'] });
  assert.strictEqual(ev.score, 2);
  assert.strictEqual(ev.isComplete, true);
  const bad = Engine.evaluateGame(g, { '1': ['casque'], '2': ['bruit'] });
  assert.strictEqual(bad.isComplete, false);
  assert.ok(bad.score < 2);
});

console.log('\n=== Test linking ===');
test('linking : score et complétion', () => {
  const g = Engine.applyGameDefaults({
    gameType: 'linking',
    allowedLinks: [{ from: '1', to: '3' }, { from: '2', to: '4' }],
    dropzones: []
  });
  assert.strictEqual(g.enableSteps, true);
  assert.strictEqual(g.steps[0].activity, 'linking');
  assert.notStrictEqual(g.gameType, 'linking');
  assert.strictEqual(g.enableLinking, true);
  assert.strictEqual(Engine.computeGameMaxScore(g), 2);
  assert.strictEqual(Engine.computeGameScore(g, { links: [{ from: '1', to: '3' }] }), 1);
  const ok = Engine.evaluateGame(g, { links: [{ from: '1', to: '3' }, { from: '2', to: '4' }] });
  assert.strictEqual(ok.isComplete, true);
  assert.strictEqual(ok.score, 2);
  const bad = Engine.evaluateGame(g, { links: [{ from: '1', to: '4' }, { from: '2', to: '4' }] });
  assert.strictEqual(bad.isComplete, false);
  assert.ok(bad.wrongLinks.length >= 1);
});

test('flèche verte (correcte) non supprimable', () => {
  const g = Engine.applyGameDefaults({
    gameType: 'linking',
    allowedLinks: [{ from: '1', to: '3' }]
  });
  assert.strictEqual(Engine.canRemoveDrawnLink(g, { from: '1', to: '3' }, false), true);
  assert.strictEqual(Engine.canRemoveDrawnLink(g, { from: '1', to: '3' }, true), false);
  assert.strictEqual(Engine.canRemoveDrawnLink(g, { from: '1', to: '9' }, true), true);
});

test('linkSplinePath produit une courbe cubique', () => {
  const d = Engine.linkSplinePath(0, 0, 200, 0);
  assert.ok(d.indexOf('C') >= 0);
  assert.ok(d.charAt(0) === 'M');
  const short = Engine.linkSplinePath(0, 0, 2, 0);
  assert.ok(short.indexOf('L') >= 0);
  const other = Engine.linkSplinePath(0, 0, 200, 0, { sign: -1 });
  assert.notStrictEqual(d, other);
});

test('enableLinking hybride avec selection', () => {
  const g = Engine.applyGameDefaults({
    gameType: 'selection',
    enableLinking: true,
    goodIds: '1,2',
    targetCount: 2,
    allowedLinks: [{ from: 'a', to: 'b' }],
    dropzones: [{ id: 1 }, { id: 2 }]
  });
  assert.strictEqual(Engine.computeGameMaxScore(g), 3);
  const ev = Engine.evaluateGame(g, {
    '1': ['1'],
    '2': ['2'],
    links: [{ from: 'a', to: 'b' }]
  });
  assert.strictEqual(ev.score, 3);
  assert.strictEqual(ev.isComplete, true);
});

test('normalizeAllowedLinks texte', () => {
  const links = Engine.normalizeAllowedLinks('1>3\n2→4\n5->6');
  assert.strictEqual(links.length, 3);
  assert.strictEqual(links[0].from, '1');
  assert.strictEqual(links[1].to, '4');
});

test('effectiveAllowedLinks : étapes primenet sur allowedLinks', () => {
  const g = Engine.applyGameDefaults({
    gameType: 'linking',
    enableSteps: true,
    allowedLinks: [{ from: 'x', to: 'y' }],
    steps: [
      { title: 'E1', instructions: '', linkPairs: [{ from: '1', to: '2' }] },
      { title: 'E2', instructions: '', linkPairs: [{ from: '3', to: '4' }, { from: '1', to: '2' }] }
    ]
  });
  const eff = Engine.effectiveAllowedLinks(g);
  assert.strictEqual(eff.length, 2);
  assert.strictEqual(eff[0].from, '1');
  assert.strictEqual(eff[1].from, '3');
  assert.strictEqual(Engine.computeGameMaxScore(g), 2);
  const ev = Engine.evaluateLinks(g, [{ from: '1', to: '2' }, { from: '3', to: '4' }]);
  assert.strictEqual(ev.isComplete, true);
  assert.strictEqual(ev.score, 2);
  // Sans étapes : allowedLinks classiques
  const g2 = Engine.applyGameDefaults({
    gameType: 'linking',
    enableSteps: false,
    allowedLinks: [{ from: 'a', to: 'b' }]
  });
  assert.strictEqual(Engine.effectiveAllowedLinks(g2).length, 1);
  assert.strictEqual(Engine.effectiveAllowedLinks(g2)[0].from, 'a');
});

test('UI Relier uniquement par étape dans placement-inputs.html', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'placement-inputs.html'), 'utf8');
  assert.ok(html.includes('value="linking"'));
  assert.ok(html.includes('data-field="activity"'));
  assert.ok(html.includes('mqSyncLinkingToolsVisibility'));
  assert.ok(html.includes('dnd-relier-btn') || html.includes('Relier (flèches)'));
  assert.ok(!html.includes('EnableLinking'));
  assert.ok(!html.includes('Relier seul'));
  assert.ok(!html.includes('Activer Relier (flèches) en plus'));
  assert.ok(!html.includes('mq-dnd-global-pairs'));
});

test('ancienne config Relier jeu → étape Relier (reprise)', () => {
  const g = Engine.applyGameDefaults({
    gameType: 'linking',
    allowedLinks: [{ from: '1', to: '3' }],
    enableSteps: true,
    steps: [{ title: 'Étape 1', activity: 'dnd', linkPairs: [{ from: '1', to: '3' }] }]
  });
  assert.strictEqual(g.gameType, 'exact');
  assert.strictEqual(g.steps.length, 1);
  assert.strictEqual(g.steps[0].activity, 'linking');
  assert.strictEqual(g.steps[0].linkPairs[0].from, '1');
  assert.strictEqual(g.enableLinking, true);
  assert.strictEqual(Engine.gameNeedsRelier(g), true);
});

console.log('\n--------------------------------');
console.log('Résultat:', passed, 'ok,', failed, 'échec(s)');
process.exit(failed ? 1 : 0);
