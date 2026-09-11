---
name: padel-scheduling
description: Programmer, consulter et annuler une tentative padel à l'ouverture avec le cron natif Hermes. Utiliser après padel-strategy quand une demande future doit être exécutée selon une règle quotidienne, hebdomadaire ou glissante documentée.
---

# Programmer une tentative à l'ouverture

Dépôt : `'{{PROJECT_DIR}}'`. Exécution actuelle : **simulation jusqu'au récapitulatif**, sans paiement final ni réservation confirmée. Ne pas présenter la programmation comme une réservation garantie.

## Préparer la décision

Lire `padel-strategy`, la demande et les observations. Un job cible **un seul club autorisé par la stratégie**, avec date, heure, durées ordonnées, environnements ordonnés et plafond horaire figés. Les préférences persistantes restent intactes. Ne pas programmer le plan B avant de connaître le résultat du club prioritaire. Une analyse seule ne demande pas un cron ; une demande de programmation l'autorise sans nouvelle confirmation.

Vérifier la session avec `node '{{PROJECT_DIR}}/scripts/login.js' --check --headless` avant de programmer. Si elle est expirée, rétablir la connexion selon `padel-booking`. Ne jamais mettre les credentials dans le JSON ou le cron.

Écrire un fichier temporaire privé contenant `request` (format config.request.json) et `opening`. Règles prises en charge, toujours en Europe/Paris :

- Quotidienne : `{"mode":"daily","horizonDays":8,"localTime":"08:00","source":"verified_observation","evidence":"références et dates des relevés indépendants"}`. La date du match moins 8 jours ouvre à 08 h. Cet horaire est un exemple, pas une règle réelle d'un club.
- Hebdomadaire : `{"mode":"weekly","releaseWeekday":5,"targetWeekOffset":1,"localTime":"18:00",...}` : vendredi de la semaine précédente pour toute la semaine suivante, semaines du lundi au dimanche. Offset 0 = semaine en cours. Ne pas ajouter J+x à cette règle.
- Glissante : `{"mode":"rolling","leadHours":72,...}` : exactement 72 heures avant l'heure du match, y compris lors du changement d'heure.
- Instant explicite : `{"mode":"explicit","at":"2026-10-01T08:00:00+02:00",...}` pour une publication ponctuelle ou une heure locale ambiguë. Utiliser un décalage UTC explicite et des secondes `00`.

Chaque règle exige `source` (`verified_observation` ou `user_instruction`) et `evidence` non vide. Ne jamais écrire `verified_observation` sur la seule base d'un horizon ou d'un créneau déjà visible au premier relevé. `user_instruction` exige que l'utilisateur ait indiqué cette règle ou cet instant ; une autorisation générique de programmer n'en fournit pas. Si heure ou règle inconnue : expliquer ce manque, conserver la surveillance existante, ne pas inventer de cron. Le catalogue n'est pas automatiquement promu en règle vérifiée.

## Créer et vérifier

1. Consulter `node '{{PROJECT_DIR}}/scripts/booking-jobs.js' list` et `cronjob(action="list")` pour éviter les doublons, y compris une création interrompue.
2. `node '{{PROJECT_DIR}}/scripts/booking-jobs.js' prepare --input PATH`. Supprimer ensuite le fichier temporaire. `needs_opening_rule` ne crée rien ; `check_now` demande de réévaluer immédiatement les disponibilités. `prepared` retourne `id`, `schedule` (ISO UTC), `script`, `cronName`, `workdir` et le récapitulatif figé.
3. Avec ces valeurs exactes, appeler l'outil natif Hermes `cronjob` : action `create`, schedule retourné, name = cronName, script retourné, `no_agent: true`, `repeat: 1`, workdir retourné. Omettre `deliver` pour conserver le chat/topic d'origine. Ne pas utiliser un cron Linux ou une automation Codex, ni fabriquer une commande avec les credentials.
4. Sur succès seulement : `node '{{PROJECT_DIR}}/scripts/booking-jobs.js' attach --id ID --cron-job-id JOB_ID`.
5. Vérifier `show --id ID` ET `cronjob(action="list")` : statut scheduled, même ID, script, instant et une seule exécution. Alors annoncer club, match, heure Europe/Paris et tâche programmée. Si attach ou vérification échoue, annuler localement puis retirer le cron créé ; signaler toute suppression non confirmée. Ne pas annoncer une programmation réussie avec un simple fichier prepared.

Le script attend que le cron arrive à l'instant d'ouverture ; un lancement anticipé est refusé. Une arrivée avec plus de cinq minutes de retard est marquée `missed`. Le scheduler et le lancement du navigateur introduisent une latence : aucune précision à la seconde ni garantie de disponibilité. Les recherches durent au maximum 90 secondes, en dessous du timeout Hermes par défaut de 120 secondes ; vérifier que ce timeout n'a pas été abaissé. Aucun retry implicite ni passage automatique à un autre club. Le compte rendu revient via le cron dans le chat d'origine.

## Suivre / annuler

```sh
node '{{PROJECT_DIR}}/scripts/booking-jobs.js' list
node '{{PROJECT_DIR}}/scripts/booking-jobs.js' show --id ID
node '{{PROJECT_DIR}}/scripts/booking-jobs.js' cancel --id ID
```

Pour annuler : désactiver **d'abord** la demande locale, puis retirer son cronJobId après avoir retrouvé le job avec `cronjob(action="list")`, et vérifier sa disparition. Si la suppression distante échoue, l'exécution locale reste désactivée. Les traces restent dans `.auth/scheduled-bookings/` ; annuler une tâche n'annule pas une réservation Anybuddy.

Une tâche en cours (`running`) n'est pas rejouable ni annulable par cette commande. Après interruption, vérifier processus et traces avant toute nouvelle demande ; ne pas effacer manuellement l'état pour forcer un retry. Les résultats `checkout_ready`, `no_match`, `blocked`, `incomplete`, `missed` sont terminaux. `checkout_ready` signifie seulement récapitulatif atteint. Modifier une demande programmée = annuler puis préparer une nouvelle tâche, avec une stratégie réévaluée.
