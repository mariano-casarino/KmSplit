export const environment = {
  production: true,
  // Mismo origen: /api se proxyea a Railway desde Vercel (ver vercel.json).
  // Así las cookies del refresh son SAME-SITE (funcionan en móvil y desktop)
  // en vez de cross-site (que los navegadores móviles bloquean).
  apiUrl: '/api',
  // Client ID de la OAuth 2.0 "Web application" de Google en producción.
  // Debe coincidir con el GOOGLE_CLIENT_ID que se carga en Railway.
  googleClientId: '292782863208-d9r2stungpedj4badngc23irn0i6r85h.apps.googleusercontent.com',
};
