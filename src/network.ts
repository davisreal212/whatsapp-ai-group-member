import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const maxRedirects = 3;

export function isSafeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = normalizeHostname(url.hostname);
    if (url.protocol !== "https:" || !hostname || url.username || url.password) return false;
    if (url.port && url.port !== "443") return false;
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".home.arpa")) return false;
    return !isPrivateIp(hostname);
  } catch {
    return false;
  }
}

export async function fetchSafeMedia(value: string, init: RequestInit = {}): Promise<Response> {
  let current = value;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    if (!isSafeHttpsUrl(current)) throw new Error("Unsafe media URL");
    const url = new URL(current);
    await assertPublicHostname(url.hostname);
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (!redirectStatuses.has(response.status)) return response;
    if (redirect === maxRedirects) throw new Error("Too many media redirects");
    const location = response.headers.get("location");
    if (!location) throw new Error("Media redirect has no location");
    current = new URL(location, current).toString();
  }
  throw new Error("Unable to fetch media");
}

async function assertPublicHostname(hostname: string): Promise<void> {
  const normalized = normalizeHostname(hostname);
  if (isPrivateIp(normalized)) throw new Error("Media host resolves to a private address");
  if (isIP(normalized)) return;
  const addresses = await lookup(normalized, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((address) => isPrivateIp(address.address))) {
    throw new Error("Media host resolves to a private address");
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function isPrivateIp(value: string): boolean {
  const normalized = normalizeHostname(value).split("%")[0] ?? "";
  if (isIP(normalized) === 4) {
    const parts = normalized.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => part < 0 || part > 255 || !Number.isInteger(part))) return true;
    const first = parts[0] ?? -1;
    const second = parts[1] ?? -1;
    return first === 0 || first === 10 || first === 127 || (first === 100 && second >= 64 && second <= 127) || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 198 && (second === 18 || second === 19)) || first >= 224;
  }
  if (isIP(normalized) === 6) {
    const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mappedIpv4) return isPrivateIp(mappedIpv4);
    const firstBlock = Number.parseInt(normalized.split(":")[0] || "0", 16);
    return normalized === "::" || normalized === "::1" || (firstBlock & 0xfe00) === 0xfc00 || (firstBlock & 0xffc0) === 0xfe80;
  }
  return false;
}
