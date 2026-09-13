# Réserver sur le site officiel 4PADEL

Le bot peut réserver et payer **les quatre parts avec le portefeuille LA FID’**, lister les réservations, vérifier leur état et annuler dans le délai annoncé par le club. Il utilise `providers.4padel.account` dans `config.fixed.json`. La recharge du portefeuille se fait manuellement sur le site officiel.

Le paiement d’une seule part en crédits peut encore demander une carte en garantie et du 3-D Secure. Pour le parcours autonome, la commande `book` règle donc **tout le terrain en crédits**. Elle ne saisit aucune carte et bloque les requêtes de paiement bancaire. Si le solde est insuffisant, elle s’arrête avant de créer la demande.

## Commandes

```sh
npm run auth:4padel
npm run 4padel -- wallet
npm run 4padel -- list
npm run 4padel -- show --id ID

# Aperçu : aucune réservation ni consommation de crédits
# Adapter la date ; le plafond concerne le prix du terrain entier par heure.
npm run 4padel -- book --club 4padel-saint-louis-bale \
  --date 2026-09-16 --time 14:00 --durations 90 \
  --court-environment indoor --max-price-per-hour 24

# Même demande avec --confirm : réservation réelle, quatre parts en crédits
npm run 4padel -- book --club 4padel-saint-louis-bale \
  --date 2026-09-16 --time 14:00 --durations 90 \
  --court-environment indoor --max-price-per-hour 24 --confirm

# Relire une tentative journalisée sans soumettre de nouveau paiement
npm run 4padel -- reconcile --club 4padel-saint-louis-bale \
  --date 2026-09-16 --time 14:00

# Annulation : lire le récapitulatif, puis utiliser sa version
npm run 4padel -- cancel --id ID
npm run 4padel -- cancel --id ID --confirm --expected-version HASH
```

Ajouter `--headed` pour un navigateur visible. Sans date ou heure explicite, les valeurs viennent de `config.request.json`. Les durées et environnements respectent les préférences habituelles. Le club doit toujours être explicite.

Clubs pris en charge : `4padel-paris-20` (79), `4padel-saint-ouen` (117), `4padel-boulogne` (105), `4padel-saint-louis-bale` (61). Ces quatre clubs figuraient dans la liste native des clubs éligibles à LA FID’ le 13 septembre 2026. Le test complet de paiement a été réalisé à Saint-Louis – Bâle ; il ne constitue pas une recette de chaque autre club.

Les commandes historiques restent disponibles : `reservations:4padel` liste le compte et accepte `--cancel ID`, tandis que `checkout:4padel` explore le récapitulatif avec `--parts 1|2|3|4` (une part par défaut), sans soumettre la réservation.

## Test réel validé

Le 13 septembre 2026, réservation de **Saint-Louis – Bâle, 16 septembre, 14 h–15 h 30, piste ID Verde**, pour **36 €** :

| Vérification | Résultat |
| --- | --- |
| Paiement | Quatre parts payées directement par le portefeuille |
| Intervention bancaire | Aucun formulaire carte ni 3-D Secure dans ce parcours |
| Compte | `Confirmed`, quatre parts payées, `fullyPaid: true` |
| Solde actualisé | 119 € → 83 € |
| Annulation | Exécutée avec le script, réponse serveur et statut `Cancelled` vérifiés |
| Restitution des crédits | Solde actualisé à 119 € |

Le solde affiché à l’ouverture de la page peut être ancien : le bot utilise **« Actualiser mon solde »** et vérifie la réponse serveur. Le délai de restitution peut varier ; le site annonce que les avoirs peuvent être crédités dans les heures suivantes. L’annulation de la réservation et le retour effectif des crédits sont deux vérifications distinctes.

Un essai précédent à une seule part avait déclenché une demande Wise de 0 € pour la garantie carte, malgré le paiement prévu en crédits. Cette demande a été annulée ; le bot n’utilise pas ce parcours pour les réservations autonomes.

