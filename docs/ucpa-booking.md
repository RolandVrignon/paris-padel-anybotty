# Réserver et gérer ses parties sur UCPA Paris 19 et Meudon

La navigation du calendrier reconnaît les jours affichés avec ou sans zéro initial (`07` ou `7`) et les associe au jour de semaine et à la plage horaire exacte. Une reconnexion automatique SSO est vérifiée par l’identité du portail, sans exiger l’apparition du formulaire email.

Le site officiel UCPA dispose de son propre parcours : **réservation avec carte déjà enregistrée, liste des réservations, détail et annulation de la partie**. Les commandes utilisent `providers.ucpa.account` dans `config.fixed.json`, indépendamment du compte et du moyen de paiement Anybuddy.

La carte bancaire enregistrée est renvoyée par le service de paiement UCPA pour le compte connecté ; elle ne dépend pas du remplissage automatique du navigateur. Le bot attend son libellé visible et reconnaît les variantes mobile et ordinateur du checkout. L’API `customerCards` concerne les cartes de séances et ne permet pas de déterminer si une carte bancaire est enregistrée.

Un test réel a été réalisé le 13 septembre 2026 : réservation du 21 septembre, 07:00–08:00, Terrain 6 Padel HC, puis annulation sans frais confirmée par UCPA et disparition des réservations à venir. Les boutons, requêtes et contrôles observés sont repris dans les modules `lib/ucpa-*.js`.

Cette intégration est locale. Les skills Hermes, le moteur multi-clubs et les tâches programmées restent actuellement orientés vers Anybuddy ; les commandes UCPA ci-dessous ne les remplacent pas automatiquement.

## Commandes

```sh
# Liste des réservations UCPA de padel à venir (Paris 19 par défaut)
npm run ucpa -- list

# Même lecture pour Meudon
npm run ucpa -- list --club ucpa-meudon

# Réservations à venir et passées renvoyées par le portail
npm run ucpa -- list --scope all

# Détail : utiliser l'identifiant reçu dans la liste
npm run ucpa -- show --id IDENTIFIANT

# Aperçu : va au checkout sans accepter les conditions ni réserver
npm run ucpa -- book --headed

# Réservation réelle : utilise la carte enregistrée chez UCPA
npm run ucpa -- book --confirm --headed

# Exemple avec préférences explicites : adapter la date à un jour futur
npm run ucpa -- book --date 2026-09-21 --time 07:00 \
  --durations 60,90 --court-environment indoor --max-price-per-hour 38
# Ajouter --confirm à cette commande pour une réservation réelle.

# Meudon : le centre est explicite pour book, list, show, cancel et reconcile
npm run ucpa -- book --club ucpa-meudon --date 2027-01-11 --time 07:00 \
  --durations 60 --court-environment indoor --max-price-per-hour 50

# Inspecter les conditions d'annulation, sans annuler
npm run ucpa -- cancel --id IDENTIFIANT

# Annuler avec la version fournie par l'aperçu précédent
npm run ucpa -- cancel --id IDENTIFIANT --confirm --expected-version VERSION

# Vérifier une tentative de réservation, sans nouveau clic
npm run ucpa -- reconcile --date 2026-09-21 --time 07:00
```

`npm run checkout:ucpa -- --headed` reste disponible comme raccourci d’aperçu. Sans `--headed`, le navigateur fonctionne en arrière-plan sur la machine locale. `npm run ucpa -- --help` affiche les options.

`--club` accepte `ucpa-paris` et `ucpa-meudon`. Sans option, Paris 19 reste la valeur par défaut. `book` et `reconcile` utilisent la date et l’heure de `config.request.json` lorsqu’elles ne sont pas explicites ; le centre UCPA présent dans les clubs est alors repris. Les dates acceptent `DD/MM/YYYY` ou `YYYY-MM-DD`. Les arguments remplacent les préférences concernées sans réécrire les fichiers privés.

## Choix du créneau et du terrain

Les terrains configurés à Paris 19 et Meudon sont intérieurs. Le bot choisit toujours **le premier terrain disponible proposé**, sans préférence de numéro. Les préférences `indoor`, `indoor,outdoor`, `outdoor,indoor` et `any` acceptent ces centres ; `outdoor` seul donne `no_match`.

