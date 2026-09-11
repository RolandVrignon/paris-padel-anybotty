# Checkout Anybuddy — relevé du 11 septembre 2026

Neuf parcours vérifiés en navigateur visible, avec le compte authentifié configuré localement. Ces constats concernent le **site web**, pas nécessairement l’application mobile, d’autres comptes ou de futures versions du site. Les dates, terrains et prix ci-dessous sont des exemples observés, pas des réservations confirmées ni des disponibilités garanties.

## Modale de choix du terrain

La présence de cette modale dépend des offres encore disponibles pour **le créneau**, pas d’une liste fixe de clubs. Un même club peut afficher la modale lors d’un essai et ouvrir directement le récapitulatif lors d’un autre. Le script vérifie donc les deux parcours pour chacun des neuf clubs.

Si la modale apparaît, `lib/court-selection.js` parcourt les durées autorisées dans leur ordre de préférence, puis choisit le **premier terrain compatible, en classant les types selon `courtEnvironment` puis les offres du même type dans l’ordre affiché**, et valide. Il gère également une modale avec un seul terrain déjà sélectionné. Les identifiants `slot-court-option` et `slot-selection-confirm` ont été vérifiés sur le DOM Anybuddy. La sélection automatique ne requiert pas `--court` ; cette option permet seulement d’imposer un terrain précis. Un terrain nommé reste une contrainte stricte ; le script peut essayer la durée autorisée suivante pour ce terrain, mais ne choisit jamais une durée exclue.

Le terrain choisi est ensuite comparé au récapitulatif avant toute acceptation des conditions. Ces scénarios sont testés indépendamment du club, y compris changement de durée, terrain indisponible et accès direct au récapitulatif. Un essai réel à Saint-Ouen le 12/09/2026 à 09:00 pour 90 minutes a sélectionné automatiquement Piste 8 (première offre affichée), puis atteint le récapitulatif sans cliquer sur Payer.

## Durées ordonnées

`durationsMinutes` conserve l’ordre exact de configuration : `[60, 90, 120]` cherche 60, puis 90, puis 120 minutes. `[60, 90]` interdit 120 minutes ; `[120, 60]` privilégie 120 minutes et interdit 90. Une liste vide, un doublon, une durée non prise en charge ou une chaîne à la place d’un nombre est refusée.

La commande reprend cette liste depuis le fichier de demande, sauf surcharge `--durations 60,90,120` ou `--duration 120` pour une seule durée. Sans fichier, le défaut reste `[60, 90]`. Le précontrôle des disponibilités accepte une heure dès qu’au moins une durée autorisée existe, puis le choix final est fait dans la modale. Pour chaque durée, les contraintes strictes et la préférence de type s’appliquent ; une durée préférée n’autorise jamais un type strictement exclu. La priorité de durée passe avant la préférence souple de type.

Le récapitulatif est vérifié même sans modale. Avant l’acceptation des conditions, sa durée doit appartenir à la liste autorisée et correspondre à celle sélectionnée ; le code ne retente jamais le bouton Payer pour essayer une autre durée. Essai réel sans paiement à Saint-Ouen : avec `[60, 90, 120]`, le script a retenu 90 minutes pour le 12/09/2026 à 09:00 (Piste Babolat, 84 €), 60 minutes n’étant pas proposé.

## Intérieur ou extérieur

`config.request.json` accepte une liste ordonnée dans `courtEnvironment` : `["indoor", "outdoor"]`, `["outdoor", "indoor"]`, `["indoor"]`, `["outdoor"]` ou `["any"]`. En son absence, `["any"]` conserve le comportement existant. La commande de simulation reprend cette valeur, avec une surcharge ponctuelle `--court-environment`. Les noms exacts des clubs et les horizons ne servent pas à deviner ce critère.

Dans la modale, les offres sont d’abord filtrées par durée, disponibilité et éventuel nom de terrain imposé. `["indoor", "outdoor"]` recherche un Intérieur avant d’accepter un Extérieur ; `["outdoor", "indoor"]` applique l’ordre inverse. `["indoor"]` et `["outdoor"]` restent stricts ; `["any"]` suit simplement l’ordre affiché. Au sein du type retenu, la première offre disponible est choisie. Une préférence s’applique aux offres du club/créneau courant, sans modifier l’ordre des clubs dans le planning. Le récapitulatif est ensuite contrôlé, y compris lorsqu’il n’y avait pas de modale. Le contrôle est répété avant de cocher les conditions et d’ouvrir Stripe. Il porte uniquement sur la ligne de caractéristiques du terrain sélectionné (paragraphe adjacent à son nom dans la carte du récapitulatif), afin de ne pas confondre les consignes générales avec le type du terrain. Un type inconnu, absent ou contradictoire bloque les modes stricts et préférentiels. Un type différent bloque un mode strict. En mode préférence, l’accès direct au récapitulatif peut accepter chacun des deux types connus ; après une modale, le type doit correspondre à celui effectivement sélectionné. Le bot suit les libellés de la plateforme ; il ne certifie pas leur exactitude physique. Vérification réelle : à Saint-Ouen, le 12/09/2026 à 09:00 pour 90 minutes, `["indoor"]` a sélectionné Piste Babolat et validé ses caractéristiques au récapitulatif (84 €) ; `["outdoor"]` a été refusé en l’absence d’offre correspondante, avant validation d’un terrain. Aucun paiement soumis.

