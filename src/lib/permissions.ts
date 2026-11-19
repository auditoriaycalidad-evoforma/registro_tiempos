export const INDEPENDENT_INTERVAL_TYPE_ALLOWED_EMAILS = [
  "ia.evoforma@gmail.com",
  "auditoriaycalidad@evoforma.net",
] as const;

/**
 * Condición estricta de permisos:
 * Habilita la selección independiente de tipo de registro por intervalo adicional
 * únicamente cuando el usuario autenticado tiene rol de administrador ("ADMIN")
 * y su correo electrónico es ia.evoforma@gmail.com o auditoriaycalidad@evoforma.net.
 */
export function canSelectIndependentIntervalType(user?: {
  rol?: string | null;
  email?: string | null;
} | null): boolean {
  if (!user) return false;
  const isRoleAdmin = user.rol?.trim().toUpperCase() === "ADMIN";
  const normalizedEmail = user.email?.trim().toLowerCase();
  return Boolean(
    isRoleAdmin &&
      normalizedEmail &&
      (INDEPENDENT_INTERVAL_TYPE_ALLOWED_EMAILS as readonly string[]).includes(normalizedEmail)
  );
}
