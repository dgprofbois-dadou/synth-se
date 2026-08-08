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
| `instructions` | Consigne unique (si `enableSteps` est off) |
| `showInstructions` | Afficher les consignes (défaut `true`) |
| `instructionsBox` | Disposition consignes : `{ x, y, width, height, font, fontSize, bold, italic, align, bgColor, color, borderColor }` |
| `enableSteps` | Jeu par étapes avec consignes successives |
| `steps` | Liste d’étapes `{ id, title, instructions, zoneIds, goodIds, linkPairs }` |
| `allowedLinks` | Paires `{ from, to }` pour le type `linking` |
| `linkMode` | `one-to-one` (défaut) ou `one-to-many` |
| `enableLinking` | Active les flèches **en plus** d’un autre type de jeu |
| `linkTooltip` | Texte d’aide (défaut : clic droit maintenu) |
| `relierBtn` | Position/taille du bouton flèche `{ x, y, size }` |

### Jeu par étapes (`enableSteps`)

Dans l’admin : cocher **Jeu par étapes**, puis ajouter des étapes. Chaque étape a :

- une **consigne** qui s’allume (animation) quand l’étape devient active ;
- des **critères de passage** (optionnels) : IDs de zones à valider, IDs de cartes à placer, et/ou flèches `id>id`.

La consigne de l’étape N s’affiche dès que l’étape N−1 est réussie. Sans critère → bouton **Étape suivante**. Le jeu est réussi quand **toutes** les étapes sont terminées.

### Type `linking` / option Relier

- Bouton **flèche** (icône) → active le mode Relier — **glissable** + **poignée de taille** en admin.
- **Clic droit maintenu** sur une image, puis **tirer** jusqu’à l’arrivée (flèche élastique orange).
- Le **clic gauche** seul déplace la vue (**pas de pan au clic droit**).
- Tooltip d’explication sur le bouton et pendant la manip.
- Peut être utilisé seul (`gameType: linking`) ou combiné (`enableLinking: true` + selection/exact/…).
- Score = score DnD + nombre de paires correctes.
- Les **images fixes** et **textes fixes** ont un **ID** éditable (badge vert sur le canvas) et peuvent servir de nœuds Relier (`idDépart>idArrivée`).

Les consignes restent visibles jusqu’à la réussite du jeu (`dnd-game-complete`), puis sont masquées.
