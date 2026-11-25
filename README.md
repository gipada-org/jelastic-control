# Jelastic Control — PWA

Application mobile installable **sans APK** (Progressive Web App) pour lister les
environnements Jelastic et **démarrer / arrêter** chacun d'eux.

HTML/CSS/JS sans dépendance ni étape de build : le dossier se publie tel quel.

## Fonctions

- Liste des environnements : nom, domaine, statut (en marche, arrêté, en veille, en
  transition…), nœuds et cloudlets.
- Boutons **Démarrer** / **Arrêter**, avec confirmation. Le statut est suivi
  automatiquement (toutes les 5 s) tant qu'un environnement est en transition.
- Filtre par nom, actualisation manuelle et au retour au premier plan.
- Connexion par **jeton d'accès** (recommandé) ou identifiant / mot de passe.
- Interface en cache (service worker) : l'app s'ouvre même hors ligne ; les appels
  API, eux, ne sont jamais mis en cache.

## 1. Créer un jeton d'accès Jelastic

Tableau de bord Jelastic → **Settings › Access Tokens** → *Generate*.
Donner une portée limitée : `environment.control.GetEnvs`, `StartEnv`, `StopEnv`
(ou l'API « Environment control »), et une date d'expiration.

Le jeton fonctionne même avec le 2FA actif et se révoque à tout moment. La connexion
par mot de passe, elle, échoue si le 2FA est actif.

## 2. Publier l'app (HTTPS obligatoire)

Une PWA ne s'installe que servie en **HTTPS**. Tout hébergement statique convient :
Cloudflare Pages, Netlify, GitHub Pages, un nginx… Il suffit de publier le contenu de
ce dossier (sans `proxy/` ni ce README si on le souhaite).

> Ne pas l'héberger dans un des environnements qu'elle sert à arrêter : une fois
> l'environnement arrêté, l'app ne pourrait plus le redémarrer (la coquille en
> cache s'ouvrirait, mais les mises à jour ne passeraient plus).

Test local : `npx serve .` puis <http://localhost:3000> (localhost compte comme sûr).

## 3. Installer sur le téléphone

- **Android (Chrome)** : ouvrir l'URL → menu ⋮ → *Installer l'application*.
- **iPhone (Safari)** : ouvrir l'URL → Partager → *Sur l'écran d'accueil*.

L'app s'ouvre alors en plein écran, avec sa propre icône.

## 4. Se connecter

⚙ → Hôte de l'API : `https://app.jpc.infomaniak.com` (Jelastic Infomaniak, voir
`../.env.jelastic.example`), ou l'hôte du tableau de bord d'une autre plateforme.
Coller le jeton → **Se connecter**.

### Si « Impossible de joindre … » (CORS)

L'app appelle l'API Jelastic directement depuis le navigateur. Si la plateforme
n'autorise pas ces appels cross-origin, déployer le proxy fourni :

`proxy/cloudflare-worker.js` (Cloudflare Workers, gratuit) — variables
`JEL_API_HOST` et `ALLOWED_ORIGIN` (l'URL où la PWA est publiée). Puis, dans l'app,
mettre l'URL du Worker comme hôte de l'API. Le proxy ne stocke rien et ne relaie que
les 5 méthodes utilisées par l'app.

## Sécurité

- Le jeton (ou la session obtenue par mot de passe) est stocké dans le
  `localStorage` **de cet appareil uniquement**. Le mot de passe n'est jamais stocké.
- Quiconque a le téléphone déverrouillé peut arrêter les environnements : utiliser un
  jeton à portée réduite et avec expiration, et le révoquer en cas de perte.
- *Se déconnecter* efface la session de l'appareil (et ferme la session Jelastic en
  mode mot de passe ; un jeton, lui, se révoque dans le tableau de bord).

## API utilisée

| Méthode | Rôle |
|---|---|
| `POST /1.0/users/authentication/rest/signin` | connexion par mot de passe |
| `POST /1.0/environment/control/rest/getenvs` | liste et statut |
| `POST /1.0/environment/control/rest/startenv` | démarrage |
| `POST /1.0/environment/control/rest/stopenv` | arrêt |

Toutes en `application/x-www-form-urlencoded` (requêtes CORS « simples », sans
pré-vol), paramètre `session` = jeton ou session.
