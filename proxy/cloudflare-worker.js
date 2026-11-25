/*
 * Proxy CORS minimal pour Jelastic Control — à n'utiliser que si le navigateur
 * refuse l'appel direct à l'API Jelastic (erreur « Impossible de joindre … »).
 *
 * Déploiement (Cloudflare Workers, offre gratuite) :
 *   1. Créer un Worker, coller ce fichier.
 *   2. Variables : JEL_API_HOST = https://app.jpc.infomaniak.com
 *                  ALLOWED_ORIGIN = https://<hôte où la PWA est publiée>
 *   3. Dans l'app, Hôte de l'API = https://<nom>.<compte>.workers.dev
 *
 * Le proxy ne stocke rien et ne relaie que les quelques méthodes utilisées
 * par l'app : il ne peut pas servir à appeler le reste de l'API.
 */
const ALLOWED_PATHS = new Set([
  '/1.0/users/authentication/rest/signin',
  '/1.0/users/authentication/rest/signout',
  '/1.0/environment/control/rest/getenvs',
  '/1.0/environment/control/rest/startenv',
  '/1.0/environment/control/rest/stopenv',
]);

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (origin !== env.ALLOWED_ORIGIN) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (request.method !== 'POST' || !ALLOWED_PATHS.has(url.pathname)) {
      return new Response('Not found', { status: 404, headers: cors });
    }

    const upstream = await fetch(env.JEL_API_HOST.replace(/\/+$/, '') + url.pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: await request.text(),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
    });
  },
};
