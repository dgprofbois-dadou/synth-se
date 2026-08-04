# Moteur DnD (jeux complexes)

## Fichiers

- `mq-dnd-engine.js` — noyau commun (validation, score, grille, runtime jouable)
- `export-runtime/` — sources du runtime HTML autonome
- `rebuild-mq-export-runtime.js` — régénère `mq-export-runtime.js`
- `tests/dnd-engine.test.js` — tests Node légers

## Régénérer le runtime export

```bash
node rebuild-mq-export-runtime.js
```

Pour ré-extraire les sources depuis le runtime actuel :

```bash
node rebuild-mq-export-runtime.js --extract
```

## Tests

```bash
node tests/dnd-engine.test.js
```
