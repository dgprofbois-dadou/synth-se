FORMES SVG (Inkscape) — dossier library-shapes/
===============================================

DOSSIER À UTILISER : library-shapes/  (à la racine du projet synth-se)

ÉTAPES
------
1. Inkscape : Fichier → Enregistrer sous → Plain SVG (*.svg)
2. Copiez le fichier .svg dans CE dossier (library-shapes/)
3. Ouvrez manifest.json et ajoutez le nom du fichier dans "shapes" :
     "shapes": [
       "arrow-right.svg",
       "ma-fleche-inkscape.svg"
     ]
4. Rechargez placement-inputs.html dans le navigateur
5. Bibliothèque → section « Formes SVG » → glissez sur le canvas

MANIFEST SIMPLIFIÉ
------------------
- Une ligne = un fichier .svg (le nom affiché est déduit du nom de fichier)
- Option avancée pour personnaliser :
     { "file": "ma-forme.svg", "name": "Ma flèche", "defaultSize": 160 }

APRÈS LE DÉPÔT SUR LE CANVAS
----------------------------
- Taille      : bouton « Redimensionner (Ctrl+T) » ou poignées bleues
- Forme       : poignées blanches sur les sommets (déplacer / ajouter des points)
- Épaisseur   : panneau Hotspot → Contour → px

INKSCAPE
--------
- Les tracés <path> sont supportés (export Inkscape standard)
- Préférez un seul objet par fichier pour un résultat propre
- Le viewBox du SVG est utilisé pour l'échelle
