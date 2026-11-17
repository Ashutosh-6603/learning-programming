import { Check, Copy } from 'lucide-react';
import {
  isValidElement,
  lazy,
  memo,
  Suspense,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const Mermaid = lazy(() => import('./Mermaid'));

declare const __WORKSPACE_ROOT__: string;

const highlighted = new Map<string, string>();

async function highlight(code: string, lang: string): Promise<string> {
  const id = `${lang}\0${code}`;
  const cached = highlighted.get(id);
  if (cached) return cached;
  const { codeToHtml } = await import('shiki');
  const theme = 'vitesse-dark';
  const html = await codeToHtml(code, { lang, theme }).catch(() =>
    codeToHtml(code, { lang: 'text', theme }),
  );
  highlighted.set(id, html);
  return html;
}

/**
 * Only shell commands get a copy button. Source code doesn't, on purpose: rebuilding by hand is
 * the entire point of these guides, so copying should take effort.
 */
export const CodeView = memo(function CodeView({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const isShell = ['bash', 'sh', 'shell', 'console'].includes(lang);

  useEffect(() => {
    let live = true;
    void highlight(code, lang || 'text').then((result) => {
      if (live) setHtml(result);
    });
    return () => {
      live = false;
    };
  }, [code, lang]);

  return (
    <div className="code-surface group relative rounded-lg bg-[#0d141c]">
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre>
          <code>{code}</code>
        </pre>
      )}
      {isShell && (
        <button
          type="button"
          aria-label="Copy command"
          onClick={(event) => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
            event.currentTarget.blur();
          }}
          className="absolute top-2 right-2 rounded-md bg-panel-2 p-1.5 text-mist hover:text-snow"
        >
          {copied ? <Check className="size-3.5 text-pine" /> : <Copy className="size-3.5" />}
        </button>
      )}
    </div>
  );
});

function textOf(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

export const Markdown = memo(function Markdown({ md, basePath }: { md: string; basePath?: string }) {
  const components: Components = {
    pre: ({ children }) => {
      const child = (Array.isArray(children) ? children[0] : children) as ReactElement<{
        className?: string;
        children?: ReactNode;
      }>;
      const lang = /language-(\S+)/.exec(child.props.className ?? '')?.[1] ?? '';
      const code = textOf(child.props.children).replace(/\n$/, '');
      if (lang === 'mermaid') {
        return (
          <Suspense fallback={<div className="h-40 rounded-lg bg-panel" />}>
            <Mermaid chart={code} />
          </Suspense>
        );
      }
      return <CodeView code={code} lang={lang} />;
    },
    a: ({ href = '', children }) => {
      if (/^https?:/.test(href)) {
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      }
      // Paths in a guide are relative to its repo: open them in the editor.
      if (basePath && !href.startsWith('#')) {
        const target = new URL(href, `file:///${basePath}/`).pathname;
        return <a href={`vscode://file${__WORKSPACE_ROOT__}${target}`}>{children}</a>;
      }
      return <span className="underline decoration-dotted">{children}</span>;
    },
  };

  return (
    <div className="prose-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {md}
      </ReactMarkdown>
    </div>
  );
});

/** A one-line label from the guide, where `backticks` mean code. */
export function InlineCode({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className="rounded bg-panel-2 px-1 font-mono text-[0.92em]">
            {part}
          </code>
        ) : (
          part.replaceAll('**', '')
        ),
      )}
    </>
  );
}
