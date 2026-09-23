export interface LoginRequest {
  email: string;
  password: string;
  /** "Recordarme": mantiene la sesión ~7 días deslizantes (cookie persistente). */
  remember?: boolean;
}

export interface RegisterRequest {
  /** Apodo: el nombre que se muestra en toda la app. */
  name: string;
  first_name?: string;
  last_name?: string;
  email: string;
  password: string;
}

/** PUT /auth/me/ — edición de perfil (el email es solo lectura). */
export interface ProfileUpdateRequest {
  /** Apodo: el nombre que se muestra en toda la app. */
  name: string;
  first_name: string;
  last_name: string;
  /** Foto de perfil (data URI). Vacío elimina la foto. */
  avatar_url?: string;
}

/** POST /auth/change-password/ */
export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

export interface PasswordResetRequest {
  email: string;
}

export interface PasswordResetVerifyRequest {
  email: string;
  code: string;
}

export interface PasswordResetConfirmRequest {
  email: string;
  code: string;
  new_password: string;
  confirm_password: string;
}

export interface AccessTokenResponse {
  access: string;
  /** Refresh token (respaldo en localStorage para iOS PWA que limpia cookies httpOnly). */
  refresh?: string;
}
