import axios from "axios";
import config from "./config.js";

// Contract confirmed against the DIGIT-Frontend source:
//   POST /localization/messages/v1/_search
//   params: { tenantId, module (comma-joined), locale }
//   body:   { RequestInfo: { apiId: "Rainmaker", authToken, ... } }
//   resp:   { messages: [{ code, message, module, locale }, ...] }
//
// This is a READ-ONLY call, and remains the ONLY thing `sync`/`search`/`scan`/
// `lint`/`deadcheck`/`export` ever do against the backend. The one exception
// is `upsertLocalization` below, used only by the `apply` command — see its
// own comment for why that's a deliberate, narrowly-scoped exception, not a
// relaxation of the rule.
export async function searchLocalization({ modules, locale, tenantId }) {
  if (!config.baseUrl) {
    throw new Error(
      "DIGIT_API_BASE_URL is not set. Copy .env.example to .env and fill it in."
    );
  }
  const resolvedTenantId = tenantId || config.tenantId;
  if (!resolvedTenantId) {
    throw new Error(
      "No tenantId provided. Pass --tenant-id or set DIGIT_TENANT_ID in .env."
    );
  }

  const url = `${config.baseUrl.replace(/\/+$/, "")}/localization/messages/v1/_search`;
  const moduleParam = Array.isArray(modules) ? modules.join(",") : modules;

  const body = {
    RequestInfo: {
      apiId: "Rainmaker",
      ver: ".01",
      ts: null,
      action: "_search",
      did: null,
      key: null,
      msgId: `digit-i18n-cli|${locale}`,
      authToken: config.authToken,
    },
  };

  const { data } = await axios.post(url, body, {
    params: { tenantId: resolvedTenantId, module: moduleParam, locale },
  });

  return data.messages || [];
}

// Contract confirmed against a real captured request (the user's own
// browser network tab), not just the earlier _search research:
//   POST /localization/messages/v1/_upsert?tenantId=...&module=...&locale=...
//   body: { RequestInfo: { apiId, authToken, userInfo, msgId, plainAccessRequest },
//           tenantId, module, locale, messages: [{ code, message, module, locale }] }
//
// This is the ONLY function in this entire tool that ever writes to the
// backend. It is deliberately narrow: it takes a fully-formed, real
// RequestInfo (authToken + userInfo) as a parameter — it never reads one
// from .env, never caches one, never reuses one across calls implicitly.
// The only caller is `apply`, and `apply` never invokes this without an
// explicit human confirmation immediately beforehand. If you're tempted to
// call this from anywhere else, don't — that's exactly the "safe to run
// freely" property this whole tool has been built around.
export async function upsertLocalization({ tenantId, module, locale, messages, requestInfo }) {
  if (!config.baseUrl) {
    throw new Error("DIGIT_API_BASE_URL is not set. Copy .env.example to .env and fill it in.");
  }

  const url = `${config.baseUrl.replace(/\/+$/, "")}/localization/messages/v1/_upsert`;

  const body = {
    RequestInfo: {
      apiId: requestInfo.apiId || "Rainmaker",
      authToken: requestInfo.authToken,
      userInfo: requestInfo.userInfo,
      msgId: `${Date.now()}|${locale}`,
      plainAccessRequest: requestInfo.plainAccessRequest || {},
    },
    tenantId,
    module,
    locale,
    messages,
  };

  const { data } = await axios.post(url, body, {
    params: { tenantId, module, locale },
  });

  return data;
}
