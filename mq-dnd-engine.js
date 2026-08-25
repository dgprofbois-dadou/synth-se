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

  /** left/top/width en px uniquement — parseFloat('15%') === 15 casserait les flèches Relier en HTML export. */
  function cssPxNumber(value) {
    if (value == null || value === '') return NaN;
    var m = /^(-?\d+(?:\.\d+)?)(px)?$/i.exec(String(value).trim());
    if (!m) return NaN;
    var n = parseFloat(m[1]);
    return isFinite(n) ? n : NaN;
  }

  function htmlStyleBox(el) {
    if (!el || !el.style) return null;
    var left = cssPxNumber(el.style.left);
    var top = cssPxNumber(el.style.top);
    var w = (el.offsetWidth > 0) ? el.offsetWidth : cssPxNumber(el.style.width);
    var h = (el.offsetHeight > 0) ? el.offsetHeight : cssPxNumber(el.style.height);
    if (isNaN(left) || isNaN(top) || !(w > 0 || h > 0)) return null;
    return { x: left, y: top, width: w || 0, height: h || 0 };
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

  function round1(n) {
    return Math.round(Number(n) * 10) / 10;
  }

  /** Intersection rayon → bord d'un rectangle (t > 0). */
  function rayRectIntersect(x0, y0, dx, dy, rect) {
    if (!rect || !isFinite(rect.width) || !isFinite(rect.height)) return null;
    var rx1 = rect.x;
    var ry1 = rect.y;
    var rx2 = rect.x + rect.width;
    var ry2 = rect.y + rect.height;
    var bestT = Infinity;
    var best = null;
    function tryHit(t, x, y) {
      if (t <= 1e-6 || t >= bestT) return;
      if (x >= rx1 - 1e-6 && x <= rx2 + 1e-6 && y >= ry1 - 1e-6 && y <= ry2 + 1e-6) {
        bestT = t;
        best = { x: x, y: y };
      }
    }
    if (Math.abs(dx) > 1e-9) {
      tryHit((rx1 - x0) / dx, rx1, y0 + dy * ((rx1 - x0) / dx));
      tryHit((rx2 - x0) / dx, rx2, y0 + dy * ((rx2 - x0) / dx));
    }
    if (Math.abs(dy) > 1e-9) {
      tryHit((ry1 - y0) / dy, x0 + dx * ((ry1 - y0) / dy), ry1);
      tryHit((ry2 - y0) / dy, x0 + dx * ((ry2 - y0) / dy), ry2);
    }
    return best;
  }

  /** Point d'ancrage sur une zone : centre ou bord décalé si la surface le permet. */
  function linkAnchorPoint(fromX, fromY, bbox, slot, total) {
    slot = Math.max(0, parseInt(slot, 10) || 0);
    total = Math.max(1, parseInt(total, 10) || 1);
    if (!bbox || !isFinite(bbox.width) || !isFinite(bbox.height)) {
      return { x: fromX, y: fromY };
    }
    var cx = bbox.x + bbox.width / 2;
    var cy = bbox.y + bbox.height / 2;
    var area = Math.max(1, bbox.width) * Math.max(1, bbox.height);
    if (total <= 1) return { x: cx, y: cy };

    var dx = cx - fromX;
    var dy = cy - fromY;
    var len = Math.hypot(dx, dy);
    if (len < 4) return { x: cx, y: cy };
    var ux = dx / len;
    var uy = dy / len;
    var tx = -uy;
    var ty = ux;

    var hit = rayRectIntersect(fromX, fromY, ux, uy, bbox);
    var ax = hit ? hit.x : cx;
    var ay = hit ? hit.y : cy;

    if (total > 1) {
      var spread = Math.max(14, Math.min(bbox.width, bbox.height) * 0.38);
      var step = total > 1 ? spread / (total - 1) : 0;
      var off = (slot - (total - 1) / 2) * step;
      ax += tx * off;
      ay += ty * off;
      ax = Math.max(bbox.x + 2, Math.min(bbox.x + bbox.width - 2, ax));
      ay = Math.max(bbox.y + 2, Math.min(bbox.y + bbox.height - 2, ay));
    }
    return { x: ax, y: ay };
  }

  function computeLinkAnchorSlots(links, getPeerCenter) {
    var slots = new Array(links.length);
    var groups = { from: {}, to: {} };
    links.forEach(function (l, i) {
      slots[i] = { fromSlot: 0, fromTotal: 1, toSlot: 0, toTotal: 1 };
      var f = String(l.from);
      var t = String(l.to);
      if (!groups.from[f]) groups.from[f] = [];
      if (!groups.to[t]) groups.to[t] = [];
      groups.from[f].push(i);
      groups.to[t].push(i);
    });
    function assign(group, key, slotKey, totalKey, peerKey) {
      Object.keys(group).forEach(function (nodeId) {
        var indices = group[nodeId];
        if (indices.length <= 1) return;
        indices.sort(function (ia, ib) {
          var pa = getPeerCenter(links[ia][peerKey]);
          var pb = getPeerCenter(links[ib][peerKey]);
          var ca = getPeerCenter(nodeId);
          if (!pa || !pb || !ca) return ia - ib;
          return Math.atan2(pa.y - ca.y, pa.x - ca.x) - Math.atan2(pb.y - ca.y, pb.x - ca.x);
        });
        indices.forEach(function (idx, pos) {
          slots[idx][slotKey] = pos;
          slots[idx][totalKey] = indices.length;
        });
      });
    }
    assign(groups.from, 'from', 'fromSlot', 'fromTotal', 'to');
    assign(groups.to, 'to', 'toSlot', 'toTotal', 'from');
    return slots;
  }

  function polygonCentroidFromPointsAttr(pointsAttr) {
    if (!pointsAttr) return null;
    var nums = String(pointsAttr).trim().split(/[\s,]+/).map(Number).filter(function (n) { return isFinite(n); });
    if (nums.length < 6) return null;
    var area = 0;
    var cx = 0;
    var cy = 0;
    var n = Math.floor(nums.length / 2);
    for (var i = 0; i < n; i++) {
      var x0 = nums[i * 2];
      var y0 = nums[i * 2 + 1];
      var x1 = nums[((i + 1) % n) * 2];
      var y1 = nums[((i + 1) % n) * 2 + 1];
      var cross = x0 * y1 - x1 * y0;
      area += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
    area *= 0.5;
    if (Math.abs(area) < 1e-6) return null;
    return { x: cx / (6 * area), y: cy / (6 * area) };
  }

  function orient(ax, ay, bx, by, cx, cy) {
    var v = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
    if (Math.abs(v) < 1e-9) return 0;
    return v > 0 ? 1 : 2;
  }

  function onSegment(ax, ay, bx, by, cx, cy) {
    return cx >= Math.min(ax, bx) - 1e-9 && cx <= Math.max(ax, bx) + 1e-9
      && cy >= Math.min(ay, by) - 1e-9 && cy <= Math.max(ay, by) + 1e-9;
  }

  function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    var o1 = orient(ax, ay, bx, by, cx, cy);
    var o2 = orient(ax, ay, bx, by, dx, dy);
    var o3 = orient(cx, cy, dx, dy, ax, ay);
    var o4 = orient(cx, cy, dx, dy, bx, by);
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(ax, ay, bx, by, cx, cy)) return true;
    if (o2 === 0 && onSegment(ax, ay, bx, by, dx, dy)) return true;
    if (o3 === 0 && onSegment(cx, cy, dx, dy, ax, ay)) return true;
    if (o4 === 0 && onSegment(cx, cy, dx, dy, bx, by)) return true;
    return false;
  }

  function countPolylineCrossings(polyA, polyB) {
    if (!polyA || !polyB || polyA.length < 2 || polyB.length < 2) return 0;
    var n = 0;
    for (var i = 0; i < polyA.length - 1; i++) {
      for (var j = 0; j < polyB.length - 1; j++) {
        if (segmentsIntersect(
          polyA[i].x, polyA[i].y, polyA[i + 1].x, polyA[i + 1].y,
          polyB[j].x, polyB[j].y, polyB[j + 1].x, polyB[j + 1].y
        )) n++;
      }
    }
    return n;
  }

  function polylineDeviation(poly) {
    if (!poly || poly.length < 3) return 0;
    var x1 = poly[0].x;
    var y1 = poly[0].y;
    var x2 = poly[poly.length - 1].x;
    var y2 = poly[poly.length - 1].y;
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var dev = 0;
    for (var i = 1; i < poly.length - 1; i++) {
      var t = ((poly[i].x - x1) * dx + (poly[i].y - y1) * dy) / (len * len);
      var px = x1 + dx * t;
      var py = y1 + dy * t;
      dev += Math.abs(poly[i].x - px) + Math.abs(poly[i].y - py);
    }
    return dev;
  }

  function polylineKey(poly) {
    return poly.map(function (p) { return round1(p.x) + ',' + round1(p.y); }).join('|');
  }

  function dedupePolylines(list) {
    var seen = {};
    var out = [];
    list.forEach(function (poly) {
      var k = polylineKey(poly);
      if (seen[k]) return;
      seen[k] = true;
      out.push(poly);
    });
    return out;
  }

  function polylineBacktrack(poly) {
    if (!poly || poly.length < 3) return 0;
    var x1 = poly[0].x;
    var y1 = poly[0].y;
    var x2 = poly[poly.length - 1].x;
    var y2 = poly[poly.length - 1].y;
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len2 = dx * dx + dy * dy + 1e-9;
    var back = 0;
    for (var i = 1; i < poly.length - 1; i++) {
      var proj = ((poly[i].x - x1) * dx + (poly[i].y - y1) * dy) / len2;
      if (proj < 0) back += -proj;
      if (proj > 1) back += proj - 1;
    }
    return back;
  }

  /** Pénalise les tracés en « W » (points de contrôle de côtés opposés). */
  function polylineOppositeBulge(poly) {
    if (!poly || poly.length < 4) return 0;
    var x1 = poly[0].x;
    var y1 = poly[0].y;
    var x2 = poly[poly.length - 1].x;
    var y2 = poly[poly.length - 1].y;
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len = Math.hypot(dx, dy) || 1;
    var px = -dy / len;
    var py = dx / len;
    var sides = [];
    for (var i = 1; i < poly.length - 1; i++) {
      var side = (poly[i].x - x1) * px + (poly[i].y - y1) * py;
      if (Math.abs(side) > len * 0.03) sides.push(side > 0 ? 1 : -1);
    }
    for (var j = 1; j < sides.length; j++) {
      if (sides[j] !== sides[j - 1]) return 1;
    }
    return 0;
  }

  /** Génère des tracés candidats lisibles : arc simple, courbe en S parallèle, couloir doux. */
  function generateLinkRouteCandidates(x1, y1, x2, y2, opts) {
    opts = opts || {};
    x1 = Number(x1); y1 = Number(y1); x2 = Number(x2); y2 = Number(y2);
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (!isFinite(len) || len < 4) {
      return [[{ x: x1, y: y1 }, { x: x2, y: y2 }]];
    }
    var mx = (x1 + x2) / 2;
    var my = (y1 + y2) / 2;
    var px = -dy / len;
    var py = dx / len;
    var rank = Math.max(0, parseInt(opts.rank, 10) || 0);
    var sign = opts.sign < 0 ? -1 : 1;
    var base = Math.max(18, Math.min(72, len * 0.2)) * (1 + rank * 0.4);
    var primary = sign * base * (0.5 + rank * 0.45);
    var list = [[{ x: x1, y: y1 }, { x: x2, y: y2 }]];

    var laneOffsets = [
      primary,
      primary * 0.55,
      -primary * 0.55,
      primary * 1.25,
      -primary * 1.25,
      0
    ];

    laneOffsets.forEach(function (off) {
      list.push([
        { x: x1, y: y1 },
        { x: mx + px * off, y: my + py * off },
        { x: x2, y: y2 }
      ]);
      list.push([
        { x: x1, y: y1 },
        { x: x1 + dx * 0.28 + px * off, y: y1 + dy * 0.28 + py * off },
        { x: x1 + dx * 0.72 + px * off, y: y1 + dy * 0.72 + py * off },
        { x: x2, y: y2 }
      ]);
    });

    if (Math.abs(dx) >= Math.abs(dy) * 0.5) {
      [primary, -primary, primary * 1.15, -primary * 1.15].forEach(function (off) {
        var corridor = x1 + dx * 0.36;
        list.push([
          { x: x1, y: y1 },
          { x: corridor, y: y1 + off * 0.5 },
          { x: corridor, y: y2 + off * 0.5 },
          { x: x2, y: y2 }
        ]);
      });
    }

    if (Math.abs(dy) >= Math.abs(dx) * 0.5) {
      [primary, -primary].forEach(function (off) {
        var corridor = y1 + dy * 0.36;
        list.push([
          { x: x1, y: y1 },
          { x: x1 + off * 0.5, y: corridor },
          { x: x2 + off * 0.5, y: corridor },
          { x: x2, y: y2 }
        ]);
      });
    }

    return dedupePolylines(list).slice(0, 20);
  }

  function scoreRouteCandidate(poly, others) {
    var score = 0;
    var crossings = 0;
    (others || []).forEach(function (other) {
      if (other) crossings += countPolylineCrossings(poly, other);
    });
    score += crossings * 50;
    score += Math.max(0, poly.length - 3) * 10;
    score += polylineDeviation(poly) * 0.28;
    score += polylineBacktrack(poly) * 120;
    score += polylineOppositeBulge(poly) * 90;
    return score;
  }

  function pickBestRouteCandidate(candidates, others) {
    var best = candidates[0];
    var bestScore = Infinity;
    var bestCross = Infinity;
    candidates.forEach(function (poly) {
      var cross = 0;
      (others || []).forEach(function (other) {
        if (other) cross += countPolylineCrossings(poly, other);
      });
      var s = scoreRouteCandidate(poly, others);
      if (cross < bestCross || (cross === bestCross && s < bestScore)) {
        bestCross = cross;
        bestScore = s;
        best = poly;
      }
    });
    return best;
  }

  /**
   * Disposition rapide (greedy) : spline 1–4 points, croisements minimisés mais acceptés si inévitables.
   */
  function layoutLinkRoutes(entries) {
    var n = entries.length;
    var assigned = new Array(n);
    var valid = [];
    entries.forEach(function (e, i) {
      if (!e || e.empty || !isFinite(e.x1) || !isFinite(e.x2)) return;
      valid.push(i);
    });
    if (!valid.length) return assigned;

    valid.sort(function (ia, ib) {
      var ea = entries[ia];
      var eb = entries[ib];
      var la = Math.hypot(ea.x2 - ea.x1, ea.y2 - ea.y1);
      var lb = Math.hypot(eb.x2 - eb.x1, eb.y2 - eb.y1);
      return lb - la;
    });

    var candidateMap = {};
    valid.forEach(function (i) {
      var e = entries[i];
      candidateMap[i] = generateLinkRouteCandidates(e.x1, e.y1, e.x2, e.y2, e);
    });

    valid.forEach(function (i) {
      var others = [];
      valid.forEach(function (j) {
        if (j !== i && assigned[j]) others.push(assigned[j]);
      });
      assigned[i] = pickBestRouteCandidate(candidateMap[i], others);
    });

    valid.forEach(function (i) {
      var others = [];
      valid.forEach(function (j) {
        if (j !== i && assigned[j]) others.push(assigned[j]);
      });
      var improved = pickBestRouteCandidate(candidateMap[i], others);
      if (scoreRouteCandidate(improved, others) < scoreRouteCandidate(assigned[i], others)) {
        assigned[i] = improved;
      }
    });

    return assigned;
  }

  /** Points de contrôle → tracé SVG lissé (Q ou Catmull-Rom cubique). */
  function linkPolylineToPath(poly) {
    if (!poly || !poly.length) return '';
    if (poly.length === 1) {
      return 'M ' + round1(poly[0].x) + ',' + round1(poly[0].y);
    }
    if (poly.length === 2) {
      return 'M ' + round1(poly[0].x) + ',' + round1(poly[0].y)
        + ' L ' + round1(poly[1].x) + ',' + round1(poly[1].y);
    }
    if (poly.length === 3) {
      return 'M ' + round1(poly[0].x) + ',' + round1(poly[0].y)
        + ' Q ' + round1(poly[1].x) + ',' + round1(poly[1].y)
        + ' ' + round1(poly[2].x) + ',' + round1(poly[2].y);
    }
    if (poly.length === 4) {
      return 'M ' + round1(poly[0].x) + ',' + round1(poly[0].y)
        + ' C ' + round1(poly[1].x) + ',' + round1(poly[1].y)
        + ' ' + round1(poly[2].x) + ',' + round1(poly[2].y)
        + ' ' + round1(poly[3].x) + ',' + round1(poly[3].y);
    }
    var d = 'M ' + round1(poly[0].x) + ',' + round1(poly[0].y);
    for (var i = 0; i < poly.length - 1; i++) {
      var p0 = poly[i === 0 ? 0 : i - 1];
      var p1 = poly[i];
      var p2 = poly[i + 1];
      var p3 = poly[i + 2 >= poly.length ? poly.length - 1 : i + 2];
      var cp1x = p1.x + (p2.x - p0.x) / 6;
      var cp1y = p1.y + (p2.y - p0.y) / 6;
      var cp2x = p2.x - (p3.x - p1.x) / 6;
      var cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ' C ' + round1(cp1x) + ',' + round1(cp1y)
        + ' ' + round1(cp2x) + ',' + round1(cp2y)
        + ' ' + round1(p2.x) + ',' + round1(p2.y);
    }
    return d;
  }

  /** Compat. : un seul lien (sans optimisation globale). */
  function linkSplinePath(x1, y1, x2, y2, opts) {
    var routes = layoutLinkRoutes([{ x1: x1, y1: y1, x2: x2, y2: y2, rank: opts && opts.rank, sign: opts && opts.sign }]);
    return linkPolylineToPath(routes[0]);
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
      g.linkTooltip = 'Clic droit maintenu : tracer une flèche.\nClic gauche sur une flèche : la supprimer.';
    } else {
      g.linkTooltip = String(g.linkTooltip);
    }
    g.relierBtn = normalizeRelierBtn(g.relierBtn, g);
    g.linkZones = normalizeLinkZones(g.linkZones);
    if (typeof g.enableSteps !== 'boolean') g.enableSteps = false;
    g.steps = normalizeSteps(g.steps);
    g.instructionsBox = normalizeInstructionsBox(g.instructionsBox, g);
    g.scoreBox = normalizeScoreBox(g.scoreBox, g);
    migrateDraggableTooltips(g);
    if (g.enableSteps && (!g.steps || !g.steps.length) && String(g.instructions || '').trim()) {
      g.steps = [normalizeStep({
        title: 'Étape 1',
        instructions: g.instructions,
        activity: (normalizeGameType(g.gameType) === 'linking') ? 'linking' : 'dnd',
        zoneIds: [],
        goodIds: g.goodIds || '',
        linkPairs: (normalizeGameType(g.gameType) === 'linking') ? (g.allowedLinks || []) : []
      }, 0)];
    }
    migrateLegacyLinkingToSteps(g);
    if (g.enableSteps) applyStepZoneMapsToDropzones(g);
    return g;
  }

  /** Infobulle d’une carte : drapeau par image, sinon ancien réglage global du jeu. */
  function dragShowsTooltip(drag, game) {
    if (drag && typeof drag.tooltipEnabled === 'boolean') return !!drag.tooltipEnabled;
    if (game && game.tooltip && game.tooltip.enabled === false) return false;
    if (game && game.tooltipEnabled === false) return false;
    return true;
  }

  /** Ancien interrupteur global → une case par carte (une seule fois). */
  function migrateDraggableTooltips(g) {
    if (!g || !Array.isArray(g.draggables)) return g;
    var gameOn = !(g.tooltipEnabled === false || (g.tooltip && g.tooltip.enabled === false));
    g.draggables.forEach(function (d) {
      if (!d || typeof d !== 'object') return;
      if (typeof d.tooltipEnabled !== 'boolean') d.tooltipEnabled = gameOn;
    });
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

  /** Une étape Relier (explicite) ou une étape sans type mais avec des paires. */
  function gameHasRelierStep(game) {
    var steps = (game && Array.isArray(game.steps)) ? game.steps : [];
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i] || {};
      var a = String(s.activity != null ? s.activity : (s.mode || '')).trim().toLowerCase();
      if (a === 'linking' || a === 'both') return true;
      if (!a && Array.isArray(s.linkPairs) && s.linkPairs.length) return true;
    }
    return false;
  }

  /** Relier n’existe plus comme type de jeu global : uniquement via les étapes (hors migration). */
  function gameNeedsRelier(game) {
    if (!game) return false;
    if (game.enableSteps && Array.isArray(game.steps) && game.steps.length) {
      return gameHasRelierStep(game);
    }
    return isLinking(game) || !!game.enableLinking;
  }

  function hasLinkingFeature(game) {
    return gameNeedsRelier(game);
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
  function evaluateLinks(game, links, opts) {
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
    var required = maxScore;
    if (opts && opts.minCorrect != null && opts.minCorrect !== '') {
      var m = parseInt(opts.minCorrect, 10);
      if (isFinite(m) && m > 0) required = Math.min(maxScore, m);
    }
    return {
      links: user,
      correct: correct,
      wrong: wrong,
      score: score,
      maxScore: maxScore,
      requiredScore: required,
      isComplete: maxScore > 0 && score >= required && wrong.length === 0,
      gameType: 'linking'
    };
  }

  /** Une flèche verte (paire autorisée + feedback visible) ne peut pas être retirée. */
  function canRemoveDrawnLink(game, link, showFeedback) {
    if (!link) return false;
    if (!showFeedback) return true;
    var allowed = effectiveAllowedLinks(game);
    var from = String(link.from);
    var to = String(link.to);
    for (var i = 0; i < allowed.length; i++) {
      if (String(allowed[i].from) === from && String(allowed[i].to) === to) return false;
    }
    return true;
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

  /** Boîte score / malus (absolu, comme la consigne). */
  function normalizeScoreBox(raw, game) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var gw = Math.max(200, parseInt(game && game.width, 10) || 800);
    var gh = Math.max(100, parseInt(game && game.height, 10) || 400);
    var fontSize = Math.max(12, parseInt(src.fontSize, 10) || 22);
    var width = typeof src.width === 'number' ? Math.max(120, src.width) : Math.min(420, Math.max(220, Math.round(gw * 0.42)));
    var height = typeof src.height === 'number' ? Math.max(36, src.height) : Math.max(44, Math.round(fontSize * 2.2));
    var x = typeof src.x === 'number' ? Math.round(src.x) : Math.round((gw - width) / 2);
    var y = typeof src.y === 'number' ? Math.round(src.y) : Math.max(0, gh - height - Math.round(gh * 0.02));
    return {
      x: x,
      y: y,
      width: width,
      height: height,
      font: src.font != null && String(src.font).trim() ? String(src.font) : 'Verdana, sans-serif',
      fontSize: fontSize,
      bold: src.bold === false ? false : true,
      bgColor: src.bgColor != null && String(src.bgColor).trim() ? String(src.bgColor) : 'rgba(255,255,255,0.92)',
      color: src.color != null && String(src.color).trim() ? String(src.color) : '#2e7d32',
      borderColor: src.borderColor != null && String(src.borderColor).trim() ? String(src.borderColor) : '#81c784'
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

  function findInstructionsHudHost(gameContainer) {
    if (typeof document === 'undefined') return null;
    var vp = document.getElementById('viewport');
    if (vp) return vp;
    var canvas = document.getElementById('canvas-container');
    if (!canvas && typeof document.querySelector === 'function') {
      canvas = document.querySelector('.canvas-container');
    }
    if (canvas) return canvas;
    return gameContainer || null;
  }

  function findInstructionsEl(gameContainer) {
    if (gameContainer) {
      var inside = gameContainer.querySelector('.dnd-instructions');
      if (inside) return inside;
    }
    if (typeof document === 'undefined') return null;
    var gid = gameContainer && (gameContainer.getAttribute('data-dnd-gameid') || gameContainer.id || '');
    var host = findInstructionsHudHost(gameContainer);
    if (host && gid) {
      var byGame = host.querySelector('.dnd-instructions[data-dnd-instr-for="' + gid + '"]');
      if (byGame) return byGame;
    }
    if (host) {
      var inHost = host.querySelector('.dnd-instructions');
      if (inHost) return inHost;
    }
    return document.querySelector('.dnd-instructions');
  }

  function clearInstructionsHud(gameId) {
    if (typeof document === 'undefined') return;
    var sel = gameId
      ? '.dnd-instructions-hud[data-dnd-instr-for="' + String(gameId) + '"]'
      : '.dnd-instructions-hud';
    Array.prototype.slice.call(document.querySelectorAll(sel)).forEach(function (n) {
      if (n.parentNode) n.parentNode.removeChild(n);
    });
  }

  function mountInstructionsHud(el, gameContainer) {
    if (!el) return el;
    var host = findInstructionsHudHost(gameContainer);
    if (!host) host = gameContainer;
    if (!host) return el;
    var gid = gameContainer && (gameContainer.getAttribute('data-dnd-gameid') || gameContainer.id || '');
    if (gid) {
      el.setAttribute('data-dnd-instr-for', gid);
      if (typeof document !== 'undefined') {
        Array.prototype.slice.call(document.querySelectorAll('.dnd-instructions-hud[data-dnd-instr-for="' + gid + '"]')).forEach(function (old) {
          if (old !== el && old.parentNode) old.parentNode.removeChild(old);
        });
      }
    }
    if (el.classList && el.classList.add) el.classList.add('dnd-instructions-hud');
    else el.className = String(el.className || '') + ' dnd-instructions-hud';
    if (el.classList && el.classList.remove) el.classList.remove('dnd-instructions-active');
    if (el.parentNode !== host) host.appendChild(el);
    attachInstructionsFocusGuard();
    attachInstructionsHudLayoutSync();
    syncInstructionsHudLayout(host);
    return el;
  }

  function measureControlsOffset(host) {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return 12;
    var controls = document.querySelector('.controls');
    if (!controls || !controls.getBoundingClientRect) return 12;
    var cRect = controls.getBoundingClientRect();
    if (cRect.height <= 0) return 12;
    // Barre score / PDF en bas sur mobile : ne pas décaler la consigne vers le bas.
    if (cRect.top > ((typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight * 0.45 : 300)) {
      return 12;
    }
    var hostTop = 0;
    if (host && host.getBoundingClientRect) {
      hostTop = host.getBoundingClientRect().top;
    }
    return Math.max(12, Math.ceil(cRect.bottom - hostTop + 8));
  }

  var instrLayoutBound = false;

  function syncInstructionsHudLayout(optHost) {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return;
    var host = optHost || findInstructionsHudHost(null);
    var topPx = measureControlsOffset(host);
    if (host && host.style) host.style.setProperty('--mq-instr-hud-top', topPx + 'px');
    Array.prototype.forEach.call(document.querySelectorAll('.dnd-instructions-hud'), function (el) {
      el.style.top = topPx + 'px';
    });
  }

  function attachInstructionsHudLayoutSync() {
    if (typeof window === 'undefined' || instrLayoutBound) return;
    instrLayoutBound = true;
    var resync = function () { syncInstructionsHudLayout(); };
    window.addEventListener('resize', resync);
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(resync).catch(function () {});
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('DOMContentLoaded', resync);
    }
    setTimeout(resync, 0);
    setTimeout(resync, 250);
  }

  var OTHER_ACTIVITY_SEL = [
    '.box', '.input-wrapper', 'input', 'textarea', 'select',
    '#left', '#mqRail', '#topbar', '.controls', '.pdf-buttons',
    '.hotspot-group', '#hotspots', '#hotspots-ui', '.mq-topbar'
  ].join(',');

  function pointInRect(x, y, r) {
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function eventHitsDndGame(e, gameEl) {
    if (!e || !gameEl) return false;
    var t = e.target;
    if (t && t.closest && t.closest('.drag-game') === gameEl) return true;
    if (typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return false;
    if (!gameEl.getBoundingClientRect) return false;
    return pointInRect(e.clientX, e.clientY, gameEl.getBoundingClientRect());
  }

  function gameFromPointerEvent(e) {
    if (!e || typeof document === 'undefined') return null;
    var t = e.target;
    if (t && t.closest) {
      if (t.closest(OTHER_ACTIVITY_SEL) && !t.closest('.drag-game')) return null;
      var inside = t.closest('.drag-game');
      if (inside) return inside;
    }
    var x = e.clientX;
    var y = e.clientY;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    var hit = null;
    Array.prototype.forEach.call(document.querySelectorAll('.drag-game'), function (el) {
      if (pointInRect(x, y, el.getBoundingClientRect())) hit = el;
    });
    return hit;
  }

  function setInstructionsHudActive(gameEl, on) {
    if (typeof document === 'undefined') return;
    var gid = gameEl && (gameEl.getAttribute('data-dnd-gameid') || gameEl.id || '');
    Array.prototype.forEach.call(document.querySelectorAll('.dnd-instructions-hud'), function (el) {
      if (el.classList && el.classList.contains('dnd-instructions-done')) {
        el.classList.remove('dnd-instructions-active');
        return;
      }
      var mine = !gid || el.getAttribute('data-dnd-instr-for') === gid || el.getAttribute('data-dnd-instr-for') === String(gameEl && gameEl.id || '');
      if (on && mine) el.classList.add('dnd-instructions-active');
      else el.classList.remove('dnd-instructions-active');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.dnd-game-focused'), function (el) {
      if (!on || el !== gameEl) el.classList.remove('dnd-game-focused');
    });
    if (on && gameEl && gameEl.classList) gameEl.classList.add('dnd-game-focused');
    if (on) syncInstructionsHudLayout();
  }

  var instrFocusBound = false;

  function attachInstructionsFocusGuard() {
    if (typeof document === 'undefined' || !document || typeof document.addEventListener !== 'function' || instrFocusBound) return;
    instrFocusBound = true;
    document.addEventListener('pointerdown', function (e) {
      var game = gameFromPointerEvent(e);
      if (game) setInstructionsHudActive(game, true);
      else setInstructionsHudActive(null, false);
    }, true);
  }

  function applyInstructionsBoxToElement(el, game) {
    if (!el || !game) return;
    var box = normalizeInstructionsBox(game.instructionsBox, game);
    game.instructionsBox = box;
    var hud = !!(el.classList && el.classList.contains && el.classList.contains('dnd-instructions-hud'));
    if (hud) {
      el.style.position = 'absolute';
      el.style.left = '12px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.width = 'auto';
      el.style.height = 'auto';
      el.style.maxWidth = 'min(560px, calc(100% - 24px))';
      el.style.maxHeight = 'min(240px, 36vh)';
      if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
        syncInstructionsHudLayout(findInstructionsHudHost(el.closest && el.closest('.drag-game')));
      }
      if (!el.style.top) el.style.top = measureControlsOffset(null) + 'px';
    } else {
      var gw = Math.max(1, parseInt(game.width, 10) || 800);
      var gh = Math.max(1, parseInt(game.height, 10) || 400);
      el.style.left = ((box.x / gw) * 100) + '%';
      el.style.top = ((box.y / gh) * 100) + '%';
      el.style.width = ((box.width / gw) * 100) + '%';
      el.style.height = ((box.height / gh) * 100) + '%';
      el.style.right = 'auto';
    }
    el.style.fontFamily = box.font;
    el.style.fontSize = box.fontSize + 'px';
    el.style.fontWeight = box.bold ? 'bold' : '600';
    el.style.fontStyle = box.italic ? 'italic' : 'normal';
    el.style.textAlign = box.align || (hud ? 'left' : 'center');
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
    var hasLink = !!(stepHint && Array.isArray(stepHint.linkPairs) && stepHint.linkPairs.length);
    var hasDnd = !!(stepHint && (
      (Array.isArray(stepHint.zoneIds) && stepHint.zoneIds.length) ||
      String(stepHint.goodIds || '').trim() ||
      (stepHint.zoneMap && typeof stepHint.zoneMap === 'object' && Object.keys(stepHint.zoneMap).length)
    ));
    if (hasLink && hasDnd) return 'both';
    if (hasLink) return 'linking';
    return 'dnd';
  }

  function stepNeedsRelier(step) {
    var s = normalizeStep(step, 0);
    return s.activity === 'linking' || s.activity === 'both';
  }

  /** Étape Relier pure : le mode lien s’active tout seul, sans bouton bleu. */
  function stepAutoLinkMode(step) {
    return normalizeStep(step, 0).activity === 'linking';
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
    var zoneMap = normalizeZoneMap(s.zoneMap);
    var draft = { zoneIds: zoneIds, goodIds: goodIds, linkPairs: linkPairs, zoneMap: zoneMap };
    var activity = normalizeStepActivity(s.activity != null ? s.activity : s.mode, draft);
    var stepGameType = normalizeGameType(s.stepGameType || s.gameType || 'exact');
    var minCorrectLinks = parseInt(s.minCorrectLinks, 10);
    if (!isFinite(minCorrectLinks) || minCorrectLinks < 0) minCorrectLinks = 0;
    return {
      id: s.id != null ? String(s.id) : String(index + 1),
      title: s.title != null ? String(s.title) : ('Étape ' + (index + 1)),
      instructions: s.instructions != null ? String(s.instructions) : '',
      activity: activity,
      stepGameType: activity === 'linking' ? 'linking' : stepGameType,
      requireNextButton: !!s.requireNextButton,
      minCorrectLinks: minCorrectLinks,
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

  /**
   * Ancienne config Relier au niveau jeu (gameType linking / enableLinking / allowedLinks)
   * → une étape Relier, pour pouvoir reprendre la config sur une étape précise.
   */
  function migrateLegacyLinkingToSteps(g) {
    if (!g || typeof g !== 'object') return g;
    var wasLinkingType = normalizeGameType(g.gameType) === 'linking';
    var globalPairs = normalizeAllowedLinks(g.allowedLinks);
    var leftoverHybrid = !!g.enableLinking && !wasLinkingType;
    if (!Array.isArray(g.steps)) g.steps = [];
    var stepsOn = !!g.enableSteps && g.steps.length > 0;

    function isDndShellWithPairs(s) {
      var ns = normalizeStep(s, 0);
      return ns.activity === 'dnd'
        && ns.linkPairs.length > 0
        && !ns.zoneIds.length
        && !String(ns.goodIds || '').trim()
        && !(ns.zoneMap && Object.keys(ns.zoneMap).length);
    }

    function fillEmptyRelierPairs() {
      if (!globalPairs.length) return;
      g.steps.forEach(function (s) {
        var ns = normalizeStep(s, 0);
        if (!stepNeedsRelier(ns)) return;
        if (!ns.linkPairs.length) s.linkPairs = globalPairs.slice();
      });
      g.steps = normalizeSteps(g.steps);
    }

    if (!stepsOn) {
      if (wasLinkingType || leftoverHybrid) {
        g.enableSteps = true;
        g.steps = [normalizeStep({
          title: wasLinkingType ? 'Relier' : 'Étape 1',
          instructions: g.instructions || '',
          activity: wasLinkingType ? 'linking' : 'both',
          stepGameType: wasLinkingType
            ? 'linking'
            : (normalizeGameType(g.gameType) === 'classification' ? 'classification' : 'exact'),
          goodIds: wasLinkingType ? '' : (g.goodIds || ''),
          linkPairs: globalPairs
        }, 0)];
      }
    } else {
      var converted = false;
      g.steps.forEach(function (s) {
        if (isDndShellWithPairs(s) && (wasLinkingType || leftoverHybrid || globalPairs.length)) {
          s.activity = 'linking';
          converted = true;
        }
      });
      if (converted) g.steps = normalizeSteps(g.steps);

      if (!gameHasRelierStep(g) && (wasLinkingType || (leftoverHybrid && globalPairs.length))) {
        g.steps.push(normalizeStep({
          title: 'Relier',
          instructions: '',
          activity: 'linking',
          linkPairs: globalPairs
        }, g.steps.length));
      } else {
        fillEmptyRelierPairs();
      }
    }

    if (wasLinkingType) g.gameType = 'exact';
    g.enableLinking = gameHasRelierStep(g);
    if (g.enableSteps && Array.isArray(g.steps) && g.steps.length) {
      g.allowedLinks = effectiveAllowedLinks(Object.assign({}, g, { enableSteps: true }));
    }
    return g;
  }

  /** IDs de zones à valider pour une étape (zoneIds ou clés du zoneMap). */
  function effectiveStepZoneIds(step) {
    step = normalizeStep(step, 0);
    if (step.activity === 'linking') return [];
    var zoneIds = (step.zoneIds || []).map(String).filter(Boolean);
    if (!zoneIds.length) {
      var zm = normalizeZoneMap(step.zoneMap);
      zoneIds = Object.keys(zm).filter(Boolean);
    }
    return zoneIds;
  }

  /** Complète zoneMap / goodIds des étapes à partir des dropzones (export HTML, runtime). */
  function enrichStepsFromDropzones(g) {
    if (!g || !g.enableSteps || !Array.isArray(g.steps) || !g.steps.length) return g;
    if (!Array.isArray(g.dropzones)) g.dropzones = [];
    g.steps = normalizeSteps(g.steps).map(function (step, i) {
      var ns = normalizeStep(step, i);
      var map = normalizeZoneMap(ns.zoneMap);
      effectiveStepZoneIds(ns).forEach(function (zid) {
        var sid = String(zid);
        if (normalizeZoneMapIds(map[sid]).length) return;
        g.dropzones.forEach(function (dz, di) {
          var dzid = dz.id != null ? String(dz.id) : String(di + 1);
          if (dzid !== sid) return;
          var acc = Array.isArray(dz.acceptedIds) ? dz.acceptedIds : [];
          if (acc.length) map[sid] = acc.map(String);
        });
      });
      var goodIds = String(ns.goodIds || '').trim();
      if (!goodIds) {
        var idSet = {};
        Object.keys(map).forEach(function (k) {
          normalizeZoneMapIds(map[k]).forEach(function (id) { idSet[id] = true; });
        });
        (ns.linkPairs || []).forEach(function (l) {
          if (l && l.from != null) idSet[String(l.from)] = true;
          if (l && l.to != null) idSet[String(l.to)] = true;
        });
        goodIds = Object.keys(idSet).join(',');
      }
      return normalizeStep(Object.assign({}, ns, { zoneMap: map, goodIds: goodIds }), i);
    });
    applyStepZoneMapsToDropzones(g);
    return g;
  }

  function stepInstructionLabel(step, index, total) {
    step = normalizeStep(step, index);
    var n = (typeof index === 'number' ? index : 0) + 1;
    var t = typeof total === 'number' ? total : n;
    return (step.title || ('Étape ' + n)) + ' (' + n + '/' + t + ')';
  }

  /**
   * Pour valider une étape Relier : ignorer les flèches déjà validées d’autres étapes.
   * Sinon evaluateLinks les compte en « wrong » → étape bloquée alors que les flèches sont vertes.
   */
  function linksForStepEvaluation(game, step, userLinks) {
    step = normalizeStep(step, 0);
    var stepPairs = normalizeAllowedLinks(step.linkPairs || []);
    var stepKeys = {};
    stepPairs.forEach(function (l) {
      stepKeys[linkPairKey(l.from, l.to)] = true;
    });
    var otherKeys = {};
    if (game && game.enableSteps && Array.isArray(game.steps)) {
      game.steps.forEach(function (s, i) {
        var ns = normalizeStep(s, i);
        if (String(ns.id) === String(step.id)) return;
        normalizeAllowedLinks(ns.linkPairs || []).forEach(function (l) {
          var k = linkPairKey(l.from, l.to);
          if (!stepKeys[k]) otherKeys[k] = true;
        });
      });
    }
    return normalizeAllowedLinks(userLinks).filter(function (l) {
      return !otherKeys[linkPairKey(l.from, l.to)];
    });
  }

  function evaluateStep(game, step, placements) {
    placements = placements || {};
    step = normalizeStep(step, 0);
    var activity = step.activity || 'dnd';
    var zoneIds = effectiveStepZoneIds(step);
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
      // Paires de CETTE étape seulement ; flèches des autres étapes exclues
      var lev = evaluateLinks(
        { allowedLinks: linkPairs },
        linksForStepEvaluation(game, step, placements.links || []),
        { minCorrect: step.minCorrectLinks }
      );
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

  /** Cartes sources déjà déposées (grisées) : les masquer dès l’étape suivante. */
  function shouldHideUsedStepSources(st) {
    if (!st || !st.enabled) return false;
    if (st.allComplete) return true;
    if (st.currentIndex > 0) return true;
    return !!(st.active && normalizeStep(st.active, 0).activity === 'linking');
  }

  /** IDs d’images / nœuds Relier référencés par une étape (goodIds, zoneMap, linkPairs). */
  function idsReferencedByStep(step) {
    step = normalizeStep(step, 0);
    var out = {};
    parseIdList(step.goodIds).forEach(function (id) { out[String(id)] = true; });
    Object.keys(step.zoneMap || {}).forEach(function (zk) {
      normalizeZoneMapIds(step.zoneMap[zk]).forEach(function (id) { out[String(id)] = true; });
    });
    (step.linkPairs || []).forEach(function (l) {
      if (l && l.from != null) out[String(l.from)] = true;
      if (l && l.to != null) out[String(l.to)] = true;
    });
    return out;
  }

  /** Première étape (index) où apparaît chaque élément / zone. */
  function buildStepOwnership(game) {
    var steps = normalizeSteps(game && game.steps);
    var elementMinStep = {};
    var zoneMinStep = {};
    steps.forEach(function (step, i) {
      Object.keys(idsReferencedByStep(step)).forEach(function (id) {
        if (elementMinStep[id] == null || i < elementMinStep[id]) elementMinStep[id] = i;
      });
      effectiveStepZoneIds(step).forEach(function (zid) {
        var zs = String(zid);
        if (zoneMinStep[zs] == null || i < zoneMinStep[zs]) zoneMinStep[zs] = i;
      });
    });
    // Images fixes : visibleFromStep (0-based) prime sur les critères d’étapes
    (game && game.decorImages || []).forEach(function (d) {
      if (!d || d.id == null || String(d.id).trim() === '') return;
      if (d.visibleFromStep === '' || d.visibleFromStep == null) return;
      var n = parseInt(d.visibleFromStep, 10);
      if (!isFinite(n) || n < 0) return;
      elementMinStep[String(d.id).trim()] = n;
    });
    return { elementMinStep: elementMinStep, zoneMinStep: zoneMinStep };
  }

  function minStepIndexForElement(game, elementId) {
    var own = buildStepOwnership(game);
    var id = String(elementId);
    return own.elementMinStep[id] != null ? own.elementMinStep[id] : null;
  }

  function minStepIndexForZone(game, zoneId) {
    var own = buildStepOwnership(game);
    var id = String(zoneId);
    return own.zoneMinStep[id] != null ? own.zoneMinStep[id] : null;
  }

  /** Élément visible à l’étape courante (index 0-based) ? */
  function isElementVisibleAtStep(game, elementId, currentStepIndex) {
    if (!game || !game.enableSteps || !Array.isArray(game.steps) || !game.steps.length) return true;
    var min = minStepIndexForElement(game, elementId);
    if (min == null) return true;
    return min <= currentStepIndex;
  }

  function isZoneVisibleAtStep(game, zoneId, currentStepIndex) {
    if (!game || !game.enableSteps || !Array.isArray(game.steps) || !game.steps.length) return true;
    var min = minStepIndexForZone(game, zoneId);
    if (min == null) return true;
    return min <= currentStepIndex;
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
    var DEFAULT_LINK_TIP = 'Clic droit maintenu : tracer une flèche.\nClic gauche sur une flèche : la supprimer.';
    var DELETE_LINK_TIP = 'Clic gauche sur la flèche pour la supprimer.';
    var LOCKED_LINK_TIP = 'Flèche correcte : elle ne peut pas être supprimée.';
    var DRAW_LINK_TIP = 'Maintenez le clic droit et glissez jusqu’à l’image d’arrivée.';
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
      // 2) Image / texte fixe (décor)
      var decor = gameContainer.querySelector('.dnd-decor-fixed[data-id="' + sid + '"], .dnd-decor-text[data-id="' + sid + '"]');
      if (decor) return decor;
      // 3) Zone SVG Relier / nœud dédié
      var linkNode = gameContainer.querySelector('[data-link-node][data-id="' + sid + '"]');
      if (linkNode) return linkNode;
      // 4) Image source dans le bac
      return gameContainer.querySelector('.draggable[data-id="' + sid + '"]');
    }
    function allNodes() {
      return Array.prototype.slice.call(
        gameContainer.querySelectorAll('.draggable[data-id], .dnd-placed[data-id], .dnd-decor-fixed[data-id], .dnd-decor-text[data-id], [data-link-node][data-id], .dropzone[data-zone-id]')
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
    /** Centre d’un nœud en coords layout (clientWidth du jeu — fiable avec left/% et pan/zoom). */
    function nodeCenter(el) {
      if (!el) return { x: 0, y: 0 };
      var nid = el.getAttribute && el.getAttribute('data-id');
      if (nid && dragCenterOverrides[nid]) {
        return { x: dragCenterOverrides[nid].x, y: dragCenterOverrides[nid].y };
      }
      // Prioritaire : écran → layout (ne jamais se fier à left/% ni offsetLeft sous transform CSS)
      try {
        var er = el.getBoundingClientRect();
        if (er && isFinite(er.left) && isFinite(er.top) && (er.width > 0.5 || er.height > 0.5)) {
          return clientToLocal(er.left + er.width / 2, er.top + er.height / 2);
        }
      } catch (errRect) { /* ignore */ }
      // Fallback SVG (g/polygon parfois sans bbox écran utile)
      try {
        var geo = el;
        if (el.tagName === 'g') {
          geo = el.querySelector('polygon, path, polyline') || el;
        }
        if (geo && geo.tagName === 'polygon' && geo.getAttribute('points')) {
          var cent = polygonCentroidFromPointsAttr(geo.getAttribute('points'));
          if (cent) return scaleSvgUserPoint(geo, cent);
        }
        if (geo && typeof geo.getBBox === 'function' && (geo.ownerSVGElement || geo.tagName === 'svg')) {
          var bb = geo.getBBox();
          if (bb && isFinite(bb.x) && (bb.width > 0 || bb.height > 0 || (bb.x !== 0 || bb.y !== 0))) {
            return scaleSvgUserPoint(geo, { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });
          }
        }
      } catch (errBb) { /* ignore */ }
      return { x: 0, y: 0 };
    }
    /** Points viewBox (zones Relier) → pixels layout du jeu. */
    function scaleSvgUserPoint(geo, pt) {
      if (!pt) return { x: 0, y: 0 };
      var owner = (geo && geo.ownerSVGElement) || (geo && geo.tagName === 'svg' ? geo : null);
      if (!owner) return { x: pt.x, y: pt.y };
      var gw = gameContainer.clientWidth || 1;
      var gh = gameContainer.clientHeight || 1;
      var vb = owner.viewBox && owner.viewBox.baseVal;
      var vw = (vb && vb.width > 0) ? vb.width : (parseFloat(owner.getAttribute('width')) || gw);
      var vh = (vb && vb.height > 0) ? vb.height : (parseFloat(owner.getAttribute('height')) || gh);
      if (!(vw > 0) || !(vh > 0)) return { x: pt.x, y: pt.y };
      return { x: pt.x * gw / vw, y: pt.y * gh / vh };
    }
    function nodeBBoxForLink(el) {
      if (!el) return null;
      try {
        var r = el.getBoundingClientRect();
        if (r && isFinite(r.left) && (r.width > 0.5 || r.height > 0.5)) {
          var cr = gameContainer.getBoundingClientRect();
          var gw = gameContainer.clientWidth || 1;
          var gh = gameContainer.clientHeight || 1;
          var rw = cr.width || 1;
          var rh = cr.height || 1;
          return {
            x: ((r.left - cr.left) / rw) * gw,
            y: ((r.top - cr.top) / rh) * gh,
            width: (r.width / rw) * gw,
            height: (r.height / rh) * gh
          };
        }
      } catch (errB) { /* ignore */ }
      try {
        var geo = el;
        if (el.tagName === 'g') geo = el.querySelector('polygon, path, polyline') || el;
        if (geo && typeof geo.getBBox === 'function' && (geo.ownerSVGElement || geo.tagName === 'svg')) {
          var bb = geo.getBBox();
          if (bb && isFinite(bb.width) && isFinite(bb.height)) {
            var p0 = scaleSvgUserPoint(geo, { x: bb.x, y: bb.y });
            var p1 = scaleSvgUserPoint(geo, { x: bb.x + bb.width, y: bb.y + bb.height });
            return { x: p0.x, y: p0.y, width: Math.max(0, p1.x - p0.x), height: Math.max(0, p1.y - p0.y) };
          }
        }
      } catch (errA) { /* ignore */ }
      return null;
    }
    /** Point d'accroche aimanté : centre ou bord décalé si la zone est grande / plusieurs liens. */
    function linkEndpointForNode(el, peerX, peerY, slot, total) {
      if (!el) return { x: peerX, y: peerY };
      var nid = el.getAttribute && el.getAttribute('data-id');
      if (nid && dragCenterOverrides[nid]) {
        return { x: dragCenterOverrides[nid].x, y: dragCenterOverrides[nid].y };
      }
      var bbox = nodeBBoxForLink(el);
      if (!bbox) return nodeCenter(el);
      return linkAnchorPoint(peerX, peerY, bbox, slot, total);
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
      var decor = null;
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
        var dc = node.closest('.dnd-decor-fixed[data-id], .dnd-decor-text[data-id]');
        if (dc && gameContainer.contains(dc) && !seen['c:' + dc.getAttribute('data-id')]) {
          seen['c:' + dc.getAttribute('data-id')] = 1;
          if (!decor) decor = dc;
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
      // Zone SVG plus petite prioritaire si elle recouvre l’image fixe ; sinon l’image fixe.
      if (bestZone && decor && bestZone !== decor) {
        var zoneArea = linkNodeArea(bestZone);
        var decorArea = linkNodeArea(decor);
        if (zoneArea <= decorArea * 0.85) return bestZone;
        return decor;
      }
      if (decor) return decor;
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
      var decor = el.closest('.dnd-decor-fixed[data-id], .dnd-decor-text[data-id]');
      if (decor && gameContainer.contains(decor)) return decor;
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
      var w = (el.offsetWidth > 0) ? el.offsetWidth : (cssPxNumber(el.style && el.style.width) || 0);
      var h = (el.offsetHeight > 0) ? el.offsetHeight : (cssPxNumber(el.style && el.style.height) || 0);
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
      // Jeu DnD (hybrid) : hors zone de dépôt → la carte reste à sa place d’origine.
      // Relier pur : reposition libre autorisé pour que la flèche suive.
      if (!hybrid && htmlDragId && htmlDragLast && !htmlDragDropped
          && el && el.classList.contains('draggable') && !el.classList.contains('dnd-placed')) {
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
      // Dropzone : le DnD principal place la carte. Hors zone : pas de dépôt libre en hybrid.
      if (e.target && e.target.closest && e.target.closest('.dropzone')) return;
      if (hybrid) return;
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
      tip.style.cssText = 'position:absolute;z-index:20;pointer-events:none;display:none;max-width:360px;padding:10px 16px;border-radius:10px;background:rgba(30,30,30,0.92);color:#fff;font-size:20px;font-weight:600;line-height:1.35;box-shadow:0 4px 14px rgba(0,0,0,0.25);transform:none;white-space:pre-wrap;text-align:center;';
      gameContainer.appendChild(tip);
    }
    function showTip(text, x, y) {
      tip.textContent = text || '';
      if (!text) {
        tip.style.display = 'none';
        return;
      }
      tip.style.display = 'block';
      var maxW = gameContainer.clientWidth || 400;
      var maxH = gameContainer.clientHeight || 300;
      tip.style.left = '0px';
      tip.style.top = '0px';
      var tw = tip.offsetWidth || 220;
      var th = tip.offsetHeight || 40;
      var left = (typeof x === 'number' ? x : 0) + 16;
      var top = (typeof y === 'number' ? y : 0) + 20;
      if (left + tw > maxW - 8) left = x - tw - 12;
      if (top + th > maxH - 8) top = y - th - 12;
      left = Math.max(8, Math.min(maxW - tw - 8, left));
      top = Math.max(8, Math.min(maxH - th - 8, top));
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
      tip.style.transform = 'none';
    }
    function hideTip() { tip.style.display = 'none'; }
    function followTip(clientX, clientY, text) {
      var pt = localPoint(clientX, clientY);
      showTip(text || tipText(), pt.x, pt.y);
    }

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
          el.style.pointerEvents = 'auto';
        } else {
          el.classList.remove('dnd-link-node', 'dnd-link-from', 'dnd-selected');
          var isDecor = el.classList && (el.classList.contains('dnd-decor-fixed') || el.classList.contains('dnd-decor-text'));
          var isDropzone = el.classList && el.classList.contains('dropzone');
          if (isDropzone) {
            el.style.cursor = '';
            // syncZonesForStep repartira pointer-events ; laisser auto en attendant
            el.style.pointerEvents = 'auto';
          } else if (el.classList.contains('dnd-placed')) {
            el.draggable = false;
            el.style.cursor = 'pointer';
          } else if (el.classList.contains('draggable')) {
            if (el.classList.contains('used')) {
              el.draggable = false;
              el.style.cursor = 'not-allowed';
            } else {
              el.draggable = true;
              el.style.cursor = 'grab';
            }
          } else if (isDecor) {
            el.style.pointerEvents = hybrid ? 'none' : 'auto';
            el.style.cursor = hybrid ? '' : 'pointer';
            if (!hybrid) el.classList.add('dnd-link-node');
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
        var cx = (gameContainer.clientWidth || 200) / 2;
        var cy = Math.max(48, (gameContainer.clientHeight || 120) * 0.18);
        showTip(tipText(), cx, cy);
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

    function showingLinkFeedback(ev) {
      var showFb = feedbackMode === 'immediate' || verifiedOnce || (ev && ev.isComplete);
      if (typeof opts.getVerifiedOnce === 'function') {
        showFb = feedbackMode === 'immediate' || opts.getVerifiedOnce() || (ev && ev.isComplete);
      }
      return !!showFb;
    }

    function isLinkLocked(link) {
      return !canRemoveDrawnLink(game, link, showingLinkFeedback());
    }

    function removeLinkAt(index) {
      if (index < 0 || index >= links.length) return;
      if (isLinkLocked(links[index])) return;
      links.splice(index, 1);
      if (typeof opts.onChange === 'function') opts.onChange();
      else refreshStandalone();
    }

    function splineOptsForIndex(idx) {
      var l = links[idx];
      if (!l) return { sign: 1, rank: 0 };
      var from = String(l.from);
      var siblings = [];
      for (var i = 0; i < links.length; i++) {
        if (String(links[i].from) === from) siblings.push(i);
      }
      var origin = findNode(from) ? nodeCenter(findNode(from)) : null;
      siblings.sort(function (ia, ib) {
        var na = findNode(links[ia].to);
        var nb = findNode(links[ib].to);
        if (!origin || !na || !nb) return ia - ib;
        var a = nodeCenter(na);
        var b = nodeCenter(nb);
        return Math.atan2(a.y - origin.y, a.x - origin.x) - Math.atan2(b.y - origin.y, b.x - origin.x);
      });
      var pos = siblings.indexOf(idx);
      if (pos < 0) pos = 0;
      var lane = pos - (siblings.length - 1) / 2;
      return { sign: lane >= 0 ? 1 : -1, rank: Math.abs(lane) };
    }

    function makeSplineEl(tagClass, d, extra) {
      var el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('class', tagClass);
      el.setAttribute('d', d);
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('stroke-linejoin', 'round');
      if (extra) {
        Object.keys(extra).forEach(function (k) { el.setAttribute(k, extra[k]); });
      }
      return el;
    }

    function buildLinkRouteEntries(extra) {
      var peerCenterCache = {};
      function peerCenter(nodeId) {
        var key = String(nodeId);
        if (peerCenterCache[key]) return peerCenterCache[key];
        var n = findNode(key);
        peerCenterCache[key] = n ? nodeCenter(n) : null;
        return peerCenterCache[key];
      }
      var anchorSlots = computeLinkAnchorSlots(links, peerCenter);
      var entries = links.map(function (l, idx) {
        var a = findNode(l.from);
        var b = findNode(l.to);
        if (!a || !b) return null;
        var slot = anchorSlots[idx] || { fromSlot: 0, fromTotal: 1, toSlot: 0, toTotal: 1 };
        var cb0 = nodeCenter(b);
        var ca0 = nodeCenter(a);
        var ca = linkEndpointForNode(a, cb0.x, cb0.y, slot.fromSlot, slot.fromTotal);
        var cb = linkEndpointForNode(b, ca0.x, ca0.y, slot.toSlot, slot.toTotal);
        var o = splineOptsForIndex(idx);
        return { x1: ca.x, y1: ca.y, x2: cb.x, y2: cb.y, rank: o.rank, sign: o.sign };
      });
      if (extra) entries.push(extra);
      return entries;
    }

    function previewEndpoints(fromEl, targetEl) {
      var ca0 = nodeCenter(fromEl);
      if (!targetEl || targetEl === fromEl) {
        return { from: ca0, to: ca0 };
      }
      var cb0 = nodeCenter(targetEl);
      var toId = targetEl.getAttribute('data-id');
      var existingTo = 0;
      if (toId) {
        links.forEach(function (l) {
          if (String(l.to) === String(toId)) existingTo++;
        });
      }
      var fromPt = linkEndpointForNode(fromEl, cb0.x, cb0.y, 0, 1);
      var toPt = linkEndpointForNode(targetEl, ca0.x, ca0.y, existingTo, existingTo + 1);
      return { from: fromPt, to: toPt };
    }

    var linkPolylines = [];

    function drawLinks(ev) {
      Array.prototype.slice.call(svg.querySelectorAll('.dnd-link-line, .dnd-link-hit')).forEach(function (n) {
        n.parentNode.removeChild(n);
      });
      var showFb = showingLinkFeedback(ev);
      var entries = buildLinkRouteEntries();
      linkPolylines = layoutLinkRoutes(entries);
      links.forEach(function (l, idx) {
        var poly = linkPolylines[idx];
        if (!poly) return;
        var ok = isAllowedPair(l.from, l.to);
        var state = showFb ? (ok ? 'ok' : 'bad') : 'pending';
        var locked = state === 'ok';
        var d = linkPolylineToPath(poly);
        var colors = { pending: '#1565c0', ok: '#2e7d32', bad: '#d32f2f' };
        var line = makeSplineEl('dnd-link-line dnd-link-' + state, d, {
          'stroke-width': '4',
          stroke: colors[state] || colors.pending,
          'marker-end': 'url(#arrow-' + state + '-' + gameId + ')'
        });
        svg.appendChild(line);
        var hit = makeSplineEl('dnd-link-hit' + (locked ? ' dnd-link-hit-locked' : ''), d, {
          'stroke-width': '18',
          stroke: 'transparent',
          'data-locked': locked ? '1' : '0'
        });
        hit.style.pointerEvents = linkModeActive ? 'stroke' : 'none';
        hit.style.cursor = locked ? 'not-allowed' : 'pointer';
        (function (linkIndex, isLocked) {
          hit.addEventListener('pointerdown', function (e) {
            if (!linkModeActive) return;
            if (e.button != null && e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            if (isLocked) return;
            removeLinkAt(linkIndex);
          });
        })(idx, locked);
        svg.appendChild(hit);
      });
      if (dragState && dragState.line && !dragState.line.parentNode) svg.appendChild(dragState.line);
      svg.style.pointerEvents = (linkModeActive && links.length) ? 'auto' : 'none';
      Array.prototype.forEach.call(svg.querySelectorAll('.dnd-link-hit'), function (h) {
        h.style.pointerEvents = linkModeActive ? 'stroke' : 'none';
      });
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
        /* le tooltip reprend le suivi souris via pointermove */
      } else {
        hideTip();
      }
    }

    function previewRoutePath(x1, y1, x2, y2) {
      var candidates = generateLinkRouteCandidates(x1, y1, x2, y2, {});
      return pickBestRouteCandidate(candidates, linkPolylines.filter(Boolean));
    }

    function startDrag(fromEl, clientX, clientY) {
      var id = fromEl.getAttribute('data-id');
      if (!id) return;
      var c = nodeCenter(fromEl);
      var pt = localPoint(clientX, clientY);
      var previewPoly = previewRoutePath(c.x, c.y, pt.x, pt.y);
      var line = makeSplineEl('dnd-link-drag', linkPolylineToPath(previewPoly), {
        stroke: '#f59e0b',
        'stroke-width': '4',
        'stroke-dasharray': '8 6',
        'marker-end': 'url(#arrow-drag-' + gameId + ')'
      });
      line.style.pointerEvents = 'none';
      svg.appendChild(line);
      svg.style.pointerEvents = 'none';
      fromEl.classList.add('dnd-link-from', 'dnd-selected');
      dragState = { fromId: id, fromEl: fromEl, line: line, hoverEl: null };
      showTip(DRAW_LINK_TIP, pt.x, pt.y);
    }

    function moveDrag(clientX, clientY) {
      if (!dragState || !dragState.line) return;
      var pt = localPoint(clientX, clientY);
      // Survol léger (sans aimantation) : la flèche suit le curseur, pas les bords des cibles
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
      dragState.line.setAttribute('d', linkPolylineToPath(previewRoutePath(c0.x, c0.y, pt.x, pt.y)));
      showTip(DRAW_LINK_TIP, pt.x, pt.y);
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
        var ends = previewEndpoints(fromEl, target);
        if (dragState.line) {
          dragState.line.setAttribute('d', linkPolylineToPath(previewRoutePath(ends.from.x, ends.from.y, ends.to.x, ends.to.y)));
        }
        cancelDrag();
        addLink(fromId, toId);
      } else {
        cancelDrag();
      }
    }

    function hitTipFromEvent(e) {
      var t = e && e.target;
      if (!t) return null;
      var hit = null;
      if (t.classList && t.classList.contains('dnd-link-hit')) hit = t;
      else if (typeof t.closest === 'function') {
        try { hit = t.closest('.dnd-link-hit'); } catch (err) { hit = null; }
      }
      if (!hit) return null;
      return hit.getAttribute('data-locked') === '1' ? LOCKED_LINK_TIP : DELETE_LINK_TIP;
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
      if (linkModeActive && !dragState) {
        followTip(e.clientX, e.clientY, hitTipFromEvent(e) || tipText());
        return;
      }
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
    gameContainer.addEventListener('pointermove', onPointerMove, true);
    gameContainer.addEventListener('pointerup', onPointerUp);
    gameContainer.addEventListener('pointercancel', function () { cancelDrag(); });
    gameContainer.addEventListener('pointerleave', function () {
      if (!dragState && linkModeActive) hideTip();
    });

    allNodes().forEach(function (el) {
      var isDecorInit = el.classList && (el.classList.contains('dnd-decor-fixed') || el.classList.contains('dnd-decor-text'));
      if (isDecorInit || (el.hasAttribute && el.hasAttribute('data-link-node'))) {
        el.classList.add('dnd-link-node');
        if (!hybrid || isDecorInit) el.style.pointerEvents = hybrid && isDecorInit ? 'none' : 'auto';
      }
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

    // Relier pur : déplacement libre pour que la flèche suive. Hybrid → initPlayableDndGame gère dragstart.
    if (!hybrid) {
      Array.prototype.forEach.call(gameContainer.querySelectorAll('.draggable[data-id]'), function (img) {
        var id = img.getAttribute('data-id');
        if (!id || img.dataset.mqLinkFreeMove) return;
        img.dataset.mqLinkFreeMove = '1';
        img.addEventListener('dragstart', function (e) {
          if (linkModeActive) {
            e.preventDefault();
            return;
          }
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
    }

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
        var instructionsEl = findInstructionsEl(gameContainer);
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
      /** Pose des flèches sans validation ni son (test admin étape N). */
      seedLinks: function (pairs) {
        links = (pairs || []).map(function (l) {
          return { from: String(l.from), to: String(l.to) };
        }).filter(function (l) { return l.from && l.to && l.from !== l.to; });
        refreshStandalone();
      },
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

    var instructionsEl = findInstructionsEl(gameContainer);
    var instructionsText = String(game.instructions || '').trim();
    if (!instructionsText && game.showInstructions !== false) {
      instructionsText = 'Maintenez le clic droit sur une image et glissez jusqu’à l’arrivée.';
    }
    var showInstructions = game.showInstructions !== false && !!instructionsText;
    if (showInstructions && !instructionsEl) {
      instructionsEl = document.createElement('div');
      instructionsEl.className = 'dnd-instructions';
      instructionsEl.setAttribute('role', 'status');
    }
    if (instructionsEl) {
      if (showInstructions) mountInstructionsHud(instructionsEl, gameContainer);
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
    if (gamePeek.enableSteps) enrichStepsFromDropzones(gamePeek);
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
    var lastStepActivity = 'dnd';

    function isLinkModeOn() {
      if (!(linkingApi && linkingApi.isLinkModeActive && linkingApi.isLinkModeActive())) return false;
      // Étape dépôt (dnd ou mixte) : un mode flèche résiduel ne doit jamais bloquer drag/drop
      if (stepsEnabled && lastStepActivity !== 'linking') return false;
      return true;
    }

    var resultDiv = gameContainer.querySelector('.dnd-result') || gameContainer.querySelector('[id^="result"]');
    var scoreContainer = gameContainer.querySelector('.score-malus-container') ||
      gameContainer.querySelector('[id^="score-malus"]');
    var instructionsEl = findInstructionsEl(gameContainer);
    var stepsEnabled = !!(game.enableSteps && game.steps && game.steps.length);
    var lastStepIndex = -1;
    var lastActiveStepId = null;
    var manualStepDone = {};
    var showInstructions = game.showInstructions !== false;

    /** Marque les étapes 0..idx-1 comme faites et place le jeu sur l’étape idx (test admin). */
    function clearAllPlacementsQuiet() {
      Array.prototype.slice.call(gameContainer.querySelectorAll('.dropzone .dnd-placed')).forEach(function (n) {
        var id = n.getAttribute('data-id');
        var zone = n.closest('.dropzone');
        if (zone && id) removeFromZone(zone, id, true);
      });
      used.clear();
      if (linkingApi && linkingApi.seedLinks) linkingApi.seedLinks([]);
    }

    function pickAvailableCardId(ids) {
      for (var i = 0; i < (ids || []).length; i++) {
        var id = String(ids[i]);
        if (findOrig(id) && !findPlacedCard(id)) return id;
      }
      return null;
    }

    function pickCardForZoneConfig(zcfg, poolIds) {
      var pool = (poolIds && poolIds.length) ? poolIds : ((zcfg && zcfg.acceptedIds) || []);
      for (var i = 0; i < pool.length; i++) {
        var id = String(pool[i]);
        if (isCardAcceptedInZone(game, zcfg, id) && findOrig(id) && !findPlacedCard(id)) return id;
      }
      if (zcfg && zcfg.acceptedIds) {
        for (var j = 0; j < zcfg.acceptedIds.length; j++) {
          var id2 = String(zcfg.acceptedIds[j]);
          if (findOrig(id2) && !findPlacedCard(id2)) return id2;
        }
      }
      return null;
    }

    function findZoneElForCard(cardId) {
      var zones = game.dropzones || [];
      for (var i = 0; i < zones.length; i++) {
        if (!isCardAcceptedInZone(game, zones[i], cardId)) continue;
        var z = zoneById(zones[i].id);
        if (!z) continue;
        var cap = Math.max(1, parseInt(zones[i].capacity, 10) || 1);
        if (getZonePlacements(z).length < cap) return z;
      }
      return null;
    }

    function autoSeedStepDnd(step) {
      step = normalizeStep(step, 0);
      var zm = normalizeZoneMap(step.zoneMap);
      var zmKeys = Object.keys(zm).filter(Boolean);
      if (zmKeys.length) {
        zmKeys.forEach(function (zid) {
          var cardId = pickAvailableCardId(normalizeZoneMapIds(zm[zid]));
          if (!cardId) return;
          var zone = zoneById(zid);
          if (zone) placeInZone(zone, cardId, { allowMove: true, autoSeed: true, skipRefresh: true });
        });
        return;
      }
      var zoneIds = effectiveStepZoneIds(step);
      var goodIds = parseIdList(step.goodIds);
      if (zoneIds.length) {
        zoneIds.forEach(function (zid) {
          var zone = zoneById(zid);
          var zcfg = findZoneConfig(zid);
          if (!zone || !zcfg) return;
          var cardId = pickCardForZoneConfig(zcfg, goodIds);
          if (cardId) placeInZone(zone, cardId, { allowMove: true, autoSeed: true, skipRefresh: true });
        });
        return;
      }
      if (goodIds.length) {
        goodIds.forEach(function (cid) {
          var zone = findZoneElForCard(cid);
          if (zone) placeInZone(zone, cid, { allowMove: true, autoSeed: true, skipRefresh: true });
        });
      }
    }

    /** Simule les étapes précédentes : cartes dans leurs zones + flèches Relier. */
    function autoSeedPriorSteps(targetIdx) {
      if (!stepsEnabled || targetIdx <= 0) return;
      var steps = normalizeSteps(game.steps);
      var seedLinks = [];
      for (var si = 0; si < targetIdx && si < steps.length; si++) {
        var step = normalizeStep(steps[si], si);
        var act = step.activity || 'dnd';
        if (act === 'dnd' || act === 'both') autoSeedStepDnd(step);
        if (act === 'linking' || act === 'both') {
          (step.linkPairs || []).forEach(function (l) {
            if (l && l.from != null && l.to != null) {
              seedLinks.push({ from: String(l.from), to: String(l.to) });
            }
          });
        }
      }
      if (linkingApi && linkingApi.seedLinks && seedLinks.length) {
        linkingApi.seedLinks(seedLinks);
      }
    }

    function jumpToStep(stepIndex) {
      if (!stepsEnabled) return false;
      var steps = normalizeSteps(game.steps);
      if (!steps.length) return false;
      var idx = parseInt(stepIndex, 10);
      if (!isFinite(idx)) idx = 0;
      if (idx < 0) idx = 0;
      if (idx >= steps.length) idx = steps.length - 1;
      manualStepDone = {};
      for (var i = 0; i < idx; i++) {
        manualStepDone[String(steps[i].id)] = true;
      }
      lastActiveStepId = null;
      lastStepIndex = -1;
      if (syncRelierForStep) syncRelierForStep._stepKey = '';
      clearAllPlacementsQuiet();
      autoSeedPriorSteps(idx);
      refreshUI();
      return true;
    }

    function ensureInstructionsEl() {
      if (!instructionsEl) {
        instructionsEl = document.createElement('div');
        instructionsEl.className = 'dnd-instructions';
        instructionsEl.setAttribute('role', 'status');
        instructionsEl.setAttribute('aria-live', 'polite');
      }
      mountInstructionsHud(instructionsEl, gameContainer);
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

    function syncStepInstructions(st, opts) {
      if (!stepsEnabled || !st || !st.active) return;
      opts = opts || {};
      var act = st.active;
      var sid = String(act.id);
      if (!opts.force && sid === lastActiveStepId) return;
      var prevId = lastActiveStepId;
      lastActiveStepId = sid;
      lastStepIndex = st.currentIndex;
      setInstructionsContent(act.instructions || '', {
        pulse: opts.pulse !== false,
        stepLabel: stepInstructionLabel(act, st.currentIndex, st.steps.length)
      });
      highlightStepZones(act);
      if (prevId != null && prevId !== sid && typeof hooks.playSound === 'function') {
        try { hooks.playSound('ok'); } catch (e) {}
      }
    }

    function highlightStepZones(step) {
      var ids = step ? effectiveStepZoneIds(step) : [];
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
      st0.statuses.forEach(function (s, i) {
        var sid0 = String((st0.steps[i] && st0.steps[i].id) || i);
        if (manualStepDone[sid0]) {
          s.isComplete = true;
          s.needsManualNext = false;
        }
      });
      st0.allComplete = st0.statuses.every(function (s) { return s.isComplete; });
      if (st0.allComplete) {
        st0.currentIndex = st0.steps.length - 1;
      } else {
        st0.currentIndex = st0.statuses.findIndex(function (s) { return !s.isComplete; });
        if (st0.currentIndex < 0) st0.currentIndex = 0;
      }
      st0.active = st0.steps[st0.currentIndex] || null;
      st0.activeStatus = st0.statuses[st0.currentIndex] || null;
      syncStepInstructions(st0, { force: true, pulse: true });
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

    /** Affiche Relier si l’étape le demande ; étape Relier pure : activation auto, sans bouton. */
    function syncRelierForStep(st) {
      var btn = gameContainer.querySelector('.dnd-relier-btn');
      if (!btn && !linkingApi) return;
      var showBtn = false;
      var autoLink = false;
      var actName = 'dnd';
      if (linkingApi) {
        if (!stepsEnabled) {
          showBtn = !!game.enableLinking;
        } else if (st && st.enabled && !st.allComplete && st.active) {
          actName = normalizeStep(st.active, 0).activity || 'dnd';
          autoLink = stepAutoLinkMode(st.active);
          showBtn = !autoLink && stepNeedsRelier(st.active);
        }
      }
      if (btn) {
        btn.style.display = showBtn ? '' : 'none';
        btn.hidden = !showBtn;
        btn.setAttribute('aria-hidden', showBtn ? 'false' : 'true');
      }
      if (linkingApi && linkingApi.setLinkMode) {
        try {
          var stepKey = (st && st.active)
            ? (String(st.active.id) + '@' + String(st.currentIndex))
            : '';
          syncRelierForStep._stepKey = stepKey;
          if (autoLink) {
            if (!linkingApi.isLinkModeActive()) linkingApi.setLinkMode(true);
          } else {
            // Hors étape Relier auto : toujours couper le mode flèche (sinon DnD bloqué à l’étape suivante)
            linkingApi.setLinkMode(false);
          }
        } catch (e) {}
      }
      gameContainer.classList.toggle('dnd-step-relier-on', !!(autoLink || showBtn));
      gameContainer.classList.toggle('dnd-step-relier-auto', !!autoLink);
      // Filet de sécurité : hors Relier auto, la classe ne doit pas bloquer le pan / DnD
      if (!autoLink && actName !== 'linking') {
        gameContainer.classList.remove('dnd-link-mode');
      }
    }

    /** Cartes déposées : toujours opacité pleine (jamais grisées par l’étape ou la zone). */
    function syncPlacedCardsAppearance() {
      Array.prototype.forEach.call(gameContainer.querySelectorAll('.dropzone .dnd-placed'), function (clone) {
        clone.style.opacity = '1';
        clone.style.filter = 'none';
        clone.style.webkitFilter = 'none';
        clone.style.mixBlendMode = 'normal';
        clone.classList.remove('used', 'png-wrap');
        var img = clone.tagName === 'IMG' ? clone : clone.querySelector('img');
        if (img) {
          img.style.opacity = '1';
          img.style.filter = 'none';
          img.style.webkitFilter = 'none';
          img.style.mixBlendMode = 'normal';
          img.classList.remove('used');
        }
      });
    }

    /** Pendant une étape : masquer sources grisées, éléments des étapes futures, chrome zones hors étape. */
    function syncZonesForStep(st) {
      var linkingOnly = false;
      var hideUsedSources = false;
      var currentZoneIds = null;
      var ownership = null;
      var curIdx = 0;
      var hideFuture = false;
      if (stepsEnabled && st && st.active) {
        var act = normalizeStep(st.active, 0).activity;
        if (!st.allComplete) linkingOnly = act === 'linking';
        hideUsedSources = shouldHideUsedStepSources(st);
        curIdx = st.currentIndex;
        hideFuture = !st.allComplete;
        ownership = buildStepOwnership(game);
        if (!st.allComplete && !linkingOnly) {
          currentZoneIds = effectiveStepZoneIds(st.active);
          if (!currentZoneIds.length) currentZoneIds = null;
        }
      }
      var zoneIdSet = null;
      if (currentZoneIds && currentZoneIds.length) {
        zoneIdSet = {};
        currentZoneIds.forEach(function (id) { zoneIdSet[String(id)] = true; });
      }
      function applyFutureHidden(el, isFuture) {
        el.classList.toggle('dnd-step-future-hidden', !!isFuture);
        if (isFuture) {
          el.style.visibility = 'hidden';
          el.style.pointerEvents = 'none';
          el.setAttribute('aria-hidden', 'true');
        } else if (!el.classList.contains('dnd-step-source-hidden')) {
          el.style.visibility = '';
          if (el.classList.contains('draggable') || el.classList.contains('dnd-link-zone')) {
            el.style.pointerEvents = '';
          }
          el.removeAttribute('aria-hidden');
        }
      }
      var unlockedZoneCount = 0;
      Array.prototype.forEach.call(gameContainer.querySelectorAll('.dropzone'), function (z) {
        z.classList.toggle('dnd-step-locked', linkingOnly);
        z.style.removeProperty('opacity');
        var zid = String(z.getAttribute('data-zone-id') || '');
        var hideChrome = linkingOnly || !!(st && st.allComplete);
        if (hideFuture && ownership) {
          var zMin = ownership.zoneMinStep[zid];
          if (zMin != null && zMin > curIdx) hideChrome = true;
        }
        if (!hideChrome && zoneIdSet && st && st.currentIndex > 0) {
          hideChrome = !zoneIdSet[zid];
        }
        z.classList.toggle('dnd-step-zone-hidden', !!hideChrome);
        var peOff = linkingOnly || hideChrome;
        z.style.pointerEvents = peOff ? 'none' : 'auto';
        if (!peOff) unlockedZoneCount += 1;
      });
      // Filet : étape DnD dont les zoneIds ne matchent aucune dropzone → tout débloquer
      // (sinon l’élève voit le décor imprimé mais ne peut rien déposer)
      if (!linkingOnly && zoneIdSet && unlockedZoneCount === 0 && st && !st.allComplete) {
        Array.prototype.forEach.call(gameContainer.querySelectorAll('.dropzone'), function (z) {
          var zid = String(z.getAttribute('data-zone-id') || '');
          if (hideFuture && ownership) {
            var zMin2 = ownership.zoneMinStep[zid];
            if (zMin2 != null && zMin2 > curIdx) return;
          }
          z.classList.remove('dnd-step-zone-hidden', 'dnd-step-locked');
          z.style.pointerEvents = 'auto';
        });
      }
      // Couche cibles au-dessus des sources hors Relier : le DnD HTML5 rate souvent
      // les dropzones sous un parent pointer-events:none (couche #source).
      var targetsLayer = gameContainer.querySelector('[id^="targets"]');
      if (targetsLayer) {
        targetsLayer.style.pointerEvents = 'none';
        targetsLayer.style.zIndex = linkingOnly ? '7' : '10';
      }
      Array.prototype.forEach.call(gameContainer.querySelectorAll('.draggable'), function (el) {
        if (el.classList.contains('dnd-placed')) return;
        var id = String(el.getAttribute('data-id') || '');
        var isUsed = used.has(id) || el.classList.contains('used');
        var futureHide = !!(hideFuture && ownership && id && ownership.elementMinStep[id] != null && ownership.elementMinStep[id] > curIdx);
        var neededNow = !!(st && st.active && id && idsReferencedByStep(st.active)[id]);
        if (linkingOnly) {
          el.draggable = false;
          el.classList.add('dnd-step-link-phase');
        } else {
          el.classList.remove('dnd-step-link-phase');
          if (!(cardUse !== 'reusable' && used.has(id) && !neededNow)) {
            if (!el.classList.contains('used') || neededNow) el.draggable = true;
          }
        }
        if (futureHide) {
          el.classList.add('dnd-step-future-hidden');
          el.draggable = false;
          applyFutureHidden(el, true);
        } else if (hideUsedSources && isUsed && !neededNow) {
          el.classList.add('dnd-step-source-hidden');
          applyFutureHidden(el, false);
          el.style.visibility = 'hidden';
          el.style.pointerEvents = 'none';
          el.setAttribute('aria-hidden', 'true');
        } else {
          el.classList.remove('dnd-step-source-hidden', 'dnd-step-future-hidden');
          el.style.visibility = '';
          el.style.pointerEvents = 'auto';
          el.removeAttribute('aria-hidden');
          if (!linkingOnly && !futureHide && (!isUsed || neededNow)) {
            el.draggable = true;
            el.style.cursor = 'grab';
          }
        }
      });
      Array.prototype.forEach.call(gameContainer.querySelectorAll('.dnd-decor-fixed, .dnd-decor-text, .dnd-link-zone'), function (el) {
        var id = String(el.getAttribute('data-id') || '');
        if (!id) return;
        var futureHide = !!(hideFuture && ownership && ownership.elementMinStep[id] != null && ownership.elementMinStep[id] > curIdx);
        applyFutureHidden(el, futureHide);
        if (el.classList.contains('dnd-link-zone')) {
          el.style.pointerEvents = (futureHide || !isLinkModeOn()) ? 'none' : 'auto';
        }
      });
      // Les polygones SVG Relier (z-index 5) ne doivent pas intercepter le drop DnD hors mode Relier
      var linkLayer = gameContainer.querySelector('.dnd-link-zones-layer');
      if (linkLayer) {
        var blockLinkHit = !isLinkModeOn();
        linkLayer.style.pointerEvents = blockLinkHit ? 'none' : '';
        Array.prototype.forEach.call(linkLayer.querySelectorAll('.dnd-link-zone'), function (gEl) {
          if (gEl.classList.contains('dnd-step-future-hidden')) {
            gEl.style.pointerEvents = 'none';
          } else {
            gEl.style.pointerEvents = blockLinkHit ? 'none' : 'auto';
          }
        });
        Array.prototype.forEach.call(linkLayer.querySelectorAll('polygon, path, circle, rect'), function (shape) {
          if (blockLinkHit) shape.setAttribute('pointer-events', 'none');
          else if (shape.classList && shape.classList.contains('lz-fill')) shape.setAttribute('pointer-events', 'all');
        });
      }
      Array.prototype.forEach.call(gameContainer.querySelectorAll('.dnd-decor-fixed[data-id], .dnd-decor-text[data-id]'), function (el) {
        var hit = !!(linkingOnly || isLinkModeOn()) && !el.classList.contains('dnd-step-future-hidden');
        el.style.pointerEvents = hit ? 'auto' : 'none';
        if (hit) el.classList.add('dnd-link-node');
        else el.classList.remove('dnd-link-node');
      });
    }

    function sourceRoot() {
      return gameContainer.querySelector('[id^="source"]') || gameContainer;
    }

    function findOrig(id) {
      return sourceRoot().querySelector('.draggable[data-id="' + cssEscape(id) + '"]:not(.dnd-placed)');
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
        if (n.classList && n.classList.contains('dnd-placed')) n.remove();
      });
      if (reactivate !== false) setUsed(cardId, false);
      zone.classList.remove('dropzone-correct', 'dropzone-wrong');
      if (typeof clearZoneFeedbackPaint === 'function') clearZoneFeedbackPaint(zone);
      else if (zone && zone.style) {
        zone.style.removeProperty('background');
        zone.style.removeProperty('border');
        zone.style.removeProperty('box-shadow');
      }
      if (!getZonePlacements(zone).length) zone.classList.remove('dnd-has-card');
    }

    /** Clone déjà posé de cette carte (pour un déplacement zone → zone). */
    function findPlacedCard(cardId) {
      var sid = String(cardId);
      var nodes = gameContainer.querySelectorAll('.dropzone .dnd-placed[data-id]');
      for (var i = 0; i < nodes.length; i++) {
        if (String(nodes[i].getAttribute('data-id')) === sid) return nodes[i];
      }
      return null;
    }

    /** Carte déposée : centrée dans la zone, au-dessus du fond (sans couper l’image source). */
    function layoutPlacedCardInZone(clone) {
      if (!clone) return;
      clone.style.position = 'absolute';
      clone.style.inset = '0';
      clone.style.left = '0';
      clone.style.top = '0';
      clone.style.right = '0';
      clone.style.bottom = '0';
      clone.style.width = '100%';
      clone.style.height = '100%';
      clone.style.maxWidth = '100%';
      clone.style.maxHeight = '100%';
      clone.style.margin = '0';
      clone.style.zIndex = '3';
      clone.style.display = 'flex';
      clone.style.alignItems = 'center';
      clone.style.justifyContent = 'center';
      clone.style.boxSizing = 'border-box';
      clone.style.padding = '2px';
      clone.style.pointerEvents = 'auto';
      clone.style.overflow = 'visible';
      clone.style.opacity = '1';
      clone.style.filter = 'none';
      clone.style.mixBlendMode = 'normal';
      clone.style.webkitFilter = 'none';
      var img = clone.tagName === 'IMG' ? clone : clone.querySelector('img');
      if (img) {
        img.style.position = 'static';
        img.style.left = 'auto';
        img.style.top = 'auto';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.maxWidth = '100%';
        img.style.maxHeight = '100%';
        img.style.objectFit = 'contain';
        img.style.flexShrink = '0';
        img.style.opacity = '1';
        img.style.filter = 'none';
        img.style.webkitFilter = 'none';
        img.style.mixBlendMode = 'normal';
        img.classList.remove('used');
      }
    }

    function bindPlacedCardInteractions(clone, zone, id) {
      function onRemove() {
        removeFromZone(zone, id, true);
        clearSelection();
        refreshUI();
      }

      clone.addEventListener('click', function (e) {
        if (isLinkModeOn()) return;
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
        if (isLinkModeOn()) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onRemove();
        }
      });

      // Mode retry / unique : glisser une mauvaise carte vers une autre zone
      if (clone.draggable || clone.classList.contains('dnd-retry-movable')) {
        clone.addEventListener('dragstart', function (e) {
          if (isLinkModeOn()) {
            e.preventDefault();
            return;
          }
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
          // La carte a pu être déplacée (nœud retiré) : ne pas toucher un nœud détaché
          if (clone.isConnected) clone.style.opacity = '1';
          if (linkingApi && linkingApi.endCardDrag) linkingApi.endCardDrag(id, clone.isConnected ? clone : null);
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

      // Étapes : pendant Relier pur, pas de dépôt.
      // Important : utiliser lastStepActivity (mis à jour par refreshUI avec les flèches),
      // pas getStepsState(collectPlacements) sans links — sinon après Relier le dépôt
      // croit encore être en étape linking et refuse toutes les cartes.
      if (stepsEnabled && !opts.autoSeed && lastStepActivity === 'linking') {
        return false;
      }

      var existingPlaced = findPlacedCard(id);
      var orig = findOrig(id);
      if (!orig && !existingPlaced) return false;

      var capacity = Math.max(1, parseInt(zcfg.capacity, 10) || 1);
      var current = getZonePlacements(zone);

      // Déjà dans cette zone : ne rien faire (évite un remove+recreate qui « fait disparaître »)
      if (current.indexOf(id) >= 0) return false;

      if (current.length >= capacity) {
        if (capacity === 1) {
          var oldId = current[0];
          removeFromZone(zone, oldId, true);
        } else {
          return false;
        }
      }

      var correctHere = isCardAcceptedInZone(game, zcfg, id);
      // Cloner d’abord (depuis la carte posée ou la source), puis retirer l’ancienne —
      // sinon le drag HTML5 retire la source en cours de drop → image disparue.
      var proto = existingPlaced || orig;
      var clone = proto.cloneNode(true);
      clone.classList.remove(
        'draggable', 'used', 'dnd-selected', 'dnd-retry-movable', 'png-wrap',
        'dnd-step-source-hidden', 'dnd-step-future-hidden', 'dnd-step-link-phase'
      );
      clone.classList.add('dnd-placed');
      clone.classList.add('dnd-link-node');
      clone.removeAttribute('draggable');
      clone.removeAttribute('aria-hidden');
      clone.style.visibility = '';
      clone.style.pointerEvents = 'auto';

      // Carte incorrecte : toujours repositionnable (unique + retry) pour retenter
      var movable = !correctHere;
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
      layoutPlacedCardInZone(clone);
      clone.setAttribute('tabindex', '0');
      clone.setAttribute('role', 'button');

      bindPlacedCardInteractions(clone, zone, id);

      zone.classList.add('dnd-has-card');
      zone.appendChild(clone);

      // Retirer les autres occurrences après insertion (déplacement zone → zone)
      if (isSingleUse(cardUse) || existingPlaced) {
        Array.prototype.forEach.call(gameContainer.querySelectorAll('.dropzone'), function (oz) {
          if (oz === zone) return;
          if (getZonePlacements(oz).indexOf(id) >= 0) {
            removeFromZone(oz, id, false);
          }
        });
      }

      if (isSingleUse(cardUse)) setUsed(id, true);
      clearSelection();
      if (linkingApi && linkingApi.markCardDropped) linkingApi.markCardDropped();

      // Malus à chaque dépôt incorrect (tous modes), y compris repositionnements
      var flashOk = null;
      if (!opts.autoSeed) {
        if (!correctHere) {
          nbErreurs += 1;
          if (feedbackMode === 'immediate') {
            applyZoneFeedback(zone, zcfg, true);
            flashOk = false;
            if (typeof hooks.playSound === 'function') hooks.playSound('error');
            if (typeof hooks.showFloating === 'function') hooks.showFloating(zone, 'error');
          }
        } else if (feedbackMode === 'immediate') {
          applyZoneFeedback(zone, zcfg, true);
          flashOk = true;
          if (typeof hooks.playSound === 'function') hooks.playSound('success');
          if (typeof hooks.showFloating === 'function') hooks.showFloating(zone, 'success');
        }
      }

      if (!opts.skipRefresh) refreshUI();
      // Flash après refreshUI pour que l’animation ne soit pas écrasée
      if (flashOk != null && !opts.autoSeed) pulseZoneFlash(zone, flashOk);
      return true;
    }

    /** Flash court rouge/vert sur la zone au moment du dépôt. */
    function pulseZoneFlash(zone, ok) {
      if (!zone) return;
      zone.classList.remove('dnd-zone-flash-ok', 'dnd-zone-flash-bad');
      try { void zone.offsetWidth; } catch (e) { /* ignore */ }
      zone.classList.add(ok ? 'dnd-zone-flash-ok' : 'dnd-zone-flash-bad');
      setTimeout(function () {
        zone.classList.remove('dnd-zone-flash-ok', 'dnd-zone-flash-bad');
      }, 650);
    }

    function clearZoneFeedbackPaint(zone) {
      if (!zone || !zone.style) return;
      zone.style.removeProperty('background');
      zone.style.removeProperty('border');
      zone.style.removeProperty('border-color');
      zone.style.removeProperty('box-shadow');
    }

    function paintZoneFeedback(zone, kind) {
      if (!zone || !zone.style) return;
      if (kind === 'wrong') {
        zone.style.setProperty('background', 'rgba(244, 67, 54, 0.20)', 'important');
        zone.style.setProperty('border', '3px solid rgba(211, 47, 47, 0.75)', 'important');
        zone.style.setProperty('box-shadow', 'inset 0 0 0 1px rgba(244, 67, 54, 0.25)', 'important');
      } else if (kind === 'correct') {
        zone.style.setProperty('background', 'rgba(76, 175, 80, 0.22)', 'important');
        zone.style.setProperty('border', '3px solid rgba(56, 142, 60, 0.75)', 'important');
        zone.style.setProperty('box-shadow', 'inset 0 0 0 1px rgba(76, 175, 80, 0.25)', 'important');
      } else {
        clearZoneFeedbackPaint(zone);
      }
    }

    function applyZoneFeedback(zone, zcfg, force) {
      if (feedbackMode === 'deferred' && !verifiedOnce && !force) {
        zone.classList.remove('dropzone-correct', 'dropzone-wrong');
        clearZoneFeedbackPaint(zone);
        return;
      }
      var ids = getZonePlacements(zone);
      zone.classList.remove('dropzone-correct', 'dropzone-wrong');
      if (!ids.length) {
        clearZoneFeedbackPaint(zone);
        return;
      }
      var ev = evaluateZone(game, zcfg, ids);
      if (ev.hasWrong) {
        zone.classList.add('dropzone-wrong');
        paintZoneFeedback(zone, 'wrong');
      } else if (ev.correctCount > 0) {
        zone.classList.add('dropzone-correct');
        paintZoneFeedback(zone, 'correct');
      } else {
        clearZoneFeedbackPaint(zone);
      }
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

        syncStepInstructions(st);
        if (st.active && String(st.active.id) === lastActiveStepId) {
          highlightStepZones(st.active);
        }
        syncStepNextBtn(st);
        lastStepActivity = st.active
          ? (normalizeStep(st.active, 0).activity || 'dnd')
          : 'dnd';
        syncRelierForStep(st);
        syncZonesForStep(st);
        syncPlacedCardsAppearance();
        ev.stepsState = st;
        ev.isComplete = st.allComplete;
      } else {
        lastStepActivity = 'dnd';
        stepsComplete = !!ev.isComplete;
        syncRelierForStep(null);
        syncZonesForStep(null);
        syncPlacedCardsAppearance();
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
        if (z && gameContainer.contains(z)
          && !z.classList.contains('dnd-step-locked')
          && !z.classList.contains('dnd-step-zone-hidden')) return z;
      }
      // Repli géométrique : SVG Relier / pointer-events parent peuvent masquer la dropzone
      var hit = null;
      var hitArea = Infinity;
      Array.prototype.forEach.call(gameContainer.querySelectorAll('.dropzone'), function (z) {
        if (z.classList.contains('dnd-step-locked') || z.classList.contains('dnd-step-zone-hidden')) return;
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
    var startAt = hooks.startAtStep;
    if (startAt == null && gameConfig && gameConfig._startAtStep != null) {
      startAt = gameConfig._startAtStep;
    }
    if (startAt != null && stepsEnabled) {
      jumpToStep(startAt);
    }
    hooks.onScore = scoreHook;
    if (typeof hooks.onReady === 'function') {
      hooks.onReady({
        gameId: gameId,
        maxScore: computeGameMaxScore(game)
      });
    }

    return {
      refresh: refreshUI,
      jumpToStep: jumpToStep,
      getCurrentStepIndex: function () {
        if (!stepsEnabled) return 0;
        var p = collectPlacements(gameContainer, game);
        if (linkingApi) p.links = linkingApi.getLinks();
        var st = getStepsState(game, p);
        st.statuses.forEach(function (s, i) {
          var sid = String((st.steps[i] && st.steps[i].id) || i);
          if (manualStepDone[sid]) {
            s.isComplete = true;
            s.needsManualNext = false;
          }
        });
        st.allComplete = st.statuses.every(function (s) { return s.isComplete; });
        if (st.allComplete) return Math.max(0, st.steps.length - 1);
        var ci = st.statuses.findIndex(function (s) { return !s.isComplete; });
        return ci < 0 ? 0 : ci;
      },
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

  /**
   * Pendant le drag HTML5 d’une carte DnD : si le pointeur approche un bord
   * du viewport, défile le plan (pan) dans cette direction.
   * opts.getRect() → DOMRect du viewport visible
   * opts.panBy(dx, dy) → applique le décalage écran (px)
   */
  function attachDragEdgePan(opts) {
    opts = opts || {};
    var getRect = opts.getRect;
    var panBy = opts.panBy;
    var isCard = opts.isCardDrag;
    var margin = opts.margin != null ? Number(opts.margin) : 88;
    var maxSpeed = opts.maxSpeed != null ? Number(opts.maxSpeed) : 18;
    if (typeof getRect !== 'function' || typeof panBy !== 'function') {
      return { detach: function () {} };
    }
    if (margin < 24) margin = 24;
    if (maxSpeed < 4) maxSpeed = 4;

    var active = false;
    var px = 0;
    var py = 0;
    var havePos = false;
    var raf = 0;
    var lastTs = 0;

    function defaultIsCard(e) {
      var t = e && e.target;
      if (!t || !t.closest) return false;
      return !!t.closest('.drag-game .draggable, .drag-game .dnd-placed, .drag-game .png-wrap, .dnd-game-container .draggable, .dnd-game-container .png-wrap');
    }

    function edgeDelta(dist) {
      if (dist >= margin) return 0;
      if (dist < 0) dist = 0;
      var u = 1 - dist / margin;
      return u * u * maxSpeed;
    }

    function tick(ts) {
      raf = 0;
      if (!active) return;
      if (!lastTs) lastTs = ts;
      var dt = Math.min(32, ts - lastTs) / 16.67;
      lastTs = ts;
      if (havePos) {
        var rect = getRect();
        if (rect && rect.width > 8 && rect.height > 8) {
          var dx = 0;
          var dy = 0;
          var left = px - rect.left;
          var right = rect.right - px;
          var top = py - rect.top;
          var bottom = rect.bottom - py;
          if (left < margin) dx = edgeDelta(left);
          else if (right < margin) dx = -edgeDelta(right);
          if (top < margin) dy = edgeDelta(top);
          else if (bottom < margin) dy = -edgeDelta(bottom);
          if (dx || dy) panBy(dx * dt, dy * dt);
        }
      }
      raf = requestAnimationFrame(tick);
    }

    function start(e) {
      var ok = typeof isCard === 'function' ? isCard(e) : defaultIsCard(e);
      if (!ok) return;
      active = true;
      lastTs = 0;
      havePos = e.clientX != null && (e.clientX !== 0 || e.clientY !== 0);
      if (havePos) {
        px = e.clientX;
        py = e.clientY;
      }
      if (!raf) raf = requestAnimationFrame(tick);
    }

    function onMove(e) {
      if (!active) return;
      if (e.clientX === 0 && e.clientY === 0) return;
      px = e.clientX;
      py = e.clientY;
      havePos = true;
    }

    function stop() {
      active = false;
      havePos = false;
      lastTs = 0;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }

    document.addEventListener('dragstart', start, true);
    document.addEventListener('dragover', onMove, true);
    document.addEventListener('drag', onMove, true);
    document.addEventListener('dragend', stop, true);
    document.addEventListener('drop', stop, true);

    return {
      detach: function () {
        stop();
        document.removeEventListener('dragstart', start, true);
        document.removeEventListener('dragover', onMove, true);
        document.removeEventListener('drag', onMove, true);
        document.removeEventListener('dragend', stop, true);
        document.removeEventListener('drop', stop, true);
      }
    };
  }

  return {
    MQ_DND_MAX_ZONES: MQ_DND_MAX_ZONES,
    GAME_TYPES: GAME_TYPES,
    parseIdList: parseIdList,
    cssPxNumber: cssPxNumber,
    htmlStyleBox: htmlStyleBox,
    normalizeGameType: normalizeGameType,
    normalizeFeedbackMode: normalizeFeedbackMode,
    normalizeCardUse: normalizeCardUse,
    normalizeLinkMode: normalizeLinkMode,
    normalizeAllowedLinks: normalizeAllowedLinks,
    allowedLinksToText: allowedLinksToText,
    effectiveAllowedLinks: effectiveAllowedLinks,
    linkSplinePath: linkSplinePath,
    linkPolylineToPath: linkPolylineToPath,
    layoutLinkRoutes: layoutLinkRoutes,
    countPolylineCrossings: countPolylineCrossings,
    generateLinkRouteCandidates: generateLinkRouteCandidates,
    linkAnchorPoint: linkAnchorPoint,
    computeLinkAnchorSlots: computeLinkAnchorSlots,
    polygonCentroidFromPointsAttr: polygonCentroidFromPointsAttr,
    isSingleUse: isSingleUse,
    normalizeDropzone: normalizeDropzone,
    applyGameDefaults: applyGameDefaults,
    dragShowsTooltip: dragShowsTooltip,
    migrateDraggableTooltips: migrateDraggableTooltips,
    applyStepZoneMapsToDropzones: applyStepZoneMapsToDropzones,
    isCardAcceptedInZone: isCardAcceptedInZone,
    usesZoneAcceptedIds: usesZoneAcceptedIds,
    evaluateZone: evaluateZone,
    evaluateGame: evaluateGame,
    evaluateLinks: evaluateLinks,
    canRemoveDrawnLink: canRemoveDrawnLink,
    computeGameScore: computeGameScore,
    computeGameMaxScore: computeGameMaxScore,
    generateGrid: generateGrid,
    syncDropzonesToTargetCount: syncDropzonesToTargetCount,
    migrateLegacyGame: migrateLegacyGame,
    initPlayableDndGame: initPlayableDndGame,
    initPlayableLinkingGame: initPlayableLinkingGame,
    attachLinkingFeature: attachLinkingFeature,
    attachDragEdgePan: attachDragEdgePan,
    collectPlacements: collectPlacements,
    hasLinkingFeature: hasLinkingFeature,
    gameNeedsRelier: gameNeedsRelier,
    gameHasRelierStep: gameHasRelierStep,
    migrateLegacyLinkingToSteps: migrateLegacyLinkingToSteps,
    computeDndBaseMaxScore: computeDndBaseMaxScore,
    normalizeStep: normalizeStep,
    normalizeZoneMap: normalizeZoneMap,
    normalizeZoneMapIds: normalizeZoneMapIds,
    normalizeSteps: normalizeSteps,
    normalizeStepActivity: normalizeStepActivity,
    stepNeedsRelier: stepNeedsRelier,
    stepAutoLinkMode: stepAutoLinkMode,
    shouldHideUsedStepSources: shouldHideUsedStepSources,
    idsReferencedByStep: idsReferencedByStep,
    buildStepOwnership: buildStepOwnership,
    minStepIndexForElement: minStepIndexForElement,
    minStepIndexForZone: minStepIndexForZone,
    isElementVisibleAtStep: isElementVisibleAtStep,
    isZoneVisibleAtStep: isZoneVisibleAtStep,
    evaluateStep: evaluateStep,
    linksForStepEvaluation: linksForStepEvaluation,
    getStepsState: getStepsState,
    effectiveStepZoneIds: effectiveStepZoneIds,
    enrichStepsFromDropzones: enrichStepsFromDropzones,
    stepInstructionLabel: stepInstructionLabel,
    normalizeInstructionsBox: normalizeInstructionsBox,
    normalizeScoreBox: normalizeScoreBox,
    applyInstructionsBoxToElement: applyInstructionsBoxToElement,
    findInstructionsHudHost: findInstructionsHudHost,
    findInstructionsEl: findInstructionsEl,
    mountInstructionsHud: mountInstructionsHud,
    clearInstructionsHud: clearInstructionsHud,
    attachInstructionsFocusGuard: attachInstructionsFocusGuard,
    attachInstructionsHudLayoutSync: attachInstructionsHudLayoutSync,
    syncInstructionsHudLayout: syncInstructionsHudLayout,
    measureControlsOffset: measureControlsOffset,
    setInstructionsHudActive: setInstructionsHudActive,
    eventHitsDndGame: eventHitsDndGame,
    pointInRect: pointInRect,
    normalizeRelierBtn: normalizeRelierBtn,
    applyRelierBtnLayout: applyRelierBtnLayout,
    relierLogoSvg: relierLogoSvg,
    normalizeLinkZone: normalizeLinkZone,
    normalizeLinkZones: normalizeLinkZones,
    linkZoneBBox: linkZoneBBox
  };
});
