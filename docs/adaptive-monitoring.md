# Surveillance adaptative par club et par site

Le timer se réveille toutes les cinq minutes. Le collecteur décide séparément pour chaque cible s’il faut consulter le calendrier complet, quelques dates seulement, ou attendre. Les relevés restent en lecture seule, sans réservation ni paiement.

## De la découverte au suivi ciblé

| Situation | Comportement par défaut |
| --- | --- |
| Aucune cadence fiable | Contrôle toutes les cinq minutes des sept dates suivant la dernière limite observée. |
| Publication détectée | Cinq contrôles supplémentaires, espacés d’au moins cinq minutes, pour vérifier sa persistance. |
| Au moins trois publications cohérentes | Hypothèse de cadence quotidienne, hebdomadaire, mensuelle ou tous les N jours ; estimation de l’heure locale et de la taille du lot. |
| Prochaine ouverture attendue | Contrôle ciblé de 30 minutes avant à 60 minutes après l’heure estimée, toutes les cinq minutes. |
| Hors de cette plage | Pas de contrôle ciblé ; un relevé complet horaire conserve une couverture de sécurité. |
| Ouverture attendue manquée | Retour à la découverte toutes les cinq minutes ; aucune nouvelle date d’ouverture n’est inventée. |
| Erreur HTTP 401, 403, 429 ou échec d’authentification répété | Pause du fournisseur pendant au moins six heures, alerte Hermes si configurée ; les autres sites continuent. |

Un relevé complet couvre au minimum J à J+35, ou l’horizon observé + 14 jours. Chez UCPA, il couvre également deux semaines au-delà de la limite de navigation atteinte. Les appels sont séquentiels, protégés contre les collectes concurrentes. 4PADEL partage une session entre ses clubs pendant le passage.

L’apprentissage utilise au moins trois publications indépendantes, chacune suivie de cinq confirmations. Leurs intervalles de détection et la dispersion de leurs horaires doivent rester dans les quinze minutes. Une disponibilité présente dès le premier relevé n’est pas une preuve d’ouverture. Une publication atteignant le bord du scan n’établit pas la taille complète du lot.

Les lots déjà observés, même avec une heure imprécise, permettent d’élargir les dates ciblées lors des prochains passages. Le suivi ajoute une date de marge pour reconnaître une publication tronquée. Une publication mensuelle peut naturellement couvrir 28 à 31 dates. Il faut donc plusieurs semaines pour apprendre une cadence hebdomadaire et plusieurs mois pour une cadence mensuelle. Les politiques irrégulières restent en découverte.

L’heure estimée est le milieu des intervalles observés, dans le fuseau **Europe/Paris**, avec gestion du changement d’heure. `status: candidate` signifie une hypothèse utilisable pour ajuster la surveillance, pas une garantie ni une autorisation automatique de programmer une réservation. L’heure, la cadence et les preuves ne sont jamais partagées entre deux historiques de clubs ou de fournisseurs.

## Réglages par cible

Le fichier versionné [`data/monitoring-policy.json`](../data/monitoring-policy.json) contient les valeurs par défaut et les surcharges par identifiant de suivi :

```json
{
  "defaults": {
    "fullScanMinutes": 60,
    "discoveryMinutes": 5,
    "candidateDays": 7,
    "minPublications": 3,
    "maxEvidenceIntervalMinutes": 15,
    "beforeMinutes": 30,
    "afterMinutes": 60
  },
  "targets": {
    "ucpa-paris--ucpa": {
      "candidateDays": 35,
      "minPublications": 4,
      "beforeMinutes": 45
    }
  }
}
```

Cet exemple élargit la découverte UCPA à 35 dates et demande quatre publications avant adaptation. Les surcharges ne sont pas activées dans la configuration livrée. `minPublications` doit être au moins 3, `discoveryMinutes` au moins 5. Les réglages sont relus à chaque lancement.

## Consulter le plan sans contacter les sites

```sh
node scripts/observe.js --plan
npm run observe:report
```

`--plan` décrit pour chaque cible le mode `full`, `targeted` ou `skip`, les dates à consulter et, lorsqu’elle existe, l’hypothèse `pattern`. Le rapport ajoute `nextScan`, `lastFullScan`, `scanMode` et les pauses `nextRetryAt`/`monitoringAlert`. Une pause au niveau du fournisseur prime sur les plans individuels.

`pattern` indique `cadence`, `periodDays`, `publicationSizeRange`, `localTime`, `weekday` pour une ouverture hebdomadaire, `evidenceCount`, `expectedAt`, `watchFrom` et `watchUntil`. Les preuves originales restent dans `calendar.batches`.

