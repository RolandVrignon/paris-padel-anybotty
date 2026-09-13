# Authentification des sites officiels

UCPA, 4PADEL et Playtomic disposent de connexions Playwright séparées, indépendantes d’Anybuddy. Ces commandes établissent une session ; elles ne créent aucune réservation et ne soumettent aucun paiement.

## Configuration privée

Conserver `account` pour Anybuddy et ajouter les comptes officiels dans `config.fixed.json` :

```json
{
  "providers": {
    "4padel": { "account": { "email": "", "password": "" } },
    "ucpa": { "account": { "email": "", "password": "" } },
    "playtomic": { "account": { "email": "", "password": "" } }
  }
}
```

Le fichier `.sample` fournit ces champs vides. Les comptes ne sont jamais déduits de celui d’un autre fournisseur. Garder les mots de passe dans le fichier privé de la machine qui exécute le bot.

## Connexion et contrôle

| Action | 4PADEL | UCPA | Playtomic |
| --- | --- | --- | --- |
| Établir ou réutiliser une session | `npm run auth:4padel` | `npm run auth:ucpa` | `npm run auth:playtomic` |
| Vérifier la session enregistrée | `npm run auth:4padel:check` | `npm run auth:ucpa:check` | `npm run auth:playtomic:check` |
| Faire une nouvelle connexion | `npm run auth:4padel -- --fresh` | `npm run auth:ucpa -- --fresh` | `npm run auth:playtomic -- --fresh` |
| Voir le navigateur | `npm run auth:4padel -- --headed` | `npm run auth:ucpa -- --headed` | `npm run auth:playtomic -- --headed` |
| Terminer une connexion manuellement | `npm run auth:4padel -- --headed --manual` | `npm run auth:ucpa -- --headed --manual` | `npm run auth:playtomic -- --headed --manual` |

Le mode par défaut utilise un navigateur masqué. `--check` ne remplit jamais les identifiants, ne relance pas une connexion par mot de passe et ne réécrit pas les fichiers de session. Une session absente ou expirée est signalée avec `login_required`. `--fresh` ouvre un contexte neuf ; la session enregistrée n’est remplacée qu’après vérification du compte.

Le mode manuel laisse jusqu’à trois minutes pour compléter le formulaire et les éventuels contrôles interactifs. Il exige `--headed`. Ne pas l’utiliser sur un VPS sans affichage. Le script ne résout pas les codes de validation et ne réinitialise pas de mot de passe.

## Vérification et stockage

4PADEL utilise son formulaire natif puis vérifie l’identité avec `GET /splf/v1/users/me?qoodos_refund=false&appId=2`. Sa session sert aux trois centres officiels actuellement surveillés.

UCPA démarre depuis l’espace personnel Paris 19, passe si nécessaire par `authent.ucpa.com`, puis vérifie la session du portail avec l’identité renvoyée par le centre sélectionné (`/api/paris-19/user` ou `/api/meudon/user`). Une simple redirection réussie ne suffit pas : l’email renvoyé par le serveur doit correspondre au compte configuré.

Playtomic utilise le formulaire email/mot de passe de `app.playtomic.com`. Le contrôle passif exige ensuite un identifiant utilisateur actif renvoyé par le domaine Playtomic ; le fichier de session reste lié par empreinte à l’adresse configurée. Cette brique prépare la recette du checkout, mais la commande publique de disponibilités n’en dépend pas.

Le portail peut afficher temporairement `/accueil` avant la redirection SSO, puis restaurer automatiquement le compte sans montrer le formulaire. Le bot attend donc soit un formulaire email/mot de passe visible sur `authent.ucpa.com`, soit une identité confirmée par le portail. Il ne continue pas à attendre un champ email disparu après une reconnexion automatique. `login_form_unavailable` distingue un formulaire absent ou inutilisable d’une connexion refusée.

**Tolérance aux lenteurs UCPA :** les attentes de navigation et de redirection disposent de 120 secondes par défaut (180 en mode manuel). Chaque vérification HTTP de l’identité dispose d’au plus 20 secondes. Avant la connexion, les erreurs réseau temporaires, timeouts, HTTP 408/429 et 5xx peuvent déclencher jusqu’à trois lectures au total, dans une enveloppe de 60 secondes ; une session explicitement absente passe directement au login. Après le retour au portail, le script attend sa session pendant au plus 60 secondes, avec des pauses progressives de 2, 4 puis 8 secondes, et au plus dix lectures. Ces délais sont distincts : prévoir plusieurs minutes pour une connexion lente, sans interrompre le processus sur la seule absence de résultat immédiat.

Le formulaire de connexion n’est soumis qu’une fois. Les nouvelles tentatives ne concernent que la lecture de session, jamais la création d’une réservation, son paiement ou son annulation. Une réponse d’identité malformée ou un compte différent reste un échec. Les diagnostics de progression sont écrits sur stderr, sans URL privée ni identifiants ; le résultat JSON reste sur stdout pour la commande d’authentification.

Les statuts distinguent `identity_timeout`, `identity_network_error`, `identity_unavailable` (serveur temporairement indisponible), `login_page_unavailable`, `login_service_unavailable`, `login_redirect_timeout`, `login_refused` et `interaction_required`. `login_unconfirmed` signifie que le portail n’a toujours pas confirmé sa session après la période d’attente. Un timeout ou une panne ne prouve pas que le mot de passe est incorrect. Les commandes `ucpa.js` exposent aussi ce diagnostic dans leur champ `code` lorsque l’échec vient de l’authentification.

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

Le collecteur 4PADEL utilise cette brique commune. Le monitoring UCPA continue à observer le calendrier public ; il ne dépend pas des identifiants UCPA. La connexion UCPA est réutilisée par `npm run ucpa -- book|list|show|cancel|reconcile`. La réservation avec carte enregistrée, le détail et l’annulation gratuite de la partie sont intégrés : voir le [parcours UCPA](ucpa-booking.md). `checkout:ucpa` reste un aperçu sans confirmation. 4PADEL dispose de `npm run 4padel -- book|list|show|wallet|cancel|reconcile` : réservation des quatre parts en crédits, consultation du solde actualisé et gestion des réservations. `book` reste un aperçu sans `--confirm`. Voir le [parcours 4PADEL](fourpadel-booking.md). Les commandes Anybuddy existantes restent distinctes.
