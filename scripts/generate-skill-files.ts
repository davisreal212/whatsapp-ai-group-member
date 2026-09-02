import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BLUEPRINT_SKILL_CATALOG } from "../src/skill-catalog.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");
const entries = [...BLUEPRINT_SKILL_CATALOG].sort((left, right) => left.skillId.localeCompare(right.skillId));

await mkdir(root, { recursive: true });
for (const skill of entries) {
  const directory = join(root, skill.skillId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), `---
id: ${skill.skillId}
name: ${skill.name}
category: ${skill.category}
scope: ${skill.scope}
requires_permission: ${skill.requiresPermission}
---

# ${skill.name}

${skill.description}

## Rules

- Use this skill only when the incoming message and current thread support it.
- Keep each participant, quoted reply, and permission boundary distinct.
- Do not claim an action happened unless the runtime handler confirms success.
- Fall back to a safe explanation or silence when required input or permission is missing.
`, "utf8");
}
await writeFile(join(root, "index.json"), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
console.log(`Generated ${entries.length} skill files.`);
