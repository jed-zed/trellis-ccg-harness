import { redactString, redactValue } from "./redaction.mjs";

export function normalizeBaseUrl(value) {
  const url = new URL(value);
  const isLocal =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (url.username || url.password) {
    throw new Error("Provider base URL must not contain credentials.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new Error("Provider base URL must use HTTPS unless it is localhost.");
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function joinApiUrl(baseUrl, endpointPath) {
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const endpoint = endpointPath.startsWith("/")
    ? endpointPath
    : `/${endpointPath}`;
  base.pathname =
    basePath === "/v1" && endpoint.startsWith("/v1/")
      ? `${basePath}${endpoint.slice(3)}`
      : `${basePath}${endpoint}`;
  return base.toString();
}

async function requestJson(
  fetchImpl,
  url,
  {
    method = "GET",
    apiKey,
    body,
    timeoutMs,
  },
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      redirect: "error",
    });
    const responseText = await response.text();
    let payload = null;
    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch {
      // Only a bounded redacted error is retained below.
    }
    const rawError =
      payload?.error?.message ??
      (typeof payload?.error === "string" ? payload.error : null) ??
      (!response.ok ? responseText : null);
    return {
      ok: response.ok,
      status: response.status,
      payload,
      error: rawError
        ? redactString(String(rawError).slice(0, 500), [apiKey])
        : null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      payload: null,
      error: redactString(error?.message ?? String(error), [apiKey]),
    };
  } finally {
    clearTimeout(timer);
  }
}

function countSearchEvidence(payload) {
  let webSearchCallCount = 0;
  let annotationCount = 0;
  let citationCount = Array.isArray(payload?.citations)
    ? payload.citations.length
    : 0;
  let hasUrlInText = false;

  for (const item of payload?.output ?? []) {
    if (/web_search/i.test(String(item?.type ?? ""))) {
      webSearchCallCount += 1;
    }
    for (const part of item?.content ?? []) {
      annotationCount += Array.isArray(part?.annotations)
        ? part.annotations.length
        : 0;
      if (/https?:\/\//i.test(String(part?.text ?? ""))) {
        hasUrlInText = true;
      }
    }
  }
  citationCount += annotationCount;
  return {
    webSearchCallCount,
    annotationCount,
    citationCount,
    hasUrlInText,
    sourceBacked:
      webSearchCallCount > 0 &&
      (annotationCount > 0 || citationCount > 0),
  };
}

function unconfiguredReport(provider, missing, error) {
  return {
    provider: "openAICompatibleGrok",
    configured: false,
    enabledByDefault: provider.enabled,
    optional: provider.optional,
    ...(missing ? { missing } : {}),
    ...(error ? { error } : {}),
    models: null,
    chat: null,
    search: null,
  };
}

async function probeModels({
  fetchImpl,
  provider,
  baseUrl,
  apiKey,
  model,
  timeoutMs,
}) {
  const response = await requestJson(
    fetchImpl,
    joinApiUrl(baseUrl, provider.modelsPath),
    { apiKey, timeoutMs },
  );
  const modelIds = Array.isArray(response.payload?.data)
    ? response.payload.data
        .map((entry) => entry?.id)
        .filter((id) => typeof id === "string")
    : [];
  return {
    status: response.status,
    ok: response.ok,
    count: modelIds.length,
    requestedModelAvailable: modelIds.includes(model),
    error: response.error,
  };
}

async function probeChat({
  fetchImpl,
  provider,
  baseUrl,
  apiKey,
  model,
  timeoutMs,
}) {
  const response = await requestJson(
    fetchImpl,
    joinApiUrl(baseUrl, provider.chatPath),
    {
      method: "POST",
      apiKey,
      timeoutMs,
      body: {
        model,
        messages: [{ role: "user", content: "Reply with exactly OK." }],
        max_completion_tokens: 32,
        stream: false,
      },
    },
  );
  return {
    status: response.status,
    ok: response.ok,
    responded: Boolean(response.payload?.choices?.[0]?.message?.content),
    error: response.error,
  };
}

async function probeSearch({
  fetchImpl,
  provider,
  baseUrl,
  apiKey,
  model,
  timeoutMs,
}) {
  const response = await requestJson(
    fetchImpl,
    joinApiUrl(baseUrl, provider.responsesPath),
    {
      method: "POST",
      apiKey,
      timeoutMs,
      body: {
        model,
        input: [
          {
            role: "user",
            content:
              "Use live web search to find the current xAI Web Search documentation and return its title and URL.",
          },
        ],
        tools: [{ type: "web_search" }],
        include: ["inline_citations"],
        max_output_tokens: 256,
      },
    },
  );
  return {
    status: response.status,
    ok: response.ok,
    ...countSearchEvidence(response.payload),
    error: response.error,
  };
}

function prepareProbe(contract, env, fetchImpl) {
  const provider = contract.providers.openAICompatibleGrok;
  const baseUrlValue = env[provider.baseUrlEnv];
  const apiKey = env[provider.apiKeyEnv];
  const model = env[provider.modelEnv] || provider.defaultModel;
  const missing = [
    !baseUrlValue ? provider.baseUrlEnv : null,
    !apiKey ? provider.apiKeyEnv : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    return { earlyReport: unconfiguredReport(provider, missing) };
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("A Fetch API implementation is required.");
  }
  try {
    return {
      apiKey,
      provider,
      model,
      baseUrl: normalizeBaseUrl(baseUrlValue),
    };
  } catch (error) {
    return {
      earlyReport: unconfiguredReport(
        provider,
        null,
        redactString(error.message, [apiKey]),
      ),
    };
  }
}

export async function probeOpenAICompatibleGrok(
  contract,
  {
    env = process.env,
    fetchImpl = globalThis.fetch,
    includeChat = false,
    includeSearch = false,
  } = {},
) {
  const prepared = prepareProbe(contract, env, fetchImpl);
  if (prepared.earlyReport) {
    return prepared.earlyReport;
  }
  const { provider, apiKey, model, baseUrl } = prepared;
  const timeoutMs = Number(provider.timeoutMs) || 180000;
  const probeContext = {
    fetchImpl,
    provider,
    baseUrl,
    apiKey,
    model,
    timeoutMs,
  };
  const models = await probeModels(probeContext);
  const report = {
    provider: "openAICompatibleGrok",
    configured: true,
    enabledByDefault: provider.enabled,
    optional: provider.optional,
    model,
    models,
    chat: null,
    search: null,
  };

  if (includeChat) {
    report.chat = await probeChat(probeContext);
  }

  if (includeSearch) {
    report.search = await probeSearch(probeContext);
  }

  return redactValue(report, [apiKey]);
}
