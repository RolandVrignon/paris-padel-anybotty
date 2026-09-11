# Paris Padel — anybotty

Préparer un créneau de padel sur **Anybuddy** et observer quand les clubs publient leurs disponibilités, pour viser les horaires les plus demandés dès leur ouverture.

Le projet est indépendant d’Anybuddy. Il dérive de [Paris Tennis](https://github.com/RolandVrignon/par-ici-tennis), dont la base est conservée dans [`reference/paris-tennis/`](reference/paris-tennis/) et documentée dans [ORIGIN.md](ORIGIN.md).

## Ce qui fonctionne aujourd’hui

| Fonction | État |
| --- | --- |
| Catalogue de neuf clubs et planning prévisionnel | Disponible |
| Surveillance des ouvertures sur huit clubs, toutes les cinq minutes | Disponible via le timer systemd |
| Connexion Anybuddy et réutilisation de session | Disponible avec Playwright |
| Choix de durée, intérieur/extérieur et terrain dans la modale | Disponible |
| Recherche dans l’ordre des clubs, avec plafond horaire | Disponible ; arrêt au premier récapitulatif conforme |
| Simulation d’un créneau jusqu’au formulaire Stripe | Disponible |
| Réservation automatique dès l’ouverture et paiement final | À implémenter |
| Liste et annulation des réservations Anybuddy | À implémenter |

**`npm start` affiche l’état du projet ; il ne réserve rien et ne lance pas la surveillance.** `booking:search` essaie les clubs configurés pour une date et une heure ; `checkout:preview` teste un club explicite. Ces deux commandes restent sans paiement final.

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

La recherche ne patiente pas jusqu’à une ouverture future et ne programme pas de nouveau passage. Le déclenchement à l’heure d’ouverture et le paiement final viendront ensuite. Elle refuse une heure de départ passée et limite chaque club à 50 tentatives pour éviter une boucle sur des offres changeantes.

### Résultat et journal

Le JSON final est écrit sur la sortie standard et dans `.auth/booking-search/latest.json`. Les événements par club sont écrits sur la sortie d’erreur : absence de créneau, dépassement du budget, erreur de simulation ou offre retenue. En cas d’erreur de navigateur, les derniers diagnostics sont conservés dans `.auth/booking-search/failure.*`. Ces fichiers restent locaux et ignorés par Git.

| Statut | Signification | Code de sortie |
| --- | --- | --- |
| `checkout_ready` | Premier récapitulatif conforme trouvé ; aucun paiement soumis | 0 |
| `no_match` | Aucun créneau compatible après le passage | 2 |
| `incomplete` | Une erreur technique ou la limite de tentatives empêche de conclure à l’absence d’offres | 1 |
| `blocked` | Session/navigateur indisponible, ou restriction d’accès HTTP 401/403/429 | 1 |

Une erreur technique n’est pas comptée comme une indisponibilité. Le moteur essaie la possibilité suivante lorsque c’est possible, mais s’arrête sur une restriction d’accès ou une session inutilisable. Un verrou local empêche deux recherches simultanées dans ce dépôt ; il ne constitue pas encore une protection contre les doubles réservations payées. Relancer la commande recommence une recherche.

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

Installer les quatre skills dans le profil Hermes utilisé par le bot :

```sh
npm run hermes:install
# Pour un profil non standard : HERMES_HOME=/chemin/du/profil npm run hermes:install
```

L’installateur remplace les chemins du dépôt, préserve les autres skills et sauvegarde une version précédente si elle change. Les sources sont versionnées dans `skills/` ; la copie installée se trouve dans `~/.hermes/skills/` par défaut.

| Skill | Demandes prises en charge |
| --- | --- |
| `padel-clubs` | Vérifier un nom exact, lister les centres et consulter les disponibilités publiques d’une date |
| `padel-booking` | Lire/modifier les préférences, vérifier la session, chercher un créneau et expliquer le résultat |
| `padel-monitoring` | Lire les ouvertures observées, contrôler le timer et suspendre/reprendre la surveillance sur demande |
| `padel-strategy` | Arbitrer entre attendre un club prioritaire et essayer un club de repli déjà disponible |

Exemples à envoyer au bot :

- « Quels clubs Bercy connais-tu ? »
- « Quelles disponibilités à 4PADEL Paris 20 dimanche, à partir des horaires affichés ? »
- « Cherche lundi prochain à 20 h : Paris Padel puis UCPA, 60 puis 90 minutes, intérieur préféré et 80 €/h maximum. »
- « Mets mes préférences sur extérieur uniquement et 90 minutes. »
- « Paris Padel est mon premier choix mais n’a pas encore ouvert lundi prochain : vaut-il mieux attendre ou prendre Sportfield à 20 h ? »
- « Quel est le dernier résultat de recherche padel ? »
- « Quelles heures d’ouverture as-tu observées cette semaine ? »
- « Suspends la surveillance padel. »

Les recherches restent des **simulations jusqu’au récapitulatif**. Hermes ne peut pas encore payer, lister/annuler les réservations du compte Anybuddy ou réserver automatiquement à l’ouverture. Une demande enregistrée n’est pas une réservation programmée.

### Attendre un club prioritaire avant de se replier

`padel-strategy` intervient avant une recherche multi-clubs. Par défaut, si un club préféré doit encore ouvrir la date souhaitée, Hermes recommande d’attendre cette ouverture au lieu de passer directement au club suivant. Il compare les disponibilités de la journée entière, les horaires demandés, les observations et les horizons théoriques. Une estimation reste présentée comme telle ; aucune heure n’est inventée.

Si le club préféré est déjà ouvert sans offre compatible, ou si l’utilisateur demande explicitement de prendre le premier disponible maintenant, la stratégie peut autoriser un repli. Elle conserve les exclusions de durée/type et le plafond horaire. Le bot annonce le prochain essai, les incertitudes et le plan B ; le créneau de repli peut disparaître pendant l’attente.

Cette décision est portée par le skill : Hermes transmet au moteur une demande temporaire limitée aux clubs autorisés. **La commande brute `booking:search` conserve son comportement immédiat** et ne connaît pas cette stratégie. Les préférences enregistrées ne sont pas réordonnées.

Une décision d’attendre ne programme pas de recherche future : le timer collecte toujours les disponibilités, mais ne réserve pas et ne relance pas le moteur. Le prochain essai doit encore être lancé. La programmation à l’ouverture et le paiement final restent des étapes distinctes.

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

Les identifiants et `.auth/session.json` doivent être configurés sur le VPS séparément de Git. Ne jamais transmettre le mot de passe au bot Telegram. Les skills sont découverts par les outils `skills_list` et `skill_view` d’Hermes ; après installation sur un gateway déjà démarré, envoyer `/reload-skills` dans Telegram pour actualiser ses commandes sans interrompre les conversations. Invoquer ensuite `/padel-booking`, `/padel-clubs`, `/padel-monitoring` ou `/padel-strategy` (les variantes Telegram avec underscores sont aussi reconnues).

## Licence

MIT. Attribution de la base Paris Tennis conservée dans [LICENSE](LICENSE).
