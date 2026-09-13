---
name: padel-scheduling
description: Programmer, consulter et annuler une tentative padel à l'ouverture sur Anybuddy ou le site officiel 4PADEL avec le cron natif Hermes, avec contrôle des crédits à la préparation et 24 heures avant une réservation 4PADEL réelle. Utiliser après padel-strategy quand une demande future doit être exécutée selon une règle quotidienne, hebdomadaire ou glissante documentée.
---

# Programmer une tentative à l'ouverture

Dépôt : `'{{PROJECT_DIR}}'`. Deux modes : `preview` (simulation par défaut) et `pay` (réservation réelle avec paiement explicitement demandé). Ne pas présenter la programmation comme une réservation garantie.

## Choisir le site et contrôler les crédits

Figer `provider` dans le JSON de préparation : `"anybuddy"` (défaut historique) ou `"4padel"` pour le site officiel. Le nom du club ne détermine pas le site : un 4PADEL réservé via Anybuddy n’utilise pas le portefeuille LA FID’. Le scheduler ne prend pas encore en charge UCPA officiel ; ne pas substituer Anybuddy à un site officiel demandé.

Pour `provider: "4padel"` et `mode: "pay"`, `prepare` actualise lui-même le portefeuille et refuse de préparer un job si le solde est inconnu ou insuffisant. Aucun paiement ni recharge n’est effectué à cette étape. `maxPricePerHourEUR` est nécessaire : la provision cible est le plafond horaire multiplié par la plus longue durée acceptée, arrondie au centime supérieur. Expliquer que c’est une provision prudente, pas le prix annoncé du futur créneau. Exemple : 80 €/h, durées [60, 90] → 120 € pour les quatre parts. Ne pas réduire les durées ou le budget autorisés pour faire passer ce contrôle.

`insufficient_wallet_balance` retourne le solde et `missingEUR` : demander une recharge de ce montant, puis refaire la préparation quand elle est faite. `wallet_check_failed` indique un solde inconnu, jamais nul. Aucun cron n’a alors été préparé. Ne pas créer un cron de paiement malgré ce résultat.

La préparation réussie retourne aussi `walletRecheck` pour un contrôle **24 heures avant openingAt**, pas avant le match. Une tâche créée moins de 24 heures avant son exécution indique `covered_by_initial_check` : ne pas créer un rappel dans le passé. Le second contrôle alerte dans le chat d’origine si le solde a baissé ou ne peut pas être lu ; il conserve la tentative pour permettre une recharge. La réservation vérifie encore le solde face au prix réel avant création. Aucun crédit n’est immobilisé et les provisions de plusieurs tâches ne sont pas réservées dans le portefeuille. Ce contrôle ne s’applique ni à Anybuddy, ni à UCPA, ni aux simulations.

## Préparer la décision

Lire `padel-strategy`, la demande et les observations. Un job cible **un seul club autorisé par la stratégie**, avec date, heure, durées ordonnées, environnements ordonnés et plafond horaire figés. Les préférences persistantes restent intactes. Ne pas programmer le plan B avant de connaître le résultat du club prioritaire. Une analyse seule ne demande pas un cron ; une demande de programmation l'autorise sans nouvelle confirmation.

Vérifier la session Anybuddy avec `node '{{PROJECT_DIR}}/scripts/login.js' --check --headless`, ou celle de 4PADEL officiel avec `node '{{PROJECT_DIR}}/scripts/login-fourpadel.js' --check`, avant de programmer. Si elle est expirée, rétablir la connexion selon `padel-booking`. Ne jamais mettre les credentials dans le JSON ou le cron.

