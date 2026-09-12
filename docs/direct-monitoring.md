# Suivre les sites officiels

Le timer `anybotty-observe.timer` relève toutes les cinq minutes les huit clubs Anybuddy déjà suivis et quatre canaux officiels : UCPA Paris 19, 4PADEL Boulogne-Billancourt, 4PADEL Saint-Ouen et 4PADEL Paris 20. Aucun panier ni paiement n’est créé par le collecteur.

Un même club conserve des observations distinctes selon le site : une ouverture Anybuddy ne prouve pas une ouverture sur le site officiel, et inversement.

| Canal | Identifiant de suivi | Accès |
| --- | --- | --- |
| UCPA Paris 19 | `ucpa-paris--ucpa` | Calendrier public |
| 4PADEL Boulogne-Billancourt, centre 105 | `4padel-boulogne--4padel` | Compte 4PADEL |
| 4PADEL Saint-Ouen, centre 117 | `4padel-saint-ouen--4padel` | Même compte 4PADEL |
| 4PADEL Paris 20, centre 79 | `4padel-paris-20--4padel` | Même compte 4PADEL |

Horizons du site officiel renseignés le 13 septembre 2026 : **Boulogne J+14, Saint-Ouen J+30, Paris 20 J+30**. Chaque passage relit la règle et les dates accessibles ; ces valeurs ne définissent pas encore l’heure d’ouverture. Leurs observations sont séparées des horizons Anybuddy.

## Connexion 4PADEL

Ajouter à `config.fixed.json`, en conservant les autres réglages :

```json
{
  "providers": {
    "4padel": {
      "account": {
        "email": "",
        "password": ""
      }
    }
  }
}
```

```sh
npm run auth:4padel
# Si un contrôle interactif exige un navigateur visible :
npm run auth:4padel -- --headed
npm run observe:once
npm run observe:report
```

La connexion utilise le formulaire officiel puis vérifie l’identité côté serveur. `npm run auth:4padel:check` contrôle la session sans reconnecter ni sauvegarder. Les comptes et commandes UCPA/4PADEL sont détaillés dans le [guide d’authentification](authentication.md). La session privée est réutilisée dans `.auth/providers/`, avec des permissions restrictives. Une session périmée peut conduire à une nouvelle connexion avec les identifiants configurés. Un changement de compte recommence une base d’observation pour éviter de comparer des droits différents. Les erreurs ne contiennent ni mot de passe ni jeton.

Les identifiants et sessions ne sont pas versionnés. Sur un VPS, renseigner la configuration privée de ce VPS ; pousser le code ne transfère pas les secrets. Aucun autre timer ni cron Hermes récurrent n’est nécessaire. Les cibles officielles s’activent ou se désactivent dans `data/direct-monitoring.json` avec `monitoring.enabled`.

## Lire les résultats

```sh
node scripts/observe.js --report
```

Chaque entrée fournit `provider`, `canonicalClubId` (club physique), `clubId` (identifiant de l’historique) et `horizon` :

- `lastAvailableDate` et `availableLeadDays` : dernière journée avec au moins un créneau proposé, exprimée depuis la date du relevé à Paris.
- `availableLeadIsLowerBound` : la disponibilité atteint la fin du scan ; ce n’est pas un horizon fixe.
- `navigationThroughDate` : dernière journée atteinte par les flèches hebdomadaires UCPA.
- `selectableThroughDate` : dernière date accessible dans le calendrier, quand cette information est disponible.
- `declaredVisibilityDays` : règle de visibilité annoncée pour le compte 4PADEL.
- `lastPublishedDate` : dernière journée présentant des horaires, même si tous ses terrains sont complets.

Chez 4PADEL, l’API peut retourner des terrains au-delà des dates accessibles dans le calendrier. Le collecteur lit d’abord les dates activées dans l’interface, puis interroge uniquement ces journées. Les dates désactivées sont conservées dans `snapshot.blockedDates`. Les prix correspondent au terrain entier en double (quatre joueurs), pour les durées renvoyées par le club. Il n’utilise pas le faux fuseau de `startingDate` : les heures sont calculées à partir de `startingDateZuluTime`.

Chez UCPA, Playwright parcourt le calendrier public avec sa flèche « semaine suivante », jusqu’à sa désactivation. Il relève les semaines réellement affichées et suit aussi les deux semaines suivant cette limite pour détecter son déplacement. `availabilityScope: public_next_week_navigation` précise cette portée : la limite de navigation n’est pas une règle de réservation garantie, et les éventuels autres parcours du sélecteur de date ou droits de compte ne sont pas validés. L’API UCPA seule peut exposer des terrains beaucoup plus lointains ; ils ne sont pas comptés comme accessibles par ce parcours.

Une règle J+14 ou J+30 ne prouve pas une ouverture à minuit. Le suivi enregistre, dans le parcours observé, le passage de « date inaccessible ou sans disponibilité » à « au moins un créneau proposé », puis cherche cinq confirmations supplémentaires espacées de cinq minutes. Une première collecte établit seulement une base. Les groupes de dates apparues ensemble permettent aussi de rechercher des publications hebdomadaires.

Les historiques Anybuddy existants conservent leurs identifiants. Les échecs HTTP 401, 403 ou 429 mettent en attente le fournisseur concerné ; les autres fournisseurs continuent. Une erreur conserve le dernier relevé valide, sans compter comme absence ou confirmation. Les instantanés privés sont conservés 30 jours.

## Périmètre de réservation

Les parcours de réservation, paiement, annulation et programmation existants exécutent **Anybuddy**. Cette extension ajoute l’observation des sites officiels. Elle ne rend pas encore exécutables des réservations UCPA ou 4PADEL directes. Hermes doit conserver le fournisseur dans son analyse et ne pas appliquer une ouverture 4PADEL au moteur de réservation Anybuddy. Boulogne-Billancourt est ajouté au suivi officiel ; il n’est pas ajouté artificiellement au catalogue de réservation Anybuddy.
