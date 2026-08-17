import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadModuleRegistry() {
  const projectConfigPath = path.resolve(process.cwd(), "digit-i18n.config.json");
  const source = fs.existsSync(projectConfigPath)
    ? projectConfigPath
    : path.resolve(__dirname, "default-modules.config.json");

  const raw = JSON.parse(fs.readFileSync(source, "utf8"));
  return { source, ...raw };
}

const moduleRegistry = loadModuleRegistry();

export const config = {
  baseUrl: process.env.DIGIT_API_BASE_URL || "",
  tenantId: process.env.DIGIT_TENANT_ID || "",
  authToken: process.env.DIGIT_AUTH_TOKEN || null,
  defaultLocale: process.env.DIGIT_DEFAULT_LOCALE || "en_IN",
  localizationsDir: process.env.DIGIT_LOCALIZATIONS_DIR
    ? path.resolve(process.cwd(), process.env.DIGIT_LOCALIZATIONS_DIR)
    : path.resolve(process.cwd(), "localizations"),
  // Default target locales for `apply --to`, only used when --to isn't
  // passed explicitly on the command line. Not a secret — just a list of
  // locale codes — so unlike credentials, this is fine in .env.
  upsertLocales: process.env.DIGIT_UPSERT_LOCALES
    ? process.env.DIGIT_UPSERT_LOCALES.split(",").map((l) => l.trim()).filter(Boolean)
    : [],
  // Used only by `apply`, only to log in fresh at the moment it runs (see
  // src/digitAuth.js) — never cached, never reused across runs. Same
  // sensitivity as DIGIT_AUTH_TOKEN above; make sure .env is gitignored
  // wherever this is set.
  username: process.env.DIGIT_USERNAME || null,
  password: process.env.DIGIT_PASSWORD || null,
  userType: process.env.DIGIT_USER_TYPE || "EMPLOYEE",
  moduleRegistry,
};

export default config;
