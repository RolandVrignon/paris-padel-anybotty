---
name: padel-monitoring
description: Consulter les heures de publication observées des créneaux Anybuddy, l’historique et l’état de la surveillance Anybotty sur le VPS. Diagnostiquer ou suspendre/reprendre le timer existant à la demande de l’utilisateur.
---

# Surveillance des ouvertures Anybotty

Dépôt : `'{{PROJECT_DIR}}'`. Huit clubs sont suivis par le timer utilisateur `anybotty-observe.timer`, toutes les cinq minutes. Trinquet Village est exclu. Ce timer collecte les disponibilités publiques ; il ne réserve pas et n’a besoin ni de connexion Anybuddy ni de modèle.

## Lire les observations

```sh
node '{{PROJECT_DIR}}/scripts/observe.js' --report
systemctl --user list-timers anybotty-observe.timer --no-pager
systemctl --user show anybotty-observe.service -p Result -p ExecMainStatus -p ActiveState
```

Comparer `lastSuccessAt`, `attemptedAtParis`, `status`, `nextRetryAt` et `error` avant d’affirmer que le suivi est à jour. `not_observed` signifie absence de données, pas absence de créneaux. Un service oneshot `inactive` entre les passages est normal ; vérifier le timer et le dernier résultat.

Pour comprendre les champs avancés, lire `'{{PROJECT_DIR}}/docs/opening-observation.md'`. Le rapport donne les dates suivies, premières apparitions et cinq confirmations supplémentaires, espacées d’environ cinq minutes. Une ouverture se situe entre le dernier contrôle valide sans créneau et le premier avec créneau ; ne pas annoncer une heure exacte quand seule une fourchette est établie.

Une date déjà disponible au premier relevé ne prouve pas son heure d’ouverture. Cinq confirmations vérifient la persistance de disponibilités pendant environ 25 minutes, pas cinq ouvertures indépendantes. Une erreur ne compte jamais comme absence ou confirmation.

`calendar.batches` regroupe les dates apparues au même contrôle ; sept dates publiées ensemble représentent une publication. `calendar.additionalSlots` suit les ajouts sur une date déjà ouverte, qui peuvent aussi provenir d’annulations. Pour une hypothèse quotidienne, comparer quatre à cinq publications indépendantes ; pour une hebdomadaire, plutôt deux à trois semaines. Présenter les résultats comme hypothèses tant que les données ne suffisent pas.

## Opérations demandées par l’utilisateur

Consulter le rapport ne nécessite pas de nouvelle collecte. Si un relevé immédiat est explicitement demandé :

```sh
node '{{PROJECT_DIR}}/scripts/observe.js'
```

Ne pas créer un second cron Hermes toutes les cinq minutes : le timer existant réalise déjà cette collecte. Pour diagnostiquer :

```sh
journalctl --user -u anybotty-observe.service -n 30 --no-pager
```

Sur demande explicite de suspension :

```sh
systemctl --user disable --now anybotty-observe.timer
systemctl --user stop anybotty-observe.service
```

Sur demande de reprise :

```sh
systemctl --user enable --now anybotty-observe.timer
systemctl --user list-timers anybotty-observe.timer --no-pager
```

Ces opérations conservent les relevés. Ne pas effacer l’historique, modifier les autres services Hermes, les demandes Paris Tennis ou les identifiants. Les instantanés sont privés dans `observations/`, conservés 30 jours. Une désactivation du timer ne supprime aucune réservation.

Pour décider entre attendre une ouverture et essayer un club de repli, utiliser `padel-strategy`. Pour chercher ensuite un créneau sur le périmètre retenu, utiliser `padel-booking` ; le moteur ne transforme pas encore les observations en réservation automatique à une heure donnée.
