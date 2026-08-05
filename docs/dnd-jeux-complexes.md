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
| `allowedLinks` | Paires `{ from, to }` pour le type `linking` |
| `linkMode` | `one-to-one` (défaut) ou `one-to-many` |
| `enableLinking` | Active les flèches **en plus** d’un autre type de jeu |
| `linkTooltip` | Texte d’aide pendant le tirage de flèche |

### Type `linking` / option Relier

- Bouton **Relier** → mode flèches (curseur croix).
- Maintenir le clic sur une image et **tirer** jusqu’à l’arrivée (flèche élastique orange).
- Tooltip d’explication pendant la manip.
- Peut être utilisé seul (`gameType: linking`) ou combiné (`enableLinking: true` + selection/exact/…).
- Score = score DnD + nombre de paires correctes.

Les consignes restent visibles jusqu’à la réussite de l’étape (`dnd-game-complete`), puis sont masquées.
