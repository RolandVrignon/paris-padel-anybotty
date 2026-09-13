# Playtomic et Casa Padel

Le fournisseur Playtomic couvre actuellement deux clubs : `casa-padel-asnieres` et `casa-padel-saint-denis`. Le nom Saint-Denis provient du lien Playtomic fourni ; ce club ne doit pas être confondu avec un Casa Padel Saint-Ouen.

## Fonctionnel

- catalogue local avec tenant natif, URL exacte, fuseau et nombre de terrains ;
- lecture directe de l’inventaire public padel par date ;
- normalisation des horaires, durées, prix du terrain et identifiants de terrain ;
- sélection selon l’ordre des durées et le plafond de prix par heure ;
- construction de l’URL officielle du checkout ;
- monitoring public séparé par club, centré autour de la frontière J+14 initiale ;
- session Playwright Playtomic séparée, à configurer dans `providers.playtomic.account`.

## Garde-fou actuel

La commande `book` est un aperçu. Elle ne clique pas sur la confirmation, ne soumet pas de paiement et ne crée pas de réservation. `--confirm` échoue explicitement tant que le parcours authentifié, le moyen de paiement, la confirmation de résultat et l’annulation n’ont pas été observés puis recettés. Cette limite évite de présenter un checkout public comme une réservation autonome déjà validée.

## Commandes

```sh
npm run playtomic -- clubs
npm run playtomic -- availability --club casa-padel-asnieres --date YYYY-MM-DD
npm run playtomic -- book --club casa-padel-saint-denis --date YYYY-MM-DD --time HH:mm --durations 90 --max-price-per-hour 60
npm run auth:playtomic
npm run auth:playtomic:check
```

Les sorties sont en JSON. Les disponibilités restent publiques ; les fichiers d’authentification sont privés sous `.auth/providers/` et ne doivent jamais être commités.
