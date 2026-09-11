# Mesurer une ouverture par club

Le suivi opérationnel est décrit dans le [README](../README.md#surveillance-toutes-les-cinq-minutes).

## Cible fixe

Chaque club démarre avec la date du jour en Europe/Paris et l’horizon du catalogue. Sa cible vaut date de départ + horizon + 1 jour. Le 11 septembre 2026, Sportfield Bercy à J+14 cible donc le samedi 26 septembre. La cible est persistée et reste fixe après minuit et les redémarrages.

Les huit suivis actifs avancent en parallèle, chacun avec son état et ses confirmations. Une requête publique de disponibilités couvre uniquement la date cible et toutes les durées proposées.

## Détection et cinq contrôles supplémentaires

- Sans créneau : attendre le passage suivant, cinq minutes plus tard.
- Première disponibilité après une absence valide : enregistrer l’intervalle d’apparition, borné par les horodatages des deux observations.
- Aux cinq passages suivants : vérifier la présence de créneaux pour cette date, environ 25 minutes au total. Conserver le nombre de créneaux et le nombre de créneaux initiaux encore disponibles.
- Après cinq confirmations : terminer le suivi de ce club, conserver le résultat et continuer les autres.
- Si les disponibilités disparaissent : conserver l’essai interrompu puis repartir en attente.
- Une erreur ne compte pas comme une absence ni comme une confirmation. Le prochain relevé valide peut donner un intervalle plus large ou prolonger les contrôles.

Une date déjà disponible au premier relevé fait l’objet des cinq contrôles, mais aucune heure d’ouverture ne peut en être déduite. Le résultat est `already_available_at_first_check` et l’intervalle reste nul.

## Interprétation

L’heure estimée concerne la date surveillée. Une ouverture peut être progressive, et un créneau peut réapparaître après une annulation. Une seule campagne et cinq confirmations ne prouvent donc pas une règle universelle du club. Pour établir une règle quotidienne, répéter les campagnes sur plusieurs dates puis comparer les résultats.

Les dates du catalogue sont des horizons initialement observés, pas des limites confirmées. Si une cible est déjà ouverte au démarrage (pour un club surveillé), le rapport le signale sans inventer une heure de publication.

Trinquet Village reste dans le catalogue mais est exclu de la collecte via `monitoring.enabled: false`. Son ancien suivi et ses observations sont conservés, sans nouvelles requêtes.
