import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Resolved relative to this config file. A forward-slash relative path keeps
  // drizzle-kit's glob working on Windows (a joined absolute path resolves with
  // backslashes, which the globber treats as escapes).
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
