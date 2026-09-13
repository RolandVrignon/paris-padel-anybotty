---
name: padel-monitoring
description: Consulter les heures de publication observées des créneaux Anybuddy, UCPA et 4PADEL, l’historique et l’état de la surveillance Anybotty sur le VPS. Diagnostiquer ou suspendre/reprendre le timer existant à la demande de l’utilisateur.
---

# Surveillance des ouvertures Anybotty

Dépôt : `'{{PROJECT_DIR}}'`. Le timer utilisateur `anybotty-observe.timer` évalue toutes les cinq minutes les besoins de collecte de cinq clubs Anybuddy et quatre canaux officiels : UCPA Paris 19, 4PADEL Boulogne-Billancourt, 4PADEL Saint-Ouen et 4PADEL Paris 20. Trinquet Village est exclu. Ce timer ne réserve pas et n’utilise pas de modèle. Anybuddy et UCPA sont publics ; 4PADEL utilise le compte `providers.4padel.account` du fichier privé `config.fixed.json`.

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

## Fournisseurs et horizons

Lire `'{{PROJECT_DIR}}/docs/direct-monitoring.md'` pour les champs et la connexion. Conserver `provider` et `canonicalClubId` dans chaque comparaison : les historiques d’un même club sur deux sites ne sont pas interchangeables. `horizon.availableLeadDays` mesure la dernière disponibilité au moment du relevé ; si `availableLeadIsLowerBound` vaut true, la fin du scan est atteinte et aucun horizon fixe n’est établi. `declaredVisibilityDays` est une règle annoncée par 4PADEL, pas une heure d’ouverture mesurée.

Les disponibilités de l’API 4PADEL peuvent dépasser les dates accessibles de son interface : utiliser les relevés du collecteur qui respectent les dates désactivées, pas un appel improvisé à l’inventaire. UCPA peut aussi exposer davantage d’inventaire que son calendrier ne permet de parcourir. `navigationThroughDate` mesure uniquement la limite atteinte avec les flèches hebdomadaires publiques ; ce n’est pas une preuve que tous les autres parcours de réservation bloquent au-delà.

Une erreur 4PADEL ne suspend pas Anybuddy ni UCPA. Pour vérifier la session, utiliser `node '{{PROJECT_DIR}}/scripts/login-fourpadel.js' --check` ; pour la rétablir après correction des identifiants, retirer `--check`. La commande UCPA correspondante est `node '{{PROJECT_DIR}}/scripts/login-ucpa.js' --check`, mais cette connexion n’est pas requise pour le monitoring public UCPA. Lire `'{{PROJECT_DIR}}/docs/authentication.md'` pour les options et statuts JSON. Une session `authenticated` ne signifie pas qu’une réservation a été créée. Ne jamais afficher la configuration privée ou le contenu de `.auth/`.

La réservation et la programmation existantes exécutent Anybuddy uniquement. Le suivi direct ne rend pas encore les parcours de réservation UCPA/4PADEL disponibles. Ne pas programmer le moteur Anybuddy sur la base d’un horaire d’ouverture propre à un site officiel.

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

## Monitoring adaptatif

Lire `'{{PROJECT_DIR}}/docs/adaptive-monitoring.md'`. `node scripts/observe.js --plan` explique les prochaines consultations sans contacter les sites. Les règles sont dans `data/monitoring-policy.json` : valeurs par défaut et surcharges par identifiant club/site. Le collecteur apprend une cadence après au moins trois publications indépendantes confirmées et suffisamment précises. `nextScan.pattern.status: candidate` reste une hypothèse ; ne pas la présenter comme une garantie de réservation.

Les contrôles complets sont horaires. La découverte et la plage entourant une ouverture estimée utilisent des contrôles ciblés toutes les cinq minutes. Une ouverture manquée relance la découverte. Les publications en cours de confirmation continuent leurs cinq vérifications. Une fenêtre ciblée vide ne signifie pas que le club entier est complet : consulter `lastFullScan.horizon` et son horodatage.

En cas de restriction HTTP ou d’authentification répétée en échec, le fournisseur est suspendu au moins six heures. Respecter `nextRetryAt`. Une alerte est envoyée via `hermes send` si `ANYBOTTY_ALERT_TARGET` est configuré sur le service ; lire `monitoringAlert.delivery` avant d’affirmer son envoi. Ne pas ajouter un cron de notification doublon. Le collecteur 4PADEL ne reconnecte pas avec le mot de passe : rétablir la session par la commande d’authentification si nécessaire.

Les preuves résumées de publications sont conservées 400 jours pour permettre l’apprentissage mensuel ; les instantanés bruts restent limités à 30 jours.

Le suivi Anybuddy est désactivé pour `ucpa-paris`, `4padel-paris-20` et `4padel-saint-ouen` dans `data/clubs.json`, car leur site officiel est déjà suivi. Les cinq suivis Anybuddy actifs sont Paris Padel, Sportfield Bercy, Aquaboulevard, Padelistes Bercy et Padel 15. La réservation via Anybuddy reste disponible pour les clubs désactivés ; leurs anciens relevés ne décrivent plus une disponibilité actuelle. Aucun historique n’est effacé par cette désactivation.
