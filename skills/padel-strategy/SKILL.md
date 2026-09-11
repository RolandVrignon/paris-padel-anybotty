---
name: padel-strategy
description: Choisir quand tenter une réservation Anybuddy selon les clubs préférés et leurs ouvertures. Utiliser avant une recherche multi-clubs ou pour décider entre attendre un club prioritaire et prendre un créneau disponible dans un club de repli.
---

# Stratégie de réservation padel

Utiliser le dépôt `'{{PROJECT_DIR}}'`. Ce skill décide **quels clubs essayer maintenant et lesquels attendre** ; `padel-booking` exécute ensuite une simulation sur le périmètre retenu. L’ordre des clubs exprime aussi une préférence dans le temps, pas seulement un tri des disponibilités présentes.

## Intention à préserver

Par défaut, **préserver le club prioritaire lorsqu’une ouverture future reste une possibilité crédible**. Ne pas prendre automatiquement le deuxième club parce que le premier n’a pas encore publié ses créneaux. Une demande générique « trouve-moi un créneau » n’autorise pas à abandonner cette priorité temporelle.

Si l’utilisateur demande explicitement « prends le premier disponible maintenant », « sécurise un créneau » ou accepte le repli sans attendre, privilégier la disponibilité immédiate en conservant l’ordre des clubs déjà disponibles. Ne pas redemander cet arbitrage s’il a déjà été donné pour cette demande. Respecter une éventuelle échéance d’attente ; si l’ouverture est trop incertaine pour proposer une échéance utile, expliquer ce manque et demander la préférence nécessaire au lieu d’inventer une date limite.

## Recueillir les faits

Lire la demande enregistrée ou utiliser la demande ponctuelle de la conversation, sans modifier les préférences persistantes simplement pour analyser une stratégie :

```sh
node '{{PROJECT_DIR}}/scripts/padel.js' request show
node '{{PROJECT_DIR}}/scripts/padel.js' clubs find --query 'nom du club'
node '{{PROJECT_DIR}}/scripts/anybotty.js' plan
node '{{PROJECT_DIR}}/scripts/observe.js' --report
```

`plan` utilise la demande enregistrée. Pour une autre demande, écrire son JSON variable dans un fichier temporaire privé et utiliser `plan --config PATH`, puis supprimer ce fichier. Résoudre les dates relatives en Europe/Paris et vérifier que les observations correspondent à la demande, au jour et à l’heure analysés.

Pour chaque club concerné, consulter **la journée entière** puis repérer l’heure et les durées demandées dans la réponse :

```sh
node '{{PROJECT_DIR}}/scripts/padel.js' availability --club paris-padel --date 2026-09-21
```

Adapter cet exemple à la date réelle. Une requête filtrée sur 20 h ne suffit pas à savoir si toute la journée est déjà publiée. Les prix publics sont indicatifs et le type intérieur/extérieur peut encore nécessiter le checkout. Une offre visible n’est donc qu’une candidate tant que `padel-booking` n’a pas validé tous les critères.

Lire `padel-monitoring` pour interpréter les publications groupées, horaires ajoutés progressivement et confirmations. S’appuyer sur les relevés datés : une heure observée sur plusieurs publications indépendantes est plus solide qu’une simple soustraction de l’horizon.

## Classer chaque club

| Situation observée | Interprétation et conduite |
| --- | --- |
| Heure/durée demandée visible | Candidate à essayer ; budget et type restent à vérifier au récapitulatif. |
| Journée vide, ouverture future étayée par les observations | Club à attendre ; indiquer la fenêtre d’ouverture et les preuves. |
| Journée vide, seulement un horizon théorique futur | Ouverture estimée, non confirmée ; préserver la priorité et présenter l’incertitude. Ne pas annoncer une heure précise. |
| Journée déjà publiée, horaire demandé absent | Échec au contrôle actuel. Vérifier si les relevés montrent des publications progressives avant de considérer ce club comme épuisé pour cette étape. |
| Erreur, données périmées, horizon inconnu ou journée vide sans explication | État indéterminé, pas club complet. Rafraîchir une fois si pertinent ; sinon expliquer le blocage. |