## Fonctionnement et limites

1. Vérifier le compte, rechercher une réservation existante à la même heure et actualiser le portefeuille.
2. Chercher une durée et un terrain compatibles, en respectant le prix horaire du terrain entier.
3. Choisir la piste si l’écran apparaît, vérifier les extras à zéro et sélectionner quatre parts.
4. Créer la demande, vérifier son ID, son propriétaire, sa date, sa piste et son prix.
5. Choisir « Je paye avec mon solde », puis confirmer le montant intégral. Les mutations autorisées sont limitées à cette réservation, cette participation, ces quatre parts et ce montant.
6. Relire le compte : seul `Confirmed` avec quatre parts payées et `fullyPaid` vaut succès.

Le journal privé `.auth/fourpadel-actions/<compte>/` est écrit avant les soumissions. Une nouvelle exécution de la même demande déjà journalisée fait une réconciliation ; elle ne répète pas le paiement, même après une réponse incertaine ou une annulation. Les erreurs après création renvoient `booking_unverified` et conservent la trace pour inspection. Le verrou local empêche deux commandes du compte de s’exécuter simultanément.

La liste concerne les réservations dont le compte est capitaine, dans la fenêtre du portail. Elle n’inclut pas toutes les participations chez d’autres capitaines. Si la limite native de 15 résultats est atteinte, le script signale une liste potentiellement tronquée. Les demandes `Pending` avec zéro part payée peuvent être masquées dans l’interface : la commande d’annulation le signale et ne prétend pas les avoir annulées.

L’annulation vérifie le club, la piste, la date et le délai affichés. Le checkout Paris 20 a annoncé 24 heures, Saint-Louis – Bâle 48 heures : ne pas appliquer un délai unique à tous les clubs. Le remboursement est un **avoir**, pas un remboursement bancaire. La commande confirme le statut d’annulation ; contrôler le montant rendu avec `wallet`.

Au-delà de J+14, la recherche renvoie `outside_assumed_horizon`, conformément à la politique de travail retenue. Ce n’est pas une mesure de l’heure d’ouverture du serveur : voir le [monitoring](direct-monitoring.md). Une session propre est utilisée à chaque exécution ; le site a présenté des erreurs de rendu après certains rechargements de calendrier.

Ces commandes sont locales. Leur raccordement aux skills Hermes et le déploiement VPS sont distincts de cette intégration.

## Repères techniques

| Étape | Élément observé |
| --- | --- |
| Dates | `.lf-booking-date`, `.lf-booking-date-number`, `.lf-booking-date-day` |
| Offre | `.lf-booking-smart-slot`, `.description`, `.lf-booking-smart-slot-duration`, `.duration` |
| Terrain | `/reservations/terrain`, nom exact du terrain renvoyé par le calendrier |
| Parts | `/paiement/plusieurs`, `select.lf-select-custom`, bouton `Payer maintenant` |
| Création | `PUT /splf/v1/bookings?appId=2&isChannelWeb=true` |
| Solde | `GET https://api2-front.lefive.fr/users/me?qoodos_refund=true&appId=2` |
| Paiement en crédits | Bouton `Je paye avec mon solde`, modale `Confirmation de paiement`, bouton `OK` |
| Participation | `PUT /splf/v1/userparticipations`, paramètres et corps liés au compte, à la réservation et aux quatre parts |
| Débit du portefeuille | `POST /splf/v1/userparticipations/{id}/status`, `paidByCredit: true`, réponse 204 |
| Annulation | Ligne `.lf-my-booking-column` contenant l’ID exact, bouton `Annuler`, confirmation `Oui`, `POST /splf/v1/bookings/{id}` |

Les tests couvrent les montants et préférences, les identités, les paramètres natifs, le paiement en crédits dans Chromium simulé, la réconciliation sans seconde soumission, le solde insuffisant et l’annulation. Les données de carte ne sont pas utilisées par le module de paiement en crédits. Les configurations, sessions et journaux privés restent exclus de Git.
