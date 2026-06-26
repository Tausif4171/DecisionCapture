export function requiresAdminRouteValidation(path: string) {
  return path.startsWith("/admin");
}