Écrire un fichier temporaire privé contenant `provider`, `request` (format config.request.json), `opening` et `mode`. Pour 4PADEL officiel, utiliser un identifiant de club retourné par `node '{{PROJECT_DIR}}/scripts/fourpadel.js' clubs`, y compris Boulogne même s’il est absent du catalogue Anybuddy. Utiliser `"mode":"pay"` pour une demande explicite de réservation réelle, `"mode":"preview"` pour une simulation. Le mode est figé à la préparation ; les anciens jobs restent en simulation. Une demande de réservation réelle déjà autorisée ne nécessite pas une seconde approbation au déclenchement. Pour Anybuddy, vérifier que le paiement est configuré localement sans lire les valeurs de carte ; voir `padel-booking`. Pour 4PADEL officiel, utiliser les crédits et le contrôle de provision décrit ci-dessus. Règles prises en charge : Europe/Paris pour Anybuddy et les centres métropolitains, Indian/Reunion pour le centre 4PADEL de La Réunion. `localTime` et l’heure du match suivent le fuseau du club, tandis que `opening.at` conserve son décalage explicite :

- Quotidienne : `{"mode":"daily","horizonDays":8,"localTime":"08:00","source":"verified_observation","evidence":"références et dates des relevés indépendants"}`. La date du match moins 8 jours ouvre à 08 h. Cet horaire est un exemple, pas une règle réelle d'un club.
- Hebdomadaire : `{"mode":"weekly","releaseWeekday":5,"targetWeekOffset":1,"localTime":"18:00",...}` : vendredi de la semaine précédente pour toute la semaine suivante, semaines du lundi au dimanche. Offset 0 = semaine en cours. Ne pas ajouter J+x à cette règle.
- Glissante : `{"mode":"rolling","leadHours":72,...}` : exactement 72 heures avant l'heure du match, y compris lors du changement d'heure.
- Instant explicite : `{"mode":"explicit","at":"2026-10-01T08:00:00+02:00",...}` pour une publication ponctuelle ou une heure locale ambiguë. Utiliser un décalage UTC explicite et des secondes `00`.

Chaque règle exige `source` (`verified_observation` ou `user_instruction`) et `evidence` non vide. Ne jamais écrire `verified_observation` sur la seule base d'un horizon ou d'un créneau déjà visible au premier relevé. `user_instruction` exige que l'utilisateur ait indiqué cette règle ou cet instant ; une autorisation générique de programmer n'en fournit pas. Si heure ou règle inconnue : expliquer ce manque, conserver la surveillance existante, ne pas inventer de cron. Le catalogue n'est pas automatiquement promu en règle vérifiée.

## Créer et vérifier

1. Consulter `node '{{PROJECT_DIR}}/scripts/booking-jobs.js' list` et `cronjob(action="list")` pour éviter les doublons, y compris une création interrompue.
2. `node '{{PROJECT_DIR}}/scripts/booking-jobs.js' prepare --input PATH`. Supprimer ensuite le fichier temporaire. `needs_opening_rule` ne crée rien ; `check_now` demande de réévaluer immédiatement les disponibilités. `prepared` retourne `id`, `schedule` (ISO UTC), `script`, `cronName`, `workdir` et le récapitulatif figé.
3. Si `walletRecheck.status` vaut `prepared`, créer d’abord son cron natif avec les valeurs exactes `walletRecheck.schedule`, `walletRecheck.cronName`, `walletRecheck.script`, `walletRecheck.workdir`, `no_agent: true`, `repeat: 1`, et sans `deliver` pour conserver le chat. Puis `node '{{PROJECT_DIR}}/scripts/booking-jobs.js' attach-wallet --id ID --cron-job-id WALLET_JOB_ID`. Vérifier le cron retourné. Ne pas fabriquer un rappel texte : le script doit réellement actualiser le solde.
4. Avec les valeurs de la tentative principale, appeler l'outil natif Hermes `cronjob` : action `create`, schedule retourné, name = cronName, script retourné, `no_agent: true`, `repeat: 1`, workdir retourné. Omettre `deliver` pour conserver le chat/topic d'origine. Ne pas utiliser un cron Linux ou une automation Codex, ni fabriquer une commande avec les credentials.
5. Sur succès seulement : `node '{{PROJECT_DIR}}/scripts/booking-jobs.js' attach --id ID --cron-job-id JOB_ID`.
6. Vérifier `show --id ID` ET `cronjob(action="list")` : statut scheduled, mêmes IDs, scripts et instants, une seule exécution par cron. Pour 4PADEL payant, vérifier aussi le contrôle à J−1 ou le motif `covered_by_initial_check`. Alors annoncer club, match, heure Europe/Paris et tâche programmée. Si attach ou vérification échoue, annuler localement puis retirer tous les crons créés pour cette demande (contrôle de solde et réservation) ; signaler toute suppression non confirmée. Ne pas annoncer une programmation réussie avec un simple fichier prepared.

