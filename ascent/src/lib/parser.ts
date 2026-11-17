/** Turns a STEPS.md into a playable quest. Pure, so it can be tested against the real files. */

export type CodeBlock = {
  kind: 'code';
  key: string;
  task: 'type' | 'run';
  lang: string;
  code: string;
  path?: string;
  action?: string;
  lines: number;
};
export type ReadBlock = { kind: 'read'; key: string; title: string; md: string };
export type NoteBlock = { kind: 'note'; key: string; title: string; md: string };
export type CheckBlock = { kind: 'check'; key: string; md: string };
export type CommitBlock = { kind: 'commit'; key: string; message: string; command: string };
export type TaskBlock = CodeBlock | ReadBlock | NoteBlock | CheckBlock | CommitBlock;
export type ProseBlock = { kind: 'prose'; md: string };
export type Block = ProseBlock | TaskBlock;

export type Step = {
  id: string;
  partNumber: number;
  title: string;
  goal: string;
  files: string;
  blocks: Block[];
  tasks: TaskBlock[];
  commitNote?: string;
};
export type Part = { number: number; title: string; intro: string; steps: Step[] };
export type ParsedSteps = { title: string; briefing: string; parts: Part[]; steps: Step[] };

type Token =
  | { type: 'line'; text: string }
  | { type: 'fence'; lang: string; code: string; raw: string[]; indented: boolean };

