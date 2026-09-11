# Paris Padel — anybotty

Réserver un créneau de padel sur **Anybuddy**, suivre les ouvertures et gérer ses réservations depuis un terminal ou en **langage naturel avec Hermes et Telegram sur un VPS**.

Le projet est indépendant d’Anybuddy. Il dérive de [Paris Tennis](https://github.com/RolandVrignon/par-ici-tennis), dont la base est conservée dans [`reference/paris-tennis/`](reference/paris-tennis/) et documentée dans [ORIGIN.md](ORIGIN.md).

Pour utiliser le bot directement, consulter [Hermes et Telegram](#piloter-depuis-hermes--telegram) et les [exemples en langage naturel](#parler-au-bot-en-langage-naturel).

## Sommaire

- [Ce qui fonctionne aujourd’hui](#ce-qui-fonctionne-aujourdhui)
- [Démarrage rapide](#démarrage-rapide)
- [Configurer le compte](#configurer-le-compte)
- [Configurer les préférences](#configurer-les-préférences)
- [Connexion Anybuddy](#connexion-anybuddy)
- [Chercher parmi les clubs préférés](#chercher-parmi-les-clubs-préférés)
- [Réserver et payer](#réserver-et-payer)
- [Simuler une réservation](#simuler-une-réservation)
- [Clubs et horizons observés](#clubs-et-horizons-observés)
- [Surveillance toutes les cinq minutes](#surveillance-toutes-les-cinq-minutes)
- [Installer la surveillance sur un VPS](#installer-la-surveillance-sur-un-vps)
- [Dépannage et validation](#dépannage-et-validation)
- [Piloter depuis Hermes / Telegram](#piloter-depuis-hermes--telegram)
  - [Parler au bot en langage naturel](#parler-au-bot-en-langage-naturel)
  - [Exemple de demande complète](#exemple-de-demande-complète)
  - [Déroulement d’une tentative programmée](#déroulement-dune-tentative-programmée)
  - [Réservations du compte et annulation](#réservations-du-compte-et-annulation)
- [Licence](#licence)

## Ce qui fonctionne aujourd’hui

| Fonction | État |
| --- | --- |
| Catalogue de neuf clubs et planning prévisionnel | Disponible |
| Surveillance des ouvertures sur huit clubs, toutes les cinq minutes | Disponible via le timer systemd |
| Connexion Anybuddy et réutilisation de session | Disponible avec Playwright |
| Choix de durée, intérieur/extérieur et terrain dans la modale | Disponible |
| Recherche dans l’ordre des clubs, avec plafond horaire | Disponible ; simulation ou paiement explicite |
| Simulation d’un créneau jusqu’au formulaire Stripe | Disponible |
| Stratégie et tentative programmée à l’ouverture | Disponible via les skills et le cron Hermes |
| Confirmation d’une nouvelle réservation et paiement final | Disponible avec `booking:pay` ; parcours réel validé à UCPA |
| Liste et détails des réservations Anybuddy | Disponible, lecture validée sur le compte réel |
| Annulation Anybuddy avec vérification du statut | Validée sur la réservation réelle UCPA, statut annulé vérifié |

**`npm start` affiche l’état du projet ; il ne réserve rien et ne lance pas la surveillance.** `booking:search` essaie les clubs configurés pour une date et une heure ; `checkout:preview` teste un club explicite. Sans option, elles restent sans paiement final. `booking:pay` (ou `booking:search -- --pay`) réalise une réservation payante.

## Démarrage rapide

Utiliser Node.js 22.22.2 ou 24 et **npm**.

```sh
git clone https://github.com/RolandVrignon/paris-padel-anybotty.git
cd paris-padel-anybotty
npm ci
npm run config:init
```

L’installation télécharge Chromium. `config:init` crée les deux fichiers locaux sans écraser ceux qui existent :

| Fichier | Contenu |
| --- | --- |
| `config.fixed.json` | Identifiants Anybuddy et options du navigateur |
| `config.request.json` | Date, heure, clubs et préférences de réservation |

Pour commencer sans compte, consulter le catalogue et générer un planning à partir de l’exemple :

```sh
npm run clubs:list
npm run booking:plan -- --config config.request.json.sample
```

Pour tester le parcours de réservation, compléter les configurations ci-dessous, puis [se connecter](#connexion-anybuddy) et [lancer une simulation](#simuler-une-réservation).

## Configurer le compte

Dans `config.fixed.json` :

```json
{
  "account": {
    "email": "votre@email.fr",
    "password": "votre-mot-de-passe"
  },
  "browser": {
    "headed": true,
    "timeoutMs": 60000
  }
}
```

`browser.headed` règle la visibilité du navigateur pour la connexion. `browser.timeoutMs` accepte de 1 000 à 300 000 millisecondes. La simulation ouvre toujours un navigateur visible par défaut ; son option `--headless` permet de le masquer.

**Ne jamais commiter les identifiants ni la session.** Les configurations locales, `.auth/` et `observations/` sont ignorées par Git. `config:init` crée les configurations avec des permissions `0600`. Aucun identifiant Paris Tennis n’est repris automatiquement.

Pour préparer le remplissage du formulaire Stripe, une section optionnelle `payment` est disponible dans `config.fixed.json` :

```json
"payment": {
  "cardholderName": "",
  "cardNumber": "",
  "expiryMonth": "",
  "expiryYear": "",
  "cvc": "",
  "billingCountry": "FR",
  "billingPostalCode": ""
}
```

Toutes les valeurs restent des chaînes entre guillemets : mois sur deux chiffres (`MM`), année sur quatre chiffres (`YYYY`), CVC sur trois ou quatre chiffres, pays sur deux lettres. Renseigner ces données uniquement dans le fichier local privé ; le fichier `.sample` conserve les champs vides. Ne pas envoyer la carte dans Telegram ou la conversation. Le mode `booking:pay` remplit la carte et confirme le paiement ; `checkout:preview -- --to-stripe --fill-card` remplit seulement le formulaire. Les tâches programmées peuvent utiliser `mode: "pay"`. Le bloc `payment` doit être renseigné sur la machine qui exécute la réservation : le déploiement du code ne transfère pas la carte vers le VPS.

## Configurer les préférences

Dans `config.request.json`, par exemple pour le 21 septembre 2026 à 20 h :

```json
{
  "date": "21/09/2026",
  "startTime": "20:00",
  "durationsMinutes": [60, 90],
  "courtEnvironment": ["indoor", "outdoor"],
  "clubs": ["paris-padel", "ucpa-paris", "sportfield-bercy", "4padel-paris-20"],
  "maxPricePerHourEUR": 80
}
```

Adapter la date à la demande. Les dates de configuration utilisent **`DD/MM/YYYY`**, les heures **`HH:mm`**, dans le fuseau **Europe/Paris**. Les identifiants de clubs figurent dans le [catalogue](#clubs-et-horizons-observés).

### Durées : l’ordre définit la préférence

| `durationsMinutes` | Choix autorisés, dans l’ordre |
| --- | --- |
| `[60, 90, 120]` | 60 min, puis 90 min, puis 120 min |
| `[60, 90]` | 60 min, puis 90 min ; 120 min exclu |
| `[90, 60]` | 90 min, puis 60 min ; 120 min exclu |
| `[120]` | 120 min uniquement |

Seules les valeurs numériques `60`, `90` et `120` sont acceptées. Une durée absente de la liste est exclue ; une liste vide ou contenant des doublons est refusée.

### Intérieur / extérieur : même principe

| `courtEnvironment` | Choix du terrain |
| --- | --- |
| `["indoor", "outdoor"]` | Intérieur préféré, extérieur accepté en second choix |
| `["outdoor", "indoor"]` | Extérieur préféré, intérieur accepté en second choix |
| `["indoor"]` | Intérieur uniquement |
| `["outdoor"]` | Extérieur uniquement |
| `["any"]` | Peu importe : premier terrain compatible |

`["any"]` est la valeur par défaut et doit être utilisé seul. Les doublons et valeurs inconnues sont refusés. Les anciennes valeurs textuelles (`any`, `indoor`, `outdoor`, `indoor_preferred`, `outdoor_preferred`) restent compatibles et sont converties en listes.

### Comment les préférences se combinent

Dans le club et le créneau inspectés, le script applique **la durée, puis le type de terrain, puis l’ordre affiché des terrains compatibles**.

Avec `[60, 90]` et `["indoor", "outdoor"]`, il préfère **60 minutes dehors à 90 minutes dedans**. Avec `[60, 90]` et `["indoor"]`, il essaie 90 minutes dedans si aucun intérieur n’est proposé à 60 minutes. Les exclusions restent obligatoires, même pour une durée préférée.

`clubs` définit l’ordre de recherche : toutes les offres compatibles d’un club sont essayées avant de passer au suivant. La recherche s’arrête dès qu’un récapitulatif respecte tous les critères. Le prix filtre les offres ; il ne remplace pas l’ordre de préférence par un classement du moins cher au plus cher.

### Budget par heure

`maxPricePerHourEUR` limite le **prix du terrain entier par heure**, pas le prix par joueur. Il se calcule à partir du total du récapitulatif : `total × 60 / durée en minutes`.

Avec un plafond de **80 €/h** :

| Durée | Total maximum accepté | Exemple |
| --- | --- | --- |
| 60 min | 80 € | 81 € est refusé |
| 90 min | 120 € | 120 € est accepté, 120,01 € est refusé |
| 120 min | 160 € | 120 € correspond à 60 €/h : accepté |

La comparaison utilise les centimes sans arrondir le taux horaire avant décision. Le plafond est vérifié au récapitulatif, puis de nouveau avant l’ouverture de Stripe si elle est demandée. Un prix manquant ou ambigu est refusé. `null` ou un champ absent signifie aucun plafond ; sinon, utiliser un montant positif avec au plus deux décimales.

**Migration :** remplacer `maxTotalPriceEUR` par `maxPricePerHourEUR`. Une ancienne valeur numérique provoque une erreur explicite, car transformer silencieusement un budget total en budget horaire augmenterait la dépense autorisée. L’ancienne valeur `null` reste acceptée.

### Fichiers et compatibilité

Les paramètres de compte restent dans le fichier fixe et les souhaits dans le fichier de demande. `booking:plan` fonctionne sans identifiants ; la connexion fonctionne sans demande de réservation.

Les variables `ANYBOTTY_FIXED_CONFIG_PATH` et `ANYBOTTY_REQUEST_CONFIG_PATH` permettent de choisir d’autres chemins. Un chemin explicite absent provoque une erreur. Les fichiers séparés ont priorité sur l’ancien `config.json` ; `config:init` peut répartir son contenu sans supprimer l’original.

## Connexion Anybuddy

Après avoir renseigné `config.fixed.json` :

```sh
npm run auth:login-headed
npm run auth:check -- --headless
```

La connexion utilise le formulaire Anybuddy. Elle n’est validée que lorsque le compte retourné correspond à l’email configuré. La session est sauvegardée dans `.auth/session.json`, avec ses cookies, son stockage local et IndexedDB, pour les prochaines commandes.

| Besoin | Commande |
| --- | --- |
| Respecter `browser.headed` | `npm run auth:login` |
| Se connecter sans interface | `npm run auth:login -- --headless` |
| Terminer la connexion à la main | `npm run auth:login-manual` |
| Vérifier la session existante | `npm run auth:check -- --headless` |

En mode manuel, augmenter `browser.timeoutMs` si nécessaire, jusqu’à cinq minutes. Aucun solveur CAPTCHA n’est intégré à la connexion Anybuddy. Une session expirée nécessite une nouvelle connexion ; `auth:check` ne la renouvelle pas automatiquement.

## Chercher parmi les clubs préférés

Après connexion, lancer la recherche avec les souhaits de `config.request.json` :

```sh
npm run booking:search
# Même recherche, navigateur masqué
npm run booking:search -- --headless
# Autre fichier de demande
npm run booking:search -- --config config.request.json --headless
```

Cette commande lit la date, l’heure, la liste des clubs, les durées, les types de terrain et le plafond horaire. Elle réalise **un passage**, dans cet ordre :

1. Consulter les disponibilités du premier club, sans déduire l’absence d’offres de son seul horizon théorique.
2. Essayer les durées autorisées, puis les types de terrain et les terrains compatibles dans leur ordre de préférence.
3. Vérifier le récapitulatif. Si l’offre dépasse le budget, exclure ce terrain pour cette durée et poursuivre dans le même club. Une nouvelle page est utilisée pour chaque tentative ; une offre écartée n’est pas rejouée pendant ce passage.
4. Passer au club suivant lorsque les possibilités sont épuisées.
5. Au premier récapitulatif conforme, enregistrer le résultat, fermer le navigateur et quitter immédiatement.

Les conditions restent non cochées et aucun bouton Payer n’est cliqué. Le résultat `checkout_ready` signifie **offre préparée**, pas réservation confirmée. Comme pour la simulation individuelle, la préparation peut laisser des paniers impayés côté serveur.

La recherche ne patiente pas jusqu’à une ouverture future et ne programme pas de nouveau passage. Le déclenchement à l’ouverture passe par `padel-scheduling` ; le mode `pay` permet le paiement final. Elle refuse une heure de départ passée et limite chaque club à 50 tentatives pour éviter une boucle sur des offres changeantes.

### Résultat et journal

Le JSON final est écrit sur la sortie standard et dans `.auth/booking-search/latest.json`. Les événements par club sont écrits sur la sortie d’erreur : absence de créneau, dépassement du budget, erreur de simulation ou offre retenue. En cas d’erreur de navigateur, les derniers diagnostics sont conservés dans `.auth/booking-search/failure.*`. Ces fichiers restent locaux et ignorés par Git.

| Statut | Signification | Code de sortie |
| --- | --- | --- |
| `checkout_ready` | Premier récapitulatif conforme trouvé ; aucun paiement soumis | 0 |
| `no_match` | Aucun créneau compatible après le passage | 2 |
| `incomplete` | Une erreur technique ou la limite de tentatives empêche de conclure à l’absence d’offres | 1 |
| `blocked` | Session/navigateur indisponible, ou restriction d’accès HTTP 401/403/429 | 1 |

Une erreur technique n’est pas comptée comme une indisponibilité. Le moteur essaie la possibilité suivante lorsque c’est possible, mais s’arrête sur une restriction d’accès ou une session inutilisable. Un verrou local empêche deux recherches simultanées dans ce dépôt. Le mode réel vérifie aussi les réservations existantes et conserve un journal avant paiement. Ces protections concernent une installation ; éviter de payer simultanément depuis le Mac, le VPS et l’application mobile.

## Réserver et payer

Une fois le compte, la carte privée et les souhaits configurés :

```sh
# Vérifier la configuration locale sans afficher la carte ni contacter la banque
npm run payment:check
# Réservation réelle avec navigateur visible
npm run booking:pay
# Même réservation depuis le VPS
npm run booking:pay -- --headless
# Demande ponctuelle
npm run booking:pay -- --config /chemin/demande.json --headless
```

Ces commandes effectuent **un vrai paiement**. Le moteur essaie les possibilités dans l’ordre club → durée → intérieur/extérieur → terrain. Au premier récapitulatif conforme, il accepte les conditions connues, ouvre Stripe, sélectionne Carte bancaire, remplit les champs privés et revérifie le club, la date, l’heure, le terrain, la durée et le total. Le plafond `maxPricePerHourEUR` s’applique toujours ; un changement du total depuis le récapitulatif bloque le paiement.

Le bouton final est identifié dans le checkout par son libellé exact et son montant. Son clic DOM évite le déplacement vers Revolut Pay constaté pendant le test UCPA. Une seule requête de confirmation Stripe est autorisée ; les autres confirmations restent bloquées. Aucun nouveau paiement n’a été effectué pour tester cette intégration : les régressions s’exécutent sur des fixtures locales.

Le succès exige une **nouvelle réservation confirmée dans le compte Anybuddy**, correspondant au club, terrain, date, heure et durée. Un simple écran de succès ou un paiement Stripe `requires_capture` ne suffit pas. Ce dernier état indique une autorisation en attente de capture, selon le [cycle PaymentIntent de Stripe](https://docs.stripe.com/payments/paymentintents/lifecycle).

| Statut | Signification | Code |
| --- | --- | --- |
| `booked` | Réservation confirmée dans Anybuddy ; arrêt du moteur | 0 |
| `existing_reservation` | Une réservation existe déjà à cette heure ; pas de nouveau paiement, consulter son statut | 0 |
| `payment_failed` | Refus ou annulation Stripe ; aucun nouvel essai automatique | 1 |
| `payment_action_required` | Validation bancaire requise | 1 |
| `payment_unverified` | Paiement potentiellement soumis, réservation non confirmée ; relecture seulement | 1 |

En mode visible, le script attend jusqu’à trois minutes après le clic pour une éventuelle validation bancaire manuelle et la confirmation. En mode masqué, une demande 3DS arrête le parcours avec `payment_action_required`. Ne pas relancer un paiement pour résoudre cette situation ; vérifier d’abord l’état du compte. Le bot ne contourne pas la validation bancaire.

Avant le clic, une trace sans carte est écrite dans `.auth/payments/`. La clé regroupe le compte, la date et l’heure, indépendamment des clubs ou durées de repli. Un lancement ultérieur pour la même intention relit son état sans soumettre un second paiement, même après une interruption. Ne pas effacer ces traces pour forcer un nouvel essai ; une réservation annulée ensuite ne réactive pas automatiquement son paiement.

```sh
# Vérification seule après interruption, avec la demande originale
npm run booking:reconcile -- --config /chemin/demande.json --headless
```

Les refus bancaires et résultats incertains interrompent la recherche avant tout plan B. Les captures d’écran sont désactivées dès l’entrée dans le parcours de paiement et les erreurs de saisie n’affichent jamais les valeurs de carte. Le parcours réel UCPA du 19 septembre 2026, 07 h–08 h, 38 €, a été payé puis annulé pour validation ; cela ne garantit pas l’acceptation bancaire d’un prochain paiement.

## Simuler une réservation

La commande exige **le club, la date au format `YYYY-MM-DD` et l’heure**. Elle reprend les préférences de durée, de type et le plafond horaire depuis le fichier de demande. Contrairement à `booking:search`, elle effectue une seule tentative de récapitulatif et s’arrête sur une offre trop chère. Les exemples ci-dessous utilisent des dates de septembre 2026 : les adapter aux disponibilités actuelles.

### S’arrêter au récapitulatif

```sh
npm run checkout:preview -- --club sportfield-bercy --date 2026-09-17 --time 22:30
```

Le script vérifie les disponibilités, restaure la session et choisit l’horaire. Si une modale de terrains apparaît, il sélectionne la première offre compatible avec les préférences, puis valide. Il gère aussi un seul terrain préselectionné ou un accès direct au récapitulatif. Il contrôle le club, la date, l’heure, la durée, le terrain choisi et le montant, puis ferme le navigateur sans accepter les conditions.

### Aller jusqu’au formulaire Stripe

```sh
npm run checkout:preview -- --club sportfield-bercy --date 2026-09-17 --time 22:30 --to-stripe
```

Cette option accepte les conditions connues du club et clique sur le premier bouton **Payer**, celui de l’étape « Confirmer et Payer ». Le script attend le formulaire Stripe intégré, puis ferme le navigateur. **Il ne saisit aucune carte et ne clique jamais sur le bouton de paiement final.**

L’ouverture du récapitulatif peut déjà créer un panier serveur. Même sans `--to-stripe`, cette simulation n’est donc pas un dry-run en lecture seule ; un panier ou une session de paiement impayée peut persister.

### Remplir la carte sans confirmer le paiement

Après avoir renseigné `payment` dans le fichier privé `config.fixed.json`, l’option explicite `--fill-card` remplit les champs Stripe puis ferme le navigateur, sans cliquer le bouton de paiement final :

```sh
npm run checkout:preview -- --club ucpa-paris --date 2026-09-19 --time 07:00 --duration 60 --to-stripe --fill-card
```

Remplacer la date par celle souhaitée. `--fill-card` exige `--to-stripe` ; cette commande reste une simulation. Pour payer, utiliser `booking:pay` ou un job `mode: "pay"`. L’ouverture du formulaire crée une session de paiement ou un panier impayé côté serveur, pas une réservation confirmée.

Les [attributs HTML relevés sur le formulaire UCPA](data/stripe-card-fields.json) sont conservés sans valeurs de carte :

| Champ | Balise et ID observé | Attribut utilisé par le script |
| --- | --- | --- |
| Numéro | `input#payment-numberInput` | `autocomplete="cc-number"` |
| Expiration | `input#payment-expiryInput` | `autocomplete="cc-exp"` |
| CVC | `input#payment-cvcInput` | `autocomplete="cc-csc"` |
| Pays | `select#payment-countryInput` | `autocomplete="billing country"` |

Le script attend un formulaire visible provenant de `https://js.stripe.com`, à l’intérieur du checkout Anybuddy. Il distingue ce formulaire des iframes techniques et ne sélectionne aucun champ par position. Si Stripe propose plusieurs moyens de paiement, il peut ouvrir l’onglet « Carte bancaire ». Plusieurs formulaires de carte visibles provoquent un refus.

Nom du titulaire et code postal sont renseignés seulement si leurs champs sont présents ; ils n’étaient pas demandés sur le formulaire UCPA observé. Le résultat donne uniquement les noms des champs remplis ou absents. Aucune capture, valeur de champ ou erreur Playwright contenant les données de carte n’est enregistrée après le début de la saisie. La protection réseau contre la confirmation Stripe reste active ; l’absence de clic final reste la première garantie.

### Options ponctuelles

| Option | Effet |
| --- | --- |
| `--durations 60,90,120` | Remplace la liste ordonnée de durées |
| `--duration 90` | Impose une seule durée ; incompatible avec `--durations` |
| `--court-environment indoor,outdoor` | Préfère l’intérieur ; accepte aussi `outdoor,indoor`, `indoor`, `outdoor` ou `any` |
| `--max-price-per-hour 80` | Remplace le plafond par 80 €/h pour cet essai |
| `--court "Terrain 1"` | Impose ce nom exact de terrain |
| `--headless` | Masque le navigateur |
| `--to-stripe` | Accepte les conditions et ouvre Stripe, sans paiement final |

Ces options ne modifient pas la configuration. Sans fichier de demande, les préférences par défaut sont `[60, 90]`, `["any"]` et aucun plafond de prix.

Le type est lu sur les caractéristiques du **terrain**, pas dans la description générale du club. Un type absent ou ambigu bloque tous les modes sauf `["any"]`. Sans modale, les préférences à deux types acceptent l’offre directe si son type est connu. Après sélection dans une modale, le type et la durée du récapitulatif doivent correspondre au choix effectué.

Les neuf clubs ont été inspectés jusqu’à Stripe le 11 septembre 2026. Une condition inconnue ou manquante bloque la préparation du paiement ; les préférences marketing restent inchangées. Les détails, cases et particularités sont dans le [relevé des checkouts](docs/checkout.md) et les [profils de clubs](data/checkout-requirements.json).

## Clubs et horizons observés

Ce tableau est un **relevé du 11 septembre 2026**, considéré comme J+0. Il ne représente ni les disponibilités actuelles ni des règles d’ouverture garanties. Sources locales : [catalogue](data/clubs.json) et [audit des horizons](data/horizon-audit-2026-09-11.json).

| Identifiant | Centre | Dernière date observée | Horizon observé |
| --- | --- | --- | --- |
| `paris-padel` | Paris Padel | 19/09/2026 | J+8 |
| `ucpa-paris` | UCPA Sport Station Hostel Paris | 19/09/2026 | J+8 |
| `sportfield-bercy` | Sportfield Paris 12 - Bercy | 25/09/2026 | J+14 |
| `4padel-paris-20` | 4PADEL Paris 20 | 14/09/2026 | J+3 |
| `aquaboulevard` | Forest Hill Aquaboulevard De Paris | 17/09/2026 | J+6 |
| `4padel-saint-ouen` | 4Padel Saint-Ouen | 12/09/2026 | J+1 |
| `trinquet-village` | Trinquet Village | 11/11/2026 | Au moins J+61 ; limite inconnue |
| `padelistes-bercy` | Padelistes Bercy - Paris 12 | 19/09/2026 | J+8 |
| `padel-15` | Padel 15 | 16/09/2026 | J+5 |

Trinquet Village reste utilisable pour le planning et la simulation, mais est **exclu de la surveillance** (`monitoring.enabled: false`) : les disponibilités atteignaient la fin de la plage recherchée. J+61 est une borne minimale, pas un horizon confirmé.

### Préparer le planning

```sh
npm run booking:plan
```

Le résultat JSON distingue `checkNow` (ouverture théorique déjà passée ou prévue aujourd’hui) et `upcoming` (ouverture estimée à venir, classée par date puis préférence de club). Pour un match le 21 septembre, un horizon J+8 suggère une ouverture le 13 septembre.

Ce planning ne consulte pas les offres et ne programme aucune réservation. Les heures d’ouverture du catalogue restent non renseignées ; consulter les observations pour rechercher une cadence réelle.

## Surveillance toutes les cinq minutes

La surveillance utilise les disponibilités publiques Anybuddy, **sans compte, navigateur ni clé API**. Elle fonctionne indépendamment des préférences de réservation.

```sh
# Un passage immédiat, sans programmer les suivants
npm run observe:once

# Lire les derniers résultats enregistrés, sans nouvelle collecte
npm run observe:report
```

Chaque passage interroge les huit clubs actifs en parallèle, sur une fenêtre d’au moins **J à J+35 inclus**, étendue si nécessaire jusqu’à l’horizon observé + 14 jours. Toutes les durées et tous les terrains sont conservés.

### Mesurer une ouverture

Chaque date a son propre suivi :

| État | Signification |
| --- | --- |
| `waiting` | Aucun créneau visible ; conserver le dernier contrôle valide |
| `verifying` | Des créneaux apparaissent ; attendre cinq contrôles supplémentaires espacés d’environ cinq minutes |
| `complete` | Les cinq confirmations sont obtenues ; conserver le résultat et continuer à observer le calendrier |

Par exemple, si une date est absente à 07:55 et présente à 08:00, son ouverture est située **entre ces deux contrôles**, sans prétendre connaître la seconde exacte. Les cinq confirmations suivantes vérifient qu’elle reste disponible pendant environ 25 minutes ; elles n’exigent pas que tous les créneaux initiaux soient encore libres.

Une date déjà disponible au premier relevé ne permet pas de dater son ouverture. Une disparition avant la fin des confirmations relance l’attente. Une erreur ne compte jamais comme absence ou confirmation. La fenêtre avance chaque jour, et les dates sont suivies indépendamment.

### Comparer les cadences

Le rapport distingue les nouvelles dates publiées ensemble (`calendar.batches`) des horaires ajoutés à une date déjà ouverte (`calendar.additionalSlots`). Il permet d’étudier les ouvertures quotidiennes, les publications en fin de semaine pour la suivante, celles en début de semaine pour la semaine en cours et les ajouts progressifs.

Quatre à cinq publications indépendantes donnent un premier indice pour une cadence quotidienne. Pour une cadence hebdomadaire, observer plutôt deux à trois semaines. Sept dates apparues ensemble constituent une seule publication observée. Le [protocole d’observation](docs/opening-observation.md) détaille les preuves, limites et champs du rapport ; aucune règle certaine n’est déduite automatiquement.

### Historique et reprise

Les instantanés compressés sont conservés 30 jours dans `observations/<club>/<jour UTC>/<horodatage>.json.gz`, avec les offres, prix en centimes, erreurs et événements. Les résumés conservent jusqu’à 200 campagnes, groupes et ajouts d’horaires sur cette période. `ANYBOTTY_OBSERVATIONS_DIR` permet de changer de dossier.

Les redémarrages conservent le suivi. Une seule collecte s’exécute à la fois. En cas d’échec, l’attente augmente et `Retry-After` est respecté ; les réponses 401, 403 ou 429 suspendent les passages suivants. Les erreurs peuvent élargir l’intervalle d’ouverture mesuré.

## Installer la surveillance sur un VPS

Après clonage et `npm ci`, vérifier les chemins dans [`deploy/anybotty-observe.service`](deploy/anybotty-observe.service) : le dépôt est attendu dans `~/paris-padel-anybotty` et Node dans `/usr/local/bin/node`. Adapter si nécessaire.

```sh
mkdir -p ~/.config/systemd/user
cp deploy/anybotty-observe.service deploy/anybotty-observe.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now anybotty-observe.timer
systemctl --user start anybotty-observe.service
```

Le timer lance une collecte à `:00`, `:05`, `:10`, etc. Chaque requête expire après 20 secondes et le service après quatre minutes. Pour maintenir les services utilisateur hors connexion et après redémarrage, vérifier `Linger=yes` :

```sh
loginctl show-user "$USER" -p Linger
# Si nécessaire, avec les droits d’administration :
sudo loginctl enable-linger "$USER"
```

Contrôler le fonctionnement :

```sh
systemctl --user list-timers anybotty-observe.timer
journalctl --user -u anybotty-observe.service -n 30 --no-pager
npm run observe:report
```

Pour suspendre le timer et arrêter un éventuel passage en cours :

```sh
systemctl --user disable --now anybotty-observe.timer
systemctl --user stop anybotty-observe.service
```

**Hermes** peut exécuter `node scripts/observe.js --report` depuis le dépôt pour lire le rapport JSON. Le timer assure la collecte sans solliciter un modèle toutes les cinq minutes. `booking:search` fournit aussi un résultat JSON, exploité par les skills Hermes décrits ci-dessous. Un `git push` ne déploie pas le VPS et n’y transfère ni identifiants ni session.

## Dépannage et validation

| Symptôme | Action |
| --- | --- |
| Session absente ou expirée | Relancer `npm run auth:login-headed`, puis `auth:check` |
| Connexion interactive nécessaire | Utiliser `npm run auth:login-manual` |
| Créneau introuvable ou terrain incompatible | Vérifier date, heure, durées et types autorisés ; essayer en navigateur visible |
| Échec pendant le checkout | Consulter `.auth/checkout-failure.png` et `.auth/checkout-failure.json` ; ne pas relancer aveuglément le bouton Payer |
| Aucun nouveau relevé | Vérifier le timer, son journal et les éventuels délais de reprise dans le rapport |

Les diagnostics de checkout peuvent contenir des informations de compte ; ils restent locaux et ignorés par Git.

```sh
npm run eslint
npm test
# Vérifier séparément la base Paris Tennis conservée en référence
npm run test:reference
```

Les tests locaux couvrent notamment la configuration, les préférences, les modales, le calcul du plafond horaire, la recherche entre clubs, l’arrêt au premier résultat, les contrôles avant Stripe et le suivi des ouvertures. Ils ne remplacent pas une vérification du site lorsqu’Anybuddy change son interface.


## Piloter depuis Hermes / Telegram

Une fois le VPS configuré, écrire directement au bot Telegram en français. Il n’est pas nécessaire de connaître les commandes du dépôt, les IDs des clubs ou la structure des fichiers JSON : Hermes choisit le skill adapté et exécute les commandes du projet.

**La recherche simule par défaut ; une demande de réservation réelle utilise le mode `pay`.** La gestion des réservations existantes permet, elle, une annulation réelle sur demande explicite. Une recherche immédiate, une tentative programmée et une réservation du compte sont trois objets distincts.

### Installer les skills sur le VPS

Hermes et sa connexion Telegram doivent déjà être configurés. Sur l’installation `dev-station` :

```sh
ssh dev-station
cd /home/rolexx/paris-padel-anybotty
npm run hermes:install
```

Les six skills sont versionnés dans [skills/](skills/). L’installateur renseigne automatiquement le chemin du dépôt, les copie dans `~/.hermes/skills/`, préserve les autres skills et sauvegarde les versions remplacées. Il ne crée aucune tâche programmée et n’envoie aucun message. Pour un autre profil, utiliser `HERMES_HOME=/chemin/du/profil npm run hermes:install` depuis le dépôt.

Si `npm` est introuvable dans une session SSH utilisant l’installation fnm de ce VPS :

```sh
export PATH="/home/rolexx/.local/share/fnm/node-versions/v22.22.2/installation/bin:$PATH"
```

Les credentials doivent être configurés dans le fichier privé `config.fixed.json` du VPS et la session initialisée avec `npm run auth:login -- --headless`. Vérifier ensuite la session avec `npm run auth:check -- --headless`. Ne jamais envoyer le mot de passe dans Telegram ; Git ne transfère ni les credentials ni `.auth/session.json`.

Après installation ou mise à jour, envoyer **`/reload-skills`** dans Telegram pour actualiser les skills du gateway sans interrompre les conversations. On peut ensuite parler naturellement ou invoquer un skill explicitement :

| Skill | Commande Telegram | Rôle |
| --- | --- | --- |
| [padel-clubs](skills/padel-clubs/SKILL.md) | `/padel_clubs` | Résoudre un nom exact, lister les clubs et consulter les disponibilités publiques |
| [padel-booking](skills/padel-booking/SKILL.md) | `/padel_booking` | Lire/modifier les préférences et simuler une recherche |
| [padel-monitoring](skills/padel-monitoring/SKILL.md) | `/padel_monitoring` | Lire les observations et gérer la surveillance des ouvertures |
| [padel-strategy](skills/padel-strategy/SKILL.md) | `/padel_strategy` | Décider entre attendre un club préféré et essayer un club de repli |
| [padel-scheduling](skills/padel-scheduling/SKILL.md) | `/padel_scheduling` | Programmer, consulter et annuler une tentative future |
| [padel-reservations](skills/padel-reservations/SKILL.md) | `/padel_reservations` | Lister les réservations du compte et annuler une réservation identifiée |

### Parler au bot en langage naturel

**Trouver un club ou consulter ses disponibilités**

- « Quels clubs de padel connais-tu à Bercy ? »
- « Vérifie le nom exact de 4PADEL Paris 20. »
- « Quels créneaux sont disponibles dimanche à 4PADEL Paris 20, autour de 12 h 30 ? »

**Définir ses préférences et chercher maintenant**

- « Affiche mes préférences de réservation. »
- « Enregistre Paris Padel, puis UCPA, puis Sportfield Bercy dans cet ordre. Je préfère 60 minutes, sinon 90 ; pas de 120 minutes. »
- « Mets intérieur en premier choix, extérieur accepté, avec un plafond de 80 € par heure pour le terrain entier. »
- « Pour cette recherche seulement, prends extérieur uniquement et 90 minutes. Ne change pas mes préférences enregistrées. »
- « Réserve et paie lundi prochain à 20 h, Paris Padel puis UCPA, 60 ou 90 minutes, intérieur préféré, maximum 80 €/h. »
- « Programme cette réservation réelle à l’ouverture vérifiée du club prioritaire. »
- « Vérifie le résultat du dernier paiement sans le relancer. »
- « Simule un créneau lundi prochain à 20 h chez Sportfield Bercy, 60 puis 90 minutes, sans payer. »
- « Quel est le résultat de ma dernière recherche ? »

**Choisir entre attendre et se replier**

- « Je veux jouer lundi prochain à 20 h. Paris Padel est mon premier choix, puis UCPA, puis Sportfield Bercy. Si Paris Padel n’a pas encore ouvert ses réservations, je préfère attendre. Quelle stratégie proposes-tu ? »
- « Cette fois, prends le premier créneau disponible maintenant parmi mes clubs, sans attendre les prochaines ouvertures. Fais une simulation. »
- « À quelle heure ces clubs ont-ils publié leurs nouveaux créneaux ? Est-ce confirmé par plusieurs jours d’observation ? »

**Programmer et suivre une tentative**

- « Programme une simulation à l’ouverture pour Paris Padel lundi prochain à 20 h, avec mes préférences habituelles. Utilise la règle d’ouverture vérifiée. »
- « Quelles tentatives padel sont programmées ? »
- « Annule la tentative programmée pour lundi à 20 h. »
- « Passe cette tentative à 21 h : annule l’ancienne tâche et prépare la nouvelle selon la stratégie. »

**Gérer les réservations déjà présentes sur le compte**

- « Liste mes réservations Anybuddy à venir. »
- « Montre mon historique et mes réservations annulées. »
- « Donne-moi les détails et les conditions d’annulation de ma réservation de jeudi à 20 h chez Sportfield Bercy. »
- « Annule ma réservation de jeudi à 20 h chez Sportfield Bercy. »

**Suivre les ouvertures**

- « La surveillance des clubs fonctionne-t-elle ? »
- « Y a-t-il des clubs qui ouvrent plusieurs jours d’un coup, par exemple toute la semaine suivante ? »
- « Suspends la surveillance padel. »
- « Reprends la surveillance padel. »

Les jours relatifs comme « lundi prochain » sont résolus en `Europe/Paris`. Hermes vérifie le club et demande seulement les informations manquantes ou ambiguës. Une instruction d’enregistrer des préférences ne crée pas un cron. Une demande explicite d’annulation identifiée vaut autorisation ; les conséquences financières non encore acceptées doivent être clarifiées avant l’action.

### Exemple de demande complète

> Je veux jouer lundi prochain à 20 h. Mes clubs, par ordre de préférence : Paris Padel, UCPA Sport Station Hostel Paris, puis Sportfield Paris 12 - Bercy. Je préfère 60 minutes, sinon 90 ; 120 minutes est exclu. Intérieur de préférence, extérieur accepté. Maximum 80 € par heure pour le terrain entier. Si le club préféré n’a pas encore ouvert, attends son ouverture et programme une simulation si sa règle est vérifiée. Garde les autres clubs comme plan B. Ne paie pas.

Hermes consulte les disponibilités et les observations, choisit le club à tenter, puis programme si les informations le permettent. Il doit annoncer le club retenu, la date du match, l’heure de lancement et si la tâche a effectivement été enregistrée. Une règle inconnue est signalée ; il n’invente pas d’heure. Le plan B n’est pas déclenché automatiquement : il est réévalué après le résultat du club prioritaire.

### Déroulement d’une tentative programmée

1. Hermes valide la date, l’heure, les clubs et les préférences de durée, de terrain et de budget.
2. La stratégie choisit un club prioritaire et une règle d’ouverture documentée : J+x à heure fixe, publication hebdomadaire, délai glissant ou instant explicite.
3. Le helper fige la demande et calcule l’instant en tenant compte du fuseau Europe/Paris et du changement d’heure.
4. Hermes crée un cron ponctuel `no_agent=true`, rattache son ID à la demande et vérifie son enregistrement. Le script exécuté à l’ouverture n’a pas besoin d’un modèle pour choisir ses paramètres.
5. À l’heure prévue, le script consulte les offres et tente d’atteindre un récapitulatif conforme. Le résultat revient au chat/topic Telegram d’origine.

L’heure prévue est celle du déclenchement, pas une garantie d’obtenir le terrain à la seconde. Le réseau, la session, le navigateur et les autres joueurs influencent le résultat. `checkout_ready` signifie **récapitulatif atteint**, jamais réservation confirmée. Pour annuler une tentative future, demander l’annulation de la tâche ; pour annuler un match déjà réservé, demander l’annulation de la réservation.

### Attendre un club prioritaire avant de se replier

`padel-strategy` intervient avant une recherche multi-clubs. Par défaut, si un club préféré doit encore ouvrir la date souhaitée, Hermes recommande d’attendre cette ouverture au lieu de passer directement au club suivant. Il compare les disponibilités de la journée entière, les horaires demandés, les observations et les horizons théoriques. Une estimation reste présentée comme telle ; aucune heure n’est inventée.

Si le club préféré est déjà ouvert sans offre compatible, ou si l’utilisateur demande explicitement de prendre le premier disponible maintenant, la stratégie peut autoriser un repli. Elle conserve les exclusions de durée/type et le plafond horaire. Le bot annonce le prochain essai, les incertitudes et le plan B ; le créneau de repli peut disparaître pendant l’attente.

Cette décision est portée par le skill : Hermes transmet au moteur une demande temporaire limitée aux clubs autorisés. **La commande brute `booking:search` conserve son comportement immédiat** et ne connaît pas cette stratégie. Les préférences enregistrées ne sont pas réordonnées.

Une décision d’attendre ne programme pas de recherche future : le timer collecte toujours les disponibilités, mais ne réserve pas et ne relance pas le moteur. Sur demande, `padel-scheduling` programme une simulation (`preview`) ou une réservation réelle (`pay`) via le cron natif Hermes lorsque la règle d’ouverture est documentée. Le mode est figé dans la tâche ; les anciennes simulations restent sans paiement.

### Programmer selon la politique d’ouverture

Hermes utilise `padel-scheduling` après la stratégie pour figer une demande sur **un club prioritaire**. Le calcul prend en charge J+x à heure locale fixe, une publication hebdomadaire (jour de publication et semaine cible), un délai glissant en heures ou un instant ISO explicite. Les heures locales sont calculées en Europe/Paris avec changement d’heure ; une heure ambiguë ou inexistante exige un instant explicite.

Une règle doit citer des observations vérifiées ou une instruction horaire explicite de l’utilisateur. Un horizon seul ne permet pas de programmer. Les heures encore inconnues du catalogue ne sont pas inventées : `needs_opening_rule` ne crée aucune tâche. Une ouverture déjà passée retourne `check_now`.

```sh
node scripts/booking-jobs.js prepare --input /chemin/prive/demande-programmee.json
node scripts/booking-jobs.js list
node scripts/booking-jobs.js show --id ID
node scripts/booking-jobs.js cancel --id ID
```

Le fichier d’entrée contient `request` au format de `config.request.json`, limité au club retenu, et `opening`. Exemple **hypothétique** de règle :

```json
{
  "mode": "daily",
  "horizonDays": 8,
  "localTime": "08:00",
  "source": "user_instruction",
  "evidence": "Horaire explicitement demandé par l’utilisateur pour cette tentative"
}
```

Cet objet est la valeur de `opening`. Le skill décrit aussi les règles `weekly`, `rolling` et `explicit`. `prepare` retourne un script privé et un instant UTC ; Hermes crée un cron ponctuel `no_agent: true`, l’attache avec `attach --id ID --cron-job-id JOB_ID`, puis vérifie son enregistrement. **Préparer un fichier seul ne programme rien.** Annuler désactive d’abord la tâche locale, puis Hermes supprime le cron. Les préférences enregistrées ne sont pas modifiées.

Les tâches et leurs résultats restent dans `.auth/scheduled-bookings/`, ignoré par Git. Une tentative est consommée une seule fois. Un retard de plus de cinq minutes donne `missed` ; la recherche est limitée à 90 secondes (timeout natif Hermes attendu : au moins 120 secondes). Une interruption peut laisser `running` et exige une vérification avant une nouvelle tentative. Le scheduler et le démarrage du navigateur ne garantissent pas une exécution à la seconde.

Le résultat revient dans le chat d’origine via Hermes : `checkout_ready` en simulation, `booked` uniquement après confirmation Anybuddy en mode réel. Ajouter `"mode":"pay"` à côté de `request` et `opening` dans le JSON de préparation pour une réservation réelle ; le défaut reste `preview`. Une interruption en mode réel donne un résultat de paiement incertain à réconcilier. Aucun retry implicite ni passage automatique au plan B après paiement. Il faut réévaluer la stratégie après l’échec du club préféré.

### Réservations du compte et annulation

Le skill `padel-reservations` répond par exemple à « Liste mes réservations », « Montre mon historique » ou « Annule ma réservation de jeudi à 20 h chez Sportfield ». Il lit le compte connecté, y compris les clubs hors catalogue et les autres sports. Les paniers des simulations ne sont pas assimilés à des réservations confirmées.

```sh
node scripts/reservations.js list
node scripts/reservations.js list --scope all
node scripts/reservations.js list --scope past
node scripts/reservations.js list --scope cancelled
node scripts/reservations.js list --scope pending
node scripts/reservations.js show --id ID
```

Par défaut, la liste contient les réservations à venir et en attente ; les compteurs couvrent aussi l'historique. Le résultat distingue `upcoming`, `pending`, `past` et `cancelled`, avec club, terrain, heure Europe/Paris, durée, prix affichés et conditions. L'état du compte est vérifié à chaque opération. Une erreur ou une pagination incomplète ne donne jamais une liste vide présentée comme fiable.

L'annulation utilise l'ID du match retourné par cette liste, avec deux étapes :

```sh
# Lecture des conditions, sans confirmation finale
node scripts/reservations.js cancel --id ID
# Annulation réelle, uniquement sur demande explicite
node scripts/reservations.js cancel --id ID --confirm --expected-version VERSION_DU_PREVIEW
```

Le premier appel retourne les conditions et une version liée à la réservation. Le second les relit, refuse si elles ont changé, vérifie la fiche affichée et clique la confirmation. Hermes traite toute ambiguïté sur la réservation ou perte financière non encore acceptée avant l'action. Un statut `not_cancellable` reste un refus ; le script ne contourne pas la politique du site.

Seul un statut annulé obtenu par une nouvelle lecture produit `cancelled` avec `verified: true`. `cancellation_unverified` demande une vérification, sans répéter automatiquement le clic. Le journal privé `.auth/reservations/` empêche une nouvelle soumission après un résultat incertain. Une annulation confirmée ne prouve pas qu'un remboursement est déjà reçu. Annuler une réservation ne supprime pas un cron, et inversement.

La lecture a été validée sur le compte réel ; le parcours de confirmation est testé dans un navigateur sur des données simulées. Aucune réservation existante n'a été annulée pour cette validation. Le transport de lecture suit l'action serveur du site Anybuddy, découverte dans ses fichiers JavaScript actuels ; ce n'est pas une API publique stable. Un changement de structure provoque une erreur explicite.

### Interface JSON pour Hermes

```sh
node scripts/padel.js clubs list
node scripts/padel.js clubs find --query 'bercy'
node scripts/padel.js availability --club sportfield-bercy --date 2026-09-21 --time 20:00 --durations 60,90,120
node scripts/padel.js request show
node scripts/padel.js result
```

`clubs find` distingue une correspondance exacte, partielle unique, ambiguë ou absente du catalogue. Les prix publics de `availability` sont indicatifs ; le récapitulatif final reste la référence. Une erreur n’est jamais traduite en liste vide.

Pour modifier la demande, `request show` fournit une `version`. Écrire la demande complète dans un fichier privé, puis appeler `request set --input PATH --expected-version VERSION`. Le helper valide les critères, sauvegarde la précédente demande dans `.auth/request-backups/`, écrit atomiquement et refuse les conflits entre conversations. Les credentials ne sont jamais acceptés dans cette demande. Les recherches ponctuelles peuvent utiliser `booking-search.js --config PATH` sans modifier les préférences enregistrées.

Les commandes ci-dessus sont l’interface technique utilisée par les skills. Depuis Telegram, les [demandes en langage naturel](#parler-au-bot-en-langage-naturel) suffisent ; Hermes utilise les helpers pour préserver les mêmes validations et traces de suivi.

## Licence

MIT. Attribution de la base Paris Tennis conservée dans [LICENSE](LICENSE).
