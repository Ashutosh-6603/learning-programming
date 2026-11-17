---
name: finish-repo
description: Checklist for finishing one of the 27 learning repos once its code works - default-user seed, the STEPS.md template and replay, real checkpoint outputs, contract/Docker/CI/E2E checks, docs, Ascent update and play-test, memory. Use whenever a repo's code is built (or nearly) and before stopping for the user's review.
---

# Finish a repo

CLAUDE.md is the rulebook; this is the order of work and the traps already found. Paths are relative to the workspace root `learning-programming/`. `<repo>` = folder name (e.g. `taskflow-fastapi`), `<app>` = `taskflow` / `pulse` / `cartly`, `SS` = the repo's port slot.

## 0. Before anything

- Back up the user's game save: `cp ascent/data/progress.json <scratchpad>/progress.json.$(date +%s)`. Never write to it.
- See which routes the user has started (never renumber steps in those):
  `node -e "const p=require('./ascent/data/progress.json');console.log(Object.keys(p.steps))"`
- Docker containers stop when the machine restarts: `docker compose up -d --wait` in the repo before any test.

## 1. The code is really done

- Every check green: format, lint, type check, all tests, migration drift check, production build.
- The **default user seed** exists (CLAUDE.md §6): idempotent function next to the users code, runner that refuses production, one integration test, `README` quick start shows `ashutosh@test.com` / `Ashutosh#1234`. Run it twice: `created`, then `exists`.
- No dead config: try removing anything that looks unused (an ESLint override, an exclude) and see if the checks still pass. Delete it if they do.

## 2. Design for the guide (insertion-only)

The guide reveals line ranges of the *finished* files in order, so every intermediate file must be a subsequence of the final one and must compile at its checkpoint.

