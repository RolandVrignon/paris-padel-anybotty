# Comparer les modes de publication Anybuddy

Le collecteur surveille huit clubs toutes les cinq minutes, en parallèle. Trinquet Village reste exclu. Il lit au minimum les dates de J à J+35 et couvre au moins deux semaines au-delà de l’horizon observé du club.

## Hypothèses à comparer

| Hypothèse | Évidence à rechercher |
| --- | --- |
| Ouverture quotidienne | Une nouvelle date apparaît à une heure similaire plusieurs jours consécutifs. |
| Fin de semaine pour la suivante | Plusieurs dates de la semaine suivante apparaissent ensemble, le vendredi, samedi ou dimanche. |
| Début de semaine pour la semaine en cours | Plusieurs dates de la semaine de publication apparaissent ensemble le lundi ou mardi. |
| Lots irréguliers | Plusieurs dates sont publiées ensemble, sans cadence encore établie. |
| Fenêtre glissante | De nouveaux horaires deviennent visibles progressivement, avec un délai avant match similaire. |
| Annulation ou changement de disponibilités | Des horaires reviennent sur une date déjà ouverte, sans preuve d’une nouvelle publication régulière. |

Les semaines vont du lundi au dimanche. Le fuseau de publication est Europe/Paris, avec les horodatages UTC conservés.

## Collecte et preuve

Chaque date de la fenêtre a son propre suivi. Une journée absente ne bloque pas les autres. Après une première apparition précédée d’une absence valide, le suivi enregistre l’intervalle puis cinq contrôles supplémentaires à environ cinq minutes d’écart. Une réponse erronée ne compte pas. Une disparition avant la fin invalide la confirmation de cette apparition.

Les dates apparues au même relevé sont regroupées dans `calendar.batches`, avec leurs semaines, leurs écarts à la semaine de publication, les intervalles et les confirmations individuelles. Le regroupement prouve une détection commune à la précision de collecte, pas une simultanéité exacte côté serveur.

Les nouveaux horaires d’une date déjà ouverte sont enregistrés dans `calendar.additionalSlots`. Les heures de départ, durées et délais avant match permettent d’examiner une fenêtre glissante. Une annulation reste une explication possible ; le script ne confond pas ces ajouts avec une règle confirmée.

Au premier relevé et lorsqu’une date entre dans la fenêtre, une disponibilité déjà présente ne permet pas de dater sa publication. Les preuves du précédent suivi ciblé sont reprises uniquement pour les dates qu’il couvrait. Les erreurs laissent intact le dernier relevé valide et élargissent la mesure.

## Durée d’observation

Quatre à cinq publications indépendantes peuvent soutenir une hypothèse quotidienne. Pour une cadence hebdomadaire, viser au moins deux à trois semaines. Sept dates ouvertes ensemble ne constituent qu’une seule publication observée. Le rapport compte séparément dates, jours et semaines de publication.

Comparer les cycles avant de retenir une heure de réservation. Des exceptions restent possibles selon les jours, durées, terrains, jours fériés et modifications du club. Aucune règle quotidienne ou hebdomadaire n’est automatiquement déclarée certaine.

L’historique brut est conservé 30 jours, avec les détails indiqués dans le [guide complet](guide.md#surveillance-toutes-les-cinq-minutes).