Le script attend que le cron arrive à l'instant d'ouverture ; un lancement anticipé est refusé. Une arrivée avec plus de cinq minutes de retard est marquée `missed`. Le scheduler et le lancement du navigateur introduisent une latence : aucune précision à la seconde ni garantie de disponibilité. Les recherches durent au maximum 90 secondes, en dessous du timeout Hermes par défaut de 120 secondes ; vérifier que ce timeout n'a pas été abaissé. Aucun retry implicite ni passage automatique à un autre club. Le compte rendu revient via le cron dans le chat d'origine.

## Suivre / annuler

```sh
node '{{PROJECT_DIR}}/scripts/booking-jobs.js' list
node '{{PROJECT_DIR}}/scripts/booking-jobs.js' show --id ID
node '{{PROJECT_DIR}}/scripts/booking-jobs.js' cancel --id ID
```

Pour annuler : désactiver **d'abord** la demande locale, puis retirer son `cronJobId` et son éventuel `walletRecheck.cronJobId` après avoir retrouvé chaque job avec `cronjob(action="list")`, et vérifier sa disparition. Si la suppression distante échoue, l'exécution locale reste désactivée. Les traces restent dans `.auth/scheduled-bookings/` ; annuler une tâche n'annule pas une réservation. La désactivation locale neutralise les deux scripts même si un cron distant reste présent.

Une tâche en cours (`running`) n'est pas rejouable ni annulable par cette commande. Après interruption, vérifier processus et traces avant toute nouvelle demande ; ne pas effacer manuellement l'état pour forcer un retry. Les résultats `checkout_ready`, `booked`, `existing_reservation`, `payment_failed`, `payment_action_required`, `payment_unverified`, `no_match`, `blocked`, `incomplete`, `missed` sont terminaux. Une interruption en mode réel donne un paiement incertain, jamais « aucun paiement ». Sur Anybuddy, utiliser la demande figée du job et `booking-search.js --config PATH --headless --reconcile` avant toute autre tentative. Sur 4PADEL officiel, utiliser `fourpadel.js reconcile --club CLUB --date DATE --time HEURE` avec les valeurs figées ; ne pas rejouer le job. Le timeout global de 90 secondes peut interrompre une attente de confirmation : le journal privé empêche une nouvelle soumission. `checkout_ready` signifie seulement récapitulatif atteint. Modifier une demande programmée = annuler puis préparer une nouvelle tâche, avec une stratégie réévaluée.


Pour 4PADEL, `not_open`, `outside_assumed_horizon`, `insufficient_wallet_balance`, `already_reserved_or_pending`, `cancelled`, `booking_unverified` et `error` sont également terminaux. Lire le résultat enregistré avec `show --id ID`. Un solde insuffisant au déclenchement arrête la réservation ; ne pas recharger ni utiliser la carte automatiquement. `already_reserved_or_pending` n’est pas une preuve de confirmation. Pour consulter le solde à la demande, utiliser `node '{{PROJECT_DIR}}/scripts/fourpadel.js' wallet` ; cette lecture ne rejoue pas le cron.
