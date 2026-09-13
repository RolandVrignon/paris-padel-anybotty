---
name: padel-clubs
description: Retrouver les noms exacts des clubs du catalogue Anybuddy et consulter leurs disponibilités publiques par date et horaire. Utiliser pour vérifier un nom de club ou chercher des horaires de padel sans ouvrir de panier.
---

# Clubs et disponibilités Anybuddy

Dépôt sur le VPS : `'{{PROJECT_DIR}}'`. Utiliser les commandes JSON ; aucune session ni clé API n’est nécessaire pour cette consultation publique.

```sh
node '{{PROJECT_DIR}}/scripts/padel.js' clubs list
node '{{PROJECT_DIR}}/scripts/padel.js' clubs find --query 'bercy'
```

Les identifiants et libellés retournés font foi pour le catalogue suivi. `exact` et `unique_partial` identifient un club ; `ambiguous` impose de présenter les possibilités et de demander lequel. `not_found` signifie absent de notre catalogue, pas inexistant sur Anybuddy. Les comparaisons ignorent accents, casse, espaces et ponctuation. Ne pas inventer d’adresse ou d’arrondissement : le catalogue ne fournit pas ces champs pour tous les centres.

Avant de créer une demande, résoudre chaque nom puis préserver l’ordre choisi. Ne pas confondre Sportfield Bercy et Padelistes Bercy, ni Paris Padel et Padel 15.

## Disponibilités réelles

Calculer les dates relatives en Europe/Paris. La date de la commande utilise `YYYY-MM-DD` :

```sh
node '{{PROJECT_DIR}}/scripts/padel.js' availability --club sportfield-bercy --date 2026-09-21
node '{{PROJECT_DIR}}/scripts/padel.js' availability --club sportfield-bercy --date 2026-09-21 --time 20:00 --durations 60,90,120
```

Adapter la date d’exemple. Chaque entrée contient l’heure de départ, la durée, le nombre d’offres et le prix public minimal du terrain entier, total et par heure. Ce tarif est indicatif : le total du checkout, y compris remises/frais applicables, fait foi. Cette réponse ne certifie pas le type intérieur/extérieur ; ce critère est vérifié dans la recherche Playwright.

Une liste vide après une réponse valide signifie aucun créneau public correspondant au contrôle. Elle ne permet pas de distinguer une date non ouverte d’une date complète. Une erreur HTTP, de réseau ou de format n’est jamais une disponibilité vide. Sur 401/403/429, respecter la restriction et le délai indiqué ; ne pas boucler entre clubs pour la contourner.

Les horizons du catalogue sont des observations datées, pas les disponibilités actuelles. Trinquet Village figure au catalogue mais son horizon réel est inconnu ; il est exclu de la surveillance périodique. Les heures d’ouverture doivent provenir des rapports de `padel-monitoring`, pas d’une déduction à partir de l’horizon.

Pour configurer une recherche ou simuler le checkout, utiliser `padel-booking`.

Forest Hill Nanterre–La Défense (`forest-hill-nanterre`) et La Marche Marnes-la-Coquette (`forest-hill-marnes`) sont ajoutés au catalogue de consultation et au monitoring. Leur checkout n’est pas encore audité : ne pas annoncer une réservation automatique validée. UCPA Meudon est suivi par le collecteur officiel et son checkout se simule avec `scripts/ucpa.js book --club ucpa-meudon`. Ce test ne vaut pas validation d’une réservation ou d’une annulation réelle à Meudon.
