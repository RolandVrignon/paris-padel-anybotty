# Authentification des sites officiels

UCPA et 4PADEL disposent maintenant de connexions Playwright réutilisables, indépendantes d’Anybuddy. Ces commandes établissent une session et vérifient le compte connecté ; elles ne créent aucune réservation et ne soumettent aucun paiement.

## Configuration privée

Conserver `account` pour Anybuddy et ajouter les comptes officiels dans `config.fixed.json` :

```json
{
  "providers": {
    "4padel": { "account": { "email": "", "password": "" } },
    "ucpa": { "account": { "email": "", "password": "" } }
  }
}
```

Le fichier `.sample` fournit ces champs vides. Les comptes ne sont jamais déduits de celui d’un autre fournisseur. Garder les mots de passe dans le fichier privé de la machine qui exécute le bot.

## Connexion et contrôle

| Action | 4PADEL | UCPA |
| --- | --- | --- |
| Établir ou réutiliser une session | `npm run auth:4padel` | `npm run auth:ucpa` |
| Vérifier la session enregistrée | `npm run auth:4padel:check` | `npm run auth:ucpa:check` |
| Faire une nouvelle connexion | `npm run auth:4padel -- --fresh` | `npm run auth:ucpa -- --fresh` |
| Voir le navigateur | `npm run auth:4padel -- --headed` | `npm run auth:ucpa -- --headed` |
| Terminer une connexion manuellement | `npm run auth:4padel -- --headed --manual` | `npm run auth:ucpa -- --headed --manual` |

Le mode par défaut utilise un navigateur masqué. `--check` ne remplit jamais les identifiants, ne relance pas une connexion par mot de passe et ne réécrit pas les fichiers de session. Une session absente ou expirée est signalée avec `login_required`. `--fresh` ouvre un contexte neuf ; la session enregistrée n’est remplacée qu’après vérification du compte.

Le mode manuel laisse jusqu’à trois minutes pour compléter le formulaire et les éventuels contrôles interactifs. Il exige `--headed`. Ne pas l’utiliser sur un VPS sans affichage. Le script ne résout pas les codes de validation et ne réinitialise pas de mot de passe.

## Vérification et stockage

4PADEL utilise son formulaire natif puis vérifie l’identité avec `GET /splf/v1/users/me?qoodos_refund=false&appId=2`. Sa session sert aux trois centres officiels actuellement surveillés.

UCPA démarre depuis l’espace personnel Paris 19, passe si nécessaire par `authent.ucpa.com`, puis vérifie la session du portail avec `GET /sport-station/espacepersonnel/api/paris-19/user`. Une simple redirection réussie ne suffit pas : l’email renvoyé par le serveur doit correspondre au compte configuré.

Chaque fournisseur conserve son état privé dans `.auth/providers/<provider>-session.json`, accompagné d’un fichier de métadonnées liant la session au compte par empreinte. Fichiers en `0600`, dossier en `0700`, exclus de Git. Les contrôles serveur refusent aussi une identité différente même si le fichier de session a été remplacé. Les journaux n’affichent ni identifiants, ni jetons, ni données de compte.

La sortie est un objet JSON exploitable par Hermes :

```json
{
  "provider": "ucpa",
  "status": "authenticated",
  "identityVerified": true,
  "sessionSaved": false,
  "checkedAt": "2026-09-13T00:00:00.000Z"
}
```

Les erreurs ont un statut explicite (`configuration_required`, `login_required`, `account_mismatch`, `login_refused`, `identity_unverified`…). Une connexion UCPA interrompue par un contrôle supplémentaire peut retourner `interaction_required` ; une issue indéterminée reste `login_unconfirmed`. Un échec renvoie un code de sortie non nul, sans enregistrer la session candidate.

## Réutiliser dans les prochains scripts

Importer `createFourPadelSession` depuis `lib/fourpadel-session.js` ou `createUcpaSession` depuis `lib/ucpa-session.js`. Ces fonctions renvoient un contexte Playwright authentifié et une méthode `close()` à appeler dans un `finally`.

```javascript
const session = await createUcpaSession()
try {
  const page = await session.context.newPage()
  // Continuer le parcours autorisé dans ce contexte.
} finally {
  await session.close()
}
```

Le collecteur 4PADEL utilise cette brique commune. Le monitoring UCPA continue à observer le calendrier public ; il ne dépend pas des identifiants UCPA. La connexion UCPA est réutilisée par `npm run ucpa -- book|list|show|cancel|reconcile`. La réservation avec carte enregistrée, le détail et l’annulation gratuite de la partie sont intégrés : voir le [parcours UCPA](ucpa-booking.md). `checkout:ucpa` reste un aperçu sans confirmation. La réservation officielle 4PADEL reste à intégrer. Les commandes Anybuddy existantes restent distinctes.
