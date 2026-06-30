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
        mode: 'lines',
        minConfidence: 70,
        minTextLength: 2,
        createOverlayInputs: true,
        createListInputs: true,
        useDisplayedImageCoordinates: true,
        preprocess: {
            grayscale: true,
            contrast: 1.2,
            threshold: null
        },
        getOcrCanvas: null,
        observeResizeElement: null,
        beforeRunOCR: null,
        listPrimary: false
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

    /**
     * @param {object} data — résultat Tesseract data
     * @param {string} mode — blocks | lines | words
     * @returns {Array<{ text: string, confidence: number, bbox: object }>}
     */
    function extractOcrItems(data, mode) {
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

        if (mode === 'lines' && Array.isArray(data.lines)) {
            data.lines.forEach((ln) => pushItem(ln.text, ln.confidence, ln.bbox));
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
     * @returns {object}
     */
    function createField(spec) {
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
                listHost.appendChild(field.listEl);
            }
        }

        state.fields.push(field);
        refreshListLabels();
        updateListEmptyState();
        return field;
    }

    /** Conteneur liste (créé à la volée si absent). */
    function ensureListHost() {
        if (!state.listItemsHost) {
            const panel = state.listContainer;
            if (!panel) return null;
            const wrap = document.createElement('div');
            wrap.className = 'ocr-list-panel';
            wrap.innerHTML = '<p class="ocr-list-hint">Supprimez les textes inutiles avec <strong>×</strong> · glissez <strong>⋮⋮</strong> pour trier</p>';
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

        input.addEventListener('input', () => {
            field.text = input.value;
            if (field.listEl) {
                const li = field.listEl.querySelector('input');
                if (li && li.value !== field.text) li.value = field.text;
            }
        });

        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('click', (e) => e.stopPropagation());

        wrap.addEventListener('mousedown', (e) => {
            if (e.target === handle) return;
            if (e.target === del) return;
            selectField(field.id);
            if (e.target === input) return;
            startDrag(field, e);
        });

        handle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            selectField(field.id);
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
        input.value = field.text;
        input.title = field.id + ' · confiance ' + Math.round(field.confidence) + '%';

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

        input.addEventListener('focus', () => selectField(field.id, false));

        row.addEventListener('click', (e) => {
            if (e.target.closest('.ocr-list-del') || e.target.closest('.ocr-list-drag')) return;
            selectField(field.id, false);
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
        if (focusOverlay === undefined) focusOverlay = true;
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
                if (inp) inp.focus();
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

    /**
     * Supprime un champ par id.
     * @param {string} id
     */
    function removeFieldById(id) {
        const idx = state.fields.findIndex((f) => f.id === id);
        if (idx === -1) return;
        const field = state.fields[idx];
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
            '      <option value="lines" selected>lines</option>',
            '      <option value="words">words</option>',
            '    </select>',
            '  </label>',
            '  <label>Confiance min.',
            '    <input type="number" data-control="minConfidence" min="0" max="100" value="70">',
            '  </label>',
            '  <label>Long. min.',
            '    <input type="number" data-control="minTextLength" min="1" max="50" value="2">',
            '  </label>',
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
        });
        bar.querySelector('[data-control="minConfidence"]').addEventListener('change', (e) => {
            OCRAddon.setFilter({ minConfidence: Number(e.target.value) });
        });
        bar.querySelector('[data-control="minTextLength"]').addEventListener('change', (e) => {
            OCRAddon.setFilter({ minTextLength: Number(e.target.value) });
        });

        const modeSel = bar.querySelector('[data-control="mode"]');
        modeSel.value = state.mode;
        bar.querySelector('[data-control="minConfidence"]').value = state.minConfidence;
        bar.querySelector('[data-control="minTextLength"]').value = state.minTextLength;

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
        if (isTypingInOtherInput(e.target)) return;

        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (e.target && e.target.closest && e.target.closest('.ocr-field input')) {
                if (e.key === 'Backspace' && e.target.value) return;
            }
            e.preventDefault();
            OCRAddon.deleteField(state.selectedId);
            return;
        }
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
            return !target.closest('.ocr-field') && !target.closest('.ocr-list-item');
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
            mode: opts.mode || 'lines',
            minConfidence: opts.minConfidence,
            minTextLength: opts.minTextLength,
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
            getOcrCanvas: typeof opts.getOcrCanvas === 'function' ? opts.getOcrCanvas : null,
            observeResizeElement: resolveElement(opts.observeResizeElement),
            beforeRunOCR: typeof opts.beforeRunOCR === 'function' ? opts.beforeRunOCR : null,
            listPrimary: !!opts.listPrimary
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

        if (state.beforeRunOCR && state.beforeRunOCR() === false) {
            return [];
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

            const rawItems = extractOcrItems(data, state.mode);
            OCRAddon.clear(false);

            const created = [];
            rawItems.forEach((item) => {
                if (!passesFilter(item.text, item.confidence)) return;
                const w = item.bbox.x1 - item.bbox.x0;
                const h = item.bbox.y1 - item.bbox.y0;
                const field = createField({
                    text: item.text,
                    confidence: item.confidence,
                    originalX: item.bbox.x0,
                    originalY: item.bbox.y0,
                    originalWidth: w,
                    originalHeight: h
                });
                created.push(field);
            });

            updateProgress(1, created.length + ' champ(s) créé(s)');
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
        state.fields.slice().forEach((f) => removeFieldById(f.id));
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
     * @param {{ minConfidence?: number, minTextLength?: number }} options
     */
    OCRAddon.setFilter = function (options) {
        if (!state) return;
        if (options.minConfidence != null) state.minConfidence = options.minConfidence;
        if (options.minTextLength != null) state.minTextLength = options.minTextLength;
        if (state.toolbar) {
            const mc = state.toolbar.querySelector('[data-control="minConfidence"]');
            const ml = state.toolbar.querySelector('[data-control="minTextLength"]');
            if (mc) mc.value = state.minConfidence;
            if (ml) ml.value = state.minTextLength;
        }
    };

    /**
     * Retourne une copie des champs avec métadonnées complètes.
     * @returns {object[]}
     */
    OCRAddon.getFields = function () {
        if (!state) return [];
        return state.fields.map((f) => ({
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
        }));
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
        removeFieldById(id);
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
