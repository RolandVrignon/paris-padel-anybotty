# Extension en proche banlieue

Vérifications réalisées le **13 septembre 2026**, en lecture seule. Le suivi compte désormais **16 cibles : sept Anybuddy, deux UCPA et sept 4PADEL**. Les clubs déjà suivis en direct ne sont pas surveillés une seconde fois sur Anybuddy.

## Clubs ajoutés

| Club | Canal | Résultat observé | Portée |
| --- | --- | --- | --- |
| Forest Hill Nanterre–La Défense | Anybuddy | Dernière disponibilité le 19 septembre, J+6 ; 154 créneaux dans le relevé | Consultation et monitoring |
| Forest Hill La Marche Marnes-la-Coquette | Anybuddy | Dernière disponibilité le 19 septembre, J+6 ; 239 créneaux | Consultation et monitoring |
| 4PADEL Montreuil (73) | Officiel | Calendrier visible jusqu’au 14 octobre, 31 jours | Monitoring ; moteur 4PADEL commun |
| 4PADEL CAO Saint-Denis (89) | Officiel | Calendrier visible jusqu’au 13 octobre, 30 jours | Monitoring ; moteur 4PADEL commun |
| 4PADEL Marville (65) | Officiel | Calendrier visible jusqu’au 14 octobre, 31 jours | Monitoring ; moteur 4PADEL commun |
| 4PADEL Créteil (25) | Officiel | Calendrier visible jusqu’au 14 octobre, 31 jours | Monitoring ; moteur 4PADEL commun |
| UCPA Sport Station Meudon | Officiel | Dernière semaine visible du 11 au 17 janvier 2027 | Monitoring public ; réservation à adapter |

Les nombres de créneaux sont des instantanés, pas une garantie de disponibilité future. Les deux Forest Hill ont été recherchés jusqu’au 18 octobre. Le choix de les suivre via Anybuddy ne prouve pas l’absence de priorité sur leur site officiel.

Les fiches [Nanterre](https://www.anybuddyapp.com/fr/club/forest-hill-nanterre-la-defense) et [Marnes-la-Coquette](https://www.anybuddyapp.com/fr/club/forest-hill-marnes-la-coquette/padel) indiquaient des réservations non annulables lors du relevé. Leur configuration conserve `checkout.audited: false` : la consultation fonctionne, mais le moteur refuse de poursuivre leur checkout avant audit des conditions et du parcours.

## Meudon : observer la vraie frontière du calendrier

Le [calendrier officiel](https://www.ucpa.com/sport-station/meudon/padel) utilise le même composant public et le même format hebdomadaire que Paris. Un parcours Playwright complet a atteint la semaine du **11 au 17 janvier 2027**, puis constaté la désactivation de la flèche suivante. Le 17 janvier est à **J+126** du 13 septembre ; cela ne signifie pas que la politique est un horizon glissant de 126 jours.

Le calendrier initial annonce une période de quatre mois et une date limite au 13 janvier, arrondie par son affichage à la fin de cette semaine. Le mode `month-boundary` relit cette limite, puis consulte les semaines proches de la frontière via les requêtes publiques du calendrier. Aucun stock au-delà des semaines accessibles n’est interrogé. Ce mode évite les 18 chargements hebdomadaires nécessaires pour parcourir tous les mois intermédiaires.

Le test du collecteur a relevé **94 créneaux du 11 au 17 janvier**, puis une fenêtre encore inaccessible du **18 au 31 janvier**. Un passage ciblé inchangé ne demande que le calendrier initial. Dès qu’une nouvelle période devient accessible, les semaines correspondantes sont lues et les cinq confirmations habituelles s’appliquent. Les relevés conservent la date limite et les disponibilités séparément. Le suivi couvre cinq semaines après la frontière pour pouvoir observer également des lots mensuels. Une ouverture le lundi, quotidienne ou par lots reste à établir sur plusieurs observations.

Les commandes de réservation, d’authentification et d’annulation UCPA restent liées à **Paris 19** : chemins de compte, identifiants de site et validation d’identité diffèrent. Ne pas leur passer Meudon en remplaçant simplement l’URL. Aucun test de paiement ou d’annulation n’a été effectué à Meudon.

## 4PADEL : politique commune supposée

Les quatre nouveaux centres réutilisent le moteur national et la session 4PADEL existante. Leurs calendriers sont contrôlés chaque heure et **Boulogne** reste la référence indicative pour l’ouverture à J+14, comme pour Saint-Ouen et Paris 20. Les 30/31 jours affichés sont une visibilité, pas la preuve du droit de réserver ces dates. Le monitoring n’effectue aucune tentative de paiement pour tester cette hypothèse.

Les identifiants, sources et observations initiales sont conservés dans `data/clubs.json` et `data/direct-monitoring.json`. Les heures mesurées se lisent avec `npm run observe:report` ; aucune heure de réservation n’est déduite du seul horizon.
