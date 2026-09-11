# Paris Padel - anybotty

Préparer des réservations de padel sur **Anybuddy**, avec l’objectif d’obtenir des horaires très demandés dès leur ouverture. « anybotty » est un clin d’œil à Anybuddy ; ce projet est indépendant de la plateforme.

## État du projet

Le dépôt est initialisé à partir de [Paris Tennis](https://github.com/RolandVrignon/par-ici-tennis). La copie des fichiers versionnés est conservée dans [`reference/paris-tennis/`](reference/paris-tennis/) ; l’origine exacte et la licence figurent dans [ORIGIN.md](ORIGIN.md).

La base actuelle contient :

- le catalogue des neuf centres et les dernières disponibilités relevées manuellement ;
- une configuration de demande avec heure, durées de 60/90 minutes et centres préférés ;
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
cp -n config.json.sample config.json
chmod 600 config.json
```

`npm ci` installe les dépendances héritées et Chromium. Aucun identifiant de compte n’a été copié depuis Paris Tennis. `config.json`, les journaux et les observations locales sont ignorés par Git.

## Configurer une demande

Exemple : lundi 21 septembre 2026 à 20 h, pendant 60 ou 90 minutes. Remplacer la date par la date souhaitée.

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
npm run booking:plan -- --config config.json.sample
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

Chaque club possède un suivi indépendant et persistant dans `openingWatch`. Au démarrage de son suivi, le script fixe la date cible à **date du jour à Paris + horizon observé + 1 jour**. Cette date ne change pas à minuit ni après un redémarrage. Une `monitoring.targetDate` explicite dans le catalogue prend priorité. Lorsqu’elle change, seul le suivi du club concerné redémarre ; les anciennes observations sont conservées.

Exemples avec un démarrage le **11 septembre 2026** :

| Centres | Horizon | Date cible |
| --- | --- | --- |
| Paris Padel, UCPA, Padelistes Bercy | J+8 | 20 septembre |
| Sportfield Bercy | J+14 | 26 septembre |
| 4PADEL Paris 20 | J+3 | 15 septembre |
| Aquaboulevard | J+6 | 18 septembre |
| 4Padel Saint-Ouen | J+1 | 13 septembre |
| Padel 15 | J+5 | 17 septembre |

**Trinquet Village est exclu de la surveillance** (`monitoring.enabled: false`), car il propose déjà des disponibilités très en avance. Il reste dans le catalogue ; son historique est conservé. Le collecteur, son rapport et les attentes après erreur prennent uniquement en compte les huit clubs actifs.

Les clubs actifs sont interrogés **en parallèle**, une requête par club et par passage, uniquement pour leur date cible. Toutes les durées proposées sont conservées, indépendamment de `config.json`.

1. **`waiting`** : vérifier toutes les cinq minutes si la date cible dispose de créneaux.
2. **`verifying`** : dès leur première apparition, conserver l’intervalle entre le dernier relevé sans disponibilité et le premier avec disponibilité. Puis effectuer **cinq relevés supplémentaires**, aux cinq passages suivants, soit environ 25 minutes.
3. **`complete`** : après ces cinq confirmations, archiver le résultat de la date dans `completedWatches`. Au passage suivant, le club surveille **la date suivante** et recommence le même cycle. Chaque club avance indépendamment. Une cible explicitement fixée par `monitoring.targetDate` reste une campagne unique ; les huit clubs actifs utilisent le suivi continu.

Une confirmation signifie que **la date a toujours des créneaux disponibles**. Leur nombre et le nombre de créneaux initiaux encore présents sont enregistrés à chaque contrôle : certains peuvent avoir été réservés par d’autres personnes. Si la date n’a plus aucun créneau, l’essai est conservé dans `failedAttempts` et le suivi repart en attente, avec un nouveau cycle de cinq confirmations lors de la prochaine apparition.

Les erreurs réseau ne comptent jamais comme confirmation ou disparition. Elles peuvent allonger la période au-delà de 25 minutes. Une attente croissante et `Retry-After` sont respectés ; une réponse 401, 403 ou 429 suspend tous les passages suivants pendant cette attente. Les requêtes déjà parties en parallèle peuvent terminer.

Le rapport inclut les 30 dernières campagnes terminées par club dans `completedWatches`, ainsi que `measuredOpeningDays` (campagnes avec intervalle mesuré et cinq confirmations). Une date déjà ouverte au premier contrôle ne compte pas comme heure d’ouverture mesurée.

Le rapport `observe:report` expose `openingWatch.targetDate`, `phase`, `openingInterval` (UTC et Paris), `firstAvailableAt`, `confirmations`, `completedAt` et `result`. L’intervalle inclut le temps de réponse réseau. **Une seule ouverture observée donne une heure approximative pour cette date, pas encore une règle quotidienne garantie.**

Si la date est déjà disponible au premier contrôle, le script effectue les cinq vérifications mais laisse `openingInterval` à `null` et conclut `already_available_at_first_check`. Il ne transforme pas l’heure de son démarrage en heure d’ouverture.

Les fichiers `observations/<club>/<jour UTC>/<horodatage>.json.gz` contiennent le suivi, les offres et prix en centimes, les erreurs et les changements. Ils sont exclus de Git. Conservation glissante de 30 jours, en conservant toujours le dernier état du club, y compris après la fin de son suivi. `ANYBOTTY_OBSERVATIONS_DIR` permet de choisir un autre dossier local. Les identifiants de service ne sont pas assimilés à des courts physiques.

Les anciens relevés larges restent consultables dans l’historique. Les suivis en cours sont conservés lors des mises à jour et des redémarrages. Le passage à la date suivante est automatique après les cinq confirmations. Pour lancer une série indépendante, choisir un nouveau `ANYBOTTY_OBSERVATIONS_DIR` dans le service ; les résultats précédents restent dans l’ancien dossier.

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

## Comparer quatre à cinq jours

Laisser tourner le timer permet de recueillir plusieurs ouvertures par club, sans relancer manuellement le script. Comparer les intervalles en heure de Paris, les jours de semaine, les délais et les erreurs. Quatre ou cinq ouvertures concordantes donnent un premier indice de régularité ; elles ne garantissent pas les week-ends, jours fériés ou changements de politique du club.

Le nombre de jours de fonctionnement ne garantit pas autant de mesures : si une date ne s’ouvre pas, disparaît avant cinq confirmations, ou est déjà ouverte au début du suivi, le rapport le montre. Le script garde une cible tant que son cycle n’est pas terminé. La date suivante commence au passage suivant la cinquième confirmation : si elle est déjà ouverte, son heure d’apparition reste inconnue.

## Interpréter les ouvertures

Le [protocole d’observation](docs/opening-observation.md) décrit les données à collecter et les critères de validation. Il faut déterminer, pour chaque centre, si les créneaux ouvrent tous ensemble à heure fixe ou progressivement dans une fenêtre glissante.

La stratégie cible sera ensuite : vérifier les centres déjà ouverts ; si le créneau demandé manque, tenter les prochaines ouvertures ; arrêter toutes les tentatives après une confirmation et vérifier le compte en cas de résultat incertain.

## Licence

MIT. Attribution de la base Paris Tennis conservée dans [LICENSE](LICENSE).
