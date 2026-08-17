import fs from "fs";
import path from "path";

// Loads a real RequestInfo (authToken + userInfo) from a file the developer
// supplies fresh, right before running `apply` — deliberately NOT read from
// .env. A session authToken is short-lived and tied to a specific logged-in
// user; hardcoding one in a config file would go stale silently and would
// mean a real credential sitting in a file that could easily end up
// committed or shared by accident. Requiring an explicit --request-info-file
// every time means whoever runs `apply` is always using their own current
// session, on purpose, in the moment.
export function loadRequestInfo(filePath) {
  const absPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Request-info file not found: ${absPath}`);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch (err) {
    throw new Error(`Request-info file is not valid JSON: ${err.message}`);
  }

  if (!raw.authToken) {
    throw new Error(`Request-info file is missing "authToken".`);
  }
  if (!raw.userInfo) {
    throw new Error(`Request-info file is missing "userInfo".`);
  }

  return {
    apiId: raw.apiId || "Rainmaker",
    authToken: raw.authToken,
    userInfo: raw.userInfo,
    plainAccessRequest: raw.plainAccessRequest || {},
  };
}
