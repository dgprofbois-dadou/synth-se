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

  /** Paires flèches effectives : union des étapes si enableSteps, sinon allowedLinks. */
  function effectiveAllowedLinks(game) {
    if (game && game.enableSteps && Array.isArray(game.steps) && game.steps.length) {
      var out = [];
      var seen = {};
      game.steps.forEach(function (s) {
        normalizeAllowedLinks((s && (s.linkPairs || s.allowedLinks || s.links)) || []).forEach(function (l) {
          var k = String(l.from) + '>' + String(l.to);
          if (!seen[k]) {
            seen[k] = true;
            out.push({ from: String(l.from), to: String(l.to) });
          }
        });
      });
      return out;
    }
    return normalizeAllowedLinks(game && game.allowedLinks);
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
      g.linkTooltip = 'Clic droit maintenu sur une image, puis tirez la flèche jusqu’à l’arrivée.';
    } else {
      g.linkTooltip = String(g.linkTooltip);
    }
    g.relierBtn = normalizeRelierBtn(g.relierBtn, g);
    g.linkZones = normalizeLinkZones(g.linkZones);
    if (typeof g.enableSteps !== 'boolean') g.enableSteps = false;
    g.steps = normalizeSteps(g.steps);
    g.instructionsBox = normalizeInstructionsBox(g.instructionsBox, g);
    if (g.enableSteps && (!g.steps || !g.steps.length) && String(g.instructions || '').trim()) {
      g.steps = [normalizeStep({
        title: 'Étape 1',
        instructions: g.instructions,
        activity: (normalizeGameType(g.gameType) === 'linking') ? 'linking' : 'dnd',
        zoneIds: [],
        goodIds: g.goodIds || '',
        linkPairs: []
      }, 0)];
    }
    if (g.enableSteps) applyStepZoneMapsToDropzones(g);
    return g;
  }

  /** Copie zoneMap des étapes → acceptedIds des dropzones (validation mode élève / export). */
  function applyStepZoneMapsToDropzones(g) {
    if (!g || !g.enableSteps || !Array.isArray(g.steps) || !Array.isArray(g.dropzones)) return g;
    g.steps.forEach(function (step) {
      var map = normalizeZoneMap(step && step.zoneMap);
      Object.keys(map).forEach(function (zid) {
        var ids = map[zid];
        if (!ids || !ids.length) return;
        g.dropzones.forEach(function (dz) {
          if (String(dz.id) === String(zid)) {
            dz.acceptedIds = ids.slice();
          }
        });
      });
    });
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

  /** Au moins une zone a des cartes associées (cases cochées dans l’inspecteur). */
  function usesZoneAcceptedIds(game) {
    var zones = (game && game.dropzones) || [];
    for (var i = 0; i < zones.length; i++) {
      var acc = zones[i] && zones[i].acceptedIds;
      if (Array.isArray(acc) && acc.length) return true;
    }
    return false;
  }

  /** Une carte est-elle acceptée dans cette zone ? */
  function isCardAcceptedInZone(game, zone, cardId) {
    var id = String(cardId == null ? '' : cardId);
    if (!id) return false;
    var accepted = (zone && Array.isArray(zone.acceptedIds)) ? zone.acceptedIds.map(String) : [];
    // Les cases cochées sur la zone priment (même si le type est encore « Sélection »)
    if (accepted.length) return accepted.indexOf(id) >= 0;
    if (isSelection(game)) {
      return goodIdSet(game).has(id);
    }
    return false;
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
    if (type === 'selection' && !usesZoneAcceptedIds(game)) {
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
      return effectiveAllowedLinks(game).length;
    }
    var total = computeDndBaseMaxScore(game);
    if (game.enableLinking) {
      total += effectiveAllowedLinks(game).length;
    }
    return total;
  }

  /**
   * Évalue les liaisons (flèches) pour un jeu linking.
   * links: [{ from, to }]
   * Avec étapes : union des linkPairs ; sinon allowedLinks.
   * evaluateStep passe { allowedLinks: stepPairs } → même chemin via effectiveAllowedLinks.
   */
  function evaluateLinks(game, links) {
    var allowed = effectiveAllowedLinks(game);
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

  function normalizeInstructionsBox(raw, game) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var tb = (game && game.titleBox) || {};
    var gw = Math.max(200, parseInt(game && game.width, 10) || 800);
    var defaultY = (typeof tb.y === 'number' ? tb.y : 10) + (typeof tb.height === 'number' ? tb.height : 80) + 10;
    var align = src.align === 'left' || src.align === 'right' ? src.align : 'center';
    return {
      x: typeof src.x === 'number' ? src.x : 20,
      y: typeof src.y === 'number' ? src.y : defaultY,
      width: typeof src.width === 'number' ? Math.max(80, src.width) : Math.max(200, gw - 40),
      height: typeof src.height === 'number' ? Math.max(40, src.height) : 90,
      font: src.font != null && String(src.font).trim() ? String(src.font) : 'Verdana, sans-serif',
      fontSize: Math.max(10, parseInt(src.fontSize, 10) || 22),
      bold: src.bold === false ? false : (src.bold != null ? !!src.bold : true),
      italic: !!src.italic,
      align: align,
      bgColor: src.bgColor != null && String(src.bgColor).trim() ? String(src.bgColor) : '#fff8e1',
      color: src.color != null && String(src.color).trim() ? String(src.color) : '#78350f',
      borderColor: src.borderColor != null && String(src.borderColor).trim() ? String(src.borderColor) : '#f59e0b'
    };
  }

  /** Bouton Relier (flèche) : position + taille carrée. */
  function normalizeRelierBtn(raw, game) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var gw = Math.max(200, parseInt(game && game.width, 10) || 800);
    var gh = Math.max(100, parseInt(game && game.height, 10) || 400);
    var size = typeof src.size === 'number' ? src.size
      : (typeof src.width === 'number' ? src.width
        : (typeof src.height === 'number' ? src.height : 52));
    size = Math.max(28, Math.min(180, Math.round(size) || 52));
    var x = typeof src.x === 'number' ? Math.round(src.x) : Math.round(gw * 0.02);
    var y = typeof src.y === 'number' ? Math.round(src.y) : Math.max(0, Math.round(gh * 0.90 - size));
    return { x: x, y: y, size: size, width: size, height: size };
  }

  function normalizeLinkZone(raw, index) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var pts = Array.isArray(src.points) ? src.points : [];
    var points = pts.map(function (p) {
      if (Array.isArray(p) && p.length >= 2) {
        return [Math.round(Number(p[0]) || 0), Math.round(Number(p[1]) || 0)];
      }
      if (p && typeof p === 'object') {
        return [Math.round(Number(p.x) || 0), Math.round(Number(p.y) || 0)];
      }
      return null;
    }).filter(Boolean);
    var id = src.id != null && String(src.id).trim() !== ''
      ? String(src.id).trim()
      : ('zone-' + (index + 1));
    return {
      id: id,
      points: points,
      label: src.label != null ? String(src.label) : ''
    };
  }

  function normalizeLinkZones(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeLinkZone).filter(function (z) {
      return z.points && z.points.length >= 3;
    });
  }

  function linkZoneBBox(points) {
    var pts = Array.isArray(points) ? points : [];
    if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(function (p) {
      var x = Array.isArray(p) ? p[0] : 0;
      var y = Array.isArray(p) ? p[1] : 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });
    return {
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY)
    };
  }

  function applyRelierBtnLayout(btn, game) {
    if (!btn || !game) return normalizeRelierBtn(null, game);
    var box = normalizeRelierBtn(game.relierBtn, game);
    game.relierBtn = box;
    btn.style.position = 'absolute';
    btn.style.left = box.x + 'px';
    btn.style.top = box.y + 'px';
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
    btn.style.width = box.size + 'px';
    btn.style.height = box.size + 'px';
    btn.style.borderRadius = '23%';
    var iconSize = box.size;
    var svg = btn.querySelector && btn.querySelector('svg.dnd-relier-icon, svg');
    if (svg) {
      svg.setAttribute('width', String(iconSize));
      svg.setAttribute('height', String(iconSize));
    }
    return box;
  }

  /** Logo « Relier deux zones » (assets/logo-relier-zones.svg) — ids suffixés pour multi-jeux. */
  function relierLogoSvg(uid, size) {
    uid = String(uid == null ? '0' : uid).replace(/[^a-zA-Z0-9_-]/g, '_');
    size = Math.max(14, parseInt(size, 10) || 52);
    var bg = 'mqRelBg_' + uid;
    var shine = 'mqRelSh_' + uid;
    var shadow = 'mqRelSd_' + uid;
    var glow = 'mqRelGl_' + uid;
    return '<svg class="dnd-relier-icon" width="' + size + '" height="' + size + '" viewBox="0 0 512 512" aria-hidden="true" focusable="false">'
      + '<defs>'
      + '<linearGradient id="' + bg + '" x1="70" y1="58" x2="448" y2="468" gradientUnits="userSpaceOnUse">'
      + '<stop offset="0" stop-color="#0EA5E9"/><stop offset="0.52" stop-color="#2563EB"/><stop offset="1" stop-color="#6D28D9"/>'
      + '</linearGradient>'
      + '<linearGradient id="' + shine + '" x1="95" y1="70" x2="345" y2="390" gradientUnits="userSpaceOnUse">'
      + '<stop stop-color="#FFFFFF" stop-opacity="0.20"/><stop offset="0.55" stop-color="#FFFFFF" stop-opacity="0"/>'
      + '</linearGradient>'
      + '<filter id="' + shadow + '" x="-20%" y="-20%" width="140%" height="150%" color-interpolation-filters="sRGB">'
      + '<feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#172554" flood-opacity="0.24"/>'
      + '</filter>'
      + '<filter id="' + glow + '" x="-120%" y="-120%" width="340%" height="340%" color-interpolation-filters="sRGB">'
      + '<feDropShadow dx="0" dy="0" stdDeviation="10" flood-color="#67E8F9" flood-opacity="0.85"/>'
      + '</filter>'
      + '</defs>'
      + '<g filter="url(#' + shadow + ')">'
      + '<rect x="40" y="40" width="432" height="432" rx="118" fill="url(#' + bg + ')"/>'
      + '<rect x="52" y="52" width="408" height="408" rx="106" fill="none" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="3"/>'
      + '<path d="M72 172C118 80 242 47 342 76C215 92 133 160 91 266C72 236 65 203 72 172Z" fill="url(#' + shine + ')"/>'
      + '</g>'
      + '<path d="M184 326C226 325 239 267 274 244C298 228 319 220 339 207" fill="none" stroke="#F8FAFC" stroke-width="22" stroke-linecap="round"/>'
      + '<g transform="rotate(-7 151 330)">'
      + '<rect x="96" y="275" width="110" height="110" rx="35" fill="#FFFFFF" fill-opacity="0.14" stroke="#F8FAFC" stroke-width="18"/>'
      + '<circle cx="151" cy="330" r="13" fill="#F8FAFC"/>'
      + '</g>'
      + '<g transform="rotate(7 362 184)">'
      + '<rect x="307" y="129" width="110" height="110" rx="35" fill="#FFFFFF" fill-opacity="0.14" stroke="#F8FAFC" stroke-width="18"/>'
      + '<circle cx="362" cy="184" r="13" fill="#F8FAFC"/>'
      + '</g>'
      + '<g filter="url(#' + glow + ')">'
      + '<circle cx="270" cy="248" r="24" fill="#67E8F9" stroke="#FFFFFF" stroke-width="8"/>'
      + '<path d="M260 248L267 255L281 240" fill="none" stroke="#075985" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>'
      + '</g>'
      + '</svg>';
  }

  function applyInstructionsBoxToElement(el, game) {
    if (!el || !game) return;
    var box = normalizeInstructionsBox(game.instructionsBox, game);
    game.instructionsBox = box;
    var gw = Math.max(1, parseInt(game.width, 10) || 800);
    var gh = Math.max(1, parseInt(game.height, 10) || 400);
    el.style.left = ((box.x / gw) * 100) + '%';
    el.style.top = ((box.y / gh) * 100) + '%';
    el.style.width = ((box.width / gw) * 100) + '%';
    el.style.height = ((box.height / gh) * 100) + '%';
    el.style.right = 'auto';
    el.style.fontFamily = box.font;
    el.style.fontSize = box.fontSize + 'px';
    el.style.fontWeight = box.bold ? 'bold' : '600';
    el.style.fontStyle = box.italic ? 'italic' : 'normal';
    el.style.textAlign = box.align || 'center';
    el.style.background = box.bgColor;
    el.style.color = box.color;
    el.style.borderColor = box.borderColor;
    el.style.borderStyle = 'solid';
    el.style.borderWidth = '2px';
    el.style.overflow = 'auto';
    el.style.boxSizing = 'border-box';
  }

  var STEP_ACTIVITIES = ['dnd', 'linking', 'both'];

  function normalizeStepActivity(raw, stepHint) {
    var a = raw != null ? String(raw).trim().toLowerCase() : '';
    if (STEP_ACTIVITIES.indexOf(a) >= 0) return a;
    // Inférence rétro-compat : selon les critères déjà saisis
    var hasLink = !!(stepHint && Array.isArray(stepHint.linkPairs) && stepHint.linkPairs.length);
    var hasDnd = !!(stepHint && (
      (Array.isArray(stepHint.zoneIds) && stepHint.zoneIds.length) ||
      String(stepHint.goodIds || '').trim()
    ));
    if (hasLink && hasDnd) return 'both';
    if (hasLink) return 'linking';
    return 'dnd';
  }

  function stepNeedsRelier(step) {
    var s = normalizeStep(step, 0);
    return s.activity === 'linking' || s.activity === 'both';
  }

  function normalizeZoneMapIds(raw) {
    if (Array.isArray(raw)) {
      return raw.map(function (x) { return String(x).trim(); }).filter(Boolean);
    }
    if (raw == null || raw === '') return [];
    return String(raw).split(/[,;\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function normalizeZoneMap(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.keys(raw).forEach(function (k) {
      var ids = normalizeZoneMapIds(raw[k]);
      if (ids.length) out[String(k)] = ids;
    });
    return out;
  }

  function normalizeStep(raw, index) {
    var s = raw && typeof raw === 'object' ? raw : {};
    var linkPairs = normalizeAllowedLinks(s.linkPairs || s.allowedLinks || s.links || []);
    var zoneIds = parseIdList(s.zoneIds != null ? s.zoneIds : (s.zones || ''));
    var goodIds = typeof s.goodIds === 'string'
      ? s.goodIds
      : (Array.isArray(s.goodIds) ? s.goodIds.join(',') : (s.goodIds != null ? String(s.goodIds) : ''));
    var draft = { zoneIds: zoneIds, goodIds: goodIds, linkPairs: linkPairs };
    var activity = normalizeStepActivity(s.activity != null ? s.activity : s.mode, draft);
    var zoneMap = normalizeZoneMap(s.zoneMap);
    var stepGameType = normalizeGameType(s.stepGameType || s.gameType || 'exact');
    return {
      id: s.id != null ? String(s.id) : String(index + 1),
      title: s.title != null ? String(s.title) : ('Étape ' + (index + 1)),
      instructions: s.instructions != null ? String(s.instructions) : '',
      activity: activity,
      stepGameType: activity === 'linking' ? 'linking' : stepGameType,
      requireNextButton: !!s.requireNextButton,
      zoneIds: zoneIds,
      goodIds: goodIds,
      linkPairs: linkPairs,
      zoneMap: zoneMap
    };
  }

  function normalizeSteps(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeStep);
  }

  function evaluateStep(game, step, placements) {
    placements = placements || {};
    step = normalizeStep(step, 0);
    var activity = step.activity || 'dnd';
    var zoneIds = (activity === 'linking') ? [] : (step.zoneIds || []);
    var goodIds = (activity === 'linking') ? [] : parseIdList(step.goodIds);
    var linkPairs = (activity === 'dnd') ? [] : (step.linkPairs || []);
    var hasCriteria = zoneIds.length > 0 || goodIds.length > 0 || linkPairs.length > 0;
    var okZones = true;
    var okGoods = true;
    var okLinks = true;

    if (zoneIds.length) {
      var zones = Array.isArray(game && game.dropzones) ? game.dropzones : [];
      okZones = zoneIds.every(function (zid) {
        var zone = null;
        for (var i = 0; i < zones.length; i++) {
          if (String(zones[i].id) === String(zid)) { zone = zones[i]; break; }
        }
        if (!zone) return false;
        var ev = evaluateZone(game, zone, placements[String(zid)] || []);
        return ev.isCorrect && !ev.hasWrong && !ev.isEmpty;
      });
    }

    if (goodIds.length) {
      var placed = {};
      Object.keys(placements).forEach(function (k) {
        if (k === 'links') return;
        (placements[k] || []).forEach(function (id) { placed[String(id)] = true; });
      });
      okGoods = goodIds.every(function (id) { return !!placed[String(id)]; });
    }

    if (linkPairs.length) {
      // Évaluer uniquement les paires de CETTE étape (pas l'union globale)
      var lev = evaluateLinks({ allowedLinks: linkPairs }, placements.links || []);
      okLinks = lev.isComplete;
    }

    var autoComplete = hasCriteria ? (okZones && okGoods && okLinks) : false;
    // Bouton forcé, ou aucune critère → passage manuel
    var needsManualNext = !!step.requireNextButton || !hasCriteria;

    return {
      stepId: step.id,
      title: step.title,
      instructions: step.instructions,
      activity: activity,
      hasCriteria: hasCriteria,
      needsManualNext: needsManualNext,
      isComplete: needsManualNext ? false : autoComplete,
      criteriaMet: autoComplete,
      okZones: okZones,
      okGoods: okGoods,
      okLinks: okLinks
    };
  }

  function getStepsState(game, placements) {
    var steps = normalizeSteps(game && game.steps);
    if (!steps.length) {
      return {
        enabled: false,
        steps: [],
        statuses: [],
        currentIndex: 0,
        allComplete: false,
        active: null,
        activeStatus: null
      };
    }
    var statuses = steps.map(function (s) { return evaluateStep(game, s, placements); });
    var allComplete = statuses.every(function (s) { return s.isComplete; });
    var currentIndex = 0;
    if (allComplete) {
      currentIndex = steps.length - 1;
    } else {
      currentIndex = statuses.findIndex(function (s) { return !s.isComplete; });
      if (currentIndex < 0) currentIndex = 0;
    }
    return {
      enabled: !!(game && game.enableSteps),
      steps: steps,
      statuses: statuses,
      currentIndex: currentIndex,
      allComplete: allComplete,
      active: steps[currentIndex] || null,
      activeStatus: statuses[currentIndex] || null
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

    if (type === 'selection' && !usesZoneAcceptedIds(game)) {
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
    if (isSelection(game) && !usesZoneAcceptedIds(game)) {
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
    return Array.prototype.slice.call(zoneEl.querySelectorAll('.dnd-placed[data-id]'))
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
   * Couche Relier (flèches) — bouton flèche + tirage au clic droit maintenu
   * (le clic gauche reste libre pour le pan de la page).
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
    /** Centres temporaires pendant un drag HTML5 (id → {x,y} en coords layout). */
    var dragCenterOverrides = Object.create(null);
    var DEFAULT_LINK_TIP = 'Clic droit maintenu sur une image, puis tirez la flèche jusqu’à l’arrivée.';
    var BTN_TIP = 'Mode Relier — clic droit maintenu pour tracer une flèche entre deux images';

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
      var sid = cssEscape(id);
      // 1) Carte déjà déposée (position jouée) — prioritaire sur le bac
      var placed = gameContainer.querySelector('.dropzone .dnd-placed[data-id="' + sid + '"]');
      if (placed) return placed;
      // 2) Zone SVG Relier / nœud dédié
      var linkNode = gameContainer.querySelector('[data-link-node][data-id="' + sid + '"]');
      if (linkNode) return linkNode;
      // 3) Image source dans le bac
      return gameContainer.querySelector('.draggable[data-id="' + sid + '"]');
    }
    function allNodes() {
      return Array.prototype.slice.call(
        gameContainer.querySelectorAll('.draggable[data-id], .dnd-placed[data-id], [data-link-node][data-id], .dropzone[data-zone-id]')
      );
    }
    function clientToLocal(clientX, clientY) {
      // Écran → coords layout du jeu (indépendant du zoom/pan CSS sur le stage)
      var cr = gameContainer.getBoundingClientRect();
      var w = gameContainer.clientWidth || 1;
      var h = gameContainer.clientHeight || 1;
      var rw = cr.width || 1;
      var rh = cr.height || 1;
      return {
        x: ((clientX - cr.left) / rw) * w,
        y: ((clientY - cr.top) / rh) * h
      };
    }
    function localPoint(clientX, clientY) {
      return clientToLocal(clientX, clientY);
    }
    /** Centre d’un nœud en coords layout (même repère que left/top des images). */
    function nodeCenter(el) {
      if (!el) return { x: 0, y: 0 };
      var nid = el.getAttribute && el.getAttribute('data-id');
      if (nid && dragCenterOverrides[nid]) {
        return { x: dragCenterOverrides[nid].x, y: dragCenterOverrides[nid].y };
      }
      // Zones SVG Relier (<g> / <polygon>)
      try {
        var geo = el;
        if (el.tagName === 'g') {
          geo = el.querySelector('polygon, path, polyline') || el;
        }
        if (geo && typeof geo.getBBox === 'function' && (geo.ownerSVGElement || geo.tagName === 'svg')) {
          var bb = geo.getBBox();
          if (bb && isFinite(bb.x) && (bb.width > 0 || bb.height > 0 || (bb.x !== 0 || bb.y !== 0))) {
            return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
          }
        }
      } catch (errBb) { /* ignore */ }
      var left = parseFloat(el.style.left);
      var top = parseFloat(el.style.top);
      var w = el.offsetWidth || parseFloat(el.style.width) || 0;
      var h = el.offsetHeight || parseFloat(el.style.height) || 0;
      if (!isNaN(left) && !isNaN(top) && (w > 0 || h > 0)) {
        return { x: left + w / 2, y: top + h / 2 };
      }
      // Remonter offsetLeft/Top jusqu’au conteneur de jeu
      var x = 0;
      var y = 0;
      var cur = el;
      while (cur && cur !== gameContainer) {
        x += cur.offsetLeft || 0;
        y += cur.offsetTop || 0;
        var op = cur.offsetParent;
        if (!op || (op !== gameContainer && !gameContainer.contains(op))) {
          break;
        }
        cur = op;
      }
      if (cur === gameContainer || gameContainer.contains(cur)) {
        return { x: x + w / 2, y: y + h / 2 };
      }
      // Dernier recours : projection écran
      var er = el.getBoundingClientRect();
      return clientToLocal(er.left + er.width / 2, er.top + er.height / 2);
    }
    function nodeFromPoint(clientX, clientY) {
      return pickBestLinkAt(clientX, clientY);
    }
    function linkNodeArea(el) {
      if (!el) return Infinity;
      try {
        var geo = el;
        if (el.tagName === 'g') geo = el.querySelector('polygon, path, polyline') || el;
        if (geo && typeof geo.getBBox === 'function' && (geo.ownerSVGElement || geo.tagName === 'svg')) {
          var bb = geo.getBBox();
          if (bb && isFinite(bb.width) && isFinite(bb.height)) {
            return Math.max(1, bb.width) * Math.max(1, bb.height);
          }
        }
      } catch (errA) { /* ignore */ }
      try {
        var r = el.getBoundingClientRect();
        return Math.max(1, r.width) * Math.max(1, r.height);
      } catch (errB) {
        return Infinity;
      }
    }
    /**
     * Zones SVG superposées : privilégie la plus petite (plus précise).
     * Cartes déposées / draggables restent prioritaires sur les zones.
     */
    function pickBestLinkAt(clientX, clientY) {
      var stack = [];
      try {
        if (typeof document.elementsFromPoint === 'function') {
          stack = document.elementsFromPoint(clientX, clientY) || [];
        }
      } catch (errStack) { stack = []; }
      if (!stack.length) {
        var one = document.elementFromPoint(clientX, clientY);
        if (one) stack = [one];
      }
      var placed = null;
      var drag = null;
      var bestZone = null;
      var bestArea = Infinity;
      var seen = {};
      for (var i = 0; i < stack.length; i++) {
        var node = stack[i];
        if (!node || !node.closest || !gameContainer.contains(node)) continue;
        var p = node.closest('.dnd-placed[data-id]');
        if (p && gameContainer.contains(p) && !seen['p:' + p.getAttribute('data-id')]) {
          seen['p:' + p.getAttribute('data-id')] = 1;
          if (!placed) placed = p;
        }
        var d = node.closest('.draggable[data-id]');
        if (d && gameContainer.contains(d) && !d.classList.contains('used') && !seen['d:' + d.getAttribute('data-id')]) {
          seen['d:' + d.getAttribute('data-id')] = 1;
          if (!drag) drag = d;
        }
        var lz = node.closest('[data-link-node][data-id]');
        if (lz && gameContainer.contains(lz)) {
          var lid = String(lz.getAttribute('data-id') || '');
          if (lid && !seen['z:' + lid]) {
            seen['z:' + lid] = 1;
            var area = linkNodeArea(lz);
            if (area < bestArea) {
              bestArea = area;
              bestZone = lz;
            }
          }
        }
        var dz = node.closest('.dropzone');
        if (dz && gameContainer.contains(dz) && !placed) {
          var inner = dz.querySelector('.dnd-placed[data-id]');
          if (inner) placed = inner;
        }
      }
      if (placed) return placed;
      if (drag) return drag;
      if (bestZone) return bestZone;
      // Fallback : dropzone vide (id de zone)
      for (var j = 0; j < stack.length; j++) {
        var n2 = stack[j];
        if (!n2 || !n2.closest) continue;
        var zone = n2.closest('.dropzone');
        if (zone && gameContainer.contains(zone)) {
          var zid = zone.getAttribute('data-zone-id') || zone.getAttribute('data-id');
          if (zid) {
            if (!zone.getAttribute('data-id')) zone.setAttribute('data-id', zid);
            return zone;
          }
        }
      }
      return null;
    }
    /** Image source, carte déposée, zone SVG, ou dropzone (via la carte posée). */
    function resolveLinkEl(el) {
      if (!el || !el.closest) return null;
      var placed = el.closest('.dnd-placed[data-id]');
      if (placed && gameContainer.contains(placed)) return placed;
      var drag = el.closest('.draggable[data-id]');
      if (drag && gameContainer.contains(drag) && !drag.classList.contains('used')) return drag;
      var linkNode = el.closest('[data-link-node][data-id]');
      if (linkNode && gameContainer.contains(linkNode)) return linkNode;
      var zone = el.closest('.dropzone');
      if (zone && gameContainer.contains(zone)) {
        var inner = zone.querySelector('.dnd-placed[data-id]');
        if (inner) return inner;
        var zid = zone.getAttribute('data-zone-id') || zone.getAttribute('data-id');
        if (zid) {
          if (!zone.getAttribute('data-id')) zone.setAttribute('data-id', zid);
          return zone;
        }
      }
      return null;
    }

    function setDragCenter(id, clientX, clientY) {
      if (!id) return;
      // clientX/Y à 0,0 = quirk dragend dans certains navigateurs
      if (!clientX && !clientY) return;
      dragCenterOverrides[String(id)] = clientToLocal(clientX, clientY);
      drawLinks(evaluateLinks(game, links));
    }
    function setDragCenterLocal(id, x, y) {
      if (!id || !isFinite(x) || !isFinite(y)) return;
      dragCenterOverrides[String(id)] = { x: x, y: y };
      drawLinks(evaluateLinks(game, links));
    }
    function clearDragCenter(id) {
      if (id) delete dragCenterOverrides[String(id)];
      else dragCenterOverrides = Object.create(null);
      drawLinks(evaluateLinks(game, links));
    }

    /** Suivi HTML5 drag : dragover document (fiable sous Firefox, contrairement à drag). */
    var htmlDragId = null;
    var htmlDragLast = null;
    var htmlDragDropped = false;
    function beginCardDrag(id) {
      htmlDragId = id != null ? String(id) : null;
      htmlDragLast = null;
      htmlDragDropped = false;
    }
    function markCardDropped() {
      htmlDragDropped = true;
    }
    function applyFreeMoveToEl(el, center) {
      if (!el || !center) return;
      var w = el.offsetWidth || parseFloat(el.style.width) || 0;
      var h = el.offsetHeight || parseFloat(el.style.height) || 0;
      var nx = Math.round(center.x - w / 2);
      var ny = Math.round(center.y - h / 2);
      el.style.position = 'absolute';
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
      var cid = el.getAttribute('data-id');
      if (cid && Array.isArray(game.draggables)) {
        for (var i = 0; i < game.draggables.length; i++) {
          if (String(game.draggables[i].id) === String(cid)) {
            game.draggables[i].x = nx;
            game.draggables[i].y = ny;
            break;
          }
        }
      }
    }
    function endCardDrag(id, el) {
      // Reposition libre si le drop n’est pas allé dans une zone
      if (htmlDragId && htmlDragLast && !htmlDragDropped && el && el.classList.contains('draggable')) {
        applyFreeMoveToEl(el, htmlDragLast);
      }
      htmlDragId = null;
      htmlDragLast = null;
      htmlDragDropped = false;
      clearDragCenter(id);
    }
    function onDocDragOver(e) {
      if (!htmlDragId) return;
      if (!e.clientX && !e.clientY) return;
      try { e.preventDefault(); } catch (err) { /* ignore */ }
      htmlDragLast = clientToLocal(e.clientX, e.clientY);
      setDragCenterLocal(htmlDragId, htmlDragLast.x, htmlDragLast.y);
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('dragover', onDocDragOver, true);
    }
    gameContainer.addEventListener('dragover', function (e) {
      if (!htmlDragId) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });
    gameContainer.addEventListener('drop', function (e) {
      if (!htmlDragId) return;
      // Les dropzones gèrent leur propre drop ; ici = dépôt libre sur le plateau
      if (e.target && e.target.closest && e.target.closest('.dropzone')) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.clientX || e.clientY) {
        htmlDragLast = clientToLocal(e.clientX, e.clientY);
      }
    });

    function tipText() {
      return game.linkTooltip || DEFAULT_LINK_TIP;
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

    // Logo Relier (assets/logo-relier-zones.svg)
    var relierSize = (normalizeRelierBtn(game.relierBtn, game).size);
    var relierLogoHtml = relierLogoSvg(gameId, relierSize);

    var btn = gameContainer.querySelector('.dnd-relier-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dnd-relier-btn';
      btn.style.cssText = 'position:absolute;z-index:12;pointer-events:auto;padding:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;border:none;border-radius:23%;background:transparent;overflow:hidden;box-shadow:none;';
      gameContainer.appendChild(btn);
    }
    btn.innerHTML = relierLogoHtml;
    btn.title = BTN_TIP;
    btn.setAttribute('aria-label', BTN_TIP);
    btn.setAttribute('aria-pressed', 'false');
    applyRelierBtnLayout(btn, game);

    function setLinkMode(on) {
      linkModeActive = !!on;
      gameContainer.classList.toggle('dnd-link-mode', linkModeActive);
      btn.classList.toggle('active', linkModeActive);
      btn.setAttribute('aria-pressed', linkModeActive ? 'true' : 'false');
      btn.title = linkModeActive
        ? 'Mode Relier actif — clic droit maintenu pour tracer une flèche'
        : BTN_TIP;
      btn.setAttribute('aria-label', btn.title);
      allNodes().forEach(function (el) {
        if (linkModeActive) {
          el.classList.add('dnd-link-node');
          el.dataset._prevDraggable = el.draggable ? '1' : '0';
          el.draggable = false;
          el.style.cursor = 'crosshair';
        } else {
          el.classList.remove('dnd-link-node', 'dnd-link-from', 'dnd-selected');
          // Autoriser le déplacement des images (flèches suivent) hors mode Relier
          if (el.classList.contains('draggable')) {
            el.draggable = true;
            el.style.cursor = 'grab';
          } else if (hybrid) {
            el.draggable = el.dataset._prevDraggable === '1';
            el.style.cursor = '';
          } else {
            el.draggable = false;
            el.style.cursor = 'pointer';
          }
        }
      });
      if (linkModeActive) {
        showTip(tipText(), (gameContainer.clientWidth || 200) / 2, 40);
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
    gameContainer.addEventListener('contextmenu', function (e) {
      if (!linkModeActive) return;
      e.preventDefault();
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
    // Pas de viewBox : coords SVG = pixels layout (même repère que left/top des images)
    svg.removeAttribute('viewBox');
    svg.removeAttribute('preserveAspectRatio');

    function isAllowedPair(from, to) {
      var allowed = effectiveAllowedLinks(game);
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
            if (e.button != null && e.button !== 0) return;
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
      if (dragState && dragState.hoverEl && dragState.hoverEl !== (dragState && dragState.fromEl)) {
        try { dragState.hoverEl.classList.remove('dnd-link-hover'); } catch (err) {}
      }
      if (dragState && dragState.line && dragState.line.parentNode) {
        dragState.line.parentNode.removeChild(dragState.line);
      }
      if (dragState && dragState.fromEl) {
        dragState.fromEl.classList.remove('dnd-link-from', 'dnd-selected');
      }
      dragState = null;
      if (linkModeActive) {
        showTip(tipText(), (gameContainer.clientWidth || 200) / 2, 40);
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
      dragState = { fromId: id, fromEl: fromEl, line: line, hoverEl: null };
      showTip('Maintenez le clic droit et tirez jusqu’à l’image d’arrivée.', pt.x, pt.y);
    }

    function moveDrag(clientX, clientY) {
      if (!dragState || !dragState.line) return;
      var pt = localPoint(clientX, clientY);
      // Survol visuel uniquement — pas d'accrochage magnétique au centre de la zone
      var target = pickBestLinkAt(clientX, clientY);
      if (target && target !== dragState.fromEl) {
        if (dragState.hoverEl && dragState.hoverEl !== target && dragState.hoverEl !== dragState.fromEl) {
          dragState.hoverEl.classList.remove('dnd-link-hover');
        }
        dragState.hoverEl = target;
        target.classList.add('dnd-link-hover');
      } else {
        if (dragState.hoverEl && dragState.hoverEl !== dragState.fromEl) {
          dragState.hoverEl.classList.remove('dnd-link-hover');
        }
        dragState.hoverEl = null;
      }
      var c0 = nodeCenter(dragState.fromEl);
      dragState.line.setAttribute('x1', String(c0.x));
      dragState.line.setAttribute('y1', String(c0.y));
      dragState.line.setAttribute('x2', String(pt.x));
      dragState.line.setAttribute('y2', String(pt.y));
      showTip('Maintenez le clic droit et tirez jusqu’à l’image d’arrivée.', pt.x, pt.y);
    }

    function endDrag(clientX, clientY) {
      if (!dragState) return;
      var fromId = dragState.fromId;
      var fromEl = dragState.fromEl;
      // Préférer la cible accrochée pendant le drag (évite un trait final différent)
      var target = dragState.hoverEl || nodeFromPoint(clientX, clientY);
      if (target === fromEl) target = null;
      var toId = target ? target.getAttribute('data-id') : null;
      if (toId && String(toId) !== String(fromId)) {
        var ca = nodeCenter(fromEl);
        var cb = nodeCenter(target);
        if (dragState.line) {
          dragState.line.setAttribute('x1', String(ca.x));
          dragState.line.setAttribute('y1', String(ca.y));
          dragState.line.setAttribute('x2', String(cb.x));
          dragState.line.setAttribute('y2', String(cb.y));
        }
        cancelDrag();
        addLink(fromId, toId);
      } else {
        cancelDrag();
      }
      if (linkModeActive) {
        showTip(tipText(), (gameContainer.clientWidth || 200) / 2, 40);
      }
    }

    function onPointerDown(e) {
      if (!linkModeActive) return;
      // Clic droit uniquement — le clic gauche reste pour le pan
      if (e.button != null && e.button !== 2) return;
      if (e.target && e.target.closest && e.target.closest('.dnd-relier-btn, .dnd-verify-btn, .dnd-next-step-btn')) return;
      // elementsFromPoint : si 2 zones SVG se chevauchent, prend la plus petite
      var el = pickBestLinkAt(e.clientX, e.clientY) || resolveLinkEl(e.target);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      try { gameContainer.setPointerCapture(e.pointerId); } catch (err) {}
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
      try { gameContainer.releasePointerCapture(e.pointerId); } catch (err) {}
      endDrag(e.clientX, e.clientY);
    }

    gameContainer.addEventListener('pointerdown', onPointerDown, true);
    gameContainer.addEventListener('pointermove', onPointerMove);
    gameContainer.addEventListener('pointerup', onPointerUp);
    gameContainer.addEventListener('pointercancel', function () { cancelDrag(); });

    allNodes().forEach(function (el) {
      if (!hybrid) {
        el.draggable = false;
        el.classList.add('dnd-link-node');
        el.style.pointerEvents = 'auto';
        el.style.cursor = 'pointer';
      }
    });
    Array.prototype.forEach.call(gameContainer.querySelectorAll('.dropzone'), function (z) {
      z.classList.add('dnd-link-capable');
      z.style.pointerEvents = 'auto';
    });

    // Déplacement libre des images hors mode Relier → la flèche suit (x1/y1)
    Array.prototype.forEach.call(gameContainer.querySelectorAll('.draggable[data-id]'), function (img) {
      var id = img.getAttribute('data-id');
      if (!id || img.dataset.mqLinkFreeMove) return;
      img.dataset.mqLinkFreeMove = '1';
      img.addEventListener('dragstart', function (e) {
        if (linkModeActive) {
          e.preventDefault();
          return;
        }
        // En hybrid, le gestionnaire DnD principal gère aussi ; on démarre le suivi flèche
        beginCardDrag(id);
        try {
          e.dataTransfer.setData('text/plain', id);
          e.dataTransfer.effectAllowed = 'move';
        } catch (err) { /* ignore */ }
        img.style.opacity = '0.55';
      });
      img.addEventListener('drag', function (e) {
        if (linkModeActive) return;
        if (!e.clientX && !e.clientY) return;
        setDragCenter(id, e.clientX, e.clientY);
        htmlDragLast = clientToLocal(e.clientX, e.clientY);
      });
      img.addEventListener('dragend', function () {
        img.style.opacity = img.classList.contains('used') ? '0.3' : '1';
        endCardDrag(id, img);
      });
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
      resizeTimer = setTimeout(function () {
        drawLinks(evaluateLinks(game, links));
      }, 80);
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
      setLinkMode: setLinkMode,
      setDragCenter: setDragCenter,
      clearDragCenter: clearDragCenter,
      beginCardDrag: beginCardDrag,
      markCardDropped: markCardDropped,
      endCardDrag: endCardDrag
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
      instructionsText = 'Cliquez sur le bouton flèche, puis maintenez le clic droit sur une image et tirez jusqu’à l’arrivée.';
    }
    var showInstructions = game.showInstructions !== false && !!instructionsText;
    if (showInstructions && !instructionsEl) {
      instructionsEl = document.createElement('div');
      instructionsEl.className = 'dnd-instructions';
      instructionsEl.setAttribute('role', 'status');
      gameContainer.appendChild(instructionsEl);
    }
    if (instructionsEl) {
      applyInstructionsBoxToElement(instructionsEl, game);
      if (showInstructions) {
        instructionsEl.textContent = instructionsText;
        instructionsEl.hidden = false;
        instructionsEl.style.display = '';
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
      if (!(gamePeek.enableSteps && gamePeek.steps && gamePeek.steps.length)) {
        return initPlayableLinkingGame(gameContainer, gameConfig, hooks);
      }
      gamePeek.enableLinking = true;
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
    var stepsEnabled = !!(game.enableSteps && game.steps && game.steps.length);
    var lastStepIndex = -1;
    var manualStepDone = {};
    var showInstructions = game.showInstructions !== false;

    function ensureInstructionsEl() {
      if (!instructionsEl) {
        instructionsEl = document.createElement('div');
        instructionsEl.className = 'dnd-instructions';
        instructionsEl.setAttribute('role', 'status');
        instructionsEl.setAttribute('aria-live', 'polite');
        gameContainer.appendChild(instructionsEl);
      }
      applyInstructionsBoxToElement(instructionsEl, game);
      return instructionsEl;
    }

    function pulseInstructions() {
      var el = instructionsEl;
      if (!el) return;
      el.classList.remove('dnd-instructions-pulse');
      void el.offsetWidth;
      el.classList.add('dnd-instructions-pulse');
    }

    function setInstructionsContent(text, meta) {
      if (!showInstructions) return;
      text = String(text || '').trim();
      if (!text) {
        if (instructionsEl) {
          instructionsEl.hidden = true;
          instructionsEl.style.display = 'none';
        }
        return;
      }
      var el = ensureInstructionsEl();
      var prefix = '';
      if (meta && meta.stepLabel) {
        prefix = meta.stepLabel + '\n';
      }
      el.textContent = prefix + text;
      el.hidden = false;
      el.style.display = '';
      el.classList.remove('dnd-instructions-done');
      if (meta && meta.pulse) pulseInstructions();
    }

    function highlightStepZones(step) {
      var ids = (step && step.zoneIds) ? step.zoneIds.map(String) : [];
      Array.prototype.forEach.call(gameContainer.querySelectorAll('.dropzone'), function (z) {
        var zid = String(z.getAttribute('data-zone-id') || '');
        var on = stepsEnabled && ids.length && ids.indexOf(zid) >= 0;
        z.classList.toggle('dnd-step-target', on);
      });
    }

    function updateInstructionsVisibility(isComplete) {
      if (!showInstructions) return;
      if (isComplete) {
        if (instructionsEl) {
          instructionsEl.classList.add('dnd-instructions-done');
          instructionsEl.hidden = true;
          instructionsEl.style.display = 'none';
        }
        Array.prototype.forEach.call(gameContainer.querySelectorAll('.dnd-step-target'), function (z) {
          z.classList.remove('dnd-step-target');
        });
        return;
      }
      if (!stepsEnabled) {
        var base = String(game.instructions || '').trim();
        setInstructionsContent(base, { pulse: false });
      }
    }

    // Init consignes
    if (stepsEnabled) {
      var st0 = getStepsState(game, {});
      lastStepIndex = st0.currentIndex;
      var a0 = st0.active;
      setInstructionsContent(a0 ? a0.instructions : '', {
        pulse: true,
        stepLabel: a0 ? ((a0.title || ('Étape ' + (st0.currentIndex + 1))) + ' (' + (st0.currentIndex + 1) + '/' + st0.steps.length + ')') : ''
      });
      highlightStepZones(a0);
    } else {
      updateInstructionsVisibility(false);
    }

    // Bouton « Étape suivante » (étapes sans critère)
    var stepNextBtn = gameContainer.querySelector('.dnd-step-next-btn');
    function syncStepNextBtn(st) {
      var need = !!(st && st.enabled && st.activeStatus && st.activeStatus.needsManualNext && !st.allComplete);
      if (need) {
        if (!stepNextBtn) {
          stepNextBtn = document.createElement('button');
          stepNextBtn.type = 'button';
          stepNextBtn.className = 'dnd-step-next-btn';
          stepNextBtn.textContent = 'Étape suivante';
          stepNextBtn.style.cssText = 'position:absolute;right:2%;bottom:10%;z-index:12;pointer-events:auto;padding:10px 16px;font-size:16px;font-weight:bold;cursor:pointer;border:none;border-radius:10px;background:#2e7d32;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.25);';
          gameContainer.appendChild(stepNextBtn);
          stepNextBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (stepNextBtn.disabled) return;
            var stNow = getStepsState(game, collectPlacements(gameContainer, game));
            if (linkingApi) {
              var p = collectPlacements(gameContainer, game);
              p.links = linkingApi.getLinks();
              stNow = getStepsState(game, p);
            }
            // Re-appliquer le flag manuel déjà posé
            stNow.statuses.forEach(function (s, i) {
              var sid0 = String((stNow.steps[i] && stNow.steps[i].id) || i);
              if (manualStepDone[sid0]) {
                s.isComplete = true;
                s.needsManualNext = false;
              }
            });
            if (stNow.activeStatus && stNow.activeStatus.hasCriteria && !stNow.activeStatus.criteriaMet) {
              return;
            }
            if (stNow.active) manualStepDone[String(stNow.active.id)] = true;
            refreshUI();
          });
        }
        var canClick = !(st.activeStatus && st.activeStatus.hasCriteria && !st.activeStatus.criteriaMet);
        stepNextBtn.disabled = !canClick;
        stepNextBtn.style.opacity = canClick ? '1' : '0.45';
        stepNextBtn.style.cursor = canClick ? 'pointer' : 'not-allowed';
        stepNextBtn.title = canClick
          ? 'Passer à l’étape suivante'
          : 'Terminez d’abord les critères de cette étape';
        stepNextBtn.style.display = '';
      } else if (stepNextBtn) {
        stepNextBtn.style.display = 'none';
      }
    }

    /** Affiche Relier seulement si l’étape active est linking/both (masqué sinon). */
    function syncRelierForStep(st) {
      var btn = gameContainer.querySelector('.dnd-relier-btn');
      if (!btn && !linkingApi) return;
      var show = false;
      if (linkingApi) {
        if (!stepsEnabled) {
          show = !!game.enableLinking;
        } else if (st && st.enabled && !st.allComplete && st.active) {
          show = stepNeedsRelier(st.active);
        } else {
          show = false;
        }
      }
      if (btn) {
        btn.style.display = show ? '' : 'none';
        btn.hidden = !show;
        btn.setAttribute('aria-hidden', show ? 'false' : 'true');
      }
      if (!show && linkingApi && linkingApi.setLinkMode) {
        try { linkingApi.setLinkMode(false); } catch (e) {}
      }
      gameContainer.classList.toggle('dnd-step-relier-on', !!show);
    }

    /** Pendant une étape Relier pure : zones de dépôt non interactives. */
    function syncZonesForStep(st) {
      var linkingOnly = false;
      if (stepsEnabled && st && st.active && !st.allComplete) {
        linkingOnly = normalizeStep(st.active, 0).activity === 'linking';
      }
      Array.prototype.forEach.call(gameContainer.querySelectorAll('.dropzone'), function (z) {
        z.classList.toggle('dnd-step-locked', linkingOnly);
        z.style.pointerEvents = linkingOnly ? 'none' : 'auto';
        if (linkingOnly) z.style.opacity = '0.5';
        else if (z.style.opacity === '0.5') z.style.opacity = '';
      });
      Array.prototype.forEach.call(gameContainer.querySelectorAll('.draggable'), function (el) {
        var id = String(el.getAttribute('data-id') || '');
        if (linkingOnly) {
          el.draggable = false;
          el.classList.add('dnd-step-link-phase');
        } else {
          el.classList.remove('dnd-step-link-phase');
          if (!(cardUse !== 'reusable' && used.has(id))) {
            if (!el.classList.contains('used')) el.draggable = true;
          }
        }
      });
      // Les polygones SVG Relier (z-index 5) ne doivent pas intercepter le drop DnD hors mode Relier
      var linkLayer = gameContainer.querySelector('.dnd-link-zones-layer');
      if (linkLayer) {
        var blockLinkHit = !isLinkModeOn();
        linkLayer.style.pointerEvents = blockLinkHit ? 'none' : '';
        Array.prototype.forEach.call(linkLayer.querySelectorAll('.dnd-link-zone'), function (gEl) {
          gEl.style.pointerEvents = blockLinkHit ? 'none' : 'auto';
        });
      }
    }

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
      var zones = game.dropzones || [];
      var found = zones.find(function (z) { return String(z.id) === String(zid); });
      if (found) return found;
      var zoneEl = zoneById(zid);
      if (zoneEl) {
        var all = gameContainer.querySelectorAll('.dropzone');
        var idx = Array.prototype.indexOf.call(all, zoneEl);
        if (idx >= 0 && zones[idx]) return zones[idx];
      }
      return null;
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
          if (linkingApi && linkingApi.beginCardDrag) linkingApi.beginCardDrag(id);
        });
        clone.addEventListener('drag', function (e) {
          if (!linkingApi || !linkingApi.setDragCenter) return;
          if (!e.clientX && !e.clientY) return;
          linkingApi.setDragCenter(id, e.clientX, e.clientY);
        });
        clone.addEventListener('dragend', function () {
          clone.style.opacity = '1';
          if (linkingApi && linkingApi.endCardDrag) linkingApi.endCardDrag(id, clone);
          else if (linkingApi && linkingApi.clearDragCenter) linkingApi.clearDragCenter(id);
        });
      }
    }

    function placeInZone(zone, id, opts) {
      opts = opts || {};
      var zid = zone.getAttribute('data-zone-id');
      var zcfg = findZoneConfig(zid);
      if (!zcfg) return false;
      if (isSingleUse(cardUse) && used.has(id) && !opts.allowMove) return false;

      // Étapes : pendant Relier pur, pas de dépôt (les IDs d’étape ne restreignent pas les zones)
      if (stepsEnabled) {
        var stPlace = getStepsState(game, collectPlacements(gameContainer, game));
        stPlace.statuses.forEach(function (s, i) {
          var sid = String((stPlace.steps[i] && stPlace.steps[i].id) || i);
          if (manualStepDone[sid]) { s.isComplete = true; s.needsManualNext = false; }
        });
        stPlace.allComplete = stPlace.statuses.every(function (s) { return s.isComplete; });
        if (!stPlace.allComplete) {
          stPlace.currentIndex = stPlace.statuses.findIndex(function (s) { return !s.isComplete; });
          if (stPlace.currentIndex < 0) stPlace.currentIndex = 0;
          stPlace.active = stPlace.steps[stPlace.currentIndex] || null;
        }
        var act = stPlace.active ? normalizeStep(stPlace.active, 0) : null;
        if (act && act.activity === 'linking') return false;
      }

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
      clone.classList.add('dnd-link-node');
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
      if (linkingApi && linkingApi.markCardDropped) linkingApi.markCardDropped();

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

      var stepsComplete = true;
      if (stepsEnabled) {
        var st = getStepsState(game, placements);
        st.statuses.forEach(function (s, i) {
          var sid = String((st.steps[i] && st.steps[i].id) || i);
          if (manualStepDone[sid]) {
            s.isComplete = true;
            s.needsManualNext = false;
          }
        });
        st.allComplete = st.statuses.every(function (s) { return s.isComplete; });
        if (st.allComplete) {
          st.currentIndex = st.steps.length - 1;
        } else {
          st.currentIndex = st.statuses.findIndex(function (s) { return !s.isComplete; });
          if (st.currentIndex < 0) st.currentIndex = 0;
        }
        st.active = st.steps[st.currentIndex] || null;
        st.activeStatus = st.statuses[st.currentIndex] || null;
        stepsComplete = st.allComplete;

        if (st.currentIndex !== lastStepIndex) {
          lastStepIndex = st.currentIndex;
          var act = st.active;
          setInstructionsContent(act ? act.instructions : '', {
            pulse: true,
            stepLabel: act
              ? ((act.title || ('Étape ' + (st.currentIndex + 1))) + ' (' + (st.currentIndex + 1) + '/' + st.steps.length + ')')
              : ''
          });
          highlightStepZones(act);
          if (typeof hooks.playSound === 'function' && st.currentIndex > 0) {
            try { hooks.playSound('ok'); } catch (e) {}
          }
        } else if (st.active) {
          highlightStepZones(st.active);
        }
        syncStepNextBtn(st);
        syncRelierForStep(st);
        syncZonesForStep(st);
        ev.stepsState = st;
        ev.isComplete = st.allComplete;
      } else {
        stepsComplete = !!ev.isComplete;
        syncRelierForStep(null);
        syncZonesForStep(null);
      }

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

      if (ev.isComplete && stepsComplete) {
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
        if (!stepsEnabled) updateInstructionsVisibility(false);
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
        if (linkingApi && linkingApi.beginCardDrag) linkingApi.beginCardDrag(id);
      });
      img.addEventListener('drag', function (e) {
        if (!linkingApi || !linkingApi.setDragCenter) return;
        if (!e.clientX && !e.clientY) return;
        linkingApi.setDragCenter(id, e.clientX, e.clientY);
      });
      img.addEventListener('dragend', function () {
        img.style.opacity = img.classList.contains('used') ? '0.3' : '1';
        if (linkingApi && linkingApi.endCardDrag) linkingApi.endCardDrag(id, img);
        else if (linkingApi && linkingApi.clearDragCenter) linkingApi.clearDragCenter(id);
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

    function dropzoneFromPoint(clientX, clientY) {
      if (!isFinite(clientX) || !isFinite(clientY)) return null;
      var stack = (typeof document.elementsFromPoint === 'function')
        ? (document.elementsFromPoint(clientX, clientY) || [])
        : [];
      if (!stack.length) {
        var top = document.elementFromPoint(clientX, clientY);
        if (top) stack = [top];
      }
      for (var i = 0; i < stack.length; i++) {
        var n = stack[i];
        var z = n && n.closest ? n.closest('.dropzone') : null;
        if (z && gameContainer.contains(z) && !z.classList.contains('dnd-step-locked')) return z;
      }
      // Repli géométrique : SVG Relier / pointer-events parent peuvent masquer la dropzone
      var hit = null;
      var hitArea = Infinity;
      Array.prototype.forEach.call(gameContainer.querySelectorAll('.dropzone'), function (z) {
        if (z.classList.contains('dnd-step-locked')) return;
        var r = z.getBoundingClientRect();
        if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return;
        var area = Math.max(1, r.width * r.height);
        if (area < hitArea) {
          hitArea = area;
          hit = z;
        }
      });
      return hit;
    }

    // Dropzones
    Array.prototype.forEach.call(gameContainer.querySelectorAll('.dropzone'), function (zone) {
      if (!zone.getAttribute('tabindex')) zone.setAttribute('tabindex', '0');
      var zid = zone.getAttribute('data-zone-id');
      var zcfg = findZoneConfig(zid);
      var label = zid ? ('ID ' + zid) : 'Zone';
      zone.setAttribute('aria-label', 'Zone de dépôt ' + label);
      if (!zone.querySelector('.dnd-dropzone-id-badge')) {
        var badge = document.createElement('span');
        badge.className = 'dnd-dropzone-id-badge';
        badge.textContent = label;
        zone.insertBefore(badge, zone.firstChild);
      }
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

    // Dépôt même si une zone SVG Relier (z-index plus haut) est au-dessus de la dropzone
    gameContainer.addEventListener('dragover', function (e) {
      if (isLinkModeOn()) return;
      if (!dropzoneFromPoint(e.clientX, e.clientY)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    }, true);
    gameContainer.addEventListener('drop', function (e) {
      if (isLinkModeOn()) return;
      var zone = dropzoneFromPoint(e.clientX, e.clientY);
      if (!zone) return;
      var id = '';
      try { id = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || ''; } catch (err) { id = ''; }
      if (!id && selectedId) id = selectedId;
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      placeInZone(zone, id, { allowMove: true });
    }, true);

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
    var anyStepNeedsRelier = stepsEnabled && (game.steps || []).some(function (s) {
      return stepNeedsRelier(s) || (normalizeStep(s, 0).linkPairs || []).length > 0;
    });
    if (game.enableLinking || anyStepNeedsRelier) {
      if (!game.enableLinking && anyStepNeedsRelier) game.enableLinking = true;
      linkingApi = attachLinkingFeature(gameContainer, game, hooks, {
        hybrid: true,
        gameId: gameId,
        onChange: function () { refreshUI(); },
        getVerifiedOnce: function () { return verifiedOnce; },
        addErrors: function (n) { nbErreurs += (n || 1); }
      });
      // Masquer Relier tant que l’étape active ne le demande pas
      var btn0 = gameContainer.querySelector('.dnd-relier-btn');
      if (btn0 && stepsEnabled) {
        btn0.style.display = 'none';
        btn0.hidden = true;
      }
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
    effectiveAllowedLinks: effectiveAllowedLinks,
    isSingleUse: isSingleUse,
    normalizeDropzone: normalizeDropzone,
    applyGameDefaults: applyGameDefaults,
    applyStepZoneMapsToDropzones: applyStepZoneMapsToDropzones,
    isCardAcceptedInZone: isCardAcceptedInZone,
    usesZoneAcceptedIds: usesZoneAcceptedIds,
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
    computeDndBaseMaxScore: computeDndBaseMaxScore,
    normalizeStep: normalizeStep,
    normalizeZoneMap: normalizeZoneMap,
    normalizeZoneMapIds: normalizeZoneMapIds,
    normalizeSteps: normalizeSteps,
    normalizeStepActivity: normalizeStepActivity,
    stepNeedsRelier: stepNeedsRelier,
    evaluateStep: evaluateStep,
    getStepsState: getStepsState,
    normalizeInstructionsBox: normalizeInstructionsBox,
    applyInstructionsBoxToElement: applyInstructionsBoxToElement,
    normalizeRelierBtn: normalizeRelierBtn,
    applyRelierBtnLayout: applyRelierBtnLayout,
    relierLogoSvg: relierLogoSvg,
    normalizeLinkZone: normalizeLinkZone,
    normalizeLinkZones: normalizeLinkZones,
    linkZoneBBox: linkZoneBBox
  };
});
