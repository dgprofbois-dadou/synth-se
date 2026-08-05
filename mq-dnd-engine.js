/**
 * mq-dnd-engine.js — Noyau commun DnD (éditeur, mode élève, HTML exporté, tests Node).
 * Compatible navigateur (window.MqDndEngine) et CommonJS (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (typeof root !== 'undefined') {
    root.MqDndEngine = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MQ_DND_MAX_ZONES = 100;
  var GAME_TYPES = ['selection', 'exact', 'classification', 'mindmap', 'linking'];
  var FEEDBACK_MODES = ['immediate', 'deferred'];
  var CARD_USES = ['unique', 'retry', 'reusable'];
  var LINK_MODES = ['one-to-one', 'one-to-many'];

  function parseIdList(raw) {
    if (Array.isArray(raw)) {
      return raw.map(function (s) { return String(s).trim(); }).filter(Boolean);
    }
    return String(raw || '')
      .split(',')
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function cloneJson(v) {
    return JSON.parse(JSON.stringify(v == null ? null : v));
  }

  function normalizeGameType(t) {
    var v = String(t || 'selection').toLowerCase();
    return GAME_TYPES.indexOf(v) >= 0 ? v : 'selection';
  }

  function normalizeFeedbackMode(t) {
    var v = String(t || 'immediate').toLowerCase();
    return FEEDBACK_MODES.indexOf(v) >= 0 ? v : 'immediate';
  }

  function normalizeCardUse(t) {
    var v = String(t || 'unique').toLowerCase();
    if (v === 'unique-retry' || v === 'unique_retry') v = 'retry';
    return CARD_USES.indexOf(v) >= 0 ? v : 'unique';
  }

  function normalizeLinkMode(t) {
    var v = String(t || 'one-to-one').toLowerCase();
    return LINK_MODES.indexOf(v) >= 0 ? v : 'one-to-one';
  }

  function isSingleUse(cardUse) {
    var u = normalizeCardUse(cardUse);
    return u === 'unique' || u === 'retry';
  }

  function normalizeAllowedLinks(raw) {
    var list = [];
    if (typeof raw === 'string') {
      raw.split(/[\n;]+/).forEach(function (line) {
        var m = String(line).trim().match(/^(.+?)\s*(?:→|->|>|=)\s*(.+)$/);
        if (m) list.push({ from: m[1].trim(), to: m[2].trim() });
      });
    } else if (Array.isArray(raw)) {
      raw.forEach(function (l) {
        if (!l || typeof l !== 'object') return;
        var from = String(l.from != null ? l.from : '').trim();
        var to = String(l.to != null ? l.to : '').trim();
        if (from && to) list.push({ from: from, to: to });
      });
    }
    var seen = {};
    return list.filter(function (l) {
      if (!l.from || !l.to || l.from === l.to) return false;
      var k = l.from + '\0' + l.to;
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  function allowedLinksToText(links) {
    return normalizeAllowedLinks(links).map(function (l) {
      return l.from + '>' + l.to;
    }).join('\n');
  }

  function linkPairKey(from, to) {
    return String(from) + '\0' + String(to);
  }

  function normalizeDropzone(dz, index) {
    var src = dz && typeof dz === 'object' ? dz : {};
    var id = src.id != null ? src.id : (index + 1);
    var acceptedIds = Array.isArray(src.acceptedIds)
      ? src.acceptedIds.map(function (x) { return String(x).trim(); }).filter(Boolean)
      : [];
    var out = {
      id: id,
      x: typeof src.x === 'number' ? src.x : 10,
      y: typeof src.y === 'number' ? src.y : 250,
      width: typeof src.width === 'number' ? src.width : 250,
      height: typeof src.height === 'number' ? src.height : 250,
      label: src.label != null ? String(src.label) : '',
      acceptedIds: acceptedIds,
      capacity: Math.max(1, parseInt(src.capacity, 10) || 1),
      required: src.required === false ? false : true,
      groupId: src.groupId != null ? String(src.groupId) : '',
      successMessage: src.successMessage != null ? String(src.successMessage) : '',
      errorMessage: src.errorMessage != null ? String(src.errorMessage) : ''
    };
    if (src.row != null) out.row = parseInt(src.row, 10) || src.row;
    if (src.column != null) out.column = parseInt(src.column, 10) || src.column;
    return out;
  }

  function applyGameDefaults(g) {
    if (!g || typeof g !== 'object') return g;
    g.gameType = normalizeGameType(g.gameType);
    g.feedbackMode = normalizeFeedbackMode(g.feedbackMode);
    g.cardUse = normalizeCardUse(g.cardUse);
    if (typeof g.showScore !== 'boolean') g.showScore = true;
    if (typeof g.showMalus !== 'boolean') g.showMalus = true;
    if (typeof g.revealLinksOnComplete !== 'boolean') g.revealLinksOnComplete = true;
    if (typeof g.hideBordersOnComplete !== 'boolean') g.hideBordersOnComplete = true;
    if (g.instructions == null) g.instructions = '';
    else g.instructions = String(g.instructions);
    if (typeof g.showInstructions !== 'boolean') g.showInstructions = true;
    if (g.goodIds == null) g.goodIds = '';
    if (!Array.isArray(g.dropzones)) g.dropzones = [];
    g.dropzones = g.dropzones.map(normalizeDropzone);
    g.linkMode = normalizeLinkMode(g.linkMode);
    g.allowedLinks = normalizeAllowedLinks(g.allowedLinks);
    if (typeof g.enableLinking !== 'boolean') {
      g.enableLinking = normalizeGameType(g.gameType) === 'linking';
    }
    if (normalizeGameType(g.gameType) === 'linking') g.enableLinking = true;
    if (g.linkTooltip == null || g.linkTooltip === '') {
      g.linkTooltip = 'Maintenez le clic sur une image et tirez la flèche jusqu’à l’arrivée.';
    } else {
      g.linkTooltip = String(g.linkTooltip);
    }
    return g;
  }

  function isSelection(game) {
    return normalizeGameType(game && game.gameType) === 'selection';
  }

  function isLinking(game) {
    return normalizeGameType(game && game.gameType) === 'linking';
  }

  function hasLinkingFeature(game) {
    return isLinking(game) || !!(game && game.enableLinking);
  }

  function goodIdSet(game) {
    return new Set(parseIdList(game && game.goodIds));
  }

  /** Une carte est-elle acceptée dans cette zone ? */
  function isCardAcceptedInZone(game, zone, cardId) {
    var id = String(cardId == null ? '' : cardId);
    if (!id) return false;
    if (isSelection(game)) {
      return goodIdSet(game).has(id);
    }
    var accepted = (zone && Array.isArray(zone.acceptedIds)) ? zone.acceptedIds : [];
    return accepted.map(String).indexOf(id) >= 0;
  }

  /**
   * placements: { [zoneKey]: string[] } — clés = String(zone.id)
   * Retourne l'évaluation d'une zone.
   */
  function evaluateZone(game, zone, placedIds) {
    var ids = (placedIds || []).map(String).filter(Boolean);
    var capacity = Math.max(1, parseInt(zone && zone.capacity, 10) || 1);
    var required = !(zone && zone.required === false);
    var correctIds = [];
    var wrongIds = [];
    ids.forEach(function (id) {
      if (isCardAcceptedInZone(game, zone, id)) correctIds.push(id);
      else wrongIds.push(id);
    });

    var expectedCount;
    if (isSelection(game)) {
      expectedCount = 1;
    } else if (normalizeGameType(game.gameType) === 'classification') {
      expectedCount = Math.min(capacity, (zone.acceptedIds || []).length || capacity);
    } else {
      // exact / mindmap : au moins 1 carte attendue si acceptedIds non vide, sinon capacity
      expectedCount = (zone.acceptedIds && zone.acceptedIds.length)
        ? Math.min(capacity, Math.max(1, zone.acceptedIds.length > capacity ? capacity : 1))
        : 1;
      // Pour exact avec plusieurs acceptedIds équivalents : 1 slot suffit
      if (normalizeGameType(game.gameType) === 'exact' || normalizeGameType(game.gameType) === 'mindmap') {
        expectedCount = Math.min(capacity, 1);
        // Si capacity > 1 et plusieurs accepted distincts attendus, compter min(capacity, acceptedIds.length)
        if (capacity > 1 && zone.acceptedIds && zone.acceptedIds.length > 1) {
          expectedCount = Math.min(capacity, zone.acceptedIds.length);
        }
      }
    }

    var filledOk = wrongIds.length === 0 && correctIds.length > 0;
    var complete;
    if (isSelection(game)) {
      complete = wrongIds.length === 0 && correctIds.length >= 1;
    } else if (normalizeGameType(game.gameType) === 'classification') {
      // Toutes les cartes placées doivent être acceptées ; score = correctIds.length
      complete = wrongIds.length === 0 && correctIds.length >= Math.min(capacity, (zone.acceptedIds || []).length || 1);
      if ((zone.acceptedIds || []).length === 0) complete = wrongIds.length === 0 && correctIds.length === 0 && !required;
    } else {
      complete = wrongIds.length === 0 && correctIds.length >= expectedCount;
    }

    if (!required && ids.length === 0) {
      complete = true;
      filledOk = true;
    }

    return {
      zoneId: zone && zone.id,
      groupId: (zone && zone.groupId) || '',
      required: required,
      capacity: capacity,
      placedIds: ids,
      correctIds: correctIds,
      wrongIds: wrongIds,
      correctCount: correctIds.length,
      isCorrect: filledOk && (complete || (!required && ids.length === 0)),
      isComplete: complete,
      isEmpty: ids.length === 0,
      hasWrong: wrongIds.length > 0,
      message: (filledOk && complete && zone && zone.successMessage)
        ? zone.successMessage
        : (wrongIds.length && zone && zone.errorMessage ? zone.errorMessage : '')
    };
  }

  /**
   * Score max d'un jeu selon le type.
   * selection : nombre de goodIds
   * exact/mindmap : somme des attendus sur zones required
   * classification : somme des cartes attendues (min capacity, acceptedIds.length) sur zones required
   * linking : nombre de paires autorisées
   */
  function computeDndBaseMaxScore(game) {
    if (!game) return 0;
    var type = normalizeGameType(game.gameType);
    if (type === 'linking') return 0;
    if (type === 'selection') {
      var goods = parseIdList(game.goodIds);
      var tc = parseInt(game.targetCount, 10) || 0;
      if (goods.length && tc) return Math.min(goods.length, tc);
      return goods.length || tc || 0;
    }
    var zones = Array.isArray(game.dropzones) ? game.dropzones : [];
    var total = 0;
    zones.forEach(function (z) {
      if (z.required === false) return;
      var cap = Math.max(1, parseInt(z.capacity, 10) || 1);
      var acc = Array.isArray(z.acceptedIds) ? z.acceptedIds.length : 0;
      if (type === 'classification') {
        total += acc ? Math.min(cap, acc) : cap;
      } else {
        if (acc === 0) total += 1;
        else if (cap > 1) total += Math.min(cap, acc);
        else total += 1;
      }
    });
    return total;
  }

  function computeGameMaxScore(game) {
    if (!game) return 0;
    if (isLinking(game)) {
      return normalizeAllowedLinks(game.allowedLinks).length;
    }
    var total = computeDndBaseMaxScore(game);
    if (game.enableLinking) {
      total += normalizeAllowedLinks(game.allowedLinks).length;
    }
    return total;
  }

  /**
   * Évalue les liaisons (flèches) pour un jeu linking.
   * links: [{ from, to }]
   */
  function evaluateLinks(game, links) {
    var allowed = normalizeAllowedLinks(game && game.allowedLinks);
    var allowedSet = {};
    allowed.forEach(function (l) {
      allowedSet[linkPairKey(l.from, l.to)] = true;
    });
    var user = normalizeAllowedLinks(links || []);
    var correct = [];
    var wrong = [];
    var seenCorrect = {};
    user.forEach(function (l) {
      var k = linkPairKey(l.from, l.to);
      if (allowedSet[k]) {
        if (!seenCorrect[k]) {
          seenCorrect[k] = true;
          correct.push(l);
        }
      } else {
        wrong.push(l);
      }
    });
    var maxScore = allowed.length;
    var score = correct.length;
    return {
      links: user,
      correct: correct,
      wrong: wrong,
      score: score,
      maxScore: maxScore,
      isComplete: maxScore > 0 && score >= maxScore && wrong.length === 0,
      gameType: 'linking'
    };
  }

  /**
   * Score brut (sans malus) : nombre de cartes correctement placées / liens corrects.
   * placements: { zoneKey: id[] }  OU  pour linking: { links: [{from,to}] } / tableau de liens
   */
  function computeGameScore(game, placements) {
    placements = placements || {};
    var type = normalizeGameType(game && game.gameType);
    if (type === 'linking') {
      var linksOnly = Array.isArray(placements) ? placements
        : (Array.isArray(placements.links) ? placements.links : []);
      return evaluateLinks(game, linksOnly).score;
    }
    var zones = Array.isArray(game && game.dropzones) ? game.dropzones : [];
    var score = 0;

    if (type === 'selection') {
      var good = goodIdSet(game);
      var seen = new Set();
      zones.forEach(function (z) {
        var ids = placements[String(z.id)] || [];
        ids.forEach(function (id) {
          id = String(id);
          if (good.has(id) && !seen.has(id)) {
            seen.add(id);
            score += 1;
          }
        });
      });
    } else {
      zones.forEach(function (z) {
        var ev = evaluateZone(game, z, placements[String(z.id)] || []);
        score += ev.correctCount;
      });
    }
    if (game && game.enableLinking) {
      score += evaluateLinks(game, placements.links || []).score;
    }
    return score;
  }

  function evaluateGame(game, placements) {
    placements = placements || {};
    if (isLinking(game)) {
      var links = Array.isArray(placements) ? placements
        : (Array.isArray(placements.links) ? placements.links : []);
      var lev = evaluateLinks(game, links);
      return {
        zoneEvals: [],
        groups: {},
        links: lev.links,
        correctLinks: lev.correct,
        wrongLinks: lev.wrong,
        linkEval: lev,
        score: lev.score,
        maxScore: lev.maxScore,
        isComplete: lev.isComplete,
        gameType: 'linking'
      };
    }
    var zones = Array.isArray(game && game.dropzones) ? game.dropzones : [];
    var zoneEvals = zones.map(function (z) {
      return evaluateZone(game, z, placements[String(z.id)] || []);
    });
    var groups = {};
    zoneEvals.forEach(function (ev) {
      if (!ev.groupId) return;
      if (!groups[ev.groupId]) groups[ev.groupId] = { groupId: ev.groupId, zones: [], allCorrect: true };
      groups[ev.groupId].zones.push(ev);
      if (!ev.isCorrect) groups[ev.groupId].allCorrect = false;
    });
    var requiredOk = zoneEvals.every(function (ev) {
      if (!ev.required) return true;
      return ev.isCorrect && !ev.hasWrong && !ev.isEmpty;
    });
    var dndScore = 0;
    if (isSelection(game)) {
      var good2 = goodIdSet(game);
      var seen2 = new Set();
      zones.forEach(function (z) {
        (placements[String(z.id)] || []).forEach(function (id) {
          id = String(id);
          if (good2.has(id) && !seen2.has(id)) { seen2.add(id); dndScore += 1; }
        });
      });
      var anyWrong = zoneEvals.some(function (ev) { return ev.hasWrong; });
      var selMax = computeDndBaseMaxScore(game);
      requiredOk = dndScore >= selMax && selMax > 0 && !anyWrong;
    } else {
      zoneEvals.forEach(function (ev) { dndScore += ev.correctCount; });
    }
    var dndMax = computeDndBaseMaxScore(game);

    var result = {
      zoneEvals: zoneEvals,
      groups: groups,
      score: dndScore,
      maxScore: dndMax,
      isComplete: requiredOk,
      gameType: normalizeGameType(game && game.gameType)
    };
    if (game && game.enableLinking) {
      var linkEv = evaluateLinks(game, placements.links || []);
      result.linkEval = linkEv;
      result.links = linkEv.links;
      result.correctLinks = linkEv.correct;
      result.wrongLinks = linkEv.wrong;
      result.score = dndScore + linkEv.score;
      result.maxScore = dndMax + linkEv.maxScore;
      result.isComplete = requiredOk && (linkEv.maxScore === 0 || linkEv.isComplete);
    }
    return result;
  }

  function generateGrid(opts) {
    opts = opts || {};
    var rows = Math.max(1, parseInt(opts.rows, 10) || 1);
    var cols = Math.max(1, parseInt(opts.cols, 10) || 1);
    var cellW = Math.max(10, parseInt(opts.cellWidth, 10) || 250);
    var cellH = Math.max(10, parseInt(opts.cellHeight, 10) || 250);
    var gapX = parseInt(opts.gapX, 10);
    if (isNaN(gapX)) gapX = 10;
    var gapY = parseInt(opts.gapY, 10);
    if (isNaN(gapY)) gapY = 10;
    var startX = parseInt(opts.startX, 10);
    if (isNaN(startX)) startX = 10;
    var startY = parseInt(opts.startY, 10);
    if (isNaN(startY)) startY = 250;
    var total = rows * cols;
    if (total > MQ_DND_MAX_ZONES) {
      throw new Error('Trop de zones (' + total + '). Maximum : ' + MQ_DND_MAX_ZONES);
    }
    var zones = [];
    var id = 1;
    for (var r = 1; r <= rows; r++) {
      for (var c = 1; c <= cols; c++) {
        zones.push({
          id: id++,
          x: startX + (c - 1) * (cellW + gapX),
          y: startY + (r - 1) * (cellH + gapY),
          width: cellW,
          height: cellH,
          label: 'L' + r + '-C' + c,
          acceptedIds: [],
          capacity: 1,
          required: true,
          groupId: 'row-' + r,
          successMessage: '',
          errorMessage: '',
          row: r,
          column: c
        });
      }
    }
    return zones;
  }

  function syncDropzonesToTargetCount(g, maxZones) {
    if (!g) return false;
    var cap = maxZones || MQ_DND_MAX_ZONES;
    var target = Math.max(1, Math.min(cap, parseInt(g.targetCount, 10) || 4));
    g.targetCount = target;
    if (!Array.isArray(g.dropzones)) g.dropzones = [];
    var before = g.dropzones.length;
    var zw = g.zoneWidth || 250;
    var zh = g.zoneHeight || 250;
    var gap = g.zoneGap != null ? g.zoneGap : 10;
    var defaultY = 250;

    while (g.dropzones.length < target) {
      var n = g.dropzones.length;
      var last = n > 0 ? g.dropzones[n - 1] : null;
      var newX, newY;
      if (last) {
        newX = (last.x || 0) + (last.width || zw) + gap;
        newY = last.y != null ? last.y : defaultY;
      } else {
        newX = 10;
        newY = defaultY;
      }
      var ids = g.dropzones.map(function (dz) { return parseInt(dz.id, 10) || 0; });
      var maxId = ids.length ? Math.max.apply(null, ids) : 0;
      g.dropzones.push(normalizeDropzone({
        id: maxId + 1,
        x: newX,
        y: newY,
        width: zw,
        height: zh
      }, n));
    }
    while (g.dropzones.length > target) {
      g.dropzones.pop();
    }
    g.dropzones = g.dropzones.map(normalizeDropzone);
    return g.dropzones.length !== before;
  }

  /**
   * Round-trip helper : normalise un jeu et vérifie conservation goodIds.
   */
  function migrateLegacyGame(saved) {
    var g = Object.assign({}, saved || {});
    var preservedGoodIds = g.goodIds;
    applyGameDefaults(g);
    if (preservedGoodIds != null) g.goodIds = preservedGoodIds;
    if (!g.gameType) g.gameType = 'selection';
    return g;
  }

  // ---------- Runtime jouable (DOM) ----------

  function getZonePlacements(zoneEl) {
    return Array.prototype.slice.call(zoneEl.querySelectorAll('[data-id]'))
      .map(function (el) { return el.getAttribute('data-id'); })
      .filter(Boolean);
  }

  function collectPlacements(gameEl, game) {
    var out = {};
    (game.dropzones || []).forEach(function (dz) {
      out[String(dz.id)] = [];
    });
    Array.prototype.forEach.call(gameEl.querySelectorAll('.dropzone'), function (zone) {
      var zid = zone.getAttribute('data-zone-id');
      if (!zid) return;
      out[zid] = getZonePlacements(zone);
    });
    return out;
  }

  /**
   * Couche Relier (flèches) — bouton Relier + tirage au clic maintenu.
   * opts.hybrid: true = en plus d'un jeu DnD (ne masque pas les zones).
   * opts.onChange: callback après modification des liens.
   * opts.getVerifiedOnce / opts.addErrors: pont avec le score parent (hybrid).
   */
  function attachLinkingFeature(gameContainer, game, hooks, opts) {
    hooks = hooks || {};
    opts = opts || {};
    var hybrid = !!opts.hybrid;
    var feedbackMode = normalizeFeedbackMode(game.feedbackMode);
    var linkMode = normalizeLinkMode(game.linkMode);
    var links = [];
    var linkErrors = 0;
    var verifiedOnce = feedbackMode === 'immediate';
    var gameId = opts.gameId || game._gameId || gameContainer.getAttribute('data-dnd-gameid') || 'game';
    var linkModeActive = false;
    var dragState = null;
    var completeFired = false;

    gameContainer.classList.add('dnd-linking-ready');
    if (!hybrid) {
      gameContainer.classList.add('dnd-linking');
      Array.prototype.forEach.call(gameContainer.querySelectorAll('.dropzone'), function (z) {
        z.style.pointerEvents = 'none';
        z.style.opacity = '0';
        z.setAttribute('aria-hidden', 'true');
      });
    }

    function cssEscape(id) {
      if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(id));
      return String(id).replace(/"/g, '\\"');
    }
    function findNode(id) {
      return gameContainer.querySelector('.draggable[data-id="' + cssEscape(id) + '"], [data-link-node][data-id="' + cssEscape(id) + '"]');
    }
    function allNodes() {
      return Array.prototype.slice.call(
        gameContainer.querySelectorAll('.draggable[data-id], [data-link-node][data-id]')
      );
    }
    function localPoint(clientX, clientY) {
      var cr = gameContainer.getBoundingClientRect();
      return { x: clientX - cr.left, y: clientY - cr.top };
    }
    function nodeCenter(el) {
      var cr = gameContainer.getBoundingClientRect();
      var er = el.getBoundingClientRect();
      return { x: (er.left + er.width / 2) - cr.left, y: (er.top + er.height / 2) - cr.top };
    }
    function nodeFromPoint(clientX, clientY) {
      var el = document.elementFromPoint(clientX, clientY);
      if (!el || !el.closest) return null;
      var node = el.closest('.draggable[data-id], [data-link-node][data-id]');
      if (node && gameContainer.contains(node)) return node;
      return null;
    }

    var tip = gameContainer.querySelector('.dnd-link-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'dnd-link-tooltip';
      tip.setAttribute('role', 'status');
      tip.style.cssText = 'position:absolute;z-index:20;pointer-events:none;display:none;max-width:280px;padding:8px 12px;border-radius:10px;background:rgba(30,30,30,0.92);color:#fff;font-size:14px;font-weight:600;line-height:1.3;box-shadow:0 4px 14px rgba(0,0,0,0.25);transform:translate(-50%,-120%);white-space:pre-wrap;text-align:center;';
      gameContainer.appendChild(tip);
    }
    function showTip(text, x, y) {
      tip.textContent = text || '';
      tip.style.display = text ? 'block' : 'none';
      if (text) {
        tip.style.left = Math.max(20, Math.min((gameContainer.clientWidth || 400) - 20, x)) + 'px';
        tip.style.top = Math.max(24, y) + 'px';
      }
    }
    function hideTip() { tip.style.display = 'none'; }

    var btn = gameContainer.querySelector('.dnd-relier-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dnd-relier-btn';
      btn.textContent = 'Relier';
      btn.title = 'Activer le mode flèches';
      btn.style.cssText = 'position:absolute;left:2%;bottom:10%;z-index:12;pointer-events:auto;padding:10px 16px;font-size:16px;font-weight:bold;cursor:pointer;border:none;border-radius:10px;background:#1565c0;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.25);';
      gameContainer.appendChild(btn);
    }

    function setLinkMode(on) {
      linkModeActive = !!on;
      gameContainer.classList.toggle('dnd-link-mode', linkModeActive);
      btn.classList.toggle('active', linkModeActive);
      btn.setAttribute('aria-pressed', linkModeActive ? 'true' : 'false');
      btn.style.background = linkModeActive ? '#ef6c00' : '#1565c0';
      btn.textContent = linkModeActive ? 'Relier (actif)' : 'Relier';
      allNodes().forEach(function (el) {
        if (linkModeActive) {
          el.classList.add('dnd-link-node');
          el.dataset._prevDraggable = el.draggable ? '1' : '0';
          el.draggable = false;
          el.style.cursor = 'crosshair';
        } else {
          el.classList.remove('dnd-link-node', 'dnd-link-from', 'dnd-selected');
          if (hybrid) {
            el.draggable = el.dataset._prevDraggable === '1';
            el.style.cursor = '';
          } else {
            el.draggable = false;
            el.style.cursor = 'pointer';
          }
        }
      });
      if (linkModeActive) {
        showTip(game.linkTooltip || 'Maintenez le clic sur une image et tirez la flèche jusqu’à l’arrivée.', (gameContainer.clientWidth || 200) / 2, 40);
      } else {
        hideTip();
        cancelDrag();
      }
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setLinkMode(!linkModeActive);
    });

    var svg = gameContainer.querySelector('svg.dnd-links-layer');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'dnd-links-layer');
      svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:6;pointer-events:none;overflow:visible;';
      var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      ['#1565c0', '#2e7d32', '#d32f2f', '#f59e0b'].forEach(function (color, i) {
        var names = ['arrow-pending', 'arrow-ok', 'arrow-bad', 'arrow-drag'];
        var marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', names[i] + '-' + gameId);
        marker.setAttribute('markerWidth', '10');
        marker.setAttribute('markerHeight', '10');
        marker.setAttribute('refX', '8');
        marker.setAttribute('refY', '3');
        marker.setAttribute('orient', 'auto');
        marker.setAttribute('markerUnits', 'strokeWidth');
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M0,0 L0,6 L9,3 z');
        path.setAttribute('fill', color);
        marker.appendChild(path);
        defs.appendChild(marker);
      });
      svg.appendChild(defs);
      gameContainer.appendChild(svg);
    }

    function isAllowedPair(from, to) {
      var allowed = normalizeAllowedLinks(game.allowedLinks);
      for (var i = 0; i < allowed.length; i++) {
        if (String(allowed[i].from) === String(from) && String(allowed[i].to) === String(to)) return true;
      }
      return false;
    }

    function addLink(from, to) {
      from = String(from);
      to = String(to);
      if (!from || !to || from === to) return false;
      if (linkMode === 'one-to-one') {
        links = links.filter(function (l) { return String(l.from) !== from && String(l.to) !== to; });
      } else {
        links = links.filter(function (l) { return !(String(l.from) === from && String(l.to) === to); });
      }
      var ok = isAllowedPair(from, to);
      if (!ok) {
        linkErrors += 1;
        if (typeof opts.addErrors === 'function') opts.addErrors(1);
        if (typeof hooks.playSound === 'function') hooks.playSound('error');
      } else if (typeof hooks.playSound === 'function') {
        hooks.playSound('ok');
      }
      links.push({ from: from, to: to });
      if (typeof opts.onChange === 'function') opts.onChange();
      else refreshStandalone();
      return true;
    }

    function removeLinkAt(index) {
      if (index < 0 || index >= links.length) return;
      links.splice(index, 1);
      if (typeof opts.onChange === 'function') opts.onChange();
      else refreshStandalone();
    }

    function drawLinks(ev) {
      Array.prototype.slice.call(svg.querySelectorAll('line.dnd-link-line, line.dnd-link-hit')).forEach(function (n) {
        n.parentNode.removeChild(n);
      });
      var showFb = feedbackMode === 'immediate' || verifiedOnce || (ev && ev.isComplete);
      if (typeof opts.getVerifiedOnce === 'function') {
        showFb = feedbackMode === 'immediate' || opts.getVerifiedOnce() || (ev && ev.isComplete);
      }
      links.forEach(function (l, idx) {
        var a = findNode(l.from);
        var b = findNode(l.to);
        if (!a || !b) return;
        var ca = nodeCenter(a);
        var cb = nodeCenter(b);
        var ok = isAllowedPair(l.from, l.to);
        var state = showFb ? (ok ? 'ok' : 'bad') : 'pending';
        var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(ca.x));
        line.setAttribute('y1', String(ca.y));
        line.setAttribute('x2', String(cb.x));
        line.setAttribute('y2', String(cb.y));
        line.setAttribute('class', 'dnd-link-line dnd-link-' + state);
        line.setAttribute('stroke-width', '4');
        line.setAttribute('stroke-linecap', 'round');
        var colors = { pending: '#1565c0', ok: '#2e7d32', bad: '#d32f2f' };
        line.setAttribute('stroke', colors[state] || colors.pending);
        line.setAttribute('marker-end', 'url(#arrow-' + state + '-' + gameId + ')');
        svg.appendChild(line);
        var hit = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        hit.setAttribute('x1', String(ca.x));
        hit.setAttribute('y1', String(ca.y));
        hit.setAttribute('x2', String(cb.x));
        hit.setAttribute('y2', String(cb.y));
        hit.setAttribute('class', 'dnd-link-hit');
        hit.setAttribute('stroke', 'transparent');
        hit.setAttribute('stroke-width', '18');
        hit.style.pointerEvents = 'stroke';
        hit.style.cursor = 'pointer';
        (function (linkIndex) {
          hit.addEventListener('pointerdown', function (e) {
            if (!linkModeActive) return;
            e.preventDefault();
            e.stopPropagation();
            removeLinkAt(linkIndex);
          });
        })(idx);
        svg.appendChild(hit);
      });
      if (dragState && dragState.line && !dragState.line.parentNode) svg.appendChild(dragState.line);
      svg.style.pointerEvents = (linkModeActive && links.length) ? 'auto' : 'none';
    }

    function cancelDrag() {
      if (dragState && dragState.line && dragState.line.parentNode) {
        dragState.line.parentNode.removeChild(dragState.line);
      }
      if (dragState && dragState.fromEl) {
        dragState.fromEl.classList.remove('dnd-link-from', 'dnd-selected');
      }
      dragState = null;
      if (linkModeActive) {
        showTip(game.linkTooltip || 'Maintenez le clic sur une image et tirez la flèche jusqu’à l’arrivée.', (gameContainer.clientWidth || 200) / 2, 40);
      } else {
        hideTip();
      }
    }

    function startDrag(fromEl, clientX, clientY) {
      var id = fromEl.getAttribute('data-id');
      if (!id) return;
      var c = nodeCenter(fromEl);
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'dnd-link-drag');
      line.setAttribute('x1', String(c.x));
      line.setAttribute('y1', String(c.y));
      var pt = localPoint(clientX, clientY);
      line.setAttribute('x2', String(pt.x));
      line.setAttribute('y2', String(pt.y));
      line.setAttribute('stroke', '#f59e0b');
      line.setAttribute('stroke-width', '4');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('stroke-dasharray', '8 6');
      line.setAttribute('marker-end', 'url(#arrow-drag-' + gameId + ')');
      line.style.pointerEvents = 'none';
      svg.appendChild(line);
      svg.style.pointerEvents = 'none';
      fromEl.classList.add('dnd-link-from', 'dnd-selected');
      dragState = { fromId: id, fromEl: fromEl, line: line };
      showTip('Tirez jusqu’à l’image d’arrivée, puis relâchez.', pt.x, pt.y);
    }

    function moveDrag(clientX, clientY) {
      if (!dragState || !dragState.line) return;
      var pt = localPoint(clientX, clientY);
      dragState.line.setAttribute('x2', String(pt.x));
      dragState.line.setAttribute('y2', String(pt.y));
      showTip('Tirez jusqu’à l’image d’arrivée, puis relâchez.', pt.x, pt.y);
    }

    function endDrag(clientX, clientY) {
      if (!dragState) return;
      var fromId = dragState.fromId;
      var target = nodeFromPoint(clientX, clientY);
      cancelDrag();
      if (target) {
        var toId = target.getAttribute('data-id');
        if (toId && String(toId) !== String(fromId)) addLink(fromId, toId);
      }
      if (linkModeActive) {
        showTip(game.linkTooltip || 'Maintenez le clic sur une image et tirez la flèche jusqu’à l’arrivée.', (gameContainer.clientWidth || 200) / 2, 40);
      }
    }

    function onPointerDown(e) {
      if (!linkModeActive) return;
      if (e.button != null && e.button !== 0) return;
      var el = e.currentTarget;
      e.preventDefault();
      e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      startDrag(el, e.clientX, e.clientY);
    }
    function onPointerMove(e) {
      if (!dragState) return;
      e.preventDefault();
      moveDrag(e.clientX, e.clientY);
    }
    function onPointerUp(e) {
      if (!dragState) return;
      e.preventDefault();
      endDrag(e.clientX, e.clientY);
    }

    allNodes().forEach(function (el) {
      if (!hybrid) {
        el.draggable = false;
        el.classList.add('dnd-link-node');
        el.style.pointerEvents = 'auto';
        el.style.cursor = 'pointer';
      }
      el.addEventListener('pointerdown', onPointerDown);
      el.addEventListener('pointermove', onPointerMove);
      el.addEventListener('pointerup', onPointerUp);
      el.addEventListener('pointercancel', function () { cancelDrag(); });
    });

    setLinkMode(false);

    function getVerified() {
      if (typeof opts.getVerifiedOnce === 'function') return opts.getVerifiedOnce();
      return verifiedOnce;
    }

    function refreshStandalone() {
      var ev = evaluateLinks(game, links);
      drawLinks(ev);
      if (!hybrid) {
        var resultDiv = gameContainer.querySelector('.dnd-result') || gameContainer.querySelector('[id^="result"]');
        var scoreContainer = gameContainer.querySelector('.score-malus-container') || gameContainer.querySelector('[id^="score-malus"]');
        var instructionsEl = gameContainer.querySelector('.dnd-instructions');
        if (ev.isComplete) {
          gameContainer.classList.add('dnd-game-complete');
          if (instructionsEl) { instructionsEl.hidden = true; instructionsEl.style.display = 'none'; }
          if (resultDiv) { resultDiv.textContent = '✅ Parfait !'; resultDiv.style.color = '#2e7d32'; }
        } else {
          gameContainer.classList.remove('dnd-game-complete');
          if (resultDiv && (feedbackMode === 'immediate' || getVerified())) {
            if (ev.wrong.length) {
              resultDiv.textContent = '❌ Vérifiez vos flèches';
              resultDiv.style.color = '#d32f2f';
            } else {
              resultDiv.textContent = '';
            }
          }
        }
        var maxScore = ev.maxScore;
        var scoreFinal = Math.max(0, ev.score - linkErrors * 0.5);
        if (scoreContainer && game.showScore !== false) {
          var malusHtml = (game.showMalus !== false && linkErrors > 0)
            ? '<span class="dnd-malus" style="color:#d32f2f;">−' + (linkErrors * 0.5) + '</span>'
            : '';
          scoreContainer.innerHTML = '<span class="dnd-score">' + scoreFinal + (maxScore ? ' / ' + maxScore : '') + '</span> ' + malusHtml;
        }
        if (typeof hooks.onScore === 'function') {
          hooks.onScore({ gameId: gameId, score: scoreFinal, maxScore: maxScore, errors: linkErrors, isComplete: ev.isComplete });
        }
        if (ev.isComplete && !completeFired && typeof hooks.onComplete === 'function') {
          completeFired = true;
          hooks.onComplete(ev);
        }
        if (!ev.isComplete) completeFired = false;
      } else {
        drawLinks(evaluateLinks(game, links));
      }
    }

    if (!hybrid && feedbackMode === 'deferred') {
      var verifyBtn = gameContainer.querySelector('.dnd-verify-btn');
      if (!verifyBtn) {
        verifyBtn = document.createElement('button');
        verifyBtn.type = 'button';
        verifyBtn.className = 'dnd-verify-btn';
        verifyBtn.textContent = 'Vérifier';
        verifyBtn.style.cssText = 'position:absolute;left:50%;bottom:8%;transform:translateX(-50%);z-index:5;pointer-events:auto;padding:8px 16px;font-size:18px;cursor:pointer;';
        gameContainer.appendChild(verifyBtn);
      }
      verifyBtn.addEventListener('click', function () {
        verifiedOnce = true;
        refreshStandalone();
      });
    }

    var resizeTimer = null;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { drawLinks(evaluateLinks(game, links)); }, 80);
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', onResize);
    }

    refreshStandalone();

    return {
      refresh: function () { drawLinks(evaluateLinks(game, links)); },
      getLinks: function () { return links.slice(); },
      getErrors: function () { return linkErrors; },
      setVerified: function (v) { verifiedOnce = !!v; },
      isLinkModeActive: function () { return linkModeActive; },
      setLinkMode: setLinkMode
    };
  }

  /**
   * Jeu Relier pur (gameType linking) : consignes + couche flèches.
   */
  function initPlayableLinkingGame(gameContainer, gameConfig, hooks) {
    if (!gameContainer || !gameConfig) return null;
    hooks = hooks || {};
    var game = applyGameDefaults(cloneJson(gameConfig));
    var gameId = gameConfig._gameId || gameContainer.getAttribute('data-dnd-gameid') || 'game';
    game._gameId = gameId;

    var instructionsEl = gameContainer.querySelector('.dnd-instructions');
    var instructionsText = String(game.instructions || '').trim();
    if (!instructionsText && game.showInstructions !== false) {
      instructionsText = 'Cliquez sur Relier, puis maintenez le clic sur une image et tirez jusqu’à l’arrivée.';
    }
    var showInstructions = game.showInstructions !== false && !!instructionsText;
    if (showInstructions && !instructionsEl) {
      instructionsEl = document.createElement('div');
      instructionsEl.className = 'dnd-instructions';
      instructionsEl.setAttribute('role', 'status');
      gameContainer.appendChild(instructionsEl);
    }
    if (instructionsEl) {
      var tbPos = game.titleBox || gameConfig.titleBox || null;
      var gH = game.height || gameContainer.clientHeight || 400;
      var topPct = 8;
      if (tbPos && typeof tbPos.y === 'number') {
        topPct = Math.min(70, Math.max(2, (((tbPos.y || 0) + (tbPos.height || 0) + 10) / Math.max(1, gH)) * 100));
      }
      if (!instructionsEl.style.top) instructionsEl.style.top = topPct + '%';
      if (showInstructions) {
        instructionsEl.textContent = instructionsText;
        instructionsEl.hidden = false;
      } else {
        instructionsEl.hidden = true;
        instructionsEl.style.display = 'none';
      }
    }

    var api = attachLinkingFeature(gameContainer, game, hooks, { hybrid: false, gameId: gameId });
    var scoreHook = hooks.onScore;
    hooks.onScore = null;
    if (api && api.refresh) api.refresh();
    hooks.onScore = scoreHook;
    if (typeof hooks.onReady === 'function') {
      hooks.onReady({ gameId: gameId, maxScore: computeGameMaxScore(game) });
    }
    return {
      refresh: function () { if (api) api.refresh(); },
      getLinks: function () { return api ? api.getLinks() : []; },
      getPlacements: function () { return { links: api ? api.getLinks() : [] }; },
      evaluate: function () { return evaluateGame(game, { links: api ? api.getLinks() : [] }); },
      getErrors: function () { return api ? api.getErrors() : 0; },
      linking: api
    };
  }

  function initPlayableDndGame(gameContainer, gameConfig, hooks) {
    if (!gameContainer || !gameConfig) return null;
    hooks = hooks || {};
    var gamePeek = applyGameDefaults(cloneJson(gameConfig));
    if (isLinking(gamePeek)) {
      return initPlayableLinkingGame(gameContainer, gameConfig, hooks);
    }
    var game = gamePeek;
    var cardUse = normalizeCardUse(game.cardUse);
    var feedbackMode = normalizeFeedbackMode(game.feedbackMode);
    var used = new Set();
    var selectedId = null;
    var nbErreurs = 0;
    var verifiedOnce = feedbackMode === 'immediate';
    var gameId = gameConfig._gameId || gameContainer.getAttribute('data-dnd-gameid') || 'game';
    var linkingApi = null;

    function isLinkModeOn() {
      return !!(linkingApi && linkingApi.isLinkModeActive && linkingApi.isLinkModeActive());
    }

    var resultDiv = gameContainer.querySelector('.dnd-result') || gameContainer.querySelector('[id^="result"]');
    var scoreContainer = gameContainer.querySelector('.score-malus-container') ||
      gameContainer.querySelector('[id^="score-malus"]');
    var instructionsEl = gameContainer.querySelector('.dnd-instructions');
    var instructionsText = String(game.instructions || '').trim();
    var showInstructions = game.showInstructions !== false && !!instructionsText;

    if (showInstructions && !instructionsEl) {
      instructionsEl = document.createElement('div');
      instructionsEl.className = 'dnd-instructions';
      instructionsEl.setAttribute('role', 'status');
      instructionsEl.setAttribute('aria-live', 'polite');
      gameContainer.appendChild(instructionsEl);
    }
    if (instructionsEl) {
      var tbPos = game.titleBox || gameConfig.titleBox || null;
      var gH = game.height || gameContainer.clientHeight || 400;
      var topPct = 8;
      if (tbPos && typeof tbPos.y === 'number') {
        topPct = (((tbPos.y || 0) + (tbPos.height || 0) + 10) / Math.max(1, gH)) * 100;
        if (topPct < 2) topPct = 2;
        if (topPct > 70) topPct = 70;
      }
      if (!instructionsEl.style.top) instructionsEl.style.top = topPct + '%';
      if (showInstructions) {
        instructionsEl.textContent = instructionsText;
        instructionsEl.hidden = false;
        instructionsEl.style.display = '';
      } else {
        instructionsEl.hidden = true;
        instructionsEl.style.display = 'none';
      }
    }

    function updateInstructionsVisibility(isComplete) {
      if (!instructionsEl || !showInstructions) return;
      if (isComplete) {
        instructionsEl.classList.add('dnd-instructions-done');
        instructionsEl.hidden = true;
        instructionsEl.style.display = 'none';
      } else {
        instructionsEl.classList.remove('dnd-instructions-done');
        instructionsEl.hidden = false;
        instructionsEl.style.display = '';
      }
    }
    updateInstructionsVisibility(false);

    function sourceRoot() {
      return gameContainer.querySelector('[id^="source"]') || gameContainer;
    }

    function findOrig(id) {
      return sourceRoot().querySelector('.draggable[data-id="' + cssEscape(id) + '"]');
    }

    function cssEscape(id) {
      if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(id));
      return String(id).replace(/"/g, '\\"');
    }

    function setUsed(id, isUsed) {
      var orig = findOrig(id);
      if (!orig) return;
      if (cardUse === 'reusable') {
        orig.classList.remove('used');
        orig.draggable = true;
        orig.style.opacity = '1';
        used.delete(id);
        return;
      }
      if (isUsed) {
        used.add(id);
        orig.classList.add('used');
        orig.draggable = false;
        orig.style.opacity = '0.3';
        if (orig.style) orig.style.filter = 'grayscale(100%)';
      } else {
        used.delete(id);
        orig.classList.remove('used');
        orig.draggable = true;
        orig.style.opacity = '1';
        if (orig.style) orig.style.filter = 'none';
      }
    }

    function clearSelection() {
      selectedId = null;
      Array.prototype.forEach.call(gameContainer.querySelectorAll('.draggable.dnd-selected, .dnd-placed.dnd-selected'), function (el) {
        el.classList.remove('dnd-selected');
        el.removeAttribute('aria-pressed');
      });
    }

    function selectCard(id, el) {
      clearSelection();
      selectedId = id;
      if (el) {
        el.classList.add('dnd-selected');
        el.setAttribute('aria-pressed', 'true');
      }
      var orig = findOrig(id);
      if (orig && orig !== el) {
        orig.classList.add('dnd-selected');
        orig.setAttribute('aria-pressed', 'true');
      }
    }

    function zoneById(zid) {
      return gameContainer.querySelector('.dropzone[data-zone-id="' + cssEscape(zid) + '"]');
    }

    function findZoneConfig(zid) {
      return (game.dropzones || []).find(function (z) { return String(z.id) === String(zid); });
    }

    function removeFromZone(zone, cardId, reactivate) {
      Array.prototype.slice.call(zone.querySelectorAll('[data-id="' + cssEscape(cardId) + '"]')).forEach(function (n) {
        n.remove();
      });
      if (reactivate !== false) setUsed(cardId, false);
      zone.classList.remove('dropzone-correct', 'dropzone-wrong');
    }

    function bindPlacedCardInteractions(clone, zone, id) {
      function onRemove() {
        removeFromZone(zone, id, true);
        clearSelection();
        refreshUI();
      }

      clone.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (selectedId && selectedId !== id) {
          placeInZone(zone, selectedId, { allowMove: true });
          clearSelection();
          return;
        }
        if (selectedId === id) {
          onRemove();
          return;
        }
        selectCard(id, clone);
      });
      clone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onRemove();
        }
      });

      // Mode retry : glisser une mauvaise carte vers une autre zone
      if (cardUse === 'retry' && clone.draggable) {
        clone.addEventListener('dragstart', function (e) {
          e.dataTransfer.setData('text/plain', id);
          e.dataTransfer.effectAllowed = 'move';
          selectCard(id, clone);
          clone.style.opacity = '0.6';
        });
        clone.addEventListener('dragend', function () {
          clone.style.opacity = '1';
        });
      }
    }

    function placeInZone(zone, id, opts) {
      opts = opts || {};
      var zid = zone.getAttribute('data-zone-id');
      var zcfg = findZoneConfig(zid);
      if (!zcfg) return false;
      if (isSingleUse(cardUse) && used.has(id) && !opts.allowMove) return false;

      var orig = findOrig(id);
      if (!orig) return false;

      var capacity = Math.max(1, parseInt(zcfg.capacity, 10) || 1);
      var current = getZonePlacements(zone);

      if (current.indexOf(id) >= 0) return false;

      if (current.length >= capacity) {
        if (capacity === 1) {
          var oldId = current[0];
          removeFromZone(zone, oldId, true);
        } else {
          return false;
        }
      }

      // Une seule présence à la fois (unique + retry)
      if (isSingleUse(cardUse)) {
        Array.prototype.forEach.call(gameContainer.querySelectorAll('.dropzone'), function (oz) {
          if (oz === zone) return;
          if (getZonePlacements(oz).indexOf(id) >= 0) {
            removeFromZone(oz, id, false);
          }
        });
      }

      var correctHere = isCardAcceptedInZone(game, zcfg, id);
      var clone = orig.cloneNode(true);
      clone.classList.remove('draggable', 'used', 'dnd-selected', 'dnd-retry-movable');
      clone.classList.add('dnd-placed');
      clone.removeAttribute('draggable');
      // Retry + erreur : carte repositionnable ; sinon figée jusqu'au retrait
      var movable = (cardUse === 'retry' && !correctHere);
      if (movable) {
        clone.setAttribute('draggable', 'true');
        clone.draggable = true;
        clone.classList.add('dnd-retry-movable');
        clone.style.cursor = 'grab';
        clone.setAttribute('aria-label', 'Carte ' + id + ' incorrecte — déplacez-la vers une autre zone (malus à chaque erreur)');
      } else {
        clone.setAttribute('draggable', 'false');
        clone.draggable = false;
        clone.style.cursor = 'pointer';
        clone.setAttribute('aria-label', 'Carte ' + id + ' déposée — Entrée pour retirer');
      }
      clone.style.opacity = '1';
      clone.style.filter = 'none';
      clone.style.position = 'static';
      clone.style.left = 'auto';
      clone.style.top = 'auto';
      clone.style.margin = '0';
      clone.style.maxWidth = '100%';
      clone.style.maxHeight = '100%';
      clone.style.pointerEvents = 'auto';
      clone.setAttribute('tabindex', '0');
      clone.setAttribute('role', 'button');

      bindPlacedCardInteractions(clone, zone, id);

      zone.appendChild(clone);
      if (isSingleUse(cardUse)) setUsed(id, true);
      clearSelection();

      // Malus à chaque dépôt incorrect (tous modes), y compris repositionnements
      if (!correctHere) {
        nbErreurs += 1;
        if (feedbackMode === 'immediate') {
          applyZoneFeedback(zone, zcfg, true);
          if (typeof hooks.playSound === 'function') hooks.playSound('error');
        }
      } else if (feedbackMode === 'immediate') {
        applyZoneFeedback(zone, zcfg, true);
        if (typeof hooks.playSound === 'function') hooks.playSound('success');
        if (typeof hooks.showFloating === 'function') hooks.showFloating(zone);
      }

      refreshUI();
      return true;
    }

    function applyZoneFeedback(zone, zcfg, force) {
      if (feedbackMode === 'deferred' && !verifiedOnce && !force) {
        zone.classList.remove('dropzone-correct', 'dropzone-wrong');
        return;
      }
      var ids = getZonePlacements(zone);
      zone.classList.remove('dropzone-correct', 'dropzone-wrong');
      if (!ids.length) return;
      var ev = evaluateZone(game, zcfg, ids);
      if (ev.hasWrong) zone.classList.add('dropzone-wrong');
      else if (ev.correctCount > 0) zone.classList.add('dropzone-correct');
    }

    function refreshUI() {
      var placements = collectPlacements(gameContainer, game);
      if (linkingApi) placements.links = linkingApi.getLinks();
      var ev = evaluateGame(game, placements);
      if (linkingApi && linkingApi.refresh) linkingApi.refresh();

      // Groupes
      Object.keys(ev.groups || {}).forEach(function (gid) {
        var ok = ev.groups[gid].allCorrect;
        Array.prototype.forEach.call(gameContainer.querySelectorAll('.dropzone[data-group-id="' + cssEscape(gid) + '"]'), function (z) {
          z.classList.toggle('dnd-group-complete', ok);
        });
      });

      if (feedbackMode === 'immediate' || verifiedOnce) {
        (game.dropzones || []).forEach(function (zcfg) {
          var zone = zoneById(zcfg.id);
          if (zone) applyZoneFeedback(zone, zcfg, true);
        });
      }

      if (ev.isComplete) {
        gameContainer.classList.add('dnd-game-complete');
        updateInstructionsVisibility(true);
        if (game.hideBordersOnComplete !== false) {
          Array.prototype.forEach.call(gameContainer.querySelectorAll('.dropzone.dropzone-correct'), function (z) {
            z.classList.add('dnd-border-hidden');
          });
        }
        if (resultDiv) {
          resultDiv.textContent = '✅ Parfait !';
          resultDiv.className = (resultDiv.className || '').replace(/\berror\b/g, '') + ' success';
          resultDiv.style.color = '#2e7d32';
        }
      } else {
        gameContainer.classList.remove('dnd-game-complete');
        updateInstructionsVisibility(false);
        Array.prototype.forEach.call(gameContainer.querySelectorAll('.dnd-border-hidden'), function (z) {
          z.classList.remove('dnd-border-hidden');
        });
        if (resultDiv && (feedbackMode === 'immediate' || verifiedOnce)) {
          var any = (ev.zoneEvals || []).some(function (z) { return !z.isEmpty; });
          if (any && verifiedOnce) {
            resultDiv.textContent = '❌ Vérifiez vos réponses';
            resultDiv.style.color = '#d32f2f';
          } else if (feedbackMode === 'immediate') {
            resultDiv.textContent = '';
          }
        }
      }

      var maxScore = ev.maxScore;
      var scoreBrut = ev.score - nbErreurs * 0.5;
      var scoreFinal = Math.max(0, Math.round(scoreBrut * 10) / 10);
      var showScore = game.showScore !== false;
      var showMalus = game.showMalus !== false;

      if (scoreContainer && showScore) {
        var malusHtml = (showMalus && nbErreurs > 0)
          ? '<div class="malus-display" style="color:#d32f2f;">Malus: -' + (nbErreurs * 0.5).toFixed(1) + '</div>'
          : '';
        scoreContainer.innerHTML =
          '<div class="score-display" style="color:#2e7d32;">Score: ' + scoreFinal + ' / ' + maxScore + '</div>' + malusHtml;
      } else if (scoreContainer && !showScore) {
        scoreContainer.innerHTML = '';
      }

      if (typeof hooks.onScore === 'function') {
        hooks.onScore({
          gameId: gameId,
          score: ev.score,
          displayScore: scoreFinal,
          maxScore: maxScore,
          errors: nbErreurs,
          isComplete: ev.isComplete,
          evaluation: ev
        });
      }
      if (ev.isComplete && typeof hooks.onComplete === 'function') {
        hooks.onComplete(ev);
      }
    }

    function tryPlaceSelectedOnZone(zone) {
      if (!selectedId) return;
      var id = selectedId;
      if (isSingleUse(cardUse) && used.has(id)) {
        placeInZone(zone, id, { allowMove: true });
      } else {
        placeInZone(zone, id);
      }
    }

    // Draggables
    Array.prototype.forEach.call(gameContainer.querySelectorAll('.draggable'), function (img) {
      var id = img.getAttribute('data-id');
      if (!img.hasAttribute('tabindex')) img.setAttribute('tabindex', '0');
      if (!img.getAttribute('aria-label')) {
        img.setAttribute('aria-label', 'Carte ' + id + ' — sélectionner puis choisir une zone');
      }
      img.setAttribute('role', 'button');

      img.addEventListener('dragstart', function (e) {
        if (isLinkModeOn()) {
          e.preventDefault();
          return;
        }
        if (isSingleUse(cardUse) && img.classList.contains('used')) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'move';
        try {
          var rect = img.getBoundingClientRect();
          e.dataTransfer.setDragImage(img, rect.width / 2, rect.height / 2);
        } catch (_) { /* ignore */ }
        img.style.opacity = '0.5';
        selectCard(id, img);
      });
      img.addEventListener('dragend', function () {
        img.style.opacity = img.classList.contains('used') ? '0.3' : '1';
      });
      img.addEventListener('click', function (e) {
        if (isLinkModeOn()) return;
        e.preventDefault();
        e.stopPropagation();
        if (isSingleUse(cardUse) && img.classList.contains('used')) return;
        if (selectedId === id) clearSelection();
        else selectCard(id, img);
      });
      img.addEventListener('keydown', function (e) {
        if (isLinkModeOn()) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (isSingleUse(cardUse) && img.classList.contains('used')) return;
          if (selectedId === id) clearSelection();
          else selectCard(id, img);
        }
      });
    });

    // Dropzones
    Array.prototype.forEach.call(gameContainer.querySelectorAll('.dropzone'), function (zone) {
      if (!zone.getAttribute('tabindex')) zone.setAttribute('tabindex', '0');
      var zid = zone.getAttribute('data-zone-id');
      var zcfg = findZoneConfig(zid);
      var label = (zcfg && zcfg.label) || ('Zone ' + zid);
      zone.setAttribute('aria-label', 'Zone de dépôt ' + label);
      if (zcfg && zcfg.groupId) zone.setAttribute('data-group-id', zcfg.groupId);

      zone.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        zone.classList.add('drag-over');
      });
      zone.addEventListener('dragleave', function () {
        zone.classList.remove('drag-over');
      });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        zone.classList.remove('drag-over');
        var id = e.dataTransfer.getData('text/plain');
        if (!id) return;
        placeInZone(zone, id, { allowMove: true });
      });
      zone.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.dnd-placed')) return;
        tryPlaceSelectedOnZone(zone);
      });
      zone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          tryPlaceSelectedOnZone(zone);
        }
      });
    });

    // Bouton vérifier (mode deferred)
    var verifyBtn = gameContainer.querySelector('.dnd-verify-btn');
    if (feedbackMode === 'deferred') {
      if (!verifyBtn) {
        verifyBtn = document.createElement('button');
        verifyBtn.type = 'button';
        verifyBtn.className = 'dnd-verify-btn';
        verifyBtn.textContent = 'Vérifier';
        verifyBtn.style.cssText = 'position:absolute;left:50%;bottom:8%;transform:translateX(-50%);z-index:5;pointer-events:auto;padding:8px 16px;font-size:18px;cursor:pointer;';
        gameContainer.appendChild(verifyBtn);
      }
      verifyBtn.addEventListener('click', function () {
        verifiedOnce = true;
        refreshUI();
      });
    } else if (verifyBtn) {
      verifyBtn.style.display = 'none';
    }

    // Affichage score initial ; onScore utilisateur seulement après interaction
    if (game.enableLinking) {
      linkingApi = attachLinkingFeature(gameContainer, game, hooks, {
        hybrid: true,
        gameId: gameId,
        onChange: function () { refreshUI(); },
        getVerifiedOnce: function () { return verifiedOnce; },
        addErrors: function (n) { nbErreurs += (n || 1); }
      });
    }

    var scoreHook = hooks.onScore;
    hooks.onScore = null;
    refreshUI();
    hooks.onScore = scoreHook;
    if (typeof hooks.onReady === 'function') {
      hooks.onReady({
        gameId: gameId,
        maxScore: computeGameMaxScore(game)
      });
    }

    return {
      refresh: refreshUI,
      getPlacements: function () {
        var p = collectPlacements(gameContainer, game);
        if (linkingApi) p.links = linkingApi.getLinks();
        return p;
      },
      evaluate: function () {
        var p = collectPlacements(gameContainer, game);
        if (linkingApi) p.links = linkingApi.getLinks();
        return evaluateGame(game, p);
      },
      place: function (zoneId, cardId) {
        var z = zoneById(zoneId);
        return z ? placeInZone(z, cardId, { allowMove: true }) : false;
      },
      selectCard: selectCard,
      clearSelection: clearSelection,
      getSelectedId: function () { return selectedId; },
      getErrors: function () { return nbErreurs; },
      linking: linkingApi
    };
  }

  return {
    MQ_DND_MAX_ZONES: MQ_DND_MAX_ZONES,
    GAME_TYPES: GAME_TYPES,
    parseIdList: parseIdList,
    normalizeGameType: normalizeGameType,
    normalizeFeedbackMode: normalizeFeedbackMode,
    normalizeCardUse: normalizeCardUse,
    normalizeLinkMode: normalizeLinkMode,
    normalizeAllowedLinks: normalizeAllowedLinks,
    allowedLinksToText: allowedLinksToText,
    isSingleUse: isSingleUse,
    normalizeDropzone: normalizeDropzone,
    applyGameDefaults: applyGameDefaults,
    isCardAcceptedInZone: isCardAcceptedInZone,
    evaluateZone: evaluateZone,
    evaluateGame: evaluateGame,
    evaluateLinks: evaluateLinks,
    computeGameScore: computeGameScore,
    computeGameMaxScore: computeGameMaxScore,
    generateGrid: generateGrid,
    syncDropzonesToTargetCount: syncDropzonesToTargetCount,
    migrateLegacyGame: migrateLegacyGame,
    initPlayableDndGame: initPlayableDndGame,
    initPlayableLinkingGame: initPlayableLinkingGame,
    attachLinkingFeature: attachLinkingFeature,
    collectPlacements: collectPlacements,
    hasLinkingFeature: hasLinkingFeature,
    computeDndBaseMaxScore: computeDndBaseMaxScore
  };
});
