FORMES SVG — Bibliothèque synth-se
==================================

1. Placez vos fichiers .svg dans CE dossier : library-shapes/

2. Déclarez chaque forme dans manifest.json :
   - id      : identifiant unique (sans espaces)
   - name    : nom affiché dans l'onglet Bibliothèque
   - file    : nom du fichier .svg (dans ce dossier)
   - defaultSize : taille approximative en px sur le canvas (optionnel, défaut 100)
   - preset  : style hotspot (fill, stroke, strokeW, alphaIdle, alphaActive, blendMode…)

3. Format SVG recommandé :
   - viewBox obligatoire (ex. viewBox="0 0 100 50")
   - une seule forme : <polygon>, <polyline> (fermée) ou <rect>
   - évitez les <path> complexes pour l'instant

4. Rechargez la page éditeur : section « Formes SVG » dans Bibliothèque.
   Glissez une forme sur le canvas pour créer un hotspot.

Exemple : copiez arrow-right.svg, renommez, ajoutez une entrée dans manifest.json.
