import type { AuthUser, UserRole } from "@decisioncapture/shared";

export type RequestUser = AuthUser;

export type ReviewActor = {
  user?: RequestUser;
  authRequired: boolean;
};

export const privilegedRoles: UserRole[] = ["ADMIN", "MAINTAINER", "REVIEWER"];
export const integrationManagerRoles: UserRole[] = ["ADMIN", "MAINTAINER"];
export const reopenRoles: UserRole[] = ["ADMIN", "MAINTAINER"];
