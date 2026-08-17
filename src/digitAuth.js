import axios from "axios";
import config from "./config.js";

const OAUTH_PATH = "/user/oauth/token";
// Standard DIGIT client id "egov-user-client" with an empty secret, base64
// encoded — this is DIGIT's normal public client id, not a secret in itself.
const OAUTH_BASIC_AUTH = "Basic ZWdvdi11c2VyLWNsaWVudDo=";

// Logs in with a username/password to obtain a FRESH authToken + userInfo.
// This is the same method the real DIGIT-Frontend CI pipeline uses —
// confirmed directly against `.github/workflows/pushLocalization.yml` and
// `health/configs/scripts/push-localization.js` on the upstream
// `ci/localization-push-pipeline` branch, not guessed or reverse-engineered.
// Preferred over asking a human to paste a browser session token (the
// `--request-info-file` fallback): a token obtained this way is always
// fresh at the moment it's used, and nobody has to open dev tools.
export async function authenticateWithPassword({ username, password, tenantId, userType }) {
  if (!config.baseUrl) {
    throw new Error("DIGIT_API_BASE_URL is not set. Copy .env.example to .env and fill it in.");
  }
  if (!username || !password) {
    throw new Error("Both a username and password are required to log in.");
  }

  const url = `${config.baseUrl.replace(/\/+$/, "")}${OAUTH_PATH}`;
  const body = new URLSearchParams({
    grant_type: "password",
    scope: "read",
    username,
    password,
    tenantId,
    userType: userType || "EMPLOYEE",
  });

  let data;
  try {
    const response = await axios.post(url, body.toString(), {
      headers: {
        Authorization: OAUTH_BASIC_AUTH,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    data = response.data;
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Authentication failed${status ? ` (HTTP ${status})` : ""}: ${detail}`);
  }

  if (!data.access_token) {
    throw new Error("Authentication response did not contain an access_token.");
  }

  return {
    apiId: "Rainmaker",
    authToken: data.access_token,
    userInfo: data.UserRequest,
    plainAccessRequest: {},
  };
}
