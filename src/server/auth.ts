import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import type { SwarmbookDatabase } from "../db/database";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
} from "../db/schema";

const OWNER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,63})$/;

export function localAuthEmail(owner: string): string {
  return `${owner}@users.swarmbook.invalid`;
}

export function createHumanAuth(
  database: SwarmbookDatabase,
  options: { baseURL: string; secret: string },
) {
  return betterAuth({
    appName: "Swarmbook",
    baseURL: options.baseURL,
    secret: options.secret,
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    plugins: [
      username({
        minUsernameLength: 1,
        maxUsernameLength: 64,
        usernameValidator: (value) => OWNER_PATTERN.test(value),
        displayUsernameValidator: (value) => OWNER_PATTERN.test(value),
        validationOrder: {
          username: "post-normalization",
          displayUsername: "post-normalization",
        },
      }),
    ],
    trustedOrigins: [options.baseURL],
    advanced: {
      cookiePrefix: "swarmbook",
      useSecureCookies: new URL(options.baseURL).protocol === "https:",
    },
  });
}

export type HumanAuth = ReturnType<typeof createHumanAuth>;
