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
npm run observe:once
npm run observe:report
```

`npm start` affiche l’état du projet. `clubs:list` lit le catalogue local, sans contacter Anybuddy. `booking:plan` produit du JSON avec deux groupes :

- `checkNow` : centres dont l’ouverture théorique est déjà passée ou tombe aujourd’hui ; leur disponibilité réelle reste à consulter ;
- `upcoming` : centres dont l’ouverture théorique est à venir, classés par date puis préférence.

Ce planning ne déclenche aucune tâche et n’est pas une mesure d’ouverture. Pour le 21 septembre, les J+8 conduisent théoriquement au 13 septembre, les J+6 au 15, les J+5 au 16, les J+3 au 18 et les J+1 au 20.

## Surveillance toutes les cinq minutes

```sh
# Un passage sur les neuf clubs
npm run observe:once
# Dernier état de chaque club et ouvertures candidates observées
npm run observe:report
```

Le collecteur lit la même route publique que le calendrier web : `https://www.anybuddyapp.com/api/v1/availabilities`, avec le club, le sport `padel` et une plage de dates. Aucun compte, token, modèle Hugging Face ou navigateur n’est nécessaire. Cette interface peut évoluer ; une réponse inattendue est enregistrée comme erreur, jamais comme absence de créneau.

Chaque passage interroge les neuf clubs **séquentiellement**, avec une seconde entre les requêtes, de J à J+35 inclus. Il conserve **toutes les durées** proposées, même 120 minutes, indépendamment de la demande dans `config.json`. Les dates sont celles de Paris. Un premier relevé constitue une référence ; il ne prouve pas une ouverture.

Les événements distinguent :

- `new_day_candidate` : créneaux apparus au-delà de la dernière date historiquement disponible, dans une plage déjà vérifiée ;
- `slots_added` : horaires ajoutés sur une date connue, éventuellement à la suite d’une annulation ;
- `slots_removed` : horaires disparus dans la plage encore observée ;
- `first_seen_outside_previous_window` : date vue pour la première fois parce que la plage de collecte a avancé ; aucune heure d’ouverture n’en est déduite.

Chaque apparition mesurable contient `lastValidAbsentAt`, `firstAvailableAt`, `firstAvailableParis` et `intervalSeconds`. L’intervalle inclut le temps de réponse réseau ; une panne l’élargit. Le premier relevé valide après une erreur est comparé au dernier relevé réussi. Une journée complète ou fermée reste indiscernable d’une journée non publiée à partir d’une simple absence.

Le rapport indique aussi `window` et `reachesWindowEnd` : si des créneaux atteignent J+35, **la limite réelle du club n’a pas été trouvée**. Le relevé initial manuel n’est pas une limite imposée au collecteur. Par exemple, le 11 septembre, l’interface publique renvoyait pour Trinquet Village des disponibilités au-delà du 25 septembre relevé dans le calendrier.

Les fichiers `observations/<club>/<jour UTC>/<horodatage>.json.gz` contiennent les relevés, les offres de service et leurs prix en centimes, les erreurs et les événements. Ils sont exclus de Git. Conservation glissante de 30 jours, avec maintien du dernier relevé et des 100 dernières ouvertures candidates par club. `ANYBOTTY_OBSERVATIONS_DIR` permet de choisir un autre dossier local. Les identifiants de service ne sont pas interprétés comme des identifiants de courts physiques.

Une erreur entraîne une attente croissante avant nouvel essai ; `Retry-After` est respecté. Une réponse 401, 403 ou 429 arrête le passage et suspend tous les clubs jusqu’à la fin de cette attente. Le collecteur n’envoie aucune notification à chaque passage : ses sorties JSON vont dans le journal du service, que Hermes peut lire.

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

## Interpréter les ouvertures

Le [protocole d’observation](docs/opening-observation.md) décrit les données à collecter et les critères de validation. Il faut déterminer, pour chaque centre, si les créneaux ouvrent tous ensemble à heure fixe ou progressivement dans une fenêtre glissante.

La stratégie cible sera ensuite : vérifier les centres déjà ouverts ; si le créneau demandé manque, tenter les prochaines ouvertures ; arrêter toutes les tentatives après une confirmation et vérifier le compte en cas de résultat incertain.

## Licence

MIT. Attribution de la base Paris Tennis conservée dans [LICENSE](LICENSE).
