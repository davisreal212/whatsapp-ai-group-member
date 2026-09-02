# Skill Library

This directory contains the bot's explicit skill contracts. Every skill has its own `SKILL.md` file, and the catalog currently contains more than 100 entries.

Add or edit a catalog entry in `src/skill-catalog.ts`, then run `npm run skills:sync`. The generated files are committed with the application so the deployed bot and its maintainers share the same skill library.

The model may select from these documented capabilities, but it must not invent a skill, permission, tool, or completed action. Runtime handlers remain in `src/` and action validation remains outside model-generated text.