Les durées sont considérées dans l’ordre demandé parmi les offres publiées à l’heure exacte. `90,60` permet un repli sur 60 minutes ; `90` seul ne l’autorise pas. Le calendrier observé proposait des séances d’une heure : le bot ne combine pas plusieurs créneaux pour fabriquer une durée plus longue.

Le parcours contrôle :

1. Le compte connecté, la date, l’heure et la disponibilité dans les semaines accessibles par les flèches du calendrier.
2. Le choix du premier terrain, ou le passage direct à « Ma participation » lorsqu’aucun choix n’est proposé.
3. L’identité du compte dans le tunnel, la durée et le terrain sélectionné. Les options EGYM Wellpass et code promo restent désactivées.
4. Le récapitulatif, le prix du terrain entier et l’identifiant de séance renvoyé par UCPA.
5. Pour une réservation réelle seulement : présence d’une carte enregistrée, case des conditions, clic unique sur « Réserver », puis recherche de la réservation correspondante dans le compte.

## Prix et paiement différé

Pour le test, UCPA affichait **9,50 € pour la participation du capitaine**, une place sur quatre, soit **38 € pour le terrain entier**. Le capitaine garantit le paiement des parts manquantes. Le plafond `maxPricePerHourEUR` porte sur le terrain entier, jamais sur la seule participation : pour deux heures, le budget admissible est deux fois le plafond horaire.

Cette déduction est limitée au parcours vérifié **capitaine non abonné, sans code promotionnel, une place sur quatre**. Le script refuse de déduire un total si ces conditions changent. L’ajout d’une carte, les réductions et les tarifs abonnés restent à intégrer.

