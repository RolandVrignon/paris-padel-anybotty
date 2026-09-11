# Paris Padel - anybotty

Préparer des réservations de padel sur **Anybuddy**, avec l’objectif d’obtenir des horaires très demandés dès leur ouverture. « anybotty » est un clin d’œil à Anybuddy ; ce projet est indépendant de la plateforme.

## État du projet

Le dépôt est initialisé à partir de [Paris Tennis](https://github.com/RolandVrignon/par-ici-tennis). La copie des fichiers versionnés est conservée dans [`reference/paris-tennis/`](reference/paris-tennis/) ; l’origine exacte et la licence figurent dans [ORIGIN.md](ORIGIN.md).

La base actuelle contient :

- le catalogue des neuf centres et les dernières disponibilités relevées manuellement ;
- une configuration de demande avec heure, durées de 60/90 minutes et centres préférés ;
- un planning **prévisionnel** calculé à partir des horizons observés ;
- un protocole pour mesurer les véritables heures d’ouverture.

**La consultation automatique d’Anybuddy, la surveillance des ouvertures, la réservation, le paiement et l’intégration Hermes padel ne sont pas encore implémentés.** Aucun cron n’est lancé par l’installation. Le code et les workflows de réservation Paris Tennis restent dans le dossier de référence.

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

Les données ci-dessous proviennent des observations manuelles du **11 septembre 2026**, considéré comme J+0. Elles décrivent les dernières disponibilités vues, pas des règles d’ouverture confirmées.

| Identifiant | Centre | Dernière disponibilité observée | Horizon observé |
| --- | --- | --- | --- |
| `paris-padel` | Paris Padel | 19 septembre | J+8 |
| `ucpa-paris` | UCPA Sport Station Hostel Paris | 19 septembre | J+8 |
| `sportfield-bercy` | Sportfield Paris 12 - Bercy | 25 septembre | J+14 |
| `4padel-paris-20` | 4PADEL Paris 20 | 14 septembre | J+3 |
| `aquaboulevard` | Forest Hill Aquaboulevard De Paris | 17 septembre | J+6 |
| `4padel-saint-ouen` | 4Padel Saint-Ouen | 12 septembre | J+1 |
| `trinquet-village` | Trinquet Village | 25 septembre | J+14 |
| `padelistes-bercy` | Padelistes Bercy - Paris 12 | 19 septembre | J+8 |
| `padel-15` | Padel 15 | 16 septembre | J+5 |

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
```

`npm start` affiche l’état du projet. `clubs:list` lit le catalogue local, sans contacter Anybuddy. `booking:plan` produit du JSON avec deux groupes :

- `checkNow` : centres dont l’ouverture théorique est déjà passée ou tombe aujourd’hui ; leur disponibilité réelle reste à consulter ;
- `upcoming` : centres dont l’ouverture théorique est à venir, classés par date puis préférence.

Ce planning ne déclenche aucune tâche et n’est pas une mesure d’ouverture. Pour le 21 septembre, les J+8 conduisent théoriquement au 13 septembre, les J+6 au 15, les J+5 au 16, les J+3 au 18 et les J+1 au 20.

## Prochaine étape : mesurer les ouvertures

Le [protocole d’observation](docs/opening-observation.md) décrit les données à collecter et les critères de validation. Il faut déterminer, pour chaque centre, si les créneaux ouvrent tous ensemble à heure fixe ou progressivement dans une fenêtre glissante.

La stratégie cible sera ensuite : vérifier les centres déjà ouverts ; si le créneau demandé manque, tenter les prochaines ouvertures ; arrêter toutes les tentatives après une confirmation et vérifier le compte en cas de résultat incertain.

## Licence

MIT. Attribution de la base Paris Tennis conservée dans [LICENSE](LICENSE).