Un instantané ciblé décrit seulement sa fenêtre : un `slotCount: 0` ne signifie pas que tout le club est complet. Le dernier horizon complet est conservé dans `lastFullScan.horizon`, avec sa date. Une date non consultée ne reçoit ni absence ni confirmation artificielle.

Les instantanés bruts sont conservés 30 jours. Les groupes de publications résumés sont conservés 400 jours, dans la limite de 800 groupes, pour permettre l’apprentissage mensuel. Les horaires ajoutés sur des dates déjà ouvertes restent inspectables mais ne suffisent pas à prouver une politique de publication.

## Particularités des sites

- **Anybuddy** : calendrier public, sans connexion au compte. Chaque consultation reste un appel API, même si la fenêtre de dates est réduite ; la baisse de fréquence intervient lorsque la cadence est apprise.
- **UCPA** : navigation publique par semaines. Atteindre une date future peut nécessiter le passage par les semaines intermédiaires. Le script respecte la limite de navigation et n’interprète pas l’inventaire caché comme réservable.
- **4PADEL Boulogne** : découverte et apprentissage sur son calendrier. Seules les dates ciblées et activées dans l’interface font l’objet de lectures d’inventaire supplémentaires.
- **4PADEL Saint-Ouen, Paris 20, Montreuil, CAO Saint-Denis, Marville et Créteil** : calendrier complet horaire, plus les confirmations d’une apparition déjà détectée. Leur calendrier à J+30 ne permet pas de mesurer leur autorisation réelle de réserver. Boulogne reste leur référence horaire indicative, sans tester un paiement toutes les cinq minutes.

Le collecteur 4PADEL utilise uniquement la session sauvegardée ; il ne ressaisit pas le mot de passe à chaque passage. Après expiration, rétablir la session avec `npm run auth:4padel`. Les commandes de réservation conservent leur propre fonctionnement.

## Alertes et pauses

`Retry-After` est respecté, même s’il demande une pause supérieure à six heures. Les autres erreurs appliquent un délai croissant de cinq minutes à une heure. Les erreurs ne deviennent jamais des observations d’absence.

Pour envoyer l’alerte de suspension directement via Hermes, définir dans l’environnement du service :

```ini
[Service]
Environment=ANYBOTTY_ALERT_TARGET=telegram:VOTRE_CHAT_ID
# Facultatif si Hermes est ailleurs que ~/.local/bin/hermes :
# Environment=ANYBOTTY_HERMES_BIN=/chemin/vers/hermes
```

Utiliser `systemctl --user edit anybotty-observe.service`, puis `systemctl --user daemon-reload`. Aucun modèle ni cron Hermes supplémentaire n’est nécessaire. Le destinataire reste dans la configuration privée du serveur. Sans cette variable, la suspension est journalisée mais aucun message Telegram n’est envoyé. `monitoringAlert.delivery` indique `delivered`, `failed` ou `not_configured` ; `delivered` signifie que la commande Hermes a réussi, sans preuve de lecture du message.

Cette régulation réduit la charge ; elle ne garantit pas l’absence de restrictions imposées par les sites.

Le suivi Anybuddy est désactivé pour `ucpa-paris`, `4padel-paris-20` et `4padel-saint-ouen` dans `data/clubs.json`, car leur site officiel est déjà suivi. Les sept suivis Anybuddy actifs sont Paris Padel, Sportfield Bercy, Aquaboulevard, Padelistes Bercy, Padel 15, Forest Hill Nanterre–La Défense et Forest Hill Marnes-la-Coquette. La réservation via Anybuddy reste disponible pour les clubs désactivés ; leurs anciens relevés ne décrivent plus une disponibilité actuelle. Aucun historique n’est effacé par cette désactivation.

À UCPA Meudon, `monitoring.navigationMode: "month-boundary"` relit la limite annoncée par le calendrier initial de quatre mois, puis interroge seulement les semaines accessibles autour de cette limite. Le 13 septembre 2026, les flèches natives ont confirmé la dernière semaine du 11 au 17 janvier 2027 (J+126 ce jour-là). Les contrôles ciblés surveillent donc la semaine du 18 janvier, avec cinq confirmations après apparition. La limite est recalculée à chaque passage : J+126 n’est pas figé dans la configuration. Un scan horaire conserve la précédente frontière pour ne pas sauter les dates d’un nouveau lot. Le rapport distingue `declaredCalendarThroughDate` de la limite native `navigationThroughDate` utilisée à Paris. Ce suivi des semaines lointaines ne constitue pas un inventaire de toutes les disponibilités proches, ni une validation du checkout Meudon.