Une journée vide peut être complète, fermée ou non publiée. Une date déjà disponible au premier relevé ne permet pas de dater son ouverture. Une publication groupée ne prouve pas une cadence quotidienne. Trinquet Village a un horizon inconnu et une borne minimale dans le catalogue : ne pas déduire d’heure ou de date d’ouverture à partir de J+61. Un délai HTTP doit être respecté, sans multiplier les requêtes pour contourner une restriction.

## Choisir la prochaine action

Parcourir les clubs **dans l’ordre de la demande** :

1. Si le premier club pertinent a une candidate maintenant, autoriser un essai uniquement sur ce club. S’il échoue, réévaluer les preuves puis le club suivant.
2. Si un club prioritaire est à attendre, arrêter la progression vers les clubs moins prioritaires, même s’ils ont une candidate maintenant. Ces clubs constituent le plan B. Il est possible de consulter leurs disponibilités sans ouvrir de panier.
3. Si les clubs précédents ont été essayés sans succès ou que leur publication est déjà passée sans offre compatible, autoriser le prochain club disponible, sauf nouvelle fenêtre de publication crédible ou attente explicitement voulue par l’utilisateur.
4. Si l’utilisateur a choisi la disponibilité immédiate, autoriser la recherche parmi les clubs disponibles dans leur ordre ; signaler les clubs prioritaires non encore ouverts qui sont écartés pour cette tentative.
5. Après la fenêtre d’ouverture attendue, reconsulter les faits. Une estimation non réalisée devient incertaine ; ne pas repousser indéfiniment l’attente ni déclarer automatiquement le club complet. Après un échec confirmé au club préféré, vérifier à nouveau le plan B avant de le proposer.

Ne jamais prendre un club de repli comme assurance avec l’intention de l’annuler ensuite sans instruction explicite : annulation et paiement final Anybuddy ne sont pas implémentés.

## Réponse et transmission à l’exécution

Présenter une recommandation courte : **essayer maintenant**, **attendre le club prioritaire**, ou **données insuffisantes pour trancher**. Donner le club visé, la date/heure du match, la prochaine vérification utile, le degré de confiance dans l’ouverture et le plan B. Indiquer simplement que le créneau de repli peut disparaître pendant l’attente. Éviter les probabilités chiffrées sans données.

Exemple hypothétique : Paris Padel est préféré à Sportfield ; Paris Padel doit encore publier la date visée, tandis que Sportfield a déjà 20 h. Recommander d’attendre Paris Padel, puis de reconsulter Sportfield si la tentative au club préféré échoue. L’heure d’ouverture reste inconnue si elle n’a pas été mesurée.

Avant de transmettre à `padel-booking`, expliciter **la liste des clubs autorisés pour cet essai**. Utiliser une demande temporaire avec seulement ces clubs et les autres critères inchangés, puis `booking-search.js --config PATH --headless`. Ne pas transmettre toute la liste originale si elle franchit un club prioritaire en attente. Ne pas modifier l’ordre enregistré pour contourner cette attente.

Le moteur brut `booking-search.js` essaie toujours immédiatement les possibilités restantes : cette stratégie est portée par Hermes et par le périmètre transmis, pas par une nouvelle règle codée dans le moteur. Un échec ne doit donc pas déclencher automatiquement une seconde recherche sur tous les clubs.

**Attendre est une décision, pas encore une tâche programmée.** Si l'utilisateur demande de programmer la tentative et qu'une règle d'ouverture documentée est disponible, utiliser `padel-scheduling` : demande figée sur le club prioritaire, cron Hermes ponctuel, puis vérification de son enregistrement. Sans heure connue, ne pas inventer de programmation. Le timer d'observation ne déclenche pas le moteur. Après le résultat du club prioritaire, réévaluer le plan B ; ne pas programmer des tentatives concurrentes pour la même intention.

Les limites de `padel-booking` s’appliquent : arrêt au récapitulatif, aucun paiement final, aucune réservation confirmée. Une offre `checkout_ready` ne doit jamais être annoncée comme réservée.
