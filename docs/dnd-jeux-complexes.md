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

### Type `linking` (Relier / flèches)

- Les images (`draggables`) restent fixes.
- L’élève clique une image de départ puis une d’arrivée → flèche SVG.
- Validation via `allowedLinks` (ex. `1>3`).
- Clic sur une flèche pour la retirer.
- Les zones de dépôt sont ignorées.

Les consignes restent visibles jusqu’à la réussite de l’étape (`dnd-game-complete`), puis sont masquées.
