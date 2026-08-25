/* script_fixed_v2.js - PAN + Hotspots + Inputs + DnD with score+malus
   Key behaviors:
   - PAN/ZOOM works but never blocks DnD, inputs, hotspots (PAN starts after a small movement threshold on background only)
   - SVG hotspots (data-image/data-tooltip) light up the image referenced by data-image (e.g., sciure.png)
   - Inputs (via .input-wrapper) also light up images (data-image) and show tooltip
   - DnD restores score + malus display (malus = 0.5 per wrong drop)
   - admin=true (or prof=true) enables PDF button
*/

(() => {
  'use strict';

  /** Moodle / iframe : évite position:fixed + 100vh qui cassent le visuel */
  function applyEmbedMode() {
    try {
      const q = new URLSearchParams(window.location.search);
      const forced = q.get('embed') === '1' || q.has('embed');
      const inIframe = window.self !== window.top;
      if (forced || inIframe) {
        document.documentElement.setAttribute('data-embed', '1');
      }
    } catch (_) {
      document.documentElement.setAttribute('data-embed', '1');
    }
  }
  applyEmbedMode();

  // -----------------------
  // AUDIO ENGINE (Générateur de sons)
  // -----------------------
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  function playSound(type) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;

    if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    }
    else if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.linearRampToValueAtTime(100, now + 0.15);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
    }
  }

  // -----------------------
  // 2. MOTEUR VISUEL (CSS Injections)
  // -----------------------
  function injectGamificationStyles() {
    if (document.getElementById('gamification-styles')) return;
    const style = document.createElement('style');
    style.id = 'gamification-styles';
    style.innerHTML = `
      @keyframes successPop { 0% { transform: scale(1); } 50% { transform: scale(1.1); box-shadow: 0 0 20px rgba(76, 175, 80, 0.5); border-color: #2e7d32; } 100% { transform: scale(1); } }
      @keyframes shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
      @keyframes floatUpFade { 0% { transform: translate(-50%, 0) scale(1); opacity: 1; } 100% { transform: translate(-50%, -50px) scale(1); opacity: 0; } }
      .input-success-anim { animation: successPop 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important; background-color: #c8e6c9 !important; color: #1b5e20 !important; border: 2px solid #2e7d32 !important; font-weight: bold !important; }
      .shake { animation: shake 0.4s ease-in-out; border-color: #d32f2f !important; box-shadow: 0 0 8px rgba(211, 47, 47, 0.4); }
      .input-error { background-color: #ffcdd2 !important; border: 2px solid #c62828 !important; }
      .input-partial { background-color: #ffe0b2 !important; border: 2px solid #ef6c00 !important; }
      .floating-feedback { position: fixed; pointer-events: none; z-index: 10000; font-weight: 900; font-size: 28px; color: #2e7d32; text-shadow: 1px 1px 0 #fff; animation: floatUpFade 0.8s ease-out forwards; }
      .floating-feedback.is-bad { color: #c62828; }
    `;
    document.head.appendChild(style);
  }

  function showFloatingFeedback(boxElement, kind) {
    if (!boxElement || !boxElement.getBoundingClientRect) return;
    const ok = kind !== 'error' && kind !== 'wrong' && kind !== false;
    const rect = boxElement.getBoundingClientRect();
    const el = document.createElement('div');
    el.classList.add('floating-feedback');
    el.classList.add(ok ? 'is-ok' : 'is-bad');
    el.textContent = ok ? '+1 🌟' : '✗';
    const x = rect.left + (rect.width / 2);
    const y = rect.top;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }


  // -----------------------
  // Global scores
  // -----------------------
  window.dndScores = {};
  window.dndMaxScores = {};
  window.game1Score = 0;
  window.game2Score = 0;
  window.__mqAllowMoodleScore = false;

  let scoreTimeout = null;

  /** HTTP ↔ HTTPS : aligne une URL absolue sur le protocole de la page Moodle parente */
  function mqAlignUrlToMoodleProtocol(url) {
    if (!url || typeof url !== 'string') return url;
    let parentProto = window.location.protocol;
    try {
      if (window.parent && window.parent.location && window.parent.location.protocol) {
        parentProto = window.parent.location.protocol;
      }
    } catch (_) { /* cross-origin */ }
    if (!/^https?:\/\//i.test(url)) return url;
    try {
      const u = new URL(url, window.location.href);
      if (parentProto === 'https:') u.protocol = 'https:';
      else if (parentProto === 'http:') u.protocol = 'http:';
      return u.href;
    } catch (_) {
      return url.replace(/^https:/i, 'http:').replace(/^http:/i, parentProto === 'https:' ? 'https:' : 'http:');
    }
  }

  /** Envoie Moodle : HTTP(S) uniquement (pas file:// ni ouverture locale du HTML exporté). */
  function mqCanSendMoodleScore() {
    if (!window.__mqAllowMoodleScore) return false;
    var proto = window.location.protocol;
    if (proto !== 'http:' && proto !== 'https:') return false;
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.has('admin') || params.has('prof')) return false;
    } catch (_) { /* ignore */ }
    return true;
  }

  function envoyerScoreAMoodle(scoreFinal) {
    if (!mqCanSendMoodleScore()) return;
    let finalCourseId = 1; // ID du cours Moodle (très important pour le contexte)
    let finalCmid = 1;     // ID du module

    // 1. Essai de récupération propre depuis les paramètres de l'iframe locale
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('courseid') || urlParams.has('id')) {
      finalCourseId = urlParams.get('courseid') || urlParams.get('id');
      finalCmid = urlParams.get('cmid') || urlParams.get('id');
    } else {
      // En cas d'iframe sans paramètre, on fouille dans le parent
      try {
        if (window.parent && window.parent.M && window.parent.M.cfg) {
          // Moodle expose le courseId ! C'est ce qu'il nous faut pour l'event et l'API
          if (window.parent.M.cfg.courseId) {
            finalCourseId = window.parent.M.cfg.courseId;
          }
        }
        // Et on prend l'ID de l'URL parent comme cmid
        const parentUrlParams = new URLSearchParams(window.parent.location.search);
        if (parentUrlParams.has('id')) {
          finalCmid = parentUrlParams.get('id');
        }
      } catch (e) {
        console.warn("Impossible d'accéder à window.parent (Cross-Origin ou non embarqué)");
      }
    }

    const nomExercice = document.title || "Synthese";

    // Essayer de trouver l'URL racine et la sesskey (clé de session Moodle) de l'application parent
    let wwwroot = '';
    let sesskey = '';

    try {
      if (window.parent && window.parent.M && window.parent.M.cfg) {
        wwwroot = window.parent.M.cfg.wwwroot;
        sesskey = window.parent.M.cfg.sesskey;
      }
    } catch (e) {
      console.warn("Impossible d'accéder à la config Moodle du parent.");
    }

    if (wwwroot && sesskey) {
      wwwroot = mqAlignUrlToMoodleProtocol(wwwroot);
      // Option 1 : Moodle External API Web Service
      const wsUrl = wwwroot + '/lib/ajax/service.php?sesskey=' + sesskey + '&info=local_suivisynthese_save_score';
      const payload = [{
        index: 0,
        methodname: 'local_suivisynthese_save_score',
        args: {
          courseid: parseInt(finalCourseId, 10),
          pagename: nomExercice,
          score: parseFloat(scoreFinal)
        }
      }];

      fetch(wsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // <-- IMPORTANT: envoie les cookies de session Moodle
        body: JSON.stringify(payload)
      })
        .then(r => r.json())
        .then(data => {
          if (data[0] && !data[0].error) {
            console.log("Victoire ! Moodle External API a sauvegardé en BDD le score :", scoreFinal);
          } else {
            console.error("Erreur de Web Service Moodle. Réponse brute :", data);
          }
        })
        .catch(e => console.error("Erreur de connexion WS Moodle :", e));

    } else {
      // Option 2 (Fallback) : L'ancien script PHP au cas où
      // (ex. si on est à la racine de Moodle en accès direct non iframe)
      const payload = {
        courseid: parseInt(finalCourseId, 10),
        pagename: nomExercice,
        score: parseFloat(scoreFinal)
      };

      // Si l'URL actuelle ou du parent contient moodle_V4 (ex. hébergement réel)
      // on tente de s'ajuster, sinon on tape relative
      let scriptUrl = '/local/suivisynthese/ajax_score.php';
      let moodleDir = '';

      try {
        const match = window.parent.location.pathname.match(/\/(moodle[^/]+)/i);
        if (match) moodleDir = '/' + match[1];
      } catch (e) { }

      if (!moodleDir) {
        const match2 = window.location.pathname.match(/\/(moodle[^/]+)/i);
        if (match2) moodleDir = '/' + match2[1];
      }

      scriptUrl = moodleDir + '/local/suivisynthese/ajax_score.php';
      if (/^https?:\/\//i.test(window.location.origin)) {
        scriptUrl = window.location.origin + scriptUrl;
      }

      fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // <-- IMPORTANT: envoie les cookies de session Moodle
        body: JSON.stringify(payload)
      })
        .then(r => r.json())
        .then(data => {
          if (data.status === 'success') {
            console.log("Victoire ! L'ancien script PHP a sauvegardé en BDD le score :", scoreFinal);
          } else {
            console.error("Moodle signale une erreur depuis l'ancien script :", data.message || data.error || data);
          }
        })
        .catch(e => console.error("Erreur de connexion script Moodle :", e));
    }
  }

  function updateGlobalScore() {
    const scoreDisplay = document.getElementById('score');
    const totalDisplay = document.getElementById('total-score');

    // Calcul du score
    let totalPoints = 0;
    const dndMap = window.dndScores || {};
    Object.keys(dndMap).forEach(function (k) { totalPoints += (dndMap[k] || 0); });
    if (!Object.keys(dndMap).length) {
      totalPoints += window.game1Score || 0;
      totalPoints += window.game2Score || 0;
    }

    const allInputs = document.querySelectorAll('input[type="text"], textarea');
    allInputs.forEach(input => {
      // On compte comme bon si la classe 'correct' est présente (ajoutée par initTextInputs)
      if (input.classList.contains('correct') || input.classList.contains('input-success-anim')) {
        totalPoints += 1;
      }
    });

    // Affichage texte
    if (scoreDisplay) scoreDisplay.textContent = String(totalPoints);

    // Calcul total pour la barre
    let maxPoints = allInputs.length;
    const dndMaxMap = window.dndMaxScores || {};
    let maxDnD = 0;
    Object.keys(dndMaxMap).forEach(function (k) { maxDnD += (dndMaxMap[k] || 0); });
    maxPoints += maxDnD;
    if (totalDisplay) {
      totalDisplay.textContent = String(maxPoints);
    }

    // --- MISE À JOUR BARRE DE PROGRESSION (Nouveau) ---
    const fill = document.getElementById('progress-fill');
    if (fill && maxPoints > 0) {
      const pct = Math.min(100, Math.round((totalPoints / maxPoints) * 100));
      fill.style.width = `${pct}%`;

      if (pct === 100) fill.style.background = '#00c853';
      else fill.style.background = 'linear-gradient(90deg, #4caf50, #81c784)';
    }

    // --- BUTTON ENABLE/DISABLE LOGIC (Student Mode) ---
    const btnPdf = document.getElementById('download-pdf');
    if (btnPdf) {
      const urlParams = new URLSearchParams(window.location.search);
      const isAdmin = urlParams.has('admin') || urlParams.has('prof');

      // Admin always has logic handled by enablePdfIfAdmin (runs once), 
      // but we must ensure we don't accidentally disable it here if score < 50%.
      // Ideally, if isAdmin is true, we simply do nothing here.

      if (!isAdmin) {
        const threshold = maxPoints * 0.5; // 50%
        if (totalPoints >= threshold) {
          btnPdf.disabled = false;
          btnPdf.removeAttribute('disabled');
          btnPdf.style.opacity = '1';
          btnPdf.style.cursor = 'pointer';
          btnPdf.style.backgroundColor = '#007bff';
        } else {
          btnPdf.disabled = true;
          btnPdf.style.opacity = '0.5';
          btnPdf.style.cursor = 'default';
          // Keep original color or set it if needed, but opacity handles the look.
        }
      }
    }

    // --- ENVOI MOODLE AVEC DEBOUNCE ANTI-SPAM ---
    // On attend 1.5 secondes après la dernière modification du score pour envoyer
    clearTimeout(scoreTimeout);
    if (mqCanSendMoodleScore()) {
      scoreTimeout = setTimeout(() => {
        envoyerScoreAMoodle(totalPoints);
      }, 1500);
    }
  }
  function resetInputs() {
    document.querySelectorAll('input[type="text"]').forEach(input => {
      input.value = '';
      input.classList.remove('correct', 'incorrect', 'in-progress');
    });
  }

  // -----------------------
  // Utilities
  // -----------------------
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function pickFirstImage(raw) {
    return String(raw || '')
      .split(',')
      .map(s => s.trim().replace(/^'+|'+$/g, ''))
      .filter(Boolean)[0] || '';
  }

  // Création du tooltip unique
  function ensureTooltip() {
    // DÉBOGAGE : Supprimer TOUS les tooltips existants pour repartir à zéro
    const existingTooltips = document.querySelectorAll('#svg-tooltip');
    existingTooltips.forEach((t, index) => {
      console.warn(`⚠️ Tooltip trouvé #${index + 1}:`, t);
      if (index > 0) t.remove(); // Garder seulement le premier
    });

    let tip = document.getElementById('svg-tooltip');
    if (tip) {
      console.log('✅ Tooltip existant réutilisé');
      return tip;
    }

    tip = document.createElement('div');
    tip.id = 'svg-tooltip';
    tip.style.cssText = `position: fixed; z-index: 99999; display: none; background: rgba(0,0,0,0.85); color: #fff; padding: 6px 10px; border-radius: 6px; font-size: 14px; pointer-events: none; max-width: 420px; box-shadow: 0 6px 18px rgba(0,0,0,0.35);`;
    document.body.appendChild(tip);
    console.log('🆕 Nouveau tooltip créé');
    return tip;
  }

  function getOverlayFor(el) {
    const page = el && el.closest ? el.closest('.page-container') : null;
    if (page && page.id === 'page-2-container') {
      return document.getElementById('image-overlay2') || document.getElementById('image-overlay');
    }
    return document.getElementById('image-overlay') || document.getElementById('image-overlay2');
  }

  function showOverlayFrom(el) {
    const overlay = getOverlayFor(el);
    if (!overlay) return;

    const img = pickFirstImage(el.getAttribute('data-image'));
    if (!img) {
      overlay.style.backgroundImage = 'none';
      return;
    }

    // Light up the referenced PNG only
    overlay.style.backgroundRepeat = 'no-repeat';
    overlay.style.backgroundPosition = '0 0';
    overlay.style.backgroundSize = '100% 100%';
    overlay.style.opacity = '1';
    overlay.style.backgroundImage = `url("${img}")`;
  }

  function hideOverlayFrom(el) {
    const overlay = getOverlayFor(el);
    if (!overlay) return;
    overlay.style.backgroundImage = 'none';
  }

  function findDndTooltipEl(node) {
    if (!node || !node.closest) return null;
    const game = node.closest('.drag-game');
    if (!game || game.getAttribute('data-tt-enabled') === '0') return null;
    const el = node.closest('[data-tooltip]');
    if (!el || !game.contains(el)) return null;
    const text = String(el.getAttribute('data-tooltip') || '').trim();
    return text ? el : null;
  }

  function applyTooltipTheme(tip, el) {
    const gameRoot = el && el.closest ? el.closest('.drag-game') : null;
    const font = el.getAttribute('data-tip-font') || el.getAttribute('data-hint-font')
      || (gameRoot && gameRoot.getAttribute('data-tt-font')) || 'inherit';
    const bg = el.getAttribute('data-tip-bg')
      || (gameRoot && gameRoot.getAttribute('data-tt-bg')) || 'rgba(0,0,0,0.85)';
    const color = el.getAttribute('data-tip-col')
      || (gameRoot && gameRoot.getAttribute('data-tt-col')) || '#ffffff';
    tip.style.fontFamily = font;
    tip.style.background = bg;
    tip.style.color = color;
  }

  // --- TOOLTIP AVEC PROTECTION ANTI-DOUBLON ---
  let currentTooltipTarget = null;
  let dndTooltipBound = false;

  function showTooltipFor(el, x, y) {
    // --- Durée du tooltip (en ms) --- Peut-être définie via le HTML (data-duration)
    const defaultTooltipDelay = window.tooltipDelay || 3000;
    // Protection anti-doublon : si c'est déjà cet élément, on ne fait rien
    if (currentTooltipTarget === el) {
      moveTooltip(x, y);
      return;
    }

    const text = String(el.getAttribute('data-tooltip') || '').trim();
    if (!text) return;

    currentTooltipTarget = el;
    const tip = ensureTooltip();
    const gameRoot = el.closest ? el.closest('.drag-game') : null;

    tip.innerHTML = '';
    tip.textContent = text;
    applyTooltipTheme(tip, el);
    tip.style.display = 'block';

    // --- Auto-hide ---
    const timeoutAttr = el.getAttribute('data-duration') || el.getAttribute('data-tooltip-timeout')
      || (gameRoot && gameRoot.getAttribute('data-tt-dur'));
    const delay = timeoutAttr ? parseInt(timeoutAttr, 10) : defaultTooltipDelay;

    clearTimeout(tip.hideTimeout);
    tip.hideTimeout = setTimeout(() => {
      tip.style.display = 'none';
      currentTooltipTarget = null;
    }, delay);

    moveTooltip(x, y);
  }

  function moveTooltip(x, y) {
    const tip = document.getElementById('svg-tooltip');
    if (tip && tip.style.display === 'block') {
      tip.style.left = (x + 15) + 'px';
      tip.style.top = (y + 15) + 'px';
    }
  }

  function hideTooltip(el) {
    // On ne cache que si c'est l'élément actif qui le demande
    if (currentTooltipTarget === el || el === null || el === undefined) {
      const tip = document.getElementById('svg-tooltip');
      if (tip) tip.style.display = 'none';
      currentTooltipTarget = null;
    }
  }

  //////////////////////////
  //


  // -----------------------
  // INITIALISATION DES EVENTS (Hotspots + Inputs) - VERSION UNIQUE
  // -----------------------
  function initInteractionEvents() {
    ensureTooltip();


    // Évite le double tooltip : supprime les "title" HTML natifs
    document.querySelectorAll('[title]').forEach(el => el.removeAttribute('title'));
    // A. GESTION DES HOTSPOTS (SVG)
    document.querySelectorAll('.hotspot-group').forEach(g => {
      const fill = g.querySelector('.hs-fill');
      const stroke = g.querySelector('.hs-stroke');
      const dataRect = g.querySelector('rect');

      const alphaIdle = dataRect ? (dataRect.dataset.alphaIdle || 0) : 0;
      const alphaActive = dataRect ? (dataRect.dataset.alphaActive || 0.35) : 0.35;

      // Helper to toggle group
      const toggleGroup = (groupId, active) => {
        if (!groupId) return;
        const peers = document.querySelectorAll(`[data-group="${groupId}"]`);
        peers.forEach(p => {
          if (p === g) return; // Skip self
          // If it's a hotspot
          if (p.classList.contains('hotspot-group')) {
            const pFill = p.querySelector('.hs-fill');
            const pStroke = p.querySelector('.hs-stroke');
            if (pFill) pFill.style.fillOpacity = active ? (p.dataset.alphaActive || 0.35) : (p.dataset.alphaIdle || 0);
            if (pStroke) pStroke.style.strokeOpacity = active ? (p.dataset.alphaActive || 0.35) : (p.dataset.alphaIdle || 0);
          }
          // If it's an input wrapper (optional visual feedback)
          if (p.classList.contains('input-wrapper')) {
            // p.style.boxShadow = active ? '0 0 8px #2196f3' : 'none'; 
          }
        });
      };

      // Etat initial
      if (fill) fill.style.fillOpacity = alphaIdle;
      if (stroke) stroke.style.strokeOpacity = alphaIdle;

      g.addEventListener('pointerenter', (e) => {
        if (fill) fill.style.fillOpacity = alphaActive;
        if (stroke) stroke.style.strokeOpacity = alphaActive;

        // Group Logic
        toggleGroup(g.dataset.group, true);

        if (typeof showOverlayFrom === 'function') showOverlayFrom(g);
        showTooltipFor(g, e.clientX, e.clientY);
      });

      g.addEventListener('pointermove', (e) => moveTooltip(e.clientX, e.clientY));

      g.addEventListener('pointerleave', () => {
        if (fill) fill.style.fillOpacity = alphaIdle;
        if (stroke) stroke.style.strokeOpacity = alphaIdle;

        // Group Logic off
        toggleGroup(g.dataset.group, false);

        if (typeof hideOverlayFrom === 'function') hideOverlayFrom(g);
        hideTooltip(g);
      });
    });

    // B. GESTION DES INPUTS (Wrapper)
    document.querySelectorAll('.input-wrapper').forEach(w => {

      const toggleGroup = (groupId, active) => {
        if (!groupId) return;
        const peers = document.querySelectorAll(`[data-group="${groupId}"]`);
        peers.forEach(p => {
          if (p === w) return;
          // Hotspots
          if (p.classList.contains('hotspot-group')) {
            const pFill = p.querySelector('.hs-fill');
            const pStroke = p.querySelector('.hs-stroke');
            // Use defaults if dataset missing (safe fallback)
            const aActive = p.dataset.alphaActive || 0.35;
            const aIdle = p.dataset.alphaIdle || 0;
            if (pFill) pFill.style.fillOpacity = active ? aActive : aIdle;
            if (pStroke) pStroke.style.strokeOpacity = active ? aActive : aIdle;
          }
        });
      };

      w.addEventListener('pointerenter', (e) => {
        if (typeof showOverlayFrom === 'function') showOverlayFrom(w);
        showTooltipFor(w, e.clientX, e.clientY);
        toggleGroup(w.dataset.group, true);
      });

      w.addEventListener('pointermove', (e) => moveTooltip(e.clientX, e.clientY));

      w.addEventListener('pointerleave', () => {
        if (typeof hideOverlayFrom === 'function') hideOverlayFrom(w);
        hideTooltip(w);
        toggleGroup(w.dataset.group, false);
      });
    });

    // C. GESTION DES DRAGGABLES (Images DnD) — délégation (img enfant + cartes clonées .dnd-placed)
    if (!dndTooltipBound) {
      dndTooltipBound = true;
      document.addEventListener('pointerover', (e) => {
        const el = findDndTooltipEl(e.target);
        if (el) showTooltipFor(el, e.clientX, e.clientY);
      }, true);
      document.addEventListener('pointermove', (e) => {
        const el = findDndTooltipEl(e.target);
        if (el && currentTooltipTarget === el) moveTooltip(e.clientX, e.clientY);
      }, true);
      document.addEventListener('pointerout', (e) => {
        const el = findDndTooltipEl(e.target);
        if (!el || el !== currentTooltipTarget) return;
        const stillInside = el.contains(e.relatedTarget);
        if (!stillInside) hideTooltip(el);
      }, true);
    }
  }

  // -----------------------
  // DnD with score + malus (MqDndEngine)
  // -----------------------
  function readDndConfig(gameEl) {
    const gameId = gameEl.getAttribute('data-dnd-gameid') || gameEl.id || 'game';
    let cfg = null;
    const jsonEl = document.getElementById('dnd-config-' + gameId) ||
      gameEl.querySelector('script[type="application/json"][data-dnd-config]');
    if (jsonEl) {
      try { cfg = JSON.parse(jsonEl.textContent || '{}'); } catch (e) { console.warn('dnd config', e); }
    }
    if (cfg && window.MqDndEngine) {
      const Eng = window.MqDndEngine;
      if (typeof Eng.applyGameDefaults === 'function') {
        cfg = Eng.applyGameDefaults(cfg);
      }
      if (cfg.enableSteps && typeof Eng.enrichStepsFromDropzones === 'function') {
        Eng.enrichStepsFromDropzones(cfg);
      }
    }
    if (!cfg) {
      const good = (gameEl.getAttribute('data-dnd-good') || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      const targetCount = parseInt(gameEl.getAttribute('data-dnd-target') || String(good.length), 10);
      const zones = qsa('.dropzone', gameEl).map(function (z, i) {
        return {
          id: z.getAttribute('data-zone-id') || (i + 1),
          acceptedIds: [],
          capacity: 1,
          required: true,
          groupId: z.getAttribute('data-group-id') || '',
          label: z.getAttribute('data-label') || ''
        };
      });
      cfg = {
        gameType: 'selection',
        feedbackMode: 'immediate',
        cardUse: 'unique',
        showScore: true,
        showMalus: true,
        goodIds: good.join(','),
        targetCount: targetCount,
        dropzones: zones
      };
    }
    cfg._gameId = gameId;
    // Assure data-zone-id sur le DOM
    qsa('.dropzone', gameEl).forEach(function (z, i) {
      const dz = (cfg.dropzones || [])[i];
      if (!z.getAttribute('data-zone-id')) {
        z.setAttribute('data-zone-id', dz ? String(dz.id) : String(i + 1));
      }
      if (dz && dz.groupId) z.setAttribute('data-group-id', dz.groupId);
      // Nettoyer le numéro placeholder si présent comme seul texte
      if (z.childNodes.length === 1 && z.childNodes[0].nodeType === 3) {
        z.textContent = '';
      }
    });
    return cfg;
  }

  function initDragGame(gameContainer, goodIds, targetCount, scoreContainerId, gameId) {
    if (!gameContainer) return;
    const Engine = window.MqDndEngine;
    if (!Engine || typeof Engine.initPlayableDndGame !== 'function') {
      console.error('MqDndEngine manquant');
      return;
    }
    const cfg = readDndConfig(gameContainer);
    if (Array.isArray(goodIds) && goodIds.length && !cfg.goodIds) {
      cfg.goodIds = goodIds.join(',');
    }
    if (targetCount && !cfg.targetCount) cfg.targetCount = targetCount;
    cfg._gameId = gameId || cfg._gameId;

    if (!window.dndScores) window.dndScores = {};
    if (!window.dndMaxScores) window.dndMaxScores = {};
    window.dndMaxScores[cfg._gameId] = Engine.computeGameMaxScore(cfg);
    // Compat
    if (cfg._gameId === 'game1') window.game1Score = 0;
    if (cfg._gameId === 'game2') window.game2Score = 0;

    Engine.initPlayableDndGame(gameContainer, cfg, {
      playSound: playSound,
      showFloating: showFloatingFeedback,
      onLinkRejected: function (from, to) {
        try {
          showFloatingFeedback('Flèche refusée : ' + from + ' → ' + to, false);
        } catch (e) { /* ignore */ }
      },
      onReady: function (info) {
        window.dndMaxScores[info.gameId] = info.maxScore;
        window.dndScores[info.gameId] = window.dndScores[info.gameId] || 0;
        updateGlobalScore();
      },
      onScore: function (info) {
        window.__mqAllowMoodleScore = true;
        window.dndScores[info.gameId] = info.score;
        window.dndMaxScores[info.gameId] = info.maxScore;
        if (info.gameId === 'game1') window.game1Score = info.score;
        if (info.gameId === 'game2') window.game2Score = info.score;
        updateGlobalScore();
      }
    });
  }

  // -----------------------
  // PAN/ZOOM (non-blocking) — pinch 2 doigts + barre mobile
  // -----------------------
  function initPanZoom() {
    const canvasContainer = document.getElementById('canvas-container') || document.querySelector('.canvas-container');
    const pageWrapper = document.getElementById('page-wrapper') || document.querySelector('.page-wrapper');

    if (!canvasContainer || !pageWrapper) return;

    canvasContainer.style.touchAction = 'none';
    canvasContainer.style.userSelect = 'none';
    pageWrapper.style.transformOrigin = '0 0';

    let BASE_W = pageWrapper.scrollWidth || pageWrapper.offsetWidth;
    let BASE_H = pageWrapper.scrollHeight || pageWrapper.offsetHeight;

    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;

    const MIN_SCALE = 0.1;
    const MAX_SCALE = 6;
    const PAN_THRESHOLD = 6;

    const activePointers = new Map();
    let panPointerId = null;
    let pendingPan = false;
    let isPanning = false;
    let downX = 0, downY = 0;
    let lastX = 0, lastY = 0;

    let isPinching = false;
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let pinchStartOffsetX = 0;
    let pinchStartOffsetY = 0;
    let pinchAnchorX = 0;
    let pinchAnchorY = 0;

    // Ne pas inclure [data-tooltip] / hotspots : sinon tout le schéma bloque le pan
    const INTERACTIVE_SELECTOR = [
      'input', 'textarea', 'button', 'select', 'a', 'label',
      '.input-wrapper',
      '.draggable:not(.dnd-step-source-hidden):not(.dnd-step-future-hidden):not(.used)',
      '.dropzone:not(.dnd-step-locked):not(.dnd-step-zone-hidden)',
      '.dnd-placed', '.png-wrap',
      '[data-link-node]', '.dnd-link-zone', '.dnd-link-zone-hit',
      '.dnd-relier-btn', '.dnd-verify-btn', '.dnd-next-step-btn', '.dnd-step-next-btn',
      '.pdf-buttons', '.controls', '.mobile-zoom-bar',
      '#svg-tooltip', '#btnFullscreen'
    ].join(',');

    function pointerOnDndCard(e) {
      if (!e) return false;
      const x = e.clientX, y = e.clientY;
      let stack = [];
      try { stack = (document.elementsFromPoint && document.elementsFromPoint(x, y)) || []; } catch { }
      if (!stack.length && e.target) stack = [e.target];
      for (let i = 0; i < stack.length; i++) {
        const el = stack[i];
        if (!el || !el.closest) continue;
        const game = el.closest('.drag-game');
        if (!game) continue;
        if (game.classList.contains('dnd-link-mode')) return false;
        const card = el.closest('.draggable, .dnd-placed, .png-wrap');
        if (card && !card.classList.contains('dnd-step-source-hidden') && !card.classList.contains('dnd-step-future-hidden') && !card.classList.contains('used')) return true;
        if (el.closest('.dropzone:not(.dnd-step-locked):not(.dnd-step-zone-hidden)')) return true;
      }
      return false;
    }

    function isInteractiveTarget(t, ev) {
      if (!t || !t.closest) return false;
      // Alt ou bouton du milieu : toujours pan (pour recentrer le côté gauche)
      if (ev && (ev.altKey || ev.button === 1)) return false;
      // Mode Relier actif : clic gauche = pan (les flèches se tracent au clic droit)
      if (t.closest('.dnd-link-mode')) {
        return !!(t.closest('.dnd-relier-btn, .dnd-verify-btn, .dnd-next-step-btn, .dnd-step-next-btn, button, input, textarea, select, a, label, .pdf-buttons, .controls, .mobile-zoom-bar, #btnFullscreen'));
      }
      if (ev && pointerOnDndCard(ev)) return true;
      return !!t.closest(INTERACTIVE_SELECTOR);
    }

    function getViewport() {
      const w = canvasContainer.clientWidth || window.innerWidth;
      const h = canvasContainer.clientHeight || window.innerHeight;
      return { w, h };
    }

    function refreshBaseSize() {
      BASE_W = pageWrapper.scrollWidth || pageWrapper.offsetWidth;
      BASE_H = pageWrapper.scrollHeight || pageWrapper.offsetHeight;
    }

    function clampOffsets() {
      const { w, h } = getViewport();
      refreshBaseSize();
      const contentW = BASE_W * scale;
      const contentH = BASE_H * scale;
      // Slack large : permettre de centrer le bord gauche (ou n’importe quel coin) à l’écran
      const slackX = Math.max(w * 0.85, 160);
      const slackY = Math.max(h * 0.85, 160);
      const minX = w - contentW - slackX;
      const maxX = slackX;
      const minY = h - contentH - slackY;
      const maxY = slackY;
      offsetX = Math.max(minX, Math.min(maxX, offsetX));
      offsetY = Math.max(minY, Math.min(maxY, offsetY));
    }

    let raf = null;
    function applyTransform() {
      clampOffsets();
      pageWrapper.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    }
    function scheduleApply() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        applyTransform();
      });
    }

    function zoomAt(factor, anchorX, anchorY) {
      const oldScale = scale;
      scale = Math.max(MIN_SCALE, Math.min(scale * factor, MAX_SCALE));
      offsetX = anchorX - (anchorX - offsetX) * (scale / oldScale);
      offsetY = anchorY - (anchorY - offsetY) * (scale / oldScale);
      scheduleApply();
    }

    function fit() {
      const { w, h } = getViewport();
      refreshBaseSize();
      scale = Math.min(w / BASE_W, h / BASE_H) * 0.85;
      const contentW = BASE_W * scale;
      const contentH = BASE_H * scale;
      offsetX = (w - contentW) / 2;
      offsetY = (h - contentH) / 2;
      canvasContainer.style.cursor = 'grab';
      applyTransform();
    }

    function pointerDistance() {
      const pts = [...activePointers.values()];
      if (pts.length < 2) return 0;
      return Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    }

    function pointerCenter() {
      const pts = [...activePointers.values()];
      if (!pts.length) return { x: 0, y: 0 };
      const sum = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
      return { x: sum.x / pts.length, y: sum.y / pts.length };
    }

    function beginPinch() {
      const dist = pointerDistance();
      if (dist < 8) return;
      isPinching = true;
      pendingPan = false;
      isPanning = false;
      panPointerId = null;
      pinchStartDist = dist;
      pinchStartScale = scale;
      pinchStartOffsetX = offsetX;
      pinchStartOffsetY = offsetY;
      const rect = canvasContainer.getBoundingClientRect();
      const center = pointerCenter();
      pinchAnchorX = center.x - rect.left;
      pinchAnchorY = center.y - rect.top;
    }

    function updatePinch() {
      const dist = pointerDistance();
      if (!isPinching || pinchStartDist < 8) return;
      const ratio = dist / pinchStartDist;
      const newScale = Math.max(MIN_SCALE, Math.min(pinchStartScale * ratio, MAX_SCALE));
      const sRatio = newScale / pinchStartScale;
      offsetX = pinchAnchorX - (pinchAnchorX - pinchStartOffsetX) * sRatio;
      offsetY = pinchAnchorY - (pinchAnchorY - pinchStartOffsetY) * sRatio;
      scale = newScale;
      scheduleApply();
    }

    function endPinchIfNeeded() {
      if (activePointers.size >= 2) return;
      isPinching = false;
      pinchStartDist = 0;
    }

    function endPan() {
      if (panPointerId !== null) {
        try { canvasContainer.releasePointerCapture(panPointerId); } catch { }
      }
      panPointerId = null;
      pendingPan = false;
      isPanning = false;
      canvasContainer.style.cursor = 'grab';
    }

    fit();

    // Recalcul après chargement des images (sinon BASE_W = 0 → pan/zoom cassés)
    const pageImages = pageWrapper.querySelectorAll('.page-image');
    let pendingImg = pageImages.length;
    const refitWhenReady = () => {
      if (--pendingImg <= 0) fit();
    };
    pageImages.forEach((img) => {
      img.setAttribute('draggable', 'false');
      img.addEventListener('dragstart', (e) => e.preventDefault());
      if (img.complete) refitWhenReady();
      else img.addEventListener('load', refitWhenReady, { once: true });
    });
    window.addEventListener('load', () => fit());

    canvasContainer.addEventListener('pointerdown', (e) => {
      // Clic gauche, ou milieu (pan forcé), ou Alt+clic (pan forcé)
      if (e.button !== 0 && e.button !== 1) return;
      if (isInteractiveTarget(e.target, e)) return;

      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 2) {
        try { canvasContainer.setPointerCapture(e.pointerId); } catch { }
        beginPinch();
        e.preventDefault();
        return;
      }

      if (activePointers.size > 2) return;

      // Pas de capture immédiate : laisse le drag HTML5 des cartes DnD démarrer
      panPointerId = e.pointerId;
      pendingPan = true;
      isPanning = false;
      downX = lastX = e.clientX;
      downY = lastY = e.clientY;
      if (e.button === 1 || e.altKey) {
        // Pan immédiat (sans attendre le seuil) pour recentrer facilement
        isPanning = true;
        pendingPan = false;
        try { canvasContainer.setPointerCapture(e.pointerId); } catch { }
        canvasContainer.style.cursor = 'grabbing';
        e.preventDefault();
      }
    }, { passive: false });

    canvasContainer.addEventListener('pointermove', (e) => {
      if (!activePointers.has(e.pointerId)) return;

      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size >= 2) {
        if (!isPinching) beginPinch();
        e.preventDefault();
        updatePinch();
        return;
      }

      if (isPinching) return;
      if (panPointerId === null || e.pointerId !== panPointerId) return;
      if (!pendingPan && !isPanning) return;

      const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (!isPanning) {
        if (pointerOnDndCard(e)) {
          pendingPan = false;
          panPointerId = null;
          return;
        }
        if (dist < PAN_THRESHOLD) return;
        isPanning = true;
        pendingPan = false;
        try { canvasContainer.setPointerCapture(e.pointerId); } catch { }
        canvasContainer.style.cursor = 'grabbing';
        e.preventDefault();
      } else {
        e.preventDefault();
      }

      offsetX += e.clientX - lastX;
      offsetY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      scheduleApply();
    }, { passive: false });

    function onPointerEnd(e) {
      activePointers.delete(e.pointerId);
      try { canvasContainer.releasePointerCapture(e.pointerId); } catch { }

      endPinchIfNeeded();

      if (panPointerId === e.pointerId) endPan();
      else if (panPointerId !== null && !activePointers.has(panPointerId)) endPan();
    }

    canvasContainer.addEventListener('pointerup', onPointerEnd);
    document.addEventListener('dragstart', () => { endPan(); }, true);
    canvasContainer.addEventListener('pointercancel', onPointerEnd);

    canvasContainer.addEventListener('wheel', (e) => {
      if (isInteractiveTarget(e.target, e)) return;
      e.preventDefault();
      const rect = canvasContainer.getBoundingClientRect();
      zoomAt(e.deltaY > 0 ? 0.6 : 1.1, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    window.addEventListener('resize', () => scheduleApply());

    // Barre zoom tactile (smartphone / tablette)
    const zoomBar = document.createElement('div');
    zoomBar.className = 'mobile-zoom-bar';
    zoomBar.setAttribute('aria-label', 'Zoom');
    zoomBar.innerHTML = `
      <button type="button" data-zoom="out" title="Dézoomer" aria-label="Dézoomer">−</button>
      <button type="button" data-zoom="fit" title="Ajuster à l'écran" aria-label="Ajuster">⊡</button>
      <button type="button" data-zoom="in" title="Zoomer" aria-label="Zoomer">+</button>
    `;
    document.body.appendChild(zoomBar);

    zoomBar.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-zoom]');
      if (!btn) return;
      const { w, h } = getViewport();
      const anchorX = w / 2;
      const anchorY = h / 2;
      if (btn.dataset.zoom === 'in') zoomAt(1.35, anchorX, anchorY);
      else if (btn.dataset.zoom === 'out') zoomAt(1 / 1.35, anchorX, anchorY);
      else fit();
    });

    window.__panZoomFit = fit;

    if (window.MqDndEngine && MqDndEngine.attachDragEdgePan) {
      MqDndEngine.attachDragEdgePan({
        getRect: function () { return canvasContainer.getBoundingClientRect(); },
        panBy: function (dx, dy) {
          offsetX += dx;
          offsetY += dy;
          scheduleApply();
        }
      });
    }
  }

  // -----------------------
  // PDF button enable
  // -----------------------
  function enablePdfIfAdmin() {
    const btn = document.getElementById('download-pdf');
    if (!btn) return;

    const p = new URLSearchParams(window.location.search);
    const isAdmin =
      p.get('admin') === 'true' || p.has('admin') ||
      p.get('prof') === 'true' || p.has('prof');

    if (!isAdmin) return;

    btn.disabled = false;
    btn.removeAttribute('disabled');
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
    btn.style.backgroundColor = '#007bff';
    btn.style.color = '#fff';
  }

  // -----------------------
  // Inputs grading (GAMIFIED VERSION)
  // -----------------------
  function initTextInputs() {
    injectGamificationStyles(); // On s'assure que le CSS est là
    const inputs = document.querySelectorAll('input[type="text"], textarea');

    inputs.forEach(input => {
      input.addEventListener('input', () => {
        const answer = (input.getAttribute('data-answer') || '').toLowerCase().trim().replace(/\s+/g, ' ');
        const user = (input.value || '').toLowerCase().trim().replace(/\s+/g, ' ');

        // Reset des états
        input.classList.remove('input-success-anim', 'shake', 'correct');
        input.style.backgroundColor = '';

        if (user === '') { updateGlobalScore(); return; }

        if (user === answer) {
          // --- SUCCÈS ---
          void input.offsetWidth;
          input.classList.add('input-success-anim');
          input.classList.add('correct'); // Important pour le score global

          showFloatingFeedback(input); // Le +1 qui vole
          playSound('success');       // Le son Ding

          input.readOnly = true;
          input.style.pointerEvents = 'none';
        }
        else if (answer.startsWith(user)) {
          // En cours de frappe correcte (optionnel, tu peux laisser vide)
          input.style.backgroundColor = '#ffe0b2';
        }
        else {
          // --- ERREUR ---
          void input.offsetWidth;
          input.classList.add('shake');
          input.style.backgroundColor = '#ffcdd2';

          // Anti-spam son erreur
          if (!input.dataset.wasWrong) {
            playSound('error');
            input.dataset.wasWrong = "true";
            setTimeout(() => input.dataset.wasWrong = "", 500);
          }
        }
        updateGlobalScore();
      });
    });
  }

  // -----------------------
  // Boot
  // -----------------------
  document.addEventListener('DOMContentLoaded', () => {
    initInteractionEvents();  // Initialisation UNIQUE des tooltips
    initTextInputs();
    initPanZoom();
    enablePdfIfAdmin();
    window.__mqAllowMoodleScore = false;
    updateGlobalScore();

    // Initialisation Drag & Drop (v3 + legacy data-dnd-good)
    document.querySelectorAll('.drag-game[data-dnd-gameid], .drag-game[data-dnd-good]').forEach(gameEl => {
      const good = (gameEl.getAttribute('data-dnd-good') || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const targetCount = parseInt(gameEl.getAttribute('data-dnd-target') || String(good.length || 0), 10);
      const scoreContainerId = gameEl.getAttribute('data-dnd-score-container') || '';
      const gameId = gameEl.getAttribute('data-dnd-gameid') || gameEl.id || 'game';
      if (typeof initDragGame === 'function') {
        initDragGame(gameEl, good, targetCount, scoreContainerId, gameId);
      }
    });
  });

})();