Le clic « Réserver » crée un **engagement réel**, même sans débit immédiat. UCPA indique que le prélèvement des sommes dues se déclenche au début de la partie. Le résultat expose `paymentTiming: "session_day"` ; `booked` signifie que la réservation a été retrouvée dans le compte, pas que la banque a déjà effectué un débit. [CGV UCPA, article 9](https://media.ucpa.com/image/upload/v1785140696/PRODUCTION-GRAPHIQUE/WEB/CGV-Individuels-USS-Paris.pdf).

## Annuler la partie

L’annulation proposée concerne **la partie entière**, et non le retrait de sa seule participation. Elle est réservée au capitaine, à **plus de 48 heures** du début, avec confirmation explicite dans la modale qu’aucun joueur n’aura à payer. À moins de 48 heures, les CGV maintiennent la responsabilité financière du capitaine ; ce premier script ne prend donc en charge que l’annulation gratuite. [CGV UCPA, article 9](https://media.ucpa.com/image/upload/v1785140696/PRODUCTION-GRAPHIQUE/WEB/CGV-Individuels-USS-Paris.pdf).

`cancel` affiche d’abord le terrain, la date, les conditions et une `version`. `--confirm --expected-version VERSION` vérifie de nouveau ces éléments avant de cliquer. Si les conditions ou la réservation changent, il faut refaire l’aperçu.

L’annulation est considérée comme vérifiée lorsque **la réponse UCPA confirme le succès et que la réservation n’est plus présente dans le compte**. Une disparition seule ne suffit pas. UCPA retire les parties annulées de sa liste ; `show` peut retrouver leur résultat dans le journal local lorsque le bot a enregistré une confirmation d’annulation.

## Résultats, historique et reprise

| Statut | Signification |
| --- | --- |
| `checkout_ready` | Aperçu conforme ; aucune réservation soumise. |
| `booked` | Réservation soumise et retrouvée dans le compte avec la bonne séance, date, heure, durée et terrain. |
| `already_reserved` | Une réservation existe déjà à cette date et heure ; aucune nouvelle soumission. |
| `no_match` | Créneau absent, environnement exclu ou plafond horaire dépassé. |
| `not_open` | Date hors des semaines accessibles par les flèches ; aucune heure d’ouverture n’est déduite. |
| `cancellation_preview` | Conditions d’annulation inspectées, sans soumission. |
| `cancelled` | Succès d’annulation enregistré et absence contrôlée dans le compte. |
| `booking_unverified` / `cancellation_unverified` | Issue incertaine ; aucune nouvelle soumission automatique. |
| `not_found` | Réservation absente et pas de confirmation locale permettant de conclure à une annulation. |

Les commandes émettent du JSON. Les erreurs renvoient un code de sortie 1 ; les résultats incertains, 2. Une absence de correspondance renvoie un résultat normal avec son statut explicite.

Un verrou par compte protège les opérations locales. Le journal est écrit **avant** chaque clic engageant, sous `.auth/ucpa-actions/`, dans un dossier propre au compte, avec des fichiers en `0600` exclus de Git. Il ne contient ni identifiants, ni carte, ni jetons ni QR codes. Une tentative déjà journalisée à la même date et heure est réconciliée au lieu d’être soumise de nouveau, y compris après son annulation. Une nouvelle intention après annulation n’est pas encore exposée par une option de réinitialisation.

Pour reprendre explicitement une annulation non confirmée, utiliser `cancel --id ID --retry` pour obtenir un nouvel aperçu, puis `cancel --id ID --retry --confirm --expected-version HASH`. Le script exige que la réservation figure encore dans le compte, soit annulable par le capitaine et reste sans frais à plus de 48 heures. Il conserve la tentative précédente dans le journal. Cette option ne relance jamais un paiement ou une réservation.

La liste parcourt les pages du portail et vérifie leur identité, leur total et leurs doublons. Elle couvre les réservations passées et les réservations à venir sur les 366 prochains jours ; elle affiche seulement le padel du compte principal, pas les autres sports ou les réservations de proches. Le journal d’annulation local complète `show`, mais ne constitue pas l’historique complet des annulations faites manuellement sur le site.

## Éléments observés pour la maintenance

| Étape | Contrôle observé |
| --- | --- |
| Calendrier | `web-component-planner`, jours `.mobile-day`, bouton dont le nom se termine par `RÉSERVER` (icône incluse dans le nom accessible). |
| Identité de séance | Réponse `/loisirs-reservation/api/amplify/session/products` : rapprochement du nom, de la date et de la durée avec l’ID choisi. |
| Choix du terrain | `div.card-top.pointer`, puis texte exact du terrain. |
| Étape suivante | Bouton `Étape suivante` ; vérifier aussi la classe CSS `disabled`. |
| Conditions | `input#cgi` ; conservé décoché en aperçu. |
| Validation | Bouton exact `Réserver` ; POST `/loisirs-reservation/api/users/createCourtBooking`. |
| Liste | POST `/sport-station/espacepersonnel/api/{centre}/amplify/kala/reservedSession`, pagination par contact du compte. |
| Détail | Page `scheduled-reservations/<sessionId>/<customerUuid>` ; GET `kala/getSessionById`. |
| Annulation | Bouton exact `Annuler la partie`, puis `Confirmer l'annulation`. `Garder ma partie` est l'autre choix. |
| Mutation d’annulation | POST `/sport-station/espacepersonnel/api/{centre}/cancel-court-session` avec `sessionId` et `uuid` égal au contact `horanet_id` du compte pour les séances externes ; le `customerUuid` utilisé dans l’URL de détail n’est pas cet identifiant. |

Le garde réseau bloque les mutations en aperçu. Pour une action réelle, il n’autorise qu’une requête vers le point d’entrée attendu, avec vérification de sa cible et, pour réserver, du prix de la participation et des options. Il ne rejoue pas les données de carte : la soumission vient du bouton natif et utilise la carte enregistrée chez UCPA.

## Validation

- Parcours réel : réservation, écran de confirmation, apparition dans le compte, détail, confirmation d’annulation gratuite, réponse serveur réussie et absence après relecture.
- Aperçu réel testé avec et sans affichage du navigateur, créneau complet et premier terrain intérieur disponible.
- Tests Chromium et unitaires : pagination, compte incorrect, prix modifié, double exécution, réponse perdue, version d’annulation périmée, délai de 48 heures, capitaine/participant et absence de clic engageant en aperçu.

Paris 19 a été validé de bout en bout avec sa carte enregistrée : réservation réelle, lecture du compte et annulation gratuite. Meudon a été validé le 13 septembre 2026 jusqu’au checkout avec une lecture authentifiée du compte : 11 janvier à 07:00, Terrain 1 Padel HC, 6,25 € par part et 25 € pour le terrain. Les conditions sont restées décochées et aucune réservation n’a été soumise. La réservation réelle, l’apparition dans le compte et l’annulation Meudon restent donc à recetter.
