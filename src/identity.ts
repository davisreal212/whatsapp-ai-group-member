export function normalizeWhatsAppJid(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const [local, server] = trimmed.split("@");
  if (!local || !server) return trimmed;
  return `${local.split(":", 1)[0]}@${server}`;
}

export function normalizePhoneNumber(value: string): string | undefined {
  const digits = value.trim().split("@")[0]?.split(":", 1)[0]?.replace(/\D/g, "") ?? "";
  return digits || undefined;
}

// A phone-number-ish identity: a bare number (with +, spaces, dashes), or a
// phone JID (@s.whatsapp.net / legacy @c.us). LIDs are opaque ids, not numbers.
function phoneOf(value: string): string | undefined {
  const jid = normalizeWhatsAppJid(value);
  if (jid.includes("@")) {
    return /@(s\.whatsapp\.net|c\.us)$/.test(jid) ? normalizePhoneNumber(jid) : undefined;
  }
  return normalizePhoneNumber(jid);
}

export function sameWhatsAppIdentity(left: string, right: string): boolean {
  if (normalizeWhatsAppJid(left) === normalizeWhatsAppJid(right)) return true;
  const leftPhone = phoneOf(left);
  const rightPhone = phoneOf(right);
  return Boolean(leftPhone && rightPhone && leftPhone === rightPhone);
}

export function matchesWhatsAppIdentity(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => sameWhatsAppIdentity(value, candidate));
}
