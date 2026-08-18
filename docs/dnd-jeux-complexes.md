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
| `allowedLinks` | Union des `linkPairs` des étapes Relier (cache runtime). Plus de paires globales : Relier se configure **par étape**. |
| `linkMode` | `one-to-one` (défaut) ou `one-to-many` |
| `enableLinking` | Dérivé automatiquement : `true` si au moins une étape est Relier / Les deux |
| `linkTooltip` | Texte d’aide (défaut : clic droit maintenu) |
| `relierBtn` | Position/taille du bouton flèche `{ x, y, size }` |
| `linkZones` | Zones SVG transparentes Relier `{ id, points:[[x,y],…] }` (visibles admin) |

### Jeu par étapes (`enableSteps`)

Dans l’admin : cocher **Jeu par étapes**, puis ajouter des étapes. Chaque étape a :

- une **consigne** affichée quand l’étape devient active ;
- un **type d’activité** :
  - `dnd` — Déposer (Relier **masqué**) ;
  - `linking` — Relier (dépôt **verrouillé**, bouton Relier visible) ;
  - `both` — Déposer + Relier ;
- une **fin d’étape** : critères (zones / cartes / flèches) → passage **automatique**, ou case **Exiger le bouton « Étape suivante »**.

Exemple typique : étape 1 = Déposer (zones 1,2) → étape 2 = Relier (`1>3`) → étape 3 = Déposer… Le bouton Relier n’apparaît qu’à l’étape 2.

Sans critère et sans bouton forcé → bouton **Étape suivante** obligatoire. Le jeu est réussi quand **toutes** les étapes sont terminées.

**Relier n’existe plus comme type de jeu global.** L’ancienne config (`gameType: linking`, case « Activer Relier », paires globales) est migrée vers une **étape Relier** au chargement, pour reprendre la config sur cette étape.

Les outils canvas (zones SVG, mode de liaison, tooltip) s’affichent dès que « Jeu par étapes » est coché. Les flèches à valider se règlent dans chaque étape (`Flèches à valider`).

### Relier (étape)

- Bouton **flèche** (icône) → visible seulement sur une étape « Les deux » — **glissable** + **poignée de taille** en admin.
- Étape Relier pure : mode flèche **automatique** (bouton masqué).
- **Clic droit maintenu** sur une image, puis **tirer** jusqu’à l’arrivée (flèche élastique orange).
- Le **clic gauche** seul déplace la vue (**pas de pan au clic droit**).
- Tooltip d’explication sur le bouton et pendant la manip.
- **Zones SVG Relier** : polygones dessinés (points ou crayon) — visibles en admin, **transparents** pour l’élève, avec un **ID** utilisable dans les paires (`zone-1>2`).
- Score = score DnD des étapes + nombre de paires correctes des étapes Relier.
- Les **images fixes** et **textes fixes** ont un **ID** éditable (badge vert sur le canvas) et peuvent servir de nœuds Relier (`idDépart>idArrivée`).

Les consignes restent visibles jusqu’à la réussite du jeu (`dnd-game-complete`), puis sont masquées.
