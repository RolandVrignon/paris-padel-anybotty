# Mesurer les ouvertures Anybuddy

## Objectif

Déterminer pour chacun des neuf centres quand une nouvelle date, ou un nouvel horaire de cette date, devient effectivement réservable. Ne pas supposer minuit ou 8 h à partir des dernières dates disponibles.

## Hypothèses de départ

Le catalogue contient des horizons J+x déduits d’un relevé du 11 septembre 2026. Une journée sans disponibilité peut être complète, fermée ou pas encore publiée. Ces observations ne suffisent pas à établir la règle du club.

Deux comportements sont notamment possibles :

- ouverture quotidienne groupée, à une heure locale fixe ;
- fenêtre glissante, où chaque créneau devient réservable un certain temps avant son début.

Il peut aussi exister des différences selon les courts, les durées, les jours de semaine ou les canaux de réservation.

## Collecte à implémenter

1. Lire le calendrier et les créneaux depuis une interface accessible et autorisée d’Anybuddy, sans ouvrir de commande ni effectuer de paiement.
2. Observer la date située juste au-delà du dernier horizon connu, et une date déjà ouverte comme témoin.
3. Enregistrer chaque début proposé, durée, court si disponible, prix et date du match, avec un horodatage UTC et sa représentation Europe/Paris.
4. Conserver les erreurs et états inconnus séparément des réponses valides sans créneau. Une erreur réseau ne doit jamais être interprétée comme une fermeture.
5. Comparer deux relevés valides. Encadrer l’apparition entre le dernier relevé sans ce créneau et le premier avec ce créneau.
6. Suivre également les extensions horaires d’une date déjà visible : la seule dernière date ne suffit pas pour détecter une fenêtre glissante.

Proposition initiale à ajuster aux conditions et limites de la plateforme : un relevé par centre toutes les 15 minutes pendant l’exploration, requêtes séquentielles, arrêt/backoff en cas d’erreur ou limitation. Une fois une plage plausible repérée, resserrer temporairement la mesure autour de cette plage. Aucun collecteur ni calendrier de surveillance n’est actuellement actif.

## Preuve attendue

Pour chaque apparition, conserver au minimum :

```json
{
  "clubId": "paris-padel",
  "targetDate": "2026-09-21",
  "startTime": "20:00",
  "durationMinutes": 60,
  "lastValidAbsentAt": null,
  "firstAvailableAt": null,
  "timeZone": "Europe/Paris",
  "interpretation": "unknown"
}
```

Des observations manquantes donnent un intervalle moins précis. Un créneau nouvellement apparu peut provenir d’une annulation : chercher une répétition sur plusieurs dates et/ou l’apparition de nombreux créneaux sur une nouvelle journée avant de conclure à une ouverture.

Après au moins trois journées concordantes, proposer une règle avec son niveau de confiance et la précision de mesure. Une règle reste une estimation tant qu’elle n’est pas confirmée par une source du club ou suffisamment corroborée ; conserver les observations qui la justifient.

## Livrable

Un tableau par centre : horizon vérifié ou estimé, mode d’ouverture, heure locale ou intervalle, jours observés, exceptions, dernière vérification. Ensuite seulement, programmer les tentatives pour les horaires demandés, avec durées acceptées, plafond de prix et prévention des doublons.
