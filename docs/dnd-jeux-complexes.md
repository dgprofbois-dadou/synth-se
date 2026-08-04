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

## Propriétés jeu (extra)

| Propriété | Description |
|-----------|-------------|
| `instructions` | Texte de consignes affiché pendant le jeu |
| `showInstructions` | Afficher les consignes (défaut `true`) |

Les consignes restent visibles jusqu’à la réussite de l’étape (`dnd-game-complete`), puis sont masquées.
