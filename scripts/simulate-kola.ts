import { localRelevance } from "../src/decision.js";
import { defaultPersonality, resolvePersonality, responsePolicy } from "../src/persona.js";

const p = resolvePersonality(defaultPersonality("Kola"), { personalityPresets: ["Kola"] });
console.log("resolved preset:", p.tone, "len:", p.responseLength, "talk:", p.talkativeness, "mix:", p.languageMix);
console.log("character rules injected:", p.displayName.toLowerCase() === "kola");

const mk = (text: string, fromMe = false): any => ({
  id: Math.random().toString(36).slice(2),
  chatJid: "12036302@g.us",
  senderJid: fromMe ? "2348000000000@s.whatsapp.net" : "2348111111111@s.whatsapp.net",
  senderName: fromMe ? "Kola" : "Tunde",
  text,
  timestamp: Date.now(),
  isGroup: true,
  isFromMe: fromMe,
  mentionedIds: [],
  quotedSenderId: undefined,
});

const cases: Array<[string, any, string]> = [
  ["casual chatter nobody pulled kola into", mk("una don eat?"), "expect: silence"],
  ["direct mention", mk("kola wetin be btc price now, mention am"), "expect: reply"],
  ["reply to kola's own message", mk("lol kola u dey mad 😂", false), "expect: reply"],
  ["btc price ask without mention", mk("who get btc update"), "expect: maybe silence or join if enabled"],
];

for (const [label, msg, expect] of cases) {
  const r = localRelevance(msg, "Kola", "2348000000000@s.whatsapp.net", p.talkativeness, [], false, p, []);
  const pol = responsePolicy(p, msg, { directed: /kola/i.test(msg.text) }, r.relevant);
  console.log(`\n${label} -> relevant=${r.relevant} reason=${r.reason} reply=${pol.shouldReply}  (${expect})`);
}
