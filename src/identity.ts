export function normalizeWhatsAppJid(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const [local, server] = trimmed.split("@");
  if (!local || !server) return trimmed;
  return `${local.split(":", 1)[0]}@${server}`;
}

export function normalizePhoneNumber(value: string): string | undefined {
  const digits = value.split("@")[0]?.split(":", 1)[0]?.replace(/\D/g, "") ?? "";
  return digits || undefined;
}

export function sameWhatsAppIdentity(left: string, right: string): boolean {
  if (normalizeWhatsAppJid(left) === normalizeWhatsAppJid(right)) return true;
  const leftJid = normalizeWhatsAppJid(left);
  const rightJid = normalizeWhatsAppJid(right);
  const leftPhone = leftJid.endsWith("@s.whatsapp.net") ? normalizePhoneNumber(leftJid) : !leftJid.includes("@") ? normalizePhoneNumber(leftJid) : undefined;
  const rightPhone = rightJid.endsWith("@s.whatsapp.net") ? normalizePhoneNumber(rightJid) : !rightJid.includes("@") ? normalizePhoneNumber(rightJid) : undefined;
  return Boolean(leftPhone && rightPhone && leftPhone === rightPhone);
}

export function matchesWhatsAppIdentity(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => sameWhatsAppIdentity(value, candidate));
}
