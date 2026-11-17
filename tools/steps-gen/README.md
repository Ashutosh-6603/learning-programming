# steps-gen

Renders a repo's `STEPS.md` from a template, and **replays** it to prove the guide rebuilds the repo exactly. Not one of the 27 repos; a workspace tool like `ascent/`.

## Why

A STEPS.md must match the finished code byte for byte (CLAUDE.md §7). Copying code into prose by hand drifts. Here the template refers to **line ranges of the finished files**, so code blocks can't be mistyped, and the replay proves that following the guide in order produces the repo, with every checkpoint compiling and passing.

## Template format

Markdown, plus directives on their own lines:

| Directive | Meaning |
|---|---|
| `@show PATH A-B` | Reveal lines A..B of the finished file (`all`, or `A-$` to the end). The header (new file / continue / add after `x` / add before `x` / add at the top) is derived from which lines are already revealed. |
| `@show PATH A-B \| TEXT` | Same, with a hand-written placement where no line is a unique anchor. |
| `@chunks PATH A-B [MAX]` | Reveal a range that ends the file so far, split at blank lines into blocks of ≤ MAX (40) lines. |
| `@excerpt PATH A-B` | Show lines of a generated file without revealing them. |
| `@excerpt PATH A-B \| TEXT` | Same, with a placement instead of "excerpt" (sections of a file a command creates, e.g. `pyproject.toml`). |
| `@copy PATH` / `@link PATH` | Replay only: copy a file the guide creates with a command, or symlink (`node_modules`). |
| `@verify CMD` | Replay only: run CMD in the replay folder at this point; non-zero fails. |
| `@include FILE` | Splice another template file. |

Rules that keep it sound: files only grow by insertion (an intermediate state is always a subsequence of the final file), and every line must be revealed exactly once.

## Commands

```bash
python3 stepsgen.py render templates/<repo>/STEPS.tmpl.md ../../<app>/<repo> ../../<app>/<repo>/STEPS.md
python3 stepsgen.py replay templates/<repo>/STEPS.tmpl.md ../../<app>/<repo> /tmp/replay [--from-part N]
STEPS_PARTIAL=1 python3 stepsgen.py render …   # while a template is unfinished
```

Replay needs the repo's infrastructure running (`docker compose up -d` in the repo) when `@verify` runs tests.