## Cases avant paiement

Les neuf clubs affichent **une seule case obligatoire**, avec le même libellé exact :

> J'accepte les Conditions Générales de Vente et les conditions du club

Sélecteur utilisé : `page.getByTestId('booking-sheet').getByRole('checkbox', { name: label, exact: true })`. Il s’agit d’un bouton `role="checkbox"` contenu dans un label, sans identifiant stable. Aucun sélecteur positionnel n’est utilisé.

Une option facultative peut apparaître pendant le chargement : « Je ne souhaite pas recevoir ces emails. ». Après chargement du compte testé, elle est remplacée par un message indiquant que les emails marketing sont désactivés. Le script ne change pas cette préférence. Les paragraphes « Informations importantes » varient par club, mais n’étaient pas des cases supplémentaires à cocher lors de ces tests.

## Vérifications réelles

| Club | Créneau testé (heure de Paris) | Durée | Total affiché | Stripe atteint |
|---|---|---|---|---|
| Paris Padel | 2026-09-12 08:00 | 60 min | 70 € | Oui |
| UCPA Sport Station Hostel Paris | 2026-09-12 07:00 | 60 min | 38 € | Oui |
| Sportfield Paris 12 - Bercy | 2026-09-17 22:30 | 60 min | 60 € | Oui |
| 4PADEL Paris 20 | 2026-09-13 12:30 | 90 min | 84 € | Oui |
| Forest Hill Aquaboulevard De Paris | 2026-09-12 00:00 | 60 min | 54 € | Oui |
| 4Padel Saint-Ouen | 2026-09-12 09:00 | 90 min | 84 € | Oui |
| Trinquet Village | 2026-09-12 08:00 | 60 min | 54 € | Oui |
| Padelistes Bercy - Paris 12 | 2026-09-12 06:00 | 90 min | 50 € | Oui |
| Padel 15 | 2026-09-13 19:30 | 60 min | 60 € | Oui |

Pour chaque parcours, la case CGV a été cochée et le premier bouton « Payer » a été cliqué. Le formulaire Stripe a été constaté ; aucune carte n’a été saisie et le paiement final n’a jamais été soumis. L’UCPA affiche d’abord trois méthodes : Carte bancaire, Revolut Pay, Satispay. La sélection de Carte bancaire a ensuite affiché ses champs.

## Particularités à relire avant une vraie réservation

- **Paris Padel** : Matériel payant ; consigne du club : aucune annulation à moins de 72 h.
- **UCPA Sport Station Hostel Paris** : Chaussures adaptées demandées ; accès susceptible d’être refusé sinon. Stripe propose d’abord Carte bancaire, Revolut Pay ou Satispay.
- **Sportfield Paris 12 - Bercy** : Accès autonome ; annulation annoncée jusqu’à 6 h avant le début ; matériel payant.
- **4PADEL Paris 20** : Incohérence à vérifier avant une vraie réservation : consigne de 48 h, mais récapitulatif annulable jusqu’au 12/09 à 12:30 pour le 13/09 à 12:30 (24 h).
- **Forest Hill Aquaboulevard De Paris** : Non annulable ; arriver 15 min avant pour le contrôle à l’accueil ; pas de prêt de matériel ; 4 joueurs maximum et règles de tenue/comportement.
- **4Padel Saint-Ouen** : Annulation gratuite annoncée jusqu’à 48 h avant ; créneau testé non annulable.
- **Trinquet Village** : Pas de location de matériel ; remboursement pour pluie exclusivement en crédits Anybuddy utilisables dans ce club.
- **Padelistes Bercy - Paris 12** : 4 joueurs maximum ; chaussures adaptées ; horaires à respecter ; maximum 4 réservations par jour.
- **Padel 15** : Annulation annoncée jusqu’à 48 h avant ; code de réservation pour accéder ; matériel disponible via le casier payant.

La mention « non annulable » peut résulter du délai restant avant le créneau testé ; elle ne démontre pas une interdiction générale pour toutes les dates. L’incohérence 48 h/24 h de 4PADEL Paris 20 n’est pas arbitrée par le bot : consulter les conditions applicables avant tout paiement réel.

## Validation de la commande

