# Suivre les sites officiels

Le timer `anybotty-observe.timer` se réveille toutes les cinq minutes et adapte les consultations pour les sept clubs Anybuddy et onze canaux directs : UCPA Paris 19 et Meudon, 4PADEL Boulogne-Billancourt, Saint-Ouen, Paris 20, Montreuil, CAO Saint-Denis, Marville et Créteil, puis Playtomic Casa Padel Asnières et Saint-Denis. Aucun panier ni paiement n’est créé par le collecteur.

Un même club conserve des observations distinctes selon le site : une ouverture Anybuddy ne prouve pas une ouverture sur le site officiel, et inversement.

| Canal | Identifiant de suivi | Accès |
| --- | --- | --- |
| UCPA Paris 19 | `ucpa-paris--ucpa` | Calendrier public |
| UCPA Meudon | `ucpa-meudon--ucpa` | Calendrier public |
| 4PADEL Boulogne-Billancourt, centre 105 | `4padel-boulogne--4padel` | Compte 4PADEL |
| 4PADEL Saint-Ouen, centre 117 | `4padel-saint-ouen--4padel` | Même compte 4PADEL |
| 4PADEL Paris 20, centre 79 | `4padel-paris-20--4padel` | Même compte 4PADEL |
| 4PADEL Montreuil, centre 73 | `4padel-montreuil--4padel` | Même compte 4PADEL |
| 4PADEL CAO Saint-Denis, centre 89 | `4padel-cao-saint-denis--4padel` | Même compte 4PADEL |
| 4PADEL Marville, centre 65 | `4padel-marville--4padel` | Même compte 4PADEL |
| 4PADEL Créteil, centre 25 | `4padel-creteil--4padel` | Même compte 4PADEL |
| Casa Padel Asnières | `casa-padel-asnieres--playtomic` | Calendrier public Playtomic |
| Casa Padel Saint-Denis | `casa-padel-saint-denis--playtomic` | Calendrier public Playtomic |

## Référence d’ouverture 4PADEL

**Boulogne est le calendrier de référence pour Saint-Ouen, Paris 20, Montreuil, CAO Saint-Denis, Marville et Créteil.** La règle de travail retenue avec l’utilisateur est « moins de 15 jours », soit **J+14**, comme hypothèse commune. La frontière exacte reste une hypothèse pour Saint-Ouen et Paris 20 : le refus du checkout mentionne un délai de 15 jours, alors que leur calendrier expose J+30.

Boulogne suit la stratégie adaptative ; les six calendriers de référence sont relus chaque heure, avec des contrôles supplémentaires pour confirmer une apparition. Il ne tente aucune réservation et ne soumet aucun paiement pour tester cette limite. Quand un nouveau jour avec des créneaux apparaît à Boulogne, son intervalle d’apparition et les cinq contrôles suivants deviennent une référence indicative pour la même date dans les six autres centres.

Les six cibles définissent `monitoring.openingReference.targetId: "4padel-boulogne--4padel"` dans `data/direct-monitoring.json`. Le rapport `npm run observe:report` et la sortie de chaque collecte exposent `bookingOpeningReference` :

- `status: "hypothesis"` et `assumedHorizonDays: 14` : règle supposée, même après plusieurs jours concordants à Boulogne.
- `measurements` : dates, bornes horaires et confirmations issues uniquement des nouvelles journées observées à Boulogne. Une première collecte sans observation d’absence ne produit pas d’heure d’ouverture.
- `sourceStatus` : référence fraîche, absente, ou indisponible/périmée au-delà de dix minutes. Les mesures historiques restent visibles en cas de problème.
- `bookingAuthorizationVerified: false` : aucune validation du droit de réserver dans le club cible.

Les mesures proviennent des journaux existants de Boulogne, conservés par le collecteur ; elles restent consultables après redémarrage. Les calendriers propres à Paris 20 et Saint-Ouen restent observés séparément : leurs publications à J+30 décrivent la visibilité, pas une ouverture de réservation. Les horizons Anybuddy, UCPA et le suivi de Boulogne ne sont pas modifiés.

Cette référence n’installe aucun cron de réservation et ne transforme pas l’hypothèse en règle vérifiée pour Hermes. L’heure observée à Boulogne sert à préparer une tentative future autorisée, dont le résultat devra être vérifié dans le club choisi.

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

La connexion utilise le formulaire officiel puis vérifie l’identité côté serveur. `npm run auth:4padel:check` contrôle la session sans reconnecter ni sauvegarder. Les comptes et commandes UCPA/4PADEL sont détaillés dans le [guide d’authentification](authentication.md). La session privée est réutilisée dans `.auth/providers/`, avec des permissions restrictives. Le collecteur contrôle la session sans ressaisir les identifiants. Si elle expire, lancer explicitement `npm run auth:4padel` pour la rétablir. Un changement de compte recommence une base d’observation pour éviter de comparer des droits différents. Les erreurs ne contiennent ni mot de passe ni jeton.

Les identifiants et sessions ne sont pas versionnés. Sur un VPS, renseigner la configuration privée de ce VPS ; pousser le code ne transfère pas les secrets. Aucun autre timer ni cron Hermes récurrent n’est nécessaire. Les cibles officielles s’activent ou se désactivent dans `data/direct-monitoring.json` avec `monitoring.enabled`.

## Lire les résultats

```sh
node scripts/observe.js --report
```

Chaque entrée fournit `provider`, `canonicalClubId` (club physique), `clubId` (identifiant de l’historique) et `horizon` :

