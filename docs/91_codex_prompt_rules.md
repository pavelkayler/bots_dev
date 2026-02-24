# 91 Codex prompt rules (for this repo)

Last update: 2026-02-25

When the user says “Давай промт”, produce ONE prompt for Codex that:
- is written in English
- references the connected repository (do not mention any archives)
- lists:
  - goal
  - exact files to change
  - minimal diffs required
  - verification steps (`npm run build`, manual checks)
  - a “detailed report” requirement

Do NOT:
- refactor unrelated code
- add features not requested
- change architecture
- add comments containing `@`
