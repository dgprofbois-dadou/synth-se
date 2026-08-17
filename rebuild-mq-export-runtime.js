/**
 * rebuild-mq-export-runtime.js
 * Régénère mq-export-runtime.js depuis export-runtime/*.js|css
 *
 * Usage: node rebuild-mq-export-runtime.js
 * Option: node rebuild-mq-export-runtime.js --extract  (extrait depuis le runtime actuel)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'mq-export-runtime.js');
const DIR = path.join(ROOT, 'export-runtime');

function ensureDir() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

function extractFromCurrent() {
  ensureDir();
  const src = fs.readFileSync(OUT, 'utf8');
  // eslint-disable-next-line no-new-func
  const runtime = new Function(`
    var window = {};
    ${src}
    return window.MQ_EXPORT_RUNTIME;
  `)();
  if (!runtime || !runtime.scriptJs) {
    throw new Error('Impossible d\'extraire MQ_EXPORT_RUNTIME');
  }
  fs.writeFileSync(path.join(DIR, 'style.css'), runtime.styleCss || '', 'utf8');
  fs.writeFileSync(path.join(DIR, 'script.js'), runtime.scriptJs || '', 'utf8');
  fs.writeFileSync(path.join(DIR, 'pdf-export.js'), runtime.pdfExportJs || '', 'utf8');
  fs.writeFileSync(path.join(DIR, 'fullscreen.js'), runtime.fullscreenJs || '', 'utf8');
  console.log('Extrait vers export-runtime/');
}

function jsStringLiteral(s) {
  return JSON.stringify(s);
}

function rebuild() {
  ensureDir();
  const files = {
    styleCss: 'style.css',
    scriptJs: 'script.js',
    pdfExportJs: 'pdf-export.js',
    fullscreenJs: 'fullscreen.js'
  };
  for (const f of Object.values(files)) {
    const p = path.join(DIR, f);
    if (!fs.existsSync(p)) {
      console.error('Manquant:', p, '— lancez d\'abord: node rebuild-mq-export-runtime.js --extract');
      process.exit(1);
    }
  }

  // Préfixer le script export avec le moteur DnD + CSS DnD étendu
  const engine = fs.readFileSync(path.join(ROOT, 'mq-dnd-engine.js'), 'utf8');
  let styleCss = fs.readFileSync(path.join(DIR, 'style.css'), 'utf8');
  let scriptJs = fs.readFileSync(path.join(DIR, 'script.js'), 'utf8');
  const pdfExportJs = fs.readFileSync(path.join(DIR, 'pdf-export.js'), 'utf8');
  const fullscreenJs = fs.readFileSync(path.join(DIR, 'fullscreen.js'), 'utf8');

  const dndExtraCss = `
/* === DnD v3 (jeux complexes) === */
.draggable.dnd-selected,
.dnd-placed.dnd-selected {
  outline: 4px solid #1565c0 !important;
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(21, 101, 192, 0.35);
}
.dropzone.dnd-group-complete {
  box-shadow: 0 0 18px rgba(46, 125, 50, 0.55);
}
.dnd-game-complete .dropzone.dnd-border-hidden {
  border-color: transparent !important;
  background: transparent !important;
  box-shadow: none !important;
}
.dnd-verify-btn {
  background: #1565c0;
  color: #fff;
  border: none;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
}
.dnd-placed.dnd-retry-movable {
  outline: 2px dashed #ef6c00;
  cursor: grab !important;
}
.dnd-instructions {
  position: absolute;
  z-index: 5;
  pointer-events: none;
  box-sizing: border-box;
  padding: 10px 14px;
  border-radius: 12px;
  background: #fff8e1;
  border: 2px solid #f59e0b;
  color: #78350f;
  font-size: 22px;
  font-weight: 600;
  text-align: center;
  line-height: 1.35;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  white-space: pre-wrap;
  overflow: auto;
}
.dnd-game-complete .dnd-instructions,
.dnd-instructions.dnd-instructions-done {
  display: none !important;
}
.dnd-instructions.dnd-instructions-pulse {
  animation: dndInstrPulse 0.85s ease-out;
}
@keyframes dndInstrPulse {
  0% { transform: scale(0.96); box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7); }
  40% { transform: scale(1.03); box-shadow: 0 0 0 10px rgba(245, 158, 11, 0); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
}
.dropzone.dnd-step-target {
  outline: 3px solid #f59e0b !important;
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.25);
}
.dnd-link-node.dnd-link-from,
.dnd-link-node.dnd-selected {
  outline: 4px solid #f59e0b !important;
  outline-offset: 3px;
}
.dnd-link-zone .lz-fill {
  fill: #38bdf8;
  fill-opacity: 0;
  mix-blend-mode: multiply;
  transition: fill-opacity 0.28s ease, stroke-opacity 0.28s ease, stroke-width 0.28s ease;
  pointer-events: all;
}
.drag-game:not(.dnd-link-mode) .dnd-link-zone,
.drag-game:not(.dnd-link-mode) .dnd-link-zone * {
  pointer-events: none !important;
}
.dropzone.dnd-step-locked {
  pointer-events: none !important;
}
.dnd-link-zone .lz-stroke {
  fill: none;
  stroke: #0ea5e9;
  stroke-width: 0;
  stroke-opacity: 0;
  stroke-linejoin: round;
  pointer-events: none;
  transition: stroke-opacity 0.28s ease, stroke-width 0.28s ease;
}
.dnd-link-zone:hover .lz-fill,
.dnd-link-zone.dnd-link-hover .lz-fill,
.dnd-link-zone.dnd-link-from .lz-fill,
g.dnd-link-zone.dnd-link-from .lz-fill {
  fill-opacity: 0.34;
  animation: lzLiquidPulse 1.5s ease-in-out infinite;
}
.dnd-link-zone:hover .lz-stroke,
.dnd-link-zone.dnd-link-hover .lz-stroke,
.dnd-link-zone.dnd-link-from .lz-stroke,
g.dnd-link-zone.dnd-link-from .lz-stroke {
  stroke-width: 3;
  stroke-opacity: 0.75;
}
@keyframes lzLiquidPulse {
  0%, 100% { fill-opacity: 0.28; }
  50% { fill-opacity: 0.42; }
}
g.dnd-link-zone.dnd-link-from,
g.dnd-link-zone.dnd-link-node.dnd-link-from {
  outline: none !important;
}
.dnd-links-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 6;
  overflow: visible;
}
.dnd-relier-btn {
  width: 52px;
  height: 52px;
  padding: 0 !important;
  border-radius: 50% !important;
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.dnd-relier-btn .dnd-relier-icon {
  display: block;
  pointer-events: none;
}
.dnd-relier-btn.active {
  background: #ef6c00 !important;
}
.dnd-link-mode .draggable,
.dnd-link-mode .dnd-link-node {
  cursor: crosshair !important;
}
.dropzone {
  flex-wrap: wrap;
  gap: 4px;
  overflow: hidden;
}
`;

  if (styleCss.indexOf('dnd-selected') < 0) {
    styleCss += dndExtraCss;
  } else if (styleCss.indexOf('.dnd-instructions') < 0) {
    styleCss += `
.dnd-instructions {
  position: absolute;
  z-index: 5;
  pointer-events: none;
  box-sizing: border-box;
  padding: 10px 14px;
  border-radius: 12px;
  background: #fff8e1;
  border: 2px solid #f59e0b;
  color: #78350f;
  font-size: 22px;
  font-weight: 600;
  text-align: center;
  line-height: 1.35;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  white-space: pre-wrap;
  overflow: auto;
}
.dnd-game-complete .dnd-instructions,
.dnd-instructions.dnd-instructions-done {
  display: none !important;
}
`;
  }
  if (styleCss.indexOf('.dnd-links-layer') < 0) {
    styleCss += `
.dnd-link-node.dnd-link-from,
.dnd-link-node.dnd-selected {
  outline: 4px solid #f59e0b !important;
  outline-offset: 3px;
}
.dnd-link-zone .lz-fill {
  fill: #38bdf8;
  fill-opacity: 0;
  mix-blend-mode: multiply;
  transition: fill-opacity 0.28s ease;
  pointer-events: all;
}
.dnd-link-zone .lz-stroke {
  fill: none;
  stroke: #0ea5e9;
  stroke-width: 0;
  stroke-opacity: 0;
  stroke-linejoin: round;
  pointer-events: none;
  transition: stroke-opacity 0.28s ease, stroke-width 0.28s ease;
}
.dnd-link-zone:hover .lz-fill,
.dnd-link-zone.dnd-link-hover .lz-fill,
.dnd-link-zone.dnd-link-from .lz-fill,
g.dnd-link-zone.dnd-link-from .lz-fill {
  fill-opacity: 0.34;
  animation: lzLiquidPulse 1.5s ease-in-out infinite;
}
.dnd-link-zone:hover .lz-stroke,
.dnd-link-zone.dnd-link-hover .lz-stroke,
.dnd-link-zone.dnd-link-from .lz-stroke,
g.dnd-link-zone.dnd-link-from .lz-stroke {
  stroke-width: 3;
  stroke-opacity: 0.75;
}
@keyframes lzLiquidPulse {
  0%, 100% { fill-opacity: 0.28; }
  50% { fill-opacity: 0.42; }
}
g.dnd-link-zone.dnd-link-from { outline: none !important; }
.dnd-links-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 6;
  overflow: visible;
}
.dnd-relier-btn.active { background: #ef6c00 !important; }
.dnd-relier-btn {
  width: 52px;
  height: 52px;
  padding: 0 !important;
  border-radius: 50% !important;
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.dnd-relier-btn .dnd-relier-icon { display: block; pointer-events: none; }
.dnd-link-mode .draggable,
.dnd-link-mode .dnd-link-node { cursor: crosshair !important; }
`;
  } else if (styleCss.indexOf('.dnd-relier-btn') < 0) {
    styleCss += `
.dnd-relier-btn {
  width: 52px;
  height: 52px;
  padding: 0 !important;
  border-radius: 50% !important;
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.dnd-relier-btn .dnd-relier-icon { display: block; pointer-events: none; }
.dnd-relier-btn.active { background: #ef6c00 !important; }
.dnd-link-mode .draggable,
.dnd-link-mode .dnd-link-node { cursor: crosshair !important; }
`;
  } else if (styleCss.indexOf('.dnd-relier-icon') < 0) {
    styleCss += `
.dnd-relier-btn {
  width: 52px;
  height: 52px;
  padding: 0 !important;
  border-radius: 50% !important;
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.dnd-relier-btn .dnd-relier-icon { display: block; pointer-events: none; }
`;
  }
  if (styleCss.indexOf('.lz-fill') < 0) {
    styleCss += `
.dnd-link-zone .lz-fill {
  fill: #38bdf8;
  fill-opacity: 0;
  mix-blend-mode: multiply;
  transition: fill-opacity 0.28s ease;
  pointer-events: all;
}
.dnd-link-zone .lz-stroke {
  fill: none;
  stroke: #0ea5e9;
  stroke-width: 0;
  stroke-opacity: 0;
  stroke-linejoin: round;
  pointer-events: none;
  transition: stroke-opacity 0.28s ease, stroke-width 0.28s ease;
}
.dnd-link-zone:hover .lz-fill,
.dnd-link-zone.dnd-link-hover .lz-fill,
.dnd-link-zone.dnd-link-from .lz-fill,
g.dnd-link-zone.dnd-link-from .lz-fill {
  fill-opacity: 0.34;
  animation: lzLiquidPulse 1.5s ease-in-out infinite;
}
.dnd-link-zone:hover .lz-stroke,
.dnd-link-zone.dnd-link-hover .lz-stroke,
.dnd-link-zone.dnd-link-from .lz-stroke,
g.dnd-link-zone.dnd-link-from .lz-stroke {
  stroke-width: 3;
  stroke-opacity: 0.75;
}
@keyframes lzLiquidPulse {
  0%, 100% { fill-opacity: 0.28; }
  50% { fill-opacity: 0.42; }
}
g.dnd-link-zone.dnd-link-from { outline: none !important; }
`;
  }

  // Le script export doit inclure le moteur avant le runtime
  if (scriptJs.indexOf('MqDndEngine') < 0 || scriptJs.indexOf('/* MQ_DND_ENGINE */') < 0) {
    scriptJs = '/* MQ_DND_ENGINE */\n' + engine + '\n/* /MQ_DND_ENGINE */\n' + scriptJs;
  } else {
    // Remplacer le bloc moteur
    scriptJs = scriptJs.replace(
      /\/\* MQ_DND_ENGINE \*\/[\s\S]*?\/\* \/MQ_DND_ENGINE \*\//,
      '/* MQ_DND_ENGINE */\n' + engine + '\n/* /MQ_DND_ENGINE */'
    );
  }

  const out =
    '/* Auto-généré — runtime pour export HTML autonome. Regénérer: node rebuild-mq-export-runtime.js */\n' +
    'window.MQ_EXPORT_RUNTIME = {\n' +
    '  styleCss: ' + jsStringLiteral(styleCss) + ',\n' +
    '  scriptJs: ' + jsStringLiteral(scriptJs) + ',\n' +
    '  pdfExportJs: ' + jsStringLiteral(pdfExportJs) + ',\n' +
    '  fullscreenJs: ' + jsStringLiteral(fullscreenJs) + '\n' +
    '};\n';

  fs.writeFileSync(OUT, out, 'utf8');
  console.log('Écrit', OUT, '(' + Math.round(out.length / 1024) + ' Ko)');
}

if (process.argv.includes('--extract')) {
  extractFromCurrent();
} else {
  if (!fs.existsSync(path.join(DIR, 'script.js'))) {
    extractFromCurrent();
  }
  rebuild();
}
