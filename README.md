# Paris Padel - anybotty

Préparer des réservations de padel sur **Anybuddy**, avec l’objectif d’obtenir des horaires très demandés dès leur ouverture. « anybotty » est un clin d’œil à Anybuddy ; ce projet est indépendant de la plateforme.

## État du projet

Le dépôt est initialisé à partir de [Paris Tennis](https://github.com/RolandVrignon/par-ici-tennis). La copie des fichiers versionnés est conservée dans [`reference/paris-tennis/`](reference/paris-tennis/) ; l’origine exacte et la licence figurent dans [ORIGIN.md](ORIGIN.md).

La base actuelle contient :

- le catalogue des neuf centres et les dernières disponibilités relevées manuellement ;
- deux configurations séparées : compte/options fixes et demande de réservation ;
- une connexion Playwright avec sauvegarde et vérification de session ;
- un planning **prévisionnel** calculé à partir des horizons observés ;
- un collecteur des disponibilités publiques, prévu toutes les cinq minutes ;
- un historique compressé, un rapport et des intervalles de première apparition.

**Le collecteur consulte Anybuddy et détecte les changements. La réservation, le paiement et l’intégration de réservation Hermes padel ne sont pas encore implémentés.** `npm ci` ne programme rien : la surveillance continue est activée séparément avec le timer systemd ci-dessous. Le code et les workflows de réservation Paris Tennis restent dans le dossier de référence.

## Installation

Node.js 22.22.2 ou 24 et npm sont utilisés pour cette base.

```sh
git clone https://github.com/RolandVrignon/paris-padel-anybotty.git
cd paris-padel-anybotty
npm ci
npm run config:init
```

`npm ci` installe les dépendances héritées et Chromium. Aucun identifiant de compte n’a été copié depuis Paris Tennis. `config.fixed.json`, `config.request.json`, l’ancien `config.json`, `.auth/`, les journaux et les observations locales sont ignorés par Git.

## Configuration fixe : compte et navigateur

`npm run config:init` crée les deux fichiers locaux avec des permissions `0600`, sans écraser les fichiers existants. Si un ancien `config.json` existe, ses données sont réparties entre les deux fichiers et le fichier source est conservé.

Compléter **`config.fixed.json`** :

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

Ce fichier contient les identifiants Anybuddy et les options du navigateur. Les clés de demande n’y sont pas acceptées. `browser.headed` ouvre Chromium de façon visible ; `timeoutMs` accepte de 1 000 à 300 000 millisecondes.

## Configuration variable : réservation souhaitée

Compléter **`config.request.json`**. Exemple : lundi 21 septembre 2026 à 20 h, pendant 60 ou 90 minutes. Remplacer la date par la date souhaitée.

```json
{
  "date": "21/09/2026",
  "startTime": "20:00",
  "durationsMinutes": [60, 90],
  "clubs": ["paris-padel", "ucpa-paris", "padelistes-bercy", "4padel-paris-20"],
  "maxTotalPriceEUR": null
}
```

- `date` : date du match au format `DD/MM/YYYY`, en `Europe/Paris`.
- `startTime` : heure de début exacte, au format `HH:mm`.
- `durationsMinutes` : `[60]`, `[90]` ou `[60, 90]` si les deux conviennent. Il faudra vérifier que le club propose ces durées.
- `clubs` : identifiants issus du catalogue, dans l’ordre de préférence.
- `maxTotalPriceEUR` : futur plafond total par réservation. `null` signifie non renseigné ; aucune autorisation de paiement n’en découle.

La demande ne peut pas contenir `account`, `browser` ou d’autres options fixes. `booking:plan` lit uniquement la demande ; il fonctionne même sans identifiants. La connexion lit uniquement le fichier fixe et ne dépend pas de la date de réservation.

Chemins personnalisés : `ANYBOTTY_FIXED_CONFIG_PATH` et `ANYBOTTY_REQUEST_CONFIG_PATH`. Un chemin explicite absent est une erreur ; aucun autre fichier n’est utilisé silencieusement à sa place. Les fichiers séparés prennent priorité sur l’ancien `config.json`.

## Connexion Anybuddy avec Playwright

```sh
# Connexion par email et mot de passe, navigateur visible
npm run auth:login-headed
# Respecter browser.headed du fichier fixe
npm run auth:login
# Connexion sans interface, si le compte le permet
npm run auth:login -- --headless
# Vérifier la session sauvegardée dans un nouveau navigateur
npm run auth:check -- --headless
# Connexion effectuée manuellement dans Chromium
npm run auth:login-manual
```

Le script utilise le formulaire officiel `/fr/login`, remplit l’email et le mot de passe puis clique sur « Se connecter ». Une connexion n’est déclarée réussie que lorsque `/api/me` confirme une identité correspondant à l’email configuré. Les identifiants refusés, une identité différente ou une session expirée sont signalés sans publier les valeurs sensibles.

Après confirmation, `.auth/session.json` conserve les cookies, le stockage local et IndexedDB nécessaires à la session, avec des permissions `0600` dans un dossier `0700`. Ce fichier est sensible et ignoré par Git. Il permet aux prochaines commandes Playwright de restaurer la session. `auth:check` ne reconnecte pas automatiquement un compte dont la session a expiré : relancer `auth:login`.

Le mode manuel permet de terminer une connexion interactive dans Chromium ; augmenter `browser.timeoutMs` si nécessaire, jusqu’à cinq minutes. Aucun solveur CAPTCHA n’est utilisé pour la connexion Anybuddy. Ces commandes s’arrêtent après vérification de l’authentification et n’effectuent aucune réservation.

Les identifiants Paris Tennis ne sont jamais repris automatiquement. Une installation sur le VPS possède ses propres fichiers locaux ; les identifiants et la session du Mac ne sont pas envoyés par un `git push`. Le collecteur public de disponibilités continue de fonctionner sans ces fichiers.

## Catalogue initial

Les données ci-dessous ont été revérifiées via les disponibilités publiques Anybuddy le **11 septembre 2026**, considéré comme J+0, sur une plage allant jusqu’au 11 novembre. Elles décrivent les dernières disponibilités vues, pas des règles d’ouverture confirmées. Les résultats sont conservés dans [le relevé de vérification](data/horizon-audit-2026-09-11.json).

| Identifiant | Centre | Dernière disponibilité observée | Horizon observé |
| --- | --- | --- | --- |
| `paris-padel` | Paris Padel | 19 septembre | J+8 |
| `ucpa-paris` | UCPA Sport Station Hostel Paris | 19 septembre | J+8 |
| `sportfield-bercy` | Sportfield Paris 12 - Bercy | 25 septembre | J+14 |
| `4padel-paris-20` | 4PADEL Paris 20 | 14 septembre | J+3 |
| `aquaboulevard` | Forest Hill Aquaboulevard De Paris | 17 septembre | J+6 |
| `4padel-saint-ouen` | 4Padel Saint-Ouen | 12 septembre | J+1 |
| `trinquet-village` | Trinquet Village | 11 novembre (limite de la recherche atteinte) | **au moins J+61** |
| `padelistes-bercy` | Padelistes Bercy - Paris 12 | 19 septembre | J+8 |
| `padel-15` | Padel 15 | 16 septembre | J+5 |

Le 10 novembre correspond à **J+60**, mais le 11 novembre affiche déjà des créneaux pour Trinquet Village : 26 heures de départ sur le site lors de cette vérification. Sa limite réelle reste inconnue ; `horizonIsLowerBound: true` empêche de lire J+61 comme une limite confirmée. Le champ est un indicateur de lecture du catalogue, pas une règle de réservation automatique.

Les liens des centres, les dates d’observation et le statut de vérification sont dans [`data/clubs.json`](data/clubs.json). Toutes les heures d’ouverture sont actuellement `null` et toutes les règles `verified: false`.

## Commandes disponibles

```sh
npm start
npm run clubs:list
npm run booking:plan
# Utiliser directement l’exemple, sans configuration locale
npm run booking:plan -- --config config.request.json.sample
npm run eslint
npm test
npm run test:reference
npm run observe:once
npm run observe:report
```

`npm start` affiche l’état du projet. `clubs:list` lit le catalogue local, sans contacter Anybuddy. `booking:plan` produit du JSON avec deux groupes :

- `checkNow` : centres dont l’ouverture théorique est déjà passée ou tombe aujourd’hui ; leur disponibilité réelle reste à consulter ;
- `upcoming` : centres dont l’ouverture théorique est à venir, classés par date puis préférence.

Ce planning ne déclenche aucune tâche et n’est pas une mesure d’ouverture. Pour le 21 septembre, les J+8 conduisent théoriquement au 13 septembre, les J+6 au 15, les J+5 au 16, les J+3 au 18 et les J+1 au 20.

## Surveillance toutes les cinq minutes

```sh
# Un passage sur les huit clubs surveillés
npm run observe:once
# Dernier état de chaque club et ouvertures candidates observées
npm run observe:report
```

Le collecteur lit la même route publique que le calendrier web : `https://www.anybuddyapp.com/api/v1/availabilities`, avec le club, le sport `padel` et une plage de dates. Aucun compte, token, modèle Hugging Face ou navigateur n’est nécessaire. Cette interface peut évoluer ; une réponse inattendue est enregistrée comme erreur, jamais comme absence de créneau.

Chaque passage interroge les **huit clubs actifs en parallèle**, une requête par club, sur une fenêtre de **J à J+35 inclus** au minimum. Si l’horizon observé d’un club dépasse 21 jours, la fenêtre s’étend jusqu’à cet horizon + 14 jours. Toutes les durées sont conservées, indépendamment de `config.json`.

**Trinquet Village est exclu** (`monitoring.enabled: false`). Il reste dans le catalogue et ses anciens relevés sont conservés.

### Plusieurs dates suivies simultanément

Chaque date de la fenêtre possède son propre état dans `calendar.watches` :

1. **`waiting`** : aucun créneau visible ; enregistrer le dernier contrôle valide sans disponibilité.
2. **`verifying`** : première apparition ; enregistrer l’intervalle d’ouverture puis réaliser cinq contrôles supplémentaires espacés d’environ cinq minutes. Un lancement manuel quelques secondes avant un passage du timer ne compte pas comme un contrôle de cinq minutes.
3. **`complete`** : cinq confirmations obtenues ; archiver le résultat de cette date. La collecte du calendrier continue, y compris pour voir les horaires ajoutés ensuite sur les dates déjà ouvertes.

Une date fermée ou complète ne bloque **aucune autre date**. Si sept dates deviennent visibles au même passage, leurs sept contrôles démarrent ensemble. La fenêtre avance chaque jour, et les nouvelles dates commencent avec une référence initiale : on ne leur invente pas d’heure d’ouverture.

Les anciennes cibles (par exemple le 26 septembre pour Sportfield) et leurs preuves sont reprises automatiquement lors de cette mise à jour. `openingWatch` reste un repère de lecture compatible avec l’ancien rapport ; les mesures complètes sont dans `calendar` et `completedWatches`.

Une confirmation signifie que la date possède encore des créneaux. Leur nombre et le nombre de créneaux initiaux encore présents sont conservés. Si tous disparaissent avant les cinq confirmations, le suivi de cette date repart en attente et le lot correspondant est marqué non confirmé. Une date déjà disponible au premier relevé peut être confirmée, mais son heure d’ouverture reste inconnue.

### Détecter les publications par jour, semaine ou horaire

`calendar.batches` regroupe les dates devenues visibles au même relevé. Pour chaque groupe, le rapport donne :

- le jour et l’heure de publication observés, en Europe/Paris ;
- les dates concernées et si elles sont consécutives ;
- les semaines des dates concernées, avec des semaines commençant le lundi ;
- `targetWeekOffsets` : `0` pour la semaine de publication, `1` pour la suivante, `2` pour celle d’après ;
- les intervalles de première apparition et les confirmations par date.

Cela permet de comparer une publication quotidienne, une ouverture en fin de semaine pour la semaine suivante, une ouverture le lundi pour la semaine en cours ou des groupes de dates irréguliers. Les dates vues au même relevé ne sont pas nécessairement publiées à la même seconde : la résolution reste celle de la collecte.

`calendar.additionalSlots` conserve séparément les horaires ou durées ajoutés sur une date déjà disponible, avec leur délai avant le match (`leadTimeHours`). Ils peuvent révéler une ouverture progressive, mais aussi une annulation ou une modification des disponibilités ; aucune cause n’est affirmée automatiquement.

Le rapport compte les **jours et semaines de publication distincts** (`independentPublicationDays`, `independentPublicationWeeks`) après les cinq confirmations. Sept dates publiées ensemble comptent comme **une seule publication observée**, pas sept répétitions indépendantes.

### Historique et erreurs

`observations/<club>/<jour UTC>/<horodatage>.json.gz` conserve les instantanés, offres, prix en centimes, états, erreurs et événements pendant 30 jours. Ces fichiers sont ignorés par Git. Les résumés conservent jusqu’à 200 campagnes, groupes et ajouts d’horaires des 30 derniers jours ; les instantanés bruts permettent de retrouver les détails au-delà de cette limite de résumé. `ANYBOTTY_OBSERVATIONS_DIR` choisit un autre dossier local.

Les erreurs ne comptent jamais comme absence ou confirmation et peuvent élargir les intervalles. L’attente croît en cas d’échec, `Retry-After` est respecté et une réponse 401, 403 ou 429 suspend les passages suivants. Les requêtes déjà parties en parallèle peuvent terminer. Les anciennes observations sont conservées lors des mises à jour et redémarrages.

### Activation sur le VPS

Les unités fournies ciblent `/home/<utilisateur>/paris-padel-anybotty` et `/usr/local/bin/node` ; adapter ces chemins si nécessaire. Après clonage et installation des dépendances sur le VPS :

```sh
mkdir -p ~/.config/systemd/user
cp deploy/anybotty-observe.service deploy/anybotty-observe.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now anybotty-observe.timer
systemctl --user start anybotty-observe.service
systemctl --user list-timers anybotty-observe.timer
journalctl --user -u anybotty-observe.service -n 30 --no-pager
```

Le timer passe à `:00`, `:05`, `:10`, etc., et reprend après redémarrage. Le compte doit avoir le maintien des services utilisateur activé (`loginctl show-user "$USER" -p Linger`, attendu `yes`). Une seule exécution est autorisée à la fois. Chaque requête expire après 20 secondes, le service après quatre minutes.

```sh
# Suspendre la surveillance
systemctl --user disable --now anybotty-observe.timer
# Arrêter également un éventuel passage en cours
systemctl --user stop anybotty-observe.service
```

Hermes peut lancer `node scripts/observe.js --report` depuis le dépôt et lire les mêmes résultats. Le timer système réalise la collecte sans solliciter un modèle toutes les cinq minutes.

## Établir une règle par club

Quatre à cinq **publications quotidiennes** concordantes donnent un premier indice de régularité. Pour une hypothèse **hebdomadaire**, observer plutôt **deux à trois semaines**, afin de comparer plusieurs cycles. Les dates déjà ouvertes au démarrage et les groupes non confirmés ne prouvent pas une heure de publication.

Comparer les jours et heures de publication, les semaines des matchs, les intervalles, les ajouts d’horaires et les erreurs. Vérifier aussi les différences entre semaine et week-end, courts et durées. Une absence peut signifier une date complète, fermée ou non publiée. La fenêtre interrogée est bornée : les disponibilités au-delà de sa fin restent inconnues.

Le [protocole d’observation](docs/opening-observation.md) détaille ces hypothèses. Aucune heure de réservation définitive n’est déduite d’un seul groupe de dates. La réservation automatique reste à implémenter.

## Licence

MIT. Attribution de la base Paris Tennis conservée dans [LICENSE](LICENSE).
