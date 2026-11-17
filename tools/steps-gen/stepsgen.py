#!/usr/bin/env python3
"""Render a STEPS.md from a template whose code blocks are line ranges of the finished repo,
and replay it to prove the guide rebuilds the repo exactly.

Template directives (each on its own line):

  @show PATH A-B          reveal lines A..B (1-based, inclusive) of the finished file PATH.
                          The block header (new file / continue / add after `x` / add before `x`
                          / add at the top) is derived from which lines are already revealed.
  @show PATH all          reveal the whole file.
  @show PATH A-B | TEXT   same, with a hand-written placement ("add after the CORS registration")
                          where no single line is a unique anchor.
  @chunks PATH A-B|all [MAX]  reveal a range that ends the file so far, split at blank lines into
                          blocks of at most MAX (40) lines.
  @excerpt PATH A-B       show lines without revealing them (generated files).
  @excerpt PATH A-B | TEXT  same, with a placement ("add to pyproject.toml") instead of "excerpt".
  @copy PATH              (replay only) copy a file or folder from the repo, e.g. one created by
                          a command in the guide such as `cp ../openapi.yaml contract/`.
  @link PATH              (replay only) symlink PATH to the repo's copy (node_modules).
  @verify CMD             (replay only) run CMD in the replay folder; non-zero exit fails.
  @include FILE           splice another template file (relative to the template).

Every other line is copied verbatim. Usage:

  stepsgen.py render TEMPLATE REPO OUT.md
  stepsgen.py replay TEMPLATE REPO WORKDIR [--from-part N]
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

LANG = {
    '.ts': 'ts', '.js': 'js', '.mjs': 'js', '.json': 'json', '.yml': 'yaml', '.yaml': 'yaml',
    '.toml': 'toml', '.sql': 'sql', '.md': 'markdown', '.py': 'python', '.java': 'java',
    '.xml': 'xml', '.properties': 'properties', '.sh': 'bash', '.html': 'html', '.css': 'css',
    '.tsx': 'tsx', '.mako': 'mako', '.ini': 'ini',
}
# Files without an extension. Never 'text': Ascent treats text blocks as output to read, not code to type.
NAMED = {
    'Dockerfile': 'dockerfile', '.env.example': 'bash', '.editorconfig': 'ini',
    '.gitignore': 'gitignore', '.prettierignore': 'gitignore', '.dockerignore': 'gitignore',
}


def lang_of(path: str) -> str:
    name = os.path.basename(path)
    if name in NAMED:
        return NAMED[name]
    return LANG.get(os.path.splitext(name)[1], 'text')


def parse_range(spec: str, n: int) -> tuple[int, int]:
    """'all', 'A-B', or 'A-$' (to the end of the file)."""
    if spec == 'all':
        return 1, n
    a, b = spec.split('-')
    return int(a), n if b == '$' else int(b)


def chunk_ranges(lines: list[str], a: int, b: int, limit: int = 40) -> list[str]:
    """Split lines a..b (1-based) into blocks of at most ~limit lines, each new block starting at
    a blank line, so every block after the first reads as "continue" with a leading empty line."""
    out: list[str] = []
    start = a
    while b - start + 1 > limit:
        cut = None
        for i in range(start + limit - 1, start + 4, -1):
            if lines[i - 1].strip() == '':
                cut = i
                break
        if cut is None:
            break
        out.append(f'{start}-{cut - 1}')
        start = cut
    out.append(f'{start}-{b}')
    return out


def expand(template: Path) -> list[tuple[str, int, str]]:
    """Template lines with @include resolved, as (file, line number, text)."""
    out: list[tuple[str, int, str]] = []
    for i, line in enumerate(template.read_text().splitlines(), 1):
        if line.startswith('@include '):
            out.extend(expand(template.parent / line.split(None, 1)[1].strip()))
        else:
            out.append((str(template), i, line))
    return out


@dataclass
class FileState:
    lines: list[str]
    shown: set[int] = field(default_factory=set)

    def present(self) -> list[int]:
        return sorted(self.shown)

    def text(self) -> str:
        return ''.join(self.lines[i] + '\n' for i in self.present())


class Guide:
    def __init__(self, repo: Path):
        self.repo = repo
        self.files: dict[str, FileState] = {}

    def state(self, path: str) -> FileState:
        if path not in self.files:
            full = self.repo / path
            if not full.is_file():
                raise SystemExit(f'no such file in repo: {path}')
            self.files[path] = FileState(full.read_text().split('\n')[:-1]
                                         if full.read_text().endswith('\n')
                                         else full.read_text().split('\n'))
        return self.files[path]

    def show(self, path: str, spec: str, where: str, placement: str | None = None) -> str:
        st = self.state(path)
        n = len(st.lines)
        a, b = parse_range(spec, n)
        if not (1 <= a <= b <= n):
            raise SystemExit(f'{where}: range {spec} outside 1-{n} of {path}')
        rng = set(range(a - 1, b))
        if rng & st.shown:
            dup = min(rng & st.shown) + 1
            raise SystemExit(f'{where}: {path} line {dup} already shown')
        present = st.present()
        if placement:
            if not present:
                raise SystemExit(f'{where}: placement given for a new file')
            how = placement
        elif not present:
            how = 'new file'
        else:
            before = [i for i in present if i < a - 1]
            after = [i for i in present if i > b - 1]
            if not after:
                how = 'continue'
            elif not before:
                how = 'add at the top'
            else:
                prev, nxt = before[-1], after[0]
                texts = [st.lines[i].strip() for i in present]
                pt, nt = st.lines[prev].strip(), st.lines[nxt].strip()
                if pt and texts.count(pt) == 1:
                    how = f'add after `{pt}`'
                elif nt and texts.count(nt) == 1:
                    how = f'add before `{nt}`'
                else:
                    raise SystemExit(f'{where}: no unique anchor around {path} {spec} '
                                     f'(prev {pt!r}, next {nt!r})')
        st.shown |= rng
        body = '\n'.join(st.lines[a - 1:b])
        return f'**`{path}`** · {how}\n\n```{lang_of(path)}\n{body}\n```'

    def excerpt(self, path: str, spec: str, placement: str | None = None) -> str:
        lines = (self.repo / path).read_text().split('\n')
        a, b = map(int, spec.split('-'))
        body = '\n'.join(lines[a - 1:b])
        return f'**`{path}`** · {placement or "excerpt"}\n\n```{lang_of(path)}\n{body}\n```'

    def unfinished(self) -> list[str]:
        problems = []
        for path, st in self.files.items():
            missing = [i + 1 for i in range(len(st.lines)) if i not in st.shown]
            if missing:
                problems.append(f'{path}: {len(missing)} lines never shown, first {missing[:8]}')
        return problems


def resolve_chunks(lines: list[tuple[str, int, str]], repo: Path) -> list[tuple[str, int, str]]:
    out = []
    for src, no, line in lines:
        if line.startswith('@chunks '):
            parts = line.split()
            path, spec = parts[1], parts[2]
            limit = int(parts[3]) if len(parts) > 3 else 40
            text = (repo / path).read_text()
            file_lines = text.split('\n')[:-1] if text.endswith('\n') else text.split('\n')
            a, b = parse_range(spec, len(file_lines))
            for r in chunk_ranges(file_lines, a, b, limit):
                out.append((src, no, f'@show {path} {r}'))
                out.append((src, no, ''))
        else:
            out.append((src, no, line))
    return out


def render(template: Path, repo: Path, out: Path) -> None:
    guide = Guide(repo)
    rendered: list[str] = []
    for src, no, line in resolve_chunks(expand(template), repo):
        where = f'{src}:{no}'
        if line.startswith('@show '):
            head, _, placement = line.partition(' | ')
            _, path, spec = head.split()
            rendered.append(guide.show(path, spec, where, placement or None))
        elif line.startswith('@excerpt '):
            head, _, placement = line.partition(' | ')
            _, path, spec = head.split()
            rendered.append(guide.excerpt(path, spec, placement or None))
        elif line.startswith(('@copy ', '@verify ', '@link ')):
            continue
        else:
            rendered.append(line)
    problems = guide.unfinished()
    if problems and not os.environ.get('STEPS_PARTIAL'):
        raise SystemExit('incomplete guide:\n  ' + '\n  '.join(problems))
    text = '\n'.join(rendered)
    text = re.sub(r'\n{3,}', '\n\n', text).strip() + '\n'
    out.write_text(text)
    print(f'wrote {out} ({text.count(chr(10))} lines, {len(guide.files)} files)')


def replay(template: Path, repo: Path, work: Path, from_part: int) -> None:
    guide = Guide(repo)
    if work.exists():
        for child in work.iterdir():
            if child.name != 'node_modules' and child.name != '.venv':
                shutil.rmtree(child) if child.is_dir() else child.unlink()
    work.mkdir(parents=True, exist_ok=True)
    part = -1
    for src, no, line in resolve_chunks(expand(template), repo):
        where = f'{src}:{no}'
        m = re.match(r'## Part (\d+) ', line)
        if m:
            part = int(m.group(1))
        if line.startswith('@show '):
            head, _, placement = line.partition(' | ')
            _, path, spec = head.split()
            guide.show(path, spec, where, placement or None)
            target = work / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(guide.files[path].text())
        elif line.startswith('@copy '):
            path = line.split(None, 1)[1].strip()
            dst = work / path
            dst.parent.mkdir(parents=True, exist_ok=True)
            if (repo / path).is_dir():
                shutil.copytree(repo / path, dst, dirs_exist_ok=True)
            else:
                shutil.copy2(repo / path, dst)
        elif line.startswith('@link '):
            path = line.split(None, 1)[1].strip()
            if not (work / path).exists():
                (work / path).symlink_to(repo / path)
        elif line.startswith('@verify '):
            if part < from_part:
                continue
            cmd = line.split(None, 1)[1]
            print(f'── Part {part} · {where}: {cmd}', flush=True)
            result = subprocess.run(cmd, shell=True, cwd=work, text=True,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            tail = '\n'.join(result.stdout.strip().splitlines()[-12:])
            print('   ' + tail.replace('\n', '\n   '))
            if result.returncode != 0:
                raise SystemExit(f'FAILED at {where}: {cmd}')
    problems = guide.unfinished()
    if problems and not os.environ.get('STEPS_PARTIAL'):
        raise SystemExit('incomplete guide:\n  ' + '\n  '.join(problems))
    for path, st in guide.files.items():
        if os.environ.get('STEPS_PARTIAL'):
            break
        if (work / path).read_text() != (repo / path).read_text():
            raise SystemExit(f'replayed {path} differs from the repo')
    print(f'replay OK: {len(guide.files)} files identical to the repo')


if __name__ == '__main__':
    cmd, *args = sys.argv[1:]
    if cmd == 'render':
        render(Path(args[0]), Path(args[1]), Path(args[2]))
    elif cmd == 'replay':
        start = int(args[args.index('--from-part') + 1]) if '--from-part' in args else 0
        replay(Path(args[0]), Path(args[1]).resolve(), Path(args[2]).resolve(), start)
    else:
        raise SystemExit(__doc__)