La commande autonome a également atteint le formulaire Stripe en mode headless sur Sportfield Bercy, le 17 septembre 2026 à 21:30, 60 minutes, Terrain 1, total 60 €. Aucun paiement final soumis. Les essais ont aussi confirmé les arrêts sur un créneau disparu et sur un terrain différent de celui demandé. Les tests locaux et ESLint vérifient aussi ces parcours.

## Réutilisation

`lib/checkout.js` inspecte les conditions connues de `data/checkout-requirements.json`, accepte uniquement les cases requises puis s’arrête au formulaire Stripe. Une case inconnue, une CGV absente ou un club différent interrompt l’exécution. Appeler cette fonction seulement après avoir vérifié la date, l’heure, la durée, le terrain et le montant ; `scripts/checkout-preview.js` effectue ces vérifications.

L’étape « Confirmer et Payer » et l’étape « Entrez vos informations de paiement » contiennent chacune un bouton « Payer ». Le parcours de simulation clique uniquement celui de la première étape. Le mode réel `booking:pay` utilise ensuite `lib/booking-payment.js` pour vérifier et cliquer une seule fois le bouton final. Il refuse de recommencer s’il se trouve déjà à l’étape paiement et ne rejoue pas un clic après un timeout. La présence de Stripe est vérifiée dans un iframe `js.stripe.com`, intégré dans Anybuddy, avec le formulaire carte ou le choix de méthode chargé.

Les captures et le relevé détaillé de cette session sont conservés localement dans `observations/previews/`, ignoré par Git. La préparation peut laisser des paniers ou sessions Stripe impayés côté serveur. Après les neuf tests, le compte affichait « Aucune réservation à venir » et le compteur « Mes réservations » était à zéro. Ce constat concerne les réservations visibles, pas les paniers techniques. Aucun nettoyage automatique de réservations existantes n’est effectué, et ce test ne certifie pas l’absence de toute entrée en attente dans le compte.

## Recherche ordonnée et plafond horaire

`npm run booking:search` lit le fichier de demande complet et essaie les clubs dans l’ordre, puis les durées, les types et les terrains. `lib/booking-preview.js` partage les contrôles du récapitulatif avec `checkout:preview`. Une offre trop chère est exclue par terrain/durée pour le passage en cours ; une nouvelle page permet de choisir la suivante. Les erreurs techniques restent visibles dans le rapport et ne sont pas assimilées à des disponibilités vides. La recherche termine au premier `checkout_ready`, avec `reservationConfirmed: false` et `paymentSubmitted: false`.

`maxPricePerHourEUR` s’applique au prix total du terrain ramené à 60 minutes, y compris les éléments inclus dans le total du récapitulatif. À 80 €/h, les totaux limites sont 80 €, 120 € et 160 € pour 60, 90 et 120 minutes. 120 € pour deux heures est accepté. Le plafond est revérifié dans `prepareStripeCheckout` avant les CGV ; un changement de prix au-delà du plafond bloque le premier clic Payer. Une ancienne valeur numérique `maxTotalPriceEUR` exige une migration explicite.

Les nouveaux scénarios sont vérifiés sur des pages Playwright locales : changement de terrain après dépassement de prix, passage à la durée et au club suivants, priorité intérieur/extérieur, arrêt avant tout clic de conditions/paiement, accès direct et augmentation du prix avant Stripe. Ces tests ne constituent pas une nouvelle réservation réelle sur Anybuddy. La recherche simule par défaut. `booking:pay` ajoute le paiement final et la vérification dans le compte ; les jobs Hermes peuvent figer `mode: "pay"`. Voir le README pour les journaux et les résultats incertains.

## Paiement et annulation réels

Le test UCPA du 19/09/2026, 07:00–08:00, 38 €, a validé le paiement puis l’annulation. L’implémentation réutilisable est dans `lib/booking-payment.js` ; la commande `booking:pay` l’intègre au moteur de recherche. La confirmation est liée à une nouvelle réservation du compte correspondant exactement à l’offre. Les autres clubs partagent ce tunnel, mais aucun paiement réel supplémentaire n’a été effectué pour cette intégration.

Le clic final utilise le bouton DOM `Payer [montant] €` dans `[data-testid="booking-sheet"]`, après validation du formulaire carte visible. Cette méthode évite un clic déplacé sur Revolut Pay lorsque la mise en page Stripe change. Le garde réseau permet une seule confirmation PaymentIntent, après écriture du journal privé. Les données Stripe brutes, la carte et le CVC ne sont pas journalisés.

Après annulation, Anybuddy peut retirer le match de la liste renvoyée par son action de lecture. Le script vérifie alors la fiche exacte (club, date, heure, statut `Annulé`) pour les réservations connues du journal ; une simple absence de la liste ne prouve jamais l’annulation.