- `lastAvailableDate` et `availableLeadDays` : dernière journée avec au moins un créneau proposé, exprimée depuis la date du relevé à Paris.
- `availableLeadIsLowerBound` : la disponibilité atteint la fin du scan ; ce n’est pas un horizon fixe.
- `navigationThroughDate` : dernière journée atteinte par les flèches hebdomadaires UCPA Paris.
- `declaredCalendarThroughDate` : fin de semaine correspondant à la limite annoncée par le calendrier initial de Meudon.
- `selectableThroughDate` : dernière date accessible dans le calendrier, quand cette information est disponible.
- `declaredVisibilityDays` : règle de visibilité annoncée pour le compte 4PADEL.
- `lastPublishedDate` : dernière journée présentant des horaires, même si tous ses terrains sont complets.

Chez 4PADEL, l’API peut retourner des terrains au-delà des dates accessibles dans le calendrier. Le collecteur lit d’abord les dates activées dans l’interface, puis interroge uniquement ces journées. Les dates désactivées sont conservées dans `snapshot.blockedDates`. Les prix correspondent au terrain entier en double (quatre joueurs), pour les durées renvoyées par le club. Il n’utilise pas le faux fuseau de `startingDate` : les heures sont calculées à partir de `startingDateZuluTime`.

Chez UCPA Paris, Playwright parcourt le calendrier public avec sa flèche « semaine suivante », jusqu’à sa désactivation. Il relève les semaines réellement affichées et suit aussi les deux semaines suivant cette limite pour détecter son déplacement. `availabilityScope: public_next_week_navigation` précise cette portée : la limite de navigation n’est pas une règle de réservation garantie, et les éventuels autres parcours du sélecteur de date ou droits de compte ne sont pas validés. L’API UCPA seule peut exposer des terrains beaucoup plus lointains ; ils ne sont pas comptés comme accessibles par ce parcours.

À Meudon, le calendrier initial annonce quatre mois. La dernière semaine visible a été vérifiée avec les flèches natives : **11–17 janvier 2027**, au 13 septembre 2026. Le collecteur relit cette limite à chaque passage et consulte uniquement les semaines autorisées autour de sa frontière. Il n’interroge pas les stocks bruts au-delà de cette limite. Les prochaines dates surveillées commencent au **18 janvier 2027** ; la période exacte de publication sera déterminée par les observations successives. [Validation et limites du suivi Meudon](paris-suburbs.md).

Une règle J+14 ne prouve pas une ouverture à minuit. Le suivi enregistre, dans le parcours observé, le passage de « date inaccessible ou sans disponibilité » à « au moins un créneau proposé », puis cherche cinq confirmations supplémentaires espacées de cinq minutes. Une première collecte établit seulement une base. Les groupes de dates apparues ensemble permettent aussi de rechercher des publications hebdomadaires.

Les historiques Anybuddy existants conservent leurs identifiants. Les échecs HTTP 401, 403 ou 429 mettent en attente le fournisseur concerné ; les autres fournisseurs continuent. Une erreur conserve le dernier relevé valide, sans compter comme absence ou confirmation. Les instantanés privés sont conservés 30 jours.

Playtomic expose les disponibilités par tenant et par date. Le collecteur surveille cinq jours autour de la frontière J+14 initialement affichée sur les pages Casa Padel, sans présenter cette indication comme une politique effective de tous les comptes. Il lit seulement les créneaux de padel et n’ouvre jamais l’URL de paiement. Les relevés complets sont espacés de trois heures et la découverte de quinze minutes avant apprentissage afin de réduire la charge sur le site.

## Périmètre de réservation

Le moteur multi-clubs utilise **Anybuddy**. Les skills de programmation peuvent aussi cibler un club officiel 4PADEL avec `provider: "4padel"`, une règle d’ouverture documentée et les contrôles de crédits associés. UCPA dispose de [commandes directes de réservation et de gestion](ucpa-booking.md). 4PADEL dispose également de [commandes de réservation en crédits et de gestion](fourpadel-booking.md). Les collecteurs officiels observent uniquement les calendriers ; ils ne déclenchent pas ces commandes. Hermes doit conserver le fournisseur dans son analyse et ne pas appliquer une ouverture 4PADEL au moteur de réservation Anybuddy. Boulogne-Billancourt est ajouté au suivi officiel ; il n’est pas ajouté artificiellement au catalogue de réservation Anybuddy.

## Régulation et apprentissage

Le [guide du suivi adaptatif](adaptive-monitoring.md) décrit les réglages par cible, les plages horaires apprises, les pauses de six heures en cas de restriction et les alertes Telegram via Hermes. Les scans complets sont horaires ; les autres passages sont ciblés ou ignorés selon les preuves disponibles. Les instantanés bruts restent disponibles 30 jours et les groupes de publications résumés 400 jours.

Le suivi Anybuddy est désactivé pour `ucpa-paris`, `4padel-paris-20` et `4padel-saint-ouen` dans `data/clubs.json`, car leur site officiel est déjà suivi. Les sept suivis Anybuddy actifs sont Paris Padel, Sportfield Bercy, Aquaboulevard, Padelistes Bercy, Padel 15, Forest Hill Nanterre–La Défense et Forest Hill Marnes-la-Coquette. La réservation via Anybuddy reste disponible pour les clubs désactivés ; leurs anciens relevés ne décrivent plus une disponibilité actuelle. Aucun historique n’est effacé par cette désactivation.
