# Ascent

The STEPS.md guides, as a climb. Each repo is a mountain, each Part is a camp, each Step is a stretch of the route, and **every line you type by hand is one metre of altitude**. `taskflow-express` is 7,884 m, or 8,799 m with every commit verified: 50 m short of Everest.

```bash
cd ascent
npm install
npm run dev      # opens http://localhost:5199
```

Work with the game in one window and your editor and terminal in another. It tracks; you still do the typing.

## How it works

| In STEPS.md | In the game | Metres |
|---|---|---|
| A code block | **Type it** by hand, then tick it | 1 per line |
| A shell block | **Run it** | 3 |
| What's new | **Read it** | 5 |
| 🧠 DSA & scalability | A sealed **field note**: guess the answer, then open it | 15 |
| ✅ Checkpoint | **Prove it works** | 10 |
| Commit | **Commit** | 5, or 20 if verified in your repo |
| Last task in a step | Step complete | 10 |

- `Enter` ticks the next task and scrolls to the one after it. `Esc` goes back to the route.
- Steps unlock in order. You can read ahead, and if you've already built something you can skip to it. Skipped steps earn nothing and their camps stay unstamped.
- Source code has no copy button, on purpose. Shell commands do.

**Verified commits.** On a route page, link the folder you're rebuilding in. While a step is open, the game watches that repo's `git log` for the step's exact commit message. When it appears, the commit ticks itself and pays the bonus.

**Streaks forgive.** Every 7 days banks a rest day (max 3), spent automatically when you miss one.

## Where things live

- **Content** comes straight from `<app>/<repo>/STEPS.md`, so there's nothing to sync. Edits to a guide show up live. A brand-new STEPS.md turns its uncharted peak climbable after you restart the dev server.
- **Progress** is in `data/progress.json`, written by the dev server. It survives closing the browser, stopping the server and clearing browser data. Each save first copies the previous one to `progress.json.bak`. Delete both to start over.
- `src/lib/parser.ts` turns markdown into steps and tasks. `src/lib/game.ts` holds the rules, and both are pure functions. `src/lib/patches.ts` holds the achievements; add one by adding a rule.

## Keeping STEPS.md parseable

`npm test` runs the parser against every real STEPS.md in the workspace. If a guide drifts from the format in `CLAUDE.md` §7 (`## Part N · `, `### Step N.M · `, `**✅ Checkpoint**`, `**Commit:**`, a `🧠` blockquote), the test says which step broke.

```bash
npm test && npm run typecheck && npm run lint
```
