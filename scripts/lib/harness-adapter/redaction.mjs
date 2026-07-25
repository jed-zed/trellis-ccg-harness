export const REDACTED = "[REDACTED]";

const SECRET_KEY_PATTERN =
  /(api[-_]?key|authorization|bearer|credential|password|secret|token)/i;
const SECRET_VALUE_REPLACEMENTS = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, REDACTED],
  [
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    REDACTED,
  ],
  [
    /([?&](?:api[-_]?key|token|secret|key)=)[^&#\s]+/gi,
    `$1${REDACTED}`,
  ],
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isSecretKeyName(key) {
  return SECRET_KEY_PATTERN.test(key);
}

export function redactString(value, secrets = []) {
  let output = String(value);
  for (const [pattern, replacement] of SECRET_VALUE_REPLACEMENTS) {
    output = output.replace(pattern, replacement);
  }
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 4) {
      output = output.replace(new RegExp(escapeRegExp(secret), "g"), REDACTED);
    }
  }
  return output;
}

export function redactValue(value, secrets = [], seen = new WeakSet()) {
  if (typeof value === "string") {
    return redactString(value, secrets);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets, seen));
  }
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    const namesEnvironmentVariable =
      /(?:env|environment|name|names|path|paths)$/i.test(key);
    output[key] = isSecretKeyName(key) && !namesEnvironmentVariable
      ? REDACTED
      : redactValue(item, secrets, seen);
  }
  return output;
}

export function createSafeSubprocessEnv(sourceEnv = process.env) {
  const output = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    if (
      value !== undefined &&
      !isSecretKeyName(key) &&
      !/^CLAUDE_/i.test(key)
    ) {
      output[key] = value;
    }
  }
  return output;
}
