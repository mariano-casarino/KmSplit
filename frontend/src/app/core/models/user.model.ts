export interface User {
  id: number;
  /** Apodo: el nombre que se muestra en toda la app (integrantes, cargas, resumen). */
  name: string;
  first_name: string;
  last_name: string;
  /** Foto de perfil como data URI base64. Vacío = sin foto (se muestran las iniciales). */
  avatar_url: string;
  email: string;
  created_at: string;
}