- **Mirror the previous backend's Part/Step numbering exactly** (`grep -hE '^(## Part|### Step)' tools/steps-gen/templates/taskflow-nestjs/*.md`). Part 4 ends with Step 4.9 · Seed the default user.
- **One import line naming things from two Parts breaks insertion.** Fix the code (move a registration into the module/file that owns it, split by responsibility), or check only the type checker at the intermediate steps and say "ESLint reports X as unused until Step N.M" in the guide.
- Lines added later to a decorator/annotation stack, a list or an import block are fine; a line that changes is not.
- Generated files (migrations) are `@copy`'d. Give the CLI flags that make the user's output match (TypeORM `-t <timestamp>`), and diff a dry-run generation against the committed file to list the exact hand edits.

## 3. Write the template

`tools/steps-gen/templates/<repo>/` (format in `tools/steps-gen/README.md`): `00-header.md`, one file per Part or two, `STEPS.tmpl.md` that `@include`s them. Per step: Goal, Files, code via `@show`/`@chunks`, What's new (bridge from TypeScript, explain framework magic), a `> **🧠 DSA & scalability · title**` box for non-trivial features, ✅ Checkpoint with real expected output, `@verify` lines, Commit.

Replay Part by Part while writing (fast feedback, finds ordering bugs immediately):

```bash
cd tools/steps-gen
printf '@include 00-header.md\n@include 01-part0-2.md\n' > templates/<repo>/_partial.md
STEPS_PARTIAL=1 python3 stepsgen.py replay templates/<repo>/_partial.md ../../<app>/<repo> <scratch>/replay --from-part N
rm templates/<repo>/_partial.md          # when done; never leave it behind
```

`@verify` commands by stack: Node `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`; Python `uv run mypy .`, `uv run ruff check .`, `uv run pytest`; Java `./mvnw -q compile`, `./mvnw -q test`. Test counts in "Expected:" must match what the replay prints.

## 4. Real outputs, not guesses

Run each checkpoint's command for real and paste the output. To run a server and probe it, put the commands in a script file and `kill $PID` at the end (`pkill -f "<cmd>"` from the Bash tool matches its own shell and kills it):

```bash
node dist/main.js > <scratch>/api.log 2>&1 &   # or uv run …, ./mvnw …
PID=$!; sleep 5; curl -s -m 5 localhost:80SS/health/ready; kill $PID
```

Collect: health/404/405 outputs, auth curl, seed output, contract test summary, Docker `id` and image size, compose `ps`, worker log lines, CORS preflight, actionlint.

- Contract test: start the API with `RATE_LIMIT_AUTH_PER_MINUTE=100000 RATE_LIMIT_API_PER_MINUTE=100000`, register a user for a token, `uvx schemathesis run contract/openapi.yaml --url http://localhost:80SS -H "Authorization: Bearer $TOKEN"`.
- `docker build -t <repo> . && docker run --rm <repo> id`; `docker compose --profile app up -d --build --wait`.
- `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest .github/workflows/*.yml`
  (pass the files: without a `.git`, actionlint refuses with "no project was found")
- Docker images with a healthcheck: bring them up with `--wait` and confirm `Healthy`. A page that serves isn't enough: Alpine resolves `localhost` to `::1` first, so healthchecks call `127.0.0.1` (found in both frontends, 2026-11-15).
- Frontend E2E against this backend (natively, no sudo): restart the API with raised rate limits via an override file, then from the matching frontend repo:
  `eval "$(bash .claude/skills/finish-repo/scripts/chromium-libs.sh <scratch>)"; VITE_API_URL=http://localhost:80SS npx playwright test`
  (passing `VITE_API_URL` in the environment avoids editing the user's `.env`).

## 5. Full replay, coverage, render

```bash
python3 stepsgen.py replay templates/<repo>/STEPS.tmpl.md ../../<app>/<repo> <scratch>/replay   # must end "N files identical"
# every repo file must come from the guide; only README.md and the lockfile may be missing:
comm -23 <(cd ../../<app>/<repo> && find . -type f -not -path './node_modules/*' -not -path './dist/*' -not -path './.venv/*' -not -path './target/*' -not -path './coverage/*' | sort) \
         <(cd <scratch>/replay && find . -type f -not -path './node_modules/*' -not -path './dist/*' | sort)
python3 stepsgen.py render templates/<repo>/STEPS.tmpl.md ../../<app>/<repo> ../../<app>/<repo>/STEPS.md
```

Files without an extension need a fence language in `stepsgen.py` `NAMED` (never `text`: Ascent treats `text` fences as output to read, so the user gets no "type it" task). Add new ones there.

## 6. Docs

- `<app>/README.md`: repo index row (✅ built · STEPS link), library table column.
- `CLAUDE.md` + `PLAN.md`: every decision that differs from the stack table (keep both in sync).
- The repo's `README.md`: quick start with `db:seed` and the default login, scripts table, known notes for each decision.
- New concept? Extend `docs/` instead of repeating it in every guide.

## 7. Ascent

```bash
cd ascent && npm test && npm run typecheck && npm run lint
```

- A new repo label goes in `PEAKS` / `RANGES` in `src/lib/quests.ts`. Add patches in `src/lib/patches.ts` for real new skills only, each with a test in `src/lib/game.test.ts` (copy the `skill-di` test's shape).
- Play-test on your own server with a throwaway save, and a linked scratch git repo holding Step 0.1's exact commit message (to prove verified commits):

```bash
mkdir -p <scratch>/save <scratch>/rebuild && git -C <scratch>/rebuild init -q -b main
git -C <scratch>/rebuild -c user.email=t@t -c user.name=t commit -q --allow-empty -m "<Step 0.1 commit message>"
cd ascent && ASCENT_DATA_DIR=<scratch>/save node_modules/.bin/vite --port 5300 --strictPort   # background
eval "$(bash ../.claude/skills/finish-repo/scripts/chromium-libs.sh <scratch>)"
node ../.claude/skills/finish-repo/scripts/ascent-play.mjs <repo> <scratch>/rebuild <scratch> 0.1 0.2 0.3 0.4 0.5
```

  Expect: route step count right, every box `=true`, no page errors; then check `<scratch>/save/progress.json` for `verified: true` on 0.1's commit and the Part 0 camp. Look at the screenshots. Stop the server afterwards.
- Stop your Ascent server with TaskStop, never `pkill -f` from the Bash tool (it matches its own shell and kills the command before later parts, like clearing the test save, run). Re-running `ascent-play.mjs` needs a fresh save: it expects the repo link field, which hides once linked.
- Frontends: the guide is a steps-gen template too (`templates/taskflow-frontend-python/`). Design files insertion-only: no temporary files (preview UI on the dev-only `/kit` route), and wrap lines that later gain providers. Frontend `@verify`: `npx tsc -b --noEmit && npx eslint . [&& npx vitest run]`.
- Never touch port 5199 or `ascent/data/`. Confirm `ascent/data/progress.json`'s timestamp is unchanged at the end.

## 8. Wrap up

- **Leave the default user in the repo's dev database** (the user's request, 2026-11-13): after all tests and the contract run, run the migrations and the seed once more against the dev DB (`taskflow`, not `taskflow_test`) and confirm with `docker exec <repo>-postgres-1 psql -U taskflow -d taskflow -Atc "select email from users where email='ashutosh@test.com'"`. The user tests the finished repo through the frontend straight away and only runs the seed themselves when rebuilding by hand (Step 4.9 stays in the guide). Never `docker compose down -v` at the end.
- Stop what you started (Ascent server, app containers: `docker compose --profile app rm -sf api worker migrate`), leave the infra up.
- Update memory (`taskflow-progress` and friends): what's done, what awaits review, new lessons.
- Report to the user: what was done, every check with its real result, decisions made, anything not verified. Then stop for review.
