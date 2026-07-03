/**
 * OCR Addon — reconnaissance de texte sur image existante (Tesseract.js)
 * Namespace global unique : OCRAddon
 *
 * Dépendance : Tesseract.js (chargé via <script> avant ce fichier)
 *   https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js
 */
(function (global) {
    'use strict';

  /* ------------------------------------------------------------------ */
  /* État interne                                                        */
  /* ------------------------------------------------------------------ */

    const DEFAULTS = {
        imageSelector: null,
        overlayContainerSelector: null,
        imageElement: null,
        overlayContainer: null,
        listContainerSelector: null,
        listContainer: null,
        toolbarContainer: null,
        toolbarContainerSelector: null,
        language: 'fra',
        mode: 'segments',
        minConfidence: 70,
        minTextLength: 2,
        /** Écart horizontal max. (px image) entre mots sur une ligne — mode segments. 0 = auto. */
        maxWordGap: 35,
        createOverlayInputs: true,
        createListInputs: true,
        useDisplayedImageCoordinates: true,
        preprocess: {
            grayscale: true,
            contrast: 1.2,
            threshold: null
        },
        observeResizeElement: null,
        beforeRunOCR: null,
        listPrimary: false,
        mapOcrBbox: null
    };

    /** Réglages recommandés pour certains types de documents. */
    const OCR_PRESETS = {
        'fiche-filigrane': {
            mode: 'segments',
            maxWordGap: 40,
            minConfidence: 65,
            minTextLength: 3,
            preprocess: { grayscale: true, contrast: 1.35, threshold: 185 }
        }
    };

    let state = null;
    let worker = null;
    let idCounter = 0;
    let resizeObserver = null;

  /* ------------------------------------------------------------------ */
  /* Utilitaires                                                         */
  /* ------------------------------------------------------------------ */

    /**
     * Résout un sélecteur CSS ou retourne l'élément déjà fourni.
     * @param {string|HTMLElement|null} selectorOrEl
     * @returns {HTMLElement|null}
     */
    function resolveElement(selectorOrEl) {
        if (!selectorOrEl) return null;
        if (selectorOrEl instanceof HTMLElement) return selectorOrEl;
        if (typeof selectorOrEl === 'string') return document.querySelector(selectorOrEl);
        return null;
    }

    /** Fusion profonde superficielle pour options d'init. */
    function mergeOptions(base, extra) {
        const out = Object.assign({}, base, extra || {});
        if (extra && extra.preprocess) {
            out.preprocess = Object.assign({}, base.preprocess, extra.preprocess);
        }
        return out;
    }

    /** Génère un identifiant unique ocr_NNN. */
    function nextId() {
        idCounter += 1;
        return 'ocr_' + String(idCounter).padStart(3, '0');
    }

    /** Réinitialise le compteur d'ids à partir des champs existants. */
    function syncIdCounter(fields) {
        let max = 0;
        fields.forEach((f) => {
            const m = /^ocr_(\d+)$/.exec(f.id || '');
            if (m) max = Math.max(max, parseInt(m[1], 10));
        });
        idCounter = max;
    }

    /**
     * Nettoie le texte OCR (espaces, caractères parasites).
     * @param {string} text
     * @returns {string}
     */
    function sanitizeText(text) {
        if (!text) return '';
        return String(text)
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            .replace(/[|¦]/g, 'I')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Vérifie si un candidat OCR passe les filtres courants.
     * @param {string} text
     * @param {number} confidence
     * @returns {boolean}
     */
    function passesFilter(text, confidence) {
        const t = sanitizeText(text);
        if (!t) return false;
        if (t.length < state.minTextLength) return false;
        if (confidence < state.minConfidence) return false;
        if (/^[^a-zA-Z0-9àâäéèêëïîôùûüçÀÂÄÉÈÊËÏÎÔÙÛÜÇ]+$/.test(t)) return false;
        return true;
    }

    /** Lit le texte courant depuis le DOM (liste prioritaire). */
    function readFieldText(field) {
        if (field.listEl) {
            const li = field.listEl.querySelector('input.ocr-list-text, input');
            if (li) return li.value;
        }
        if (field.el) {
            const oi = field.el.querySelector('input');
            if (oi && !oi.readOnly) return oi.value;
        }
        return field.text != null ? field.text : '';
    }

    /** Met à jour field.text depuis les inputs DOM. */
    function syncFieldTextFromDom(field) {
        field.text = readFieldText(field);
        return field.text;
    }

    /** Champ de saisie OCR (liste ou overlay). */
    function isOcrTextInput(el) {
        if (!el || el.tagName !== 'INPUT') return false;
        return !!(el.closest('.ocr-list-item') || el.closest('.ocr-field'));
    }

    /**
     * Échelle entre pixels naturels de l'image et affichage courant.
     * @returns {{ scaleX: number, scaleY: number }}
     */
    function getDisplayScale() {
        const img = state.imageElement;
        if (!img || !img.naturalWidth || !img.naturalHeight) {
            return { scaleX: 1, scaleY: 1 };
        }
        const rect = img.getBoundingClientRect();
        return {
            scaleX: rect.width / img.naturalWidth,
            scaleY: rect.height / img.naturalHeight
        };
    }

    /**
     * Convertit une bbox OCR (coords image naturelle) en position overlay.
     * @param {{ x0: number, y0: number, x1: number, y1: number }} bbox
     * @returns {{ x: number, y: number, width: number, height: number }}
     */
    function naturalBboxToDisplay(bbox) {
        const { scaleX, scaleY } = getDisplayScale();
        const t = state.transform;
        const sx = state.useDisplayedImageCoordinates ? scaleX : 1;
        const sy = state.useDisplayedImageCoordinates ? scaleY : 1;
        const w = Math.max(8, (bbox.x1 - bbox.x0) * sx * t.scale);
        const h = Math.max(14, (bbox.y1 - bbox.y0) * sy * t.scale);
        return {
            x: bbox.x0 * sx * t.scale + t.translateX,
            y: bbox.y0 * sy * t.scale + t.translateY,
            width: w,
            height: h
        };
    }

    /**
     * Convertit une position overlay affichée vers coords image naturelle.
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @returns {{ originalX: number, originalY: number, originalWidth: number, originalHeight: number }}
     */
    function displayToNatural(x, y, width, height) {
        const { scaleX, scaleY } = getDisplayScale();
        const t = state.transform;
        const sx = state.useDisplayedImageCoordinates ? scaleX : 1;
        const sy = state.useDisplayedImageCoordinates ? scaleY : 1;
        const factorX = sx * t.scale || 1;
        const factorY = sy * t.scale || 1;
        return {
            originalX: (x - t.translateX) / factorX,
            originalY: (y - t.translateY) / factorY,
            originalWidth: width / factorX,
            originalHeight: height / factorY
        };
    }

    /**
     * Applique left/top/width/height sur l'élément DOM d'un champ.
     * @param {object} field
     */
    function applyFieldGeometry(field) {
        if (!field.el) return;
        field.el.style.left = field.x + 'px';
        field.el.style.top = field.y + 'px';
        field.el.style.width = Math.max(24, field.width) + 'px';
        field.el.style.height = Math.max(18, field.height) + 'px';
    }

    /**
     * Met à jour original* depuis la géométrie affichée.
     * @param {object} field
     */
    function syncOriginalFromDisplay(field) {
        const nat = displayToNatural(field.x, field.y, field.width, field.height);
        field.originalX = nat.originalX;
        field.originalY = nat.originalY;
        field.originalWidth = nat.originalWidth;
        field.originalHeight = nat.originalHeight;
    }

    /**
     * Recalcule x/y/width/height affichés depuis original*.
     * @param {object} field
     */
    function syncDisplayFromOriginal(field) {
        const pos = naturalBboxToDisplay({
            x0: field.originalX,
            y0: field.originalY,
            x1: field.originalX + field.originalWidth,
            y1: field.originalY + field.originalHeight
        });
        field.x = pos.x;
        field.y = pos.y;
        field.width = pos.width;
        field.height = pos.height;
        applyFieldGeometry(field);
    }

  /* ------------------------------------------------------------------ */
  /* Prétraitement canvas (sans toucher l'image affichée)                 */
  /* ------------------------------------------------------------------ */

    /**
     * Dessine l'image dans un canvas et applique le prétraitement optionnel.
     * @param {HTMLImageElement} img
     * @returns {HTMLCanvasElement}
     */
    function preprocessCanvasPixels(canvas) {
        const pp = state.preprocess || {};
        if (!pp.grayscale && (!pp.contrast || pp.contrast === 1) && pp.threshold == null) {
            return canvas;
        }

        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const contrast = pp.contrast != null ? pp.contrast : 1;
        const threshold = pp.threshold;

        for (let i = 0; i < data.length; i += 4) {
            let r = data[i];
            let g = data[i + 1];
            let b = data[i + 2];

            if (pp.grayscale) {
                const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                r = g = b = gray;
            }

            if (contrast !== 1) {
                r = clamp((r - 128) * contrast + 128, 0, 255);
                g = clamp((g - 128) * contrast + 128, 0, 255);
                b = clamp((b - 128) * contrast + 128, 0, 255);
            }

            if (threshold != null) {
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                const v = lum >= threshold ? 255 : 0;
                r = g = b = v;
            }

            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    function buildOcrCanvas(img) {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return preprocessCanvasPixels(canvas);
    }

    /** Clone un canvas source puis applique le prétraitement optionnel. */
    function canvasForOcr(source) {
        const canvas = document.createElement('canvas');
        canvas.width = source.width;
        canvas.height = source.height;
        canvas.getContext('2d').drawImage(source, 0, 0);
        return preprocessCanvasPixels(canvas);
    }

    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

  /* ------------------------------------------------------------------ */
  /* Extraction des éléments OCR selon le mode                           */
  /* ------------------------------------------------------------------ */

    function wordCenterY(w) {
        return (w.bbox.y0 + w.bbox.y1) / 2;
    }

    function wordHeight(w) {
        return w.bbox.y1 - w.bbox.y0;
    }

    function medianOf(nums) {
        if (!nums.length) return 0;
        const sorted = nums.slice().sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
    }

    function wordCenterInBbox(w, bbox) {
        if (!w || !w.bbox || !bbox) return false;
        const cx = (w.bbox.x0 + w.bbox.x1) / 2;
        const cy = (w.bbox.y0 + w.bbox.y1) / 2;
        return cx >= bbox.x0 && cx <= bbox.x1 && cy >= bbox.y0 && cy <= bbox.y1;
    }

    /**
     * @param {object[]} words
     * @returns {object[][]}
     */
    function groupWordsIntoLines(words) {
        if (!words.length) return [];
        const sorted = words.slice().sort((a, b) => wordCenterY(a) - wordCenterY(b) || a.bbox.x0 - b.bbox.x0);
        const heights = sorted.map(wordHeight).filter((h) => h > 0);
        const yTol = Math.max(8, medianOf(heights) * 0.55);

        const lines = [];
        let current = [sorted[0]];
        let currentY = wordCenterY(sorted[0]);

        for (let i = 1; i < sorted.length; i++) {
            const w = sorted[i];
            const cy = wordCenterY(w);
            if (Math.abs(cy - currentY) <= yTol) {
                current.push(w);
                currentY = current.reduce((s, ww) => s + wordCenterY(ww), 0) / current.length;
            } else {
                lines.push(current);
                current = [w];
                currentY = cy;
            }
        }
        lines.push(current);
        return lines;
    }

    /**
     * Fusionne les mots d'une ligne en segments selon l'écart horizontal max.
     * @param {object[]} lineWords
     * @param {number} maxGapPx — 0 = seuil auto par ligne
     * @returns {Array<{ text: string, confidence: number, bbox: object }>}
     */
    function segmentWordsOnLine(lineWords, maxGapPx) {
        if (!lineWords.length) return [];
        const ordered = lineWords.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);

        let gapLimit = maxGapPx;
        if (!gapLimit || gapLimit <= 0) {
            const widths = ordered.map((w) => w.bbox.x1 - w.bbox.x0).filter((w) => w > 0);
            const medW = medianOf(widths) || 40;
            gapLimit = clamp(medW * 0.45, 15, 100);
        }

        const segments = [];
        let chunk = [ordered[0]];

        function flush() {
            if (!chunk.length) return;
            const text = chunk.map((w) => w.text).join(' ');
            let confWeighted = 0;
            let confLen = 0;
            chunk.forEach((w) => {
                const len = (w.text || '').length || 1;
                confWeighted += (w.confidence != null ? w.confidence : 0) * len;
                confLen += len;
            });
            segments.push({
                text: text,
                confidence: confLen ? confWeighted / confLen : 0,
                bbox: {
                    x0: Math.min(...chunk.map((w) => w.bbox.x0)),
                    y0: Math.min(...chunk.map((w) => w.bbox.y0)),
                    x1: Math.max(...chunk.map((w) => w.bbox.x1)),
                    y1: Math.max(...chunk.map((w) => w.bbox.y1))
                }
            });
            chunk = [];
        }

        for (let i = 1; i < ordered.length; i++) {
            const prev = ordered[i - 1];
            const cur = ordered[i];
            const gap = cur.bbox.x0 - prev.bbox.x1;
            if (gap > gapLimit) {
                flush();
                chunk = [cur];
            } else {
                chunk.push(cur);
            }
        }
        flush();
        return segments;
    }

    /**
     * Mode intermédiaire : découpe une ligne en morceaux selon les grands espaces.
     * @param {object} data
     * @param {number} maxGapPx
     * @returns {Array<{ text: string, confidence: number, bbox: object }>}
     */
    function extractSegmentItems(data, maxGapPx) {
        const words = (data.words || []).filter((w) => w && w.bbox && w.text);
        const items = [];
        groupWordsIntoLines(words).forEach((line) => {
            segmentWordsOnLine(line, maxGapPx).forEach((seg) => items.push(seg));
        });
        return items;
    }

    /**
     * @param {object} data — résultat Tesseract data
     * @param {string} mode — blocks | lines | segments | words
     * @param {number} [maxWordGap]
     * @returns {Array<{ text: string, confidence: number, bbox: object }>}
     */
    function extractOcrItems(data, mode, maxWordGap) {
        const items = [];

        function pushItem(text, confidence, bbox) {
            if (!bbox) return;
            items.push({
                text: sanitizeText(text),
                confidence: confidence != null ? confidence : 0,
                bbox: {
                    x0: bbox.x0,
                    y0: bbox.y0,
                    x1: bbox.x1,
                    y1: bbox.y1
                }
            });
        }

        if (mode === 'words' && Array.isArray(data.words)) {
            data.words.forEach((w) => pushItem(w.text, w.confidence, w.bbox));
            return items;
        }

        if (mode === 'segments' && Array.isArray(data.words)) {
            extractSegmentItems(data, maxWordGap).forEach((seg) => {
                pushItem(seg.text, seg.confidence, seg.bbox);
            });
            return items;
        }

        if (mode === 'lines') {
            if (Array.isArray(data.lines) && Array.isArray(data.words) && data.words.length) {
                data.lines.forEach((ln) => {
                    if (!ln.bbox) return;
                    const wordsInLine = data.words.filter((w) => w && w.bbox && w.text && wordCenterInBbox(w, ln.bbox));
                    if (wordsInLine.length > 1) {
                        segmentWordsOnLine(wordsInLine, maxWordGap).forEach((seg) => {
                            pushItem(seg.text, seg.confidence, seg.bbox);
                        });
                    } else if (wordsInLine.length === 1) {
                        pushItem(wordsInLine[0].text, wordsInLine[0].confidence, wordsInLine[0].bbox);
                    } else {
                        pushItem(ln.text, ln.confidence, ln.bbox);
                    }
                });
                return items;
            }
            if (Array.isArray(data.lines)) {
                data.lines.forEach((ln) => pushItem(ln.text, ln.confidence, ln.bbox));
            }
            return items;
        }

        if (mode === 'blocks' && Array.isArray(data.blocks)) {
            data.blocks.forEach((bl) => {
                if (bl.bbox) {
                    pushItem(bl.text, bl.confidence, bl.bbox);
                } else if (Array.isArray(bl.paragraphs)) {
                    bl.paragraphs.forEach((p) => pushItem(p.text, p.confidence, p.bbox));
                }
            });
            return items;
        }

        if (Array.isArray(data.lines)) {
            data.lines.forEach((ln) => pushItem(ln.text, ln.confidence, ln.bbox));
        }
        return items;
    }

  /* ------------------------------------------------------------------ */
  /* Gestion des champs (création, interaction)                          */
  /* ------------------------------------------------------------------ */

    /**
     * Crée un objet champ et son DOM overlay + entrée liste.
     * @param {object} spec
     * @param {string} [insertAfterId] — insère après ce champ dans la liste
     * @returns {object}
     */
    function createField(spec, insertAfterId) {
        const bbox = {
            x0: spec.originalX,
            y0: spec.originalY,
            x1: spec.originalX + spec.originalWidth,
            y1: spec.originalY + spec.originalHeight
        };
        const display = naturalBboxToDisplay(bbox);

        const field = {
            id: spec.id || nextId(),
            text: spec.text || '',
            confidence: spec.confidence != null ? spec.confidence : 0,
            x: spec.x != null ? spec.x : display.x,
            y: spec.y != null ? spec.y : display.y,
            width: spec.width != null ? spec.width : display.width,
            height: spec.height != null ? spec.height : display.height,
            originalX: spec.originalX,
            originalY: spec.originalY,
            originalWidth: spec.originalWidth,
            originalHeight: spec.originalHeight,
            el: null,
            listEl: null
        };

        if (state.createOverlayInputs) {
            field.el = buildOverlayInput(field);
            state.overlayContainer.appendChild(field.el);
        }

        if (state.createListInputs) {
            const listHost = ensureListHost();
            if (listHost) {
                field.listEl = buildListInput(field);
            }
        }

        const insertIdx = insertAfterId
            ? state.fields.findIndex((f) => f.id === insertAfterId)
            : -1;
        if (insertIdx >= 0) {
            state.fields.splice(insertIdx + 1, 0, field);
            if (field.listEl && state.listItemsHost) {
                const anchor = state.fields[insertIdx].listEl;
                if (anchor) anchor.insertAdjacentElement('afterend', field.listEl);
                else state.listItemsHost.appendChild(field.listEl);
            }
        } else {
            state.fields.push(field);
            if (field.listEl && state.listItemsHost) {
                state.listItemsHost.appendChild(field.listEl);
            }
        }
        refreshListLabels();
        updateListEmptyState();
        return field;
    }

    /**
     * Coupe un champ en deux à la position du curseur (Entrée dans la liste).
     * @param {object} field
     * @param {HTMLInputElement} input
     * @returns {boolean}
     */
    function splitFieldAtCursor(field, input) {
        const pos = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
        const full = input.value;
        if (pos <= 0 || pos >= full.length) return false;

        const left = full.slice(0, pos).trimEnd();
        const right = full.slice(pos).trimStart();
        if (!left || !right) return false;

        const totalLen = left.length + right.length;
        const ratio = left.length / totalLen;
        const origTotalW = field.originalWidth;
        const splitW = Math.max(8, origTotalW * ratio);
        const newW = Math.max(8, origTotalW - splitW);

        field.text = left;
        input.value = left;
        if (field.el) {
            const oi = field.el.querySelector('input');
            if (oi) oi.value = left;
        }
        field.originalWidth = splitW;
        syncDisplayFromOriginal(field);

        const newField = createField({
            text: right,
            confidence: field.confidence,
            originalX: field.originalX + splitW,
            originalY: field.originalY,
            originalWidth: newW,
            originalHeight: field.originalHeight
        }, field.id);

        selectField(newField.id, false);
        const newInput = newField.listEl && newField.listEl.querySelector('input');
        if (newInput) {
            newInput.focus();
            try { newInput.setSelectionRange(0, 0); } catch (err) { /* ignore */ }
        }
        return true;
    }

    /** Conteneur liste (créé à la volée si absent). */
    function ensureListHost() {
        if (!state.listItemsHost) {
            const panel = state.listContainer;
            if (!panel) return null;
            const wrap = document.createElement('div');
            wrap.className = 'ocr-list-panel';
            wrap.innerHTML = '<p class="ocr-list-hint">Corrigez le texte ici · <strong>Entrée</strong> coupe en deux · <strong>×</strong> retire · <strong>⋮⋮</strong> trier</p>';
            const items = document.createElement('div');
            items.className = 'ocr-list-items';
            const empty = document.createElement('div');
            empty.className = 'ocr-list-empty';
            empty.textContent = 'Aucun texte pour l\'instant. Lancez l\'OCR, puis retirez ici ce qui ne vous intéresse pas.';
            items.appendChild(empty);
            state.listEmptyEl = empty;
            wrap.appendChild(items);
            panel.appendChild(wrap);
            state.listPanel = wrap;
            state.listItemsHost = items;
            wireListReorder(items);
        }
        return state.listItemsHost;
    }

    /** Affiche ou masque le message « liste vide ». */
    function updateListEmptyState() {
        if (!state.listEmptyEl) return;
        const hasItems = state.fields.length > 0;
        state.listEmptyEl.style.display = hasItems ? 'none' : '';
        if (state.listItemsHost) {
            state.listItemsHost.classList.toggle('has-items', hasItems);
        }
    }

    /** Réordonne state.fields selon l'ordre DOM de la liste. */
    function syncFieldsOrderFromList() {
        if (!state.listItemsHost) return;
        const ids = Array.from(state.listItemsHost.querySelectorAll('.ocr-list-item'))
            .map((el) => el.dataset.ocrId);
        const map = new Map(state.fields.map((f) => [f.id, f]));
        state.fields = ids.map((id) => map.get(id)).filter(Boolean);
        refreshListLabels();
    }

    /** Met à jour les numéros d'ordre affichés dans la liste. */
    function refreshListLabels() {
        state.fields.forEach((f, i) => {
            if (!f.listEl) return;
            const idx = f.listEl.querySelector('.ocr-list-index');
            if (idx) idx.textContent = String(i + 1);
        });
    }

    /** Tri manuel par glisser-déposer dans la liste latérale. */
    function wireListReorder(host) {
        if (!host || host.dataset.ocrSortWired) return;
        host.dataset.ocrSortWired = '1';
        let dragId = null;

        host.addEventListener('dragstart', (e) => {
            const grip = e.target.closest('.ocr-list-drag');
            if (!grip) {
                e.preventDefault();
                return;
            }
            const row = grip.closest('.ocr-list-item');
            if (!row) return;
            dragId = row.dataset.ocrId;
            row.classList.add('is-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', dragId);
        });

        host.addEventListener('dragend', (e) => {
            const row = e.target.closest('.ocr-list-item');
            if (row) row.classList.remove('is-dragging');
            dragId = null;
            host.querySelectorAll('.ocr-list-drop-target').forEach((el) => {
                el.classList.remove('ocr-list-drop-target');
            });
        });

        host.addEventListener('dragover', (e) => {
            if (!dragId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const row = e.target.closest('.ocr-list-item');
            host.querySelectorAll('.ocr-list-drop-target').forEach((el) => {
                el.classList.remove('ocr-list-drop-target');
            });
            if (row && row.dataset.ocrId !== dragId) {
                row.classList.add('ocr-list-drop-target');
            }
        });

        host.addEventListener('dragleave', (e) => {
            const row = e.target.closest('.ocr-list-item');
            if (row) row.classList.remove('ocr-list-drop-target');
        });

        host.addEventListener('drop', (e) => {
            if (!dragId) return;
            e.preventDefault();
            const targetRow = e.target.closest('.ocr-list-item');
            host.querySelectorAll('.ocr-list-drop-target').forEach((el) => {
                el.classList.remove('ocr-list-drop-target');
            });
            if (!targetRow || targetRow.dataset.ocrId === dragId) return;
            const srcRow = host.querySelector('.ocr-list-item[data-ocr-id="' + dragId + '"]');
            if (!srcRow) return;
            const rect = targetRow.getBoundingClientRect();
            const before = e.clientY < rect.top + rect.height / 2;
            if (before) host.insertBefore(srcRow, targetRow);
            else host.insertBefore(srcRow, targetRow.nextSibling);
            syncFieldsOrderFromList();
        });
    }

    /**
     * Construit l'input overlay positionné absolument.
     * @param {object} field
     * @returns {HTMLDivElement}
     */
    function buildOverlayInput(field) {
        const wrap = document.createElement('div');
        wrap.className = 'ocr-field';
        wrap.dataset.ocrId = field.id;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = field.text;
        input.style.width = '100%';
        input.style.height = '100%';
        input.style.border = 'none';
        input.style.background = 'transparent';
        input.style.padding = '0 2px';
        input.style.font = 'inherit';
        input.style.color = 'inherit';
        if (state.listPrimary) {
            input.readOnly = true;
            input.tabIndex = -1;
            input.className = 'ocr-field-mirror';
            input.title = 'Corrigez le texte dans la liste « Textes reconnus »';
        }

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'ocr-field-delete';
        del.title = 'Supprimer';
        del.textContent = '×';
        if (!state.listPrimary) {
            del.addEventListener('click', (e) => {
                e.stopPropagation();
                OCRAddon.deleteField(field.id);
            });
        } else {
            del.style.display = 'none';
        }

        const handle = document.createElement('div');
        handle.className = 'ocr-field-resize';
        handle.title = 'Redimensionner';

        wrap.appendChild(input);
        wrap.appendChild(del);
        wrap.appendChild(handle);

        applyFieldGeometry(field);

        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('click', (e) => e.stopPropagation());
        if (!state.listPrimary) {
            input.addEventListener('input', () => {
                field.text = input.value;
                if (field.listEl) {
                    const li = field.listEl.querySelector('input');
                    if (li && li.value !== field.text) li.value = field.text;
                }
            });
        }

        wrap.addEventListener('mousedown', (e) => {
            if (e.target === handle) return;
            if (e.target === del) return;
            selectField(field.id, !state.listPrimary && e.target === input);
            if (e.target === input) return;
            startDrag(field, e);
        });

        handle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            selectField(field.id, false);
            startResize(field, e);
        });

        return wrap;
    }

    /**
     * Entrée dans la liste latérale synchronisée avec l'overlay.
     * @param {object} field
     * @returns {HTMLDivElement}
     */
    function buildListInput(field) {
        const row = document.createElement('div');
        row.className = 'ocr-list-item';
        row.dataset.ocrId = field.id;

        const grip = document.createElement('button');
        grip.type = 'button';
        grip.className = 'ocr-list-drag';
        grip.title = 'Glisser pour réordonner';
        grip.textContent = '⋮⋮';
        grip.setAttribute('draggable', 'true');

        const index = document.createElement('span');
        index.className = 'ocr-list-index';
        index.textContent = '?';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'ocr-list-text';
        input.value = field.text;
        input.readOnly = false;
        input.disabled = false;
        input.autocomplete = 'off';
        input.spellcheck = typeof window.mqAdminSpellcheckEnabled === 'function'
            ? window.mqAdminSpellcheckEnabled()
            : true;
        input.lang = input.spellcheck ? 'fr' : '';
        input.title = field.id + ' · confiance ' + Math.round(field.confidence) + '% · modifiez le texte ici';

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'ocr-list-del';
        del.title = 'Retirer ce texte de la liste';
        del.setAttribute('aria-label', 'Supprimer ce texte');
        del.textContent = '×';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            OCRAddon.deleteField(field.id);
        });

        input.addEventListener('input', () => {
            field.text = input.value;
            if (field.el) {
                const oi = field.el.querySelector('input');
                if (oi && oi.value !== field.text) oi.value = field.text;
            }
        });

        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('pointerdown', (e) => e.stopPropagation());
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                splitFieldAtCursor(field, input);
                return;
            }
            e.stopPropagation();
        });

        input.addEventListener('focus', () => selectField(field.id, false));

        row.addEventListener('mousedown', (e) => {
            if (e.target.closest('.ocr-list-del') || e.target.closest('.ocr-list-drag')) return;
            if (e.target === input) return;
            selectField(field.id, false);
            input.focus();
        });

        row.addEventListener('click', (e) => {
            if (e.target.closest('.ocr-list-del') || e.target.closest('.ocr-list-drag')) return;
            if (e.target === input) return;
            selectField(field.id, false);
            input.focus();
        });

        row.appendChild(grip);
        row.appendChild(index);
        row.appendChild(input);
        row.appendChild(del);
        return row;
    }

    /** @type {{ field: object, startX: number, startY: number, origX: number, origY: number }|null} */
    let dragState = null;
    /** @type {{ field: object, startX: number, startY: number, origW: number, origH: number }|null} */
    let resizeState = null;

    function onPointerMove(e) {
        if (dragState) {
            const dx = e.clientX - dragState.startX;
            const dy = e.clientY - dragState.startY;
            dragState.field.x = dragState.origX + dx;
            dragState.field.y = dragState.origY + dy;
            applyFieldGeometry(dragState.field);
        }
        if (resizeState) {
            const dx = e.clientX - resizeState.startX;
            const dy = e.clientY - resizeState.startY;
            resizeState.field.width = Math.max(24, resizeState.origW + dx);
            resizeState.field.height = Math.max(18, resizeState.origH + dy);
            applyFieldGeometry(resizeState.field);
        }
    }

    function onPointerUp() {
        if (dragState) {
            syncOriginalFromDisplay(dragState.field);
            dragState = null;
        }
        if (resizeState) {
            syncOriginalFromDisplay(resizeState.field);
            resizeState = null;
        }
        document.removeEventListener('mousemove', onPointerMove);
        document.removeEventListener('mouseup', onPointerUp);
    }

    function startDrag(field, e) {
        dragState = {
            field,
            startX: e.clientX,
            startY: e.clientY,
            origX: field.x,
            origY: field.y
        };
        document.addEventListener('mousemove', onPointerMove);
        document.addEventListener('mouseup', onPointerUp);
    }

    function startResize(field, e) {
        resizeState = {
            field,
            startX: e.clientX,
            startY: e.clientY,
            origW: field.width,
            origH: field.height
        };
        document.addEventListener('mousemove', onPointerMove);
        document.addEventListener('mouseup', onPointerUp);
    }

    /**
     * Sélectionne un champ (classe .ocr-selected).
     * @param {string} id
     * @param {boolean} [focusOverlay=true]
     */
    function selectField(id, focusOverlay) {
        if (focusOverlay === undefined) focusOverlay = !state.listPrimary;
        state.selectedId = id;
        state.fields.forEach((f) => {
            const sel = f.id === id;
            if (f.el) f.el.classList.toggle('ocr-selected', sel);
            if (f.listEl) f.listEl.classList.toggle('is-active', sel);
        });
        if (focusOverlay) {
            const f = state.fields.find((x) => x.id === id);
            if (f && f.el) {
                const inp = f.el.querySelector('input');
                if (inp && !inp.readOnly) inp.focus();
            }
        }
    }

    function deselectAll() {
        state.selectedId = null;
        state.fields.forEach((f) => {
            if (f.el) f.el.classList.remove('ocr-selected');
            if (f.listEl) f.listEl.classList.remove('is-active');
        });
    }

    /** Empreinte zone + texte pour mémoriser une suppression manuelle. */
    function fieldToPurgedEntry(field) {
        return {
            text: sanitizeText(field.text).toLowerCase(),
            cx: field.originalX + field.originalWidth / 2,
            cy: field.originalY + field.originalHeight / 2,
            w: field.originalWidth,
            h: field.originalHeight
        };
    }

    function bboxToPurgedEntry(text, bbox) {
        return {
            text: sanitizeText(text).toLowerCase(),
            cx: (bbox.x0 + bbox.x1) / 2,
            cy: (bbox.y0 + bbox.y1) / 2,
            w: bbox.x1 - bbox.x0,
            h: bbox.y1 - bbox.y0
        };
    }

    function recordPurgedField(field) {
        if (!state || !field) return;
        if (!state.purgedItems) state.purgedItems = [];
        state.purgedItems.push(fieldToPurgedEntry(field));
    }

    /**
     * Vérifie si une détection OCR correspond à un texte supprimé manuellement.
     * @param {string} text
     * @param {{ x0: number, y0: number, x1: number, y1: number }} bbox
     */
    function isPurgedDetection(text, bbox) {
        if (!state.purgedItems || !state.purgedItems.length) return false;
        const cur = bboxToPurgedEntry(text, bbox);
        return state.purgedItems.some((p) => {
            const dist = Math.hypot(p.cx - cur.cx, p.cy - cur.cy);
            const tol = Math.max(24, Math.min(p.w, cur.w) * 0.45);
            if (dist > tol) return false;
            if (!p.text && !cur.text) return true;
            if (!p.text || !cur.text) return dist < tol * 0.65;
            return p.text === cur.text
                || p.text.includes(cur.text)
                || cur.text.includes(p.text);
        });
    }

    /** Évite les doublons lors d'un second passage OCR. */
    function overlapsExistingField(bbox) {
        const cx = (bbox.x0 + bbox.x1) / 2;
        const cy = (bbox.y0 + bbox.y1) / 2;
        const w = bbox.x1 - bbox.x0;
        const h = bbox.y1 - bbox.y0;
        return state.fields.some((f) => {
            const fcx = f.originalX + f.originalWidth / 2;
            const fcy = f.originalY + f.originalHeight / 2;
            const dist = Math.hypot(fcx - cx, fcy - cy);
            const tol = Math.max(20, Math.min(f.originalWidth, w) * 0.4);
            return dist < tol;
        });
    }

    /**
     * Supprime un champ par id.
     * @param {string} id
     */
    function removeFieldById(id, skipPurgeRecord) {
        const idx = state.fields.findIndex((f) => f.id === id);
        if (idx === -1) return;
        const field = state.fields[idx];
        if (!skipPurgeRecord) recordPurgedField(field);
        if (field.el) field.el.remove();
        if (field.listEl) field.listEl.remove();
        state.fields.splice(idx, 1);
        if (state.selectedId === id) state.selectedId = null;
        refreshListLabels();
        updateListEmptyState();
    }

    /**
     * Duplique le champ sélectionné ou celui passé en paramètre.
     * @param {string} [id]
     */
    function duplicateField(id) {
        const srcId = id || state.selectedId;
        if (!srcId) return null;
        const src = state.fields.find((f) => f.id === srcId);
        if (!src) return null;
        const offset = 12;
        return createField({
            text: src.text,
            confidence: src.confidence,
            originalX: src.originalX + offset,
            originalY: src.originalY + offset,
            originalWidth: src.originalWidth,
            originalHeight: src.originalHeight,
            x: src.x + offset,
            y: src.y + offset,
            width: src.width,
            height: src.height
        });
    }

  /* ------------------------------------------------------------------ */
  /* Barre d'outils intégrée                                             */
  /* ------------------------------------------------------------------ */

    function updateProgress(pct, message) {
        if (!state.toolbar) return;
        const bar = state.toolbar.querySelector('.ocr-progress-bar');
        const txt = state.toolbar.querySelector('.ocr-progress-text');
        if (bar) bar.style.width = Math.round(pct * 100) + '%';
        if (txt) txt.textContent = message || (pct > 0 ? Math.round(pct * 100) + '%' : 'Prêt');
    }

    /**
     * Synchronise les contrôles de la barre d'outils avec l'état courant.
     */
    function syncToolbarControls() {
        if (!state || !state.toolbar) return;
        const bar = state.toolbar;
        const modeSel = bar.querySelector('[data-control="mode"]');
        if (modeSel) modeSel.value = state.mode;
        const mc = bar.querySelector('[data-control="minConfidence"]');
        if (mc) mc.value = state.minConfidence;
        const ml = bar.querySelector('[data-control="minTextLength"]');
        if (ml) ml.value = state.minTextLength;
        const mg = bar.querySelector('[data-control="maxWordGap"]');
        if (mg) mg.value = state.maxWordGap != null ? state.maxWordGap : 35;
        const gapWrap = bar.querySelector('[data-control="maxWordGap-wrap"]');
        if (gapWrap) {
            gapWrap.style.display = (state.mode === 'segments' || state.mode === 'lines') ? '' : 'none';
        }
        const pp = state.preprocess || {};
        const ct = bar.querySelector('[data-control="contrast"]');
        if (ct) ct.value = pp.contrast != null ? pp.contrast : 1.2;
        const th = bar.querySelector('[data-control="threshold"]');
        if (th) th.value = pp.threshold != null && pp.threshold !== '' ? pp.threshold : '';
    }

    /**
     * Construit et injecte la barre d'outils dans le conteneur fourni.
     * @param {HTMLElement} container
     */
    function buildToolbar(container) {
        container.innerHTML = '';
        const bar = document.createElement('div');
        bar.className = 'ocr-toolbar';
        bar.innerHTML = [
            '<div class="ocr-toolbar-group">',
            '  <button type="button" class="ocr-btn-primary" data-action="run">Lancer OCR</button>',
            '  <button type="button" data-action="clear">Effacer OCR</button>',
            '</div>',
            '<div class="ocr-toolbar-group">',
            '  <button type="button" data-action="export-json">Exporter JSON</button>',
            '  <button type="button" data-action="import-json">Importer JSON</button>',
            '  <button type="button" data-action="export-csv">Exporter CSV</button>',
            '</div>',
            '<div class="ocr-toolbar-group">',
            '  <label>Mode',
            '    <select data-control="mode">',
            '      <option value="blocks">blocks</option>',
            '      <option value="lines">lines</option>',
            '      <option value="segments" selected>segments</option>',
            '      <option value="words">words</option>',
            '    </select>',
            '  </label>',
            '  <label data-control="maxWordGap-wrap" title="Coupure si l\'écart horizontal entre deux mots dépasse cette valeur (px image). Plus bas = moins de fusion. 0 = auto.">Écart mots (px)',
            '    <input type="number" data-control="maxWordGap" min="0" max="500" step="1" value="35">',
            '  </label>',
            '  <label>Confiance min.',
            '    <input type="number" data-control="minConfidence" min="0" max="100" value="70">',
            '  </label>',
            '  <label>Long. min.',
            '    <input type="number" data-control="minTextLength" min="1" max="50" value="2">',
            '  </label>',
            '</div>',
            '<div class="ocr-toolbar-group ocr-toolbar-pre">',
            '  <label>Contraste',
            '    <input type="number" data-control="contrast" min="0.8" max="2" step="0.05" value="1.2">',
            '  </label>',
            '  <label title="Binarisation anti-filigrane (vide = désactivé)">Seuil filigrane',
            '    <input type="number" data-control="threshold" min="120" max="245" step="1" placeholder="off">',
            '  </label>',
            '  <button type="button" class="ocr-btn-preset" data-action="preset-watermark" title="Segments · écart 55 · contraste 1,35 · seuil 185">Fiche filigranée</button>',
            '</div>',
            '<div class="ocr-progress" title="Progression OCR"><div class="ocr-progress-bar"></div></div>',
            '<span class="ocr-progress-text">Prêt</span>'
        ].join('');

        bar.querySelector('[data-action="run"]').addEventListener('click', () => OCRAddon.runOCR());
        bar.querySelector('[data-action="clear"]').addEventListener('click', () => OCRAddon.clear());
        bar.querySelector('[data-action="export-json"]').addEventListener('click', () => {
            const data = OCRAddon.exportJSON();
            downloadBlob(JSON.stringify(data, null, 2), 'ocr-fields.json', 'application/json');
        });
        bar.querySelector('[data-action="import-json"]').addEventListener('click', () => {
            pickJsonFile((data) => OCRAddon.importJSON(data));
        });
        bar.querySelector('[data-action="export-csv"]').addEventListener('click', () => {
            downloadBlob(OCRAddon.exportCSV(), 'ocr-fields.csv', 'text/csv;charset=utf-8');
        });

        bar.querySelector('[data-control="mode"]').addEventListener('change', (e) => {
            state.mode = e.target.value;
            syncToolbarControls();
        });
        bar.querySelector('[data-control="minConfidence"]').addEventListener('change', (e) => {
            OCRAddon.setFilter({ minConfidence: Number(e.target.value) });
        });
        bar.querySelector('[data-control="minTextLength"]').addEventListener('change', (e) => {
            OCRAddon.setFilter({ minTextLength: Number(e.target.value) });
        });
        bar.querySelector('[data-control="maxWordGap"]').addEventListener('change', (e) => {
            const v = Number(e.target.value);
            OCRAddon.setFilter({ maxWordGap: Number.isFinite(v) && v >= 0 ? Math.round(v) : 35 });
        });
        bar.querySelector('[data-control="contrast"]').addEventListener('change', (e) => {
            const v = Number(e.target.value);
            OCRAddon.setPreprocess({ contrast: Number.isFinite(v) && v > 0 ? v : 1.2 });
        });
        bar.querySelector('[data-control="threshold"]').addEventListener('change', (e) => {
            const raw = String(e.target.value).trim();
            const v = raw === '' ? null : Number(raw);
            OCRAddon.setPreprocess({
                threshold: v != null && Number.isFinite(v) ? Math.round(v) : null
            });
        });
        bar.querySelector('[data-action="preset-watermark"]').addEventListener('click', () => {
            OCRAddon.applyPreset('fiche-filigrane');
        });

        syncToolbarControls();

        container.appendChild(bar);
        state.toolbar = bar;
    }

    function downloadBlob(content, filename, mime) {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    function pickJsonFile(callback) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    callback(JSON.parse(reader.result));
                } catch (err) {
                    alert('JSON invalide : ' + err.message);
                }
            };
            reader.readAsText(file);
        });
        input.click();
    }

  /* ------------------------------------------------------------------ */
  /* Raccourcis clavier globaux                                          */
  /* ------------------------------------------------------------------ */

    function onKeyDown(e) {
        if (!state || !state.selectedId) return;

        const ae = document.activeElement;
        if (isOcrTextInput(ae)) return;

        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (isTypingInOtherInput(e.target)) return;
            e.preventDefault();
            OCRAddon.deleteField(state.selectedId);
            return;
        }
        if (isTypingInOtherInput(e.target)) return;

        if (e.key === 'Escape') {
            deselectAll();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
            e.preventDefault();
            duplicateField();
        }
    }

    function isTypingInOtherInput(target) {
        if (!target) return false;
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
            return !isOcrTextInput(target);
        }
        return false;
    }

    function setupResizeObserver() {
        if (resizeObserver) resizeObserver.disconnect();
        const observeEl = state.observeResizeElement || state.imageElement;
        if (!observeEl || typeof ResizeObserver === 'undefined') return;
        resizeObserver = new ResizeObserver(() => {
            if (state && state.fields.length) OCRAddon.refreshPositions();
        });
        resizeObserver.observe(observeEl);
    }

  /* ------------------------------------------------------------------ */
  /* API publique OCRAddon                                               */
  /* ------------------------------------------------------------------ */

    const OCRAddon = {};

    /**
     * Initialise l'addon sur une image et un overlay déjà présents dans le DOM.
     * @param {object} options
     */
    OCRAddon.init = function (options) {
        const opts = mergeOptions(DEFAULTS, options);

        state = {
            imageElement: resolveElement(opts.imageElement) || resolveElement(opts.imageSelector),
            overlayContainer: resolveElement(opts.overlayContainer) || resolveElement(opts.overlayContainerSelector),
            listContainer: resolveElement(opts.listContainer) || resolveElement(opts.listContainerSelector),
            language: opts.language,
            mode: opts.mode || 'segments',
            minConfidence: opts.minConfidence,
            minTextLength: opts.minTextLength,
            maxWordGap: opts.maxWordGap != null ? opts.maxWordGap : 35,
            createOverlayInputs: opts.createOverlayInputs,
            createListInputs: opts.createListInputs,
            useDisplayedImageCoordinates: opts.useDisplayedImageCoordinates,
            preprocess: Object.assign({}, opts.preprocess),
            transform: { scale: 1, translateX: 0, translateY: 0 },
            fields: [],
            selectedId: null,
            toolbar: null,
            listPanel: null,
            listItemsHost: null,
            running: false,
            purgedItems: [],
            getOcrCanvas: typeof opts.getOcrCanvas === 'function' ? opts.getOcrCanvas : null,
            observeResizeElement: resolveElement(opts.observeResizeElement),
            beforeRunOCR: typeof opts.beforeRunOCR === 'function' ? opts.beforeRunOCR : null,
            listPrimary: !!opts.listPrimary,
            mapOcrBbox: typeof opts.mapOcrBbox === 'function' ? opts.mapOcrBbox : null
        };

        if (!state.imageElement && !state.getOcrCanvas) {
            throw new Error('OCRAddon.init : imageElement ou getOcrCanvas requis.');
        }
        if (!state.overlayContainer) {
            throw new Error('OCRAddon.init : overlayContainer ou overlayContainerSelector requis.');
        }

        if (!state.overlayContainer.style.position || state.overlayContainer.style.position === 'static') {
            state.overlayContainer.style.position = 'absolute';
        }

        const tbHost = resolveElement(opts.toolbarContainer) || resolveElement(opts.toolbarContainerSelector);
        if (tbHost) buildToolbar(tbHost);

        document.addEventListener('keydown', onKeyDown);
        setupResizeObserver();

        state.overlayContainer.addEventListener('mousedown', (e) => {
            if (e.target === state.overlayContainer) deselectAll();
        });

        return OCRAddon;
    };

    /**
     * Lance la reconnaissance OCR sur l'image affichée.
     * @returns {Promise<object[]>} champs créés
     */
    OCRAddon.runOCR = async function () {
        if (!state) throw new Error('OCRAddon non initialisé. Appelez OCRAddon.init() d\'abord.');
        if (state.running) return state.fields;

        if (state.beforeRunOCR) {
            const ok = await Promise.resolve(state.beforeRunOCR());
            if (ok === false) return [];
        }

        const img = state.imageElement;
        if (!state.getOcrCanvas && img) {
            if (!img.complete || !img.naturalWidth) {
                await new Promise((resolve, reject) => {
                    img.addEventListener('load', resolve, { once: true });
                    img.addEventListener('error', () => reject(new Error('Image non chargée.')), { once: true });
                });
            }
        }

        state.running = true;
        if (state.toolbar) state.toolbar.closest('.ocr-toolbar')?.parentElement?.classList.add('ocr-running');
        state.overlayContainer.classList.add('ocr-overlay-busy');
        updateProgress(0, 'Initialisation…');

        try {
            if (typeof Tesseract === 'undefined') {
                throw new Error('Tesseract.js non chargé. Ajoutez le script CDN avant ocr-addon.js.');
            }

            let canvas;
            if (state.getOcrCanvas) {
                const raw = state.getOcrCanvas();
                if (!(raw instanceof HTMLCanvasElement)) {
                    throw new Error('getOcrCanvas() doit retourner un HTMLCanvasElement.');
                }
                canvas = canvasForOcr(raw);
            } else {
                canvas = buildOcrCanvas(img);
            }

            if (!worker) {
                worker = await Tesseract.createWorker(state.language, 1, {
                    logger: (m) => {
                        if (m.status === 'recognizing text' && m.progress != null) {
                            updateProgress(m.progress, 'Reconnaissance… ' + Math.round(m.progress * 100) + '%');
                        } else if (m.status) {
                            updateProgress(m.progress || 0, m.status);
                        }
                    }
                });
            }

            updateProgress(0.05, 'Analyse en cours…');
            const { data } = await worker.recognize(canvas);

            const rawItems = extractOcrItems(data, state.mode, state.maxWordGap);
            const appendMode = state.fields.length > 0;
            if (!appendMode) {
                state.fields.slice().forEach((f) => removeFieldById(f.id, true));
                if (state.listPanel) {
                    state.listPanel.remove();
                    state.listPanel = null;
                    state.listItemsHost = null;
                    state.listEmptyEl = null;
                }
                updateListEmptyState();
            }

            const created = [];
            let skippedPurged = 0;
            let skippedDup = 0;
            rawItems.forEach((item) => {
                if (!passesFilter(item.text, item.confidence)) return;
                let bbox = item.bbox;
                if (state.mapOcrBbox) {
                    const mapped = state.mapOcrBbox(bbox);
                    if (mapped) bbox = mapped;
                }
                if (isPurgedDetection(item.text, bbox)) {
                    skippedPurged += 1;
                    return;
                }
                if (appendMode && overlapsExistingField(bbox)) {
                    skippedDup += 1;
                    return;
                }
                const w = bbox.x1 - bbox.x0;
                const h = bbox.y1 - bbox.y0;
                const field = createField({
                    text: item.text,
                    confidence: item.confidence,
                    originalX: bbox.x0,
                    originalY: bbox.y0,
                    originalWidth: w,
                    originalHeight: h
                });
                created.push(field);
            });

            let msg = created.length + ' champ(s) créé(s)';
            if (skippedPurged) msg += ' · ' + skippedPurged + ' ignoré(s) (purge)';
            if (skippedDup) msg += ' · ' + skippedDup + ' doublon(s)';
            if (appendMode && !created.length && !skippedPurged) {
                msg = 'Aucun nouveau texte détecté';
            }
            updateProgress(1, msg);
            return created;
        } catch (err) {
            updateProgress(0, 'Erreur');
            console.error('[OCRAddon]', err);
            throw err;
        } finally {
            state.running = false;
            if (state.toolbar) state.toolbar.closest('.ocr-toolbar')?.parentElement?.classList.remove('ocr-running');
            state.overlayContainer.classList.remove('ocr-overlay-busy');
        }
    };

    /**
     * Supprime tous les champs OCR.
     * @param {boolean} [resetProgress=true]
     */
    OCRAddon.clear = function (resetProgress) {
        if (!state) return;
        if (resetProgress !== false) updateProgress(0, 'Prêt');
        state.purgedItems = [];
        state.fields.slice().forEach((f) => removeFieldById(f.id, true));
        if (state.listPanel) {
            state.listPanel.remove();
            state.listPanel = null;
            state.listItemsHost = null;
            state.listEmptyEl = null;
        }
        updateListEmptyState();
    };

    /**
     * Exporte les champs au format JSON (sans original*).
     * @returns {object[]}
     */
    OCRAddon.exportJSON = function () {
        if (!state) return [];
        return state.fields.map((f) => ({
            id: f.id,
            text: f.text,
            confidence: Math.round(f.confidence),
            x: Math.round(f.x * 100) / 100,
            y: Math.round(f.y * 100) / 100,
            width: Math.round(f.width * 100) / 100,
            height: Math.round(f.height * 100) / 100
        }));
    };

    /**
     * Importe des champs depuis JSON et les place sur l'overlay.
     * @param {object[]} data
     */
    OCRAddon.importJSON = function (data) {
        if (!state) throw new Error('OCRAddon non initialisé.');
        if (!Array.isArray(data)) throw new Error('importJSON attend un tableau.');

        OCRAddon.clear(false);

        data.forEach((row) => {
            const nat = displayToNatural(row.x, row.y, row.width, row.height);
            createField({
                id: row.id,
                text: row.text || '',
                confidence: row.confidence != null ? row.confidence : 0,
                x: row.x,
                y: row.y,
                width: row.width,
                height: row.height,
                originalX: nat.originalX,
                originalY: nat.originalY,
                originalWidth: nat.originalWidth,
                originalHeight: nat.originalHeight
            });
        });

        syncIdCounter(state.fields);
        OCRAddon.refreshPositions();
    };

    /**
     * Exporte les champs en CSV (séparateur ;).
     * @returns {string}
     */
    OCRAddon.exportCSV = function () {
        const rows = OCRAddon.exportJSON();
        const lines = ['id;text;confidence;x;y;width;height'];
        rows.forEach((r) => {
            const text = String(r.text).replace(/"/g, '""');
            lines.push([
                r.id,
                '"' + text + '"',
                r.confidence,
                r.x,
                r.y,
                r.width,
                r.height
            ].join(';'));
        });
        return lines.join('\n');
    };

    /**
     * Met à jour les filtres (appliqués au prochain runOCR).
     * @param {{ minConfidence?: number, minTextLength?: number, maxWordGap?: number }} options
     */
    OCRAddon.setFilter = function (options) {
        if (!state) return;
        if (options.minConfidence != null) state.minConfidence = options.minConfidence;
        if (options.minTextLength != null) state.minTextLength = options.minTextLength;
        if (options.maxWordGap != null) state.maxWordGap = options.maxWordGap;
        syncToolbarControls();
    };

    /**
     * Met à jour le prétraitement image (appliqué au prochain runOCR).
     * @param {{ grayscale?: boolean, contrast?: number, threshold?: number|null }} options
     */
    OCRAddon.setPreprocess = function (options) {
        if (!state) return;
        if (!state.preprocess) state.preprocess = Object.assign({}, DEFAULTS.preprocess);
        if (options.grayscale != null) state.preprocess.grayscale = !!options.grayscale;
        if (options.contrast != null) state.preprocess.contrast = options.contrast;
        if (Object.prototype.hasOwnProperty.call(options, 'threshold')) {
            state.preprocess.threshold = options.threshold;
        }
        syncToolbarControls();
    };

    /**
     * Applique un jeu de réglages prédéfini (filtres + prétraitement).
     * @param {string} name — ex. « fiche-filigrane »
     */
    OCRAddon.applyPreset = function (name) {
        if (!state) return;
        const preset = OCR_PRESETS[name];
        if (!preset) return;
        if (preset.mode) state.mode = preset.mode;
        OCRAddon.setFilter({
            minConfidence: preset.minConfidence != null ? preset.minConfidence : state.minConfidence,
            minTextLength: preset.minTextLength != null ? preset.minTextLength : state.minTextLength,
            maxWordGap: preset.maxWordGap != null ? preset.maxWordGap : state.maxWordGap
        });
        if (preset.preprocess) {
            OCRAddon.setPreprocess(preset.preprocess);
        }
        syncToolbarControls();
    };

    /**
     * Retourne une copie des champs avec métadonnées complètes.
     * @returns {object[]}
     */
    OCRAddon.getFields = function () {
        if (!state) return [];
        return state.fields.map((f) => {
            syncFieldTextFromDom(f);
            return {
            id: f.id,
            text: f.text,
            confidence: f.confidence,
            x: f.x,
            y: f.y,
            width: f.width,
            height: f.height,
            originalX: f.originalX,
            originalY: f.originalY,
            originalWidth: f.originalWidth,
            originalHeight: f.originalHeight
        };
        });
    };

    /**
     * Met à jour le texte d'un champ OCR (liste + overlay).
     * @param {string} id
     * @param {string} text
     */
    OCRAddon.setFieldText = function (id, text) {
        if (!state) return;
        const f = state.fields.find((x) => x.id === id);
        if (!f) return;
        f.text = text;
        if (f.listEl) {
            const inp = f.listEl.querySelector('input.ocr-list-text, input');
            if (inp) inp.value = text;
        }
        if (f.el) {
            const oi = f.el.querySelector('input');
            if (oi) oi.value = text;
        }
    };

    /**
     * Recalcule les positions affichées depuis les coords image naturelle.
     */
    OCRAddon.refreshPositions = function () {
        if (!state) return;
        state.fields.forEach((f) => syncDisplayFromOriginal(f));
    };

    /**
     * Applique une transformation zoom/pan externe.
     * @param {{ scale?: number, translateX?: number, translateY?: number }} t
     */
    OCRAddon.setTransform = function (t) {
        if (!state) return;
        if (t.scale != null) state.transform.scale = t.scale;
        if (t.translateX != null) state.transform.translateX = t.translateX;
        if (t.translateY != null) state.transform.translateY = t.translateY;
        OCRAddon.refreshPositions();
    };

    /**
     * Supprime un champ par identifiant.
     * @param {string} id
     */
    OCRAddon.deleteField = function (id) {
        if (!state) return;
        removeFieldById(id, false);
    };

    /**
     * Réinitialise uniquement la liste des textes purgés (sans effacer les champs).
     */
    OCRAddon.clearPurged = function () {
        if (!state) return;
        state.purgedItems = [];
    };

    /**
     * Nombre de zones exclues manuellement des prochains OCR.
     */
    OCRAddon.getPurgedCount = function () {
        if (!state || !state.purgedItems) return 0;
        return state.purgedItems.length;
    };

    /**
     * Duplique un champ (sélectionné ou par id).
     * @param {string} [id]
     */
    OCRAddon.duplicateField = function (id) {
        return duplicateField(id);
    };

    /**
     * Réordonne les champs selon un tableau d'identifiants.
     * @param {string[]} ids
     */
    OCRAddon.reorderFields = function (ids) {
        if (!state || !Array.isArray(ids)) return;
        const map = new Map(state.fields.map((f) => [f.id, f]));
        const next = ids.map((id) => map.get(id)).filter(Boolean);
        if (!next.length) return;
        state.fields.forEach((f) => {
            if (!ids.includes(f.id)) next.push(f);
        });
        state.fields = next;
        if (state.listItemsHost) {
            state.fields.forEach((f) => {
                if (f.listEl) state.listItemsHost.appendChild(f.listEl);
            });
            refreshListLabels();
        }
    };

    /**
     * Termine le worker Tesseract (libération mémoire).
     */
    OCRAddon.terminate = async function () {
        if (worker) {
            await worker.terminate();
            worker = null;
        }
    };

    global.OCRAddon = OCRAddon;

}(typeof window !== 'undefined' ? window : this));
