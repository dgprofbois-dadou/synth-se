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
.dropzone {
  flex-wrap: wrap;
  gap: 4px;
  overflow: hidden;
}
`;

  if (styleCss.indexOf('dnd-selected') < 0) {
    styleCss += dndExtraCss;
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