const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'console']);
const DISPLAY_LANGS = new Set(['', 'text', 'mermaid']);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const open = /^(\s*)(`{3,})(.*)$/.exec(line);
    if (!open) {
      tokens.push({ type: 'line', text: line });
      continue;
    }
    const fence = open[2] as string;
    const raw = [line];
    const body: string[] = [];
    for (i++; i < lines.length; i++) {
      const current = lines[i] as string;
      raw.push(current);
      const trimmed = current.trim();
      if (trimmed.startsWith(fence) && trimmed.replaceAll('`', '') === '') break;
      body.push(current);
    }
    tokens.push({
      type: 'fence',
      lang: (open[3] as string).trim().split(/\s+/)[0] ?? '',
      code: body.join('\n'),
      raw,
      indented: (open[1] as string).length > 0,
    });
  }
  return tokens;
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function parseLabel(line: string): { path: string; action: string } | null {
  const bold = /^\*\*`([^`]+)`\*\*\s*·\s*(.+)$/.exec(line);
  if (bold) return { path: bold[1] as string, action: bold[2] as string };
  const plain = /^`([^`]+)`\s*·\s*(.+)$/.exec(line);
  if (plain) return { path: plain[1] as string, action: plain[2] as string };
  const created = /^\*\*New file\*\*\s*`([^`]+)`/.exec(line);
  if (created) return { path: created[1] as string, action: 'new file' };
  return null;
}

const isListLine = (line: string) => /^\s*([-*+]|\d+\.)\s/.test(line) || /^\s+\S/.test(line);

function parseStepBody(id: string, partNumber: number, title: string, tokens: Token[]): Step {
  const step: Step = { id, partNumber, title, goal: '', files: '', blocks: [], tasks: [] };
  const seen = new Map<string, number>();
  const key = (kind: string, content: string) => {
    const base = `${kind}-${hash(content)}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };

  let prose: string[] = [];
  const flushProse = () => {
    const md = prose.join('\n').trim();
    if (md) step.blocks.push({ kind: 'prose', md });
    prose = [];
  };
  const pushTask = (block: TaskBlock) => {
    flushProse();
    step.blocks.push(block);
    step.tasks.push(block);
  };

  let mode: 'prose' | 'read' | 'check' = 'prose';
  let section: string[] = [];
  let readTitle = '';
  let sawList = false;
  const closeSection = () => {
    const md = section.join('\n').trim();
    if (mode === 'read') pushTask({ kind: 'read', key: key('read', md), title: readTitle, md });
    if (mode === 'check') pushTask({ kind: 'check', key: key('check', md), md });
    section = [];
    mode = 'prose';
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as Token;

    if (token.type === 'line') {
      const line = token.text;

      if (line.startsWith('**Commit:**')) {
        closeSection();
        const rest = line.slice('**Commit:**'.length).trim();
        const inline = /^`([^`]+)`/.exec(rest);
        if (inline) {
          const message = inline[1] as string;
          const command = `git add -A && git commit -m "${message}"`;
          pushTask({ kind: 'commit', key: key('commit', message), message, command });
        } else if (rest) {
          step.commitNote = rest;
        } else {
          const next = tokens.slice(i + 1).find((t) => t.type === 'fence' || t.text.trim());
          if (next?.type === 'fence') {
            const message = /git commit -m "([^"]+)"/.exec(next.code)?.[1];
            if (message) {
              pushTask({ kind: 'commit', key: key('commit', message), message, command: next.code });
              i = tokens.indexOf(next);
            }
          }
        }
        continue;
      }

      if (mode === 'check') {
        section.push(line);
        continue;
      }

      if (line.startsWith('**✅ Checkpoint')) {
        closeSection();
        flushProse();
        mode = 'check';
        continue;
      }

      if (/^>\s*(\*\*)?🧠/.test(line)) {
        closeSection();
        const quoted = [line];
        while ((tokens[i + 1] as Token | undefined)?.type === 'line') {
          const next = (tokens[i + 1] as { text: string }).text;
          if (!next.startsWith('>')) break;
          quoted.push(next);
          i++;
        }
        const body = quoted.slice(1).map((l) => l.replace(/^>\s?/, ''));
        const noteTitle = /·\s*(.+?)\*{0,2}\s*$/.exec(line)?.[1] ?? 'DSA & scalability';
        const md = body.join('\n').trim();
        pushTask({ kind: 'note', key: key('note', md), title: noteTitle, md });
        continue;
      }

      const whatsNew = /^\*\*(What's new[^*]*)\*\*\s*$/.exec(line);
      if (whatsNew) {
        closeSection();
        flushProse();
        mode = 'read';
        readTitle = whatsNew[1] as string;
        sawList = false;
        continue;
      }

      if (mode === 'read') {
        const previous = section.at(-1) ?? '';
        const endsSection =
          parseLabel(line) !== null ||
          (line.trim() !== '' && !isListLine(line) && previous.trim() === '' && sawList);
        if (!endsSection) {
          if (isListLine(line)) sawList = true;
          section.push(line);
          continue;
        }
        closeSection();
      }

      if (line.startsWith('**Goal:**')) {
        step.goal = line.slice('**Goal:**'.length).trim();
        continue;
      }
      if (line.startsWith('**Files:**')) {
        step.files = line.slice('**Files:**'.length).trim();
        continue;
      }
      prose.push(line);
      continue;
    }

    if (mode !== 'prose') {
      section.push(...token.raw);
      continue;
    }

    const isDisplayOnly = token.indented || DISPLAY_LANGS.has(token.lang);
    if (isDisplayOnly) {
      prose.push(...token.raw);
      continue;
    }

    let label: { path: string; action: string } | null = null;
    let labelIndex = prose.length - 1;
    while (labelIndex >= 0 && (prose[labelIndex] as string).trim() === '') labelIndex--;
    if (labelIndex >= 0) label = parseLabel(prose[labelIndex] as string);

    // An excerpt shows code that already exists: there's nothing to type, so it stays prose.
    if (label?.action.includes('excerpt')) {
      prose.push(...token.raw);
      continue;
    }
    if (label) prose = prose.slice(0, labelIndex);

    // A block under a file label is a file to type, even when it's shell (`.env.example`, a script).
    const isCommand = SHELL_LANGS.has(token.lang) && !label;
    pushTask({
      kind: 'code',
      key: key('code', token.code),
      task: isCommand ? 'run' : 'type',
      lang: token.lang,
      code: token.code,
      lines: token.code.split('\n').filter((l) => l.trim()).length,
      ...(label ? { path: label.path, action: label.action.replaceAll('**', '') } : {}),
    });
  }
  closeSection();
  flushProse();

  if (step.tasks.length === 0) {
    pushTask({ kind: 'read', key: key('read', title), title: 'Work through this step', md: '' });
  }
  return step;
}

export function parseSteps(source: string): ParsedSteps {
  const tokens = tokenize(source);
  const result: ParsedSteps = { title: '', briefing: '', parts: [], steps: [] };

  const briefing: string[] = [];
  let part: Part | null = null;
  let stepHead: { id: string; title: string } | null = null;
  let stepTokens: Token[] = [];
  const partIntro: string[] = [];

  const closeStep = () => {
    if (!stepHead || !part) return;
    const step = parseStepBody(stepHead.id, part.number, stepHead.title, stepTokens);
    part.steps.push(step);
    result.steps.push(step);
    stepHead = null;
    stepTokens = [];
  };
  const closePartIntro = () => {
    if (part && !part.intro) part.intro = partIntro.join('\n').trim();
    partIntro.length = 0;
  };

  for (const token of tokens) {
    if (token.type === 'line') {
      const title = /^# (.+)$/.exec(token.text);
      if (title && !result.title) {
        result.title = (title[1] as string).replaceAll('`', '');
        continue;
      }
      const partHead = /^## Part (\d+) · (.+)$/.exec(token.text);
      if (partHead) {
        closeStep();
        closePartIntro();
        part = { number: Number(partHead[1]), title: partHead[2] as string, intro: '', steps: [] };
        result.parts.push(part);
        continue;
      }
      const stepMatch = /^### Step (\d+\.\d+) · (.+)$/.exec(token.text);
      if (stepMatch) {
        closeStep();
        closePartIntro();
        stepHead = { id: stepMatch[1] as string, title: (stepMatch[2] as string).trim() };
        continue;
      }
    }
    if (stepHead) stepTokens.push(token);
    else {
      const raw = token.type === 'line' ? [token.text] : token.raw;
      if (part) partIntro.push(...raw);
      else briefing.push(...raw);
    }
  }
  closeStep();
  closePartIntro();
  result.briefing = briefing.join('\n').trim();
  return result;
}
