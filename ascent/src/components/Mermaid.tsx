import mermaid from 'mermaid';
import { useEffect, useId, useState } from 'react';

mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });

export default function Mermaid({ chart }: { chart: string }) {
  const id = `m${useId().replaceAll(/[^a-zA-Z0-9]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void mermaid.render(id, chart).then(
      (result) => {
        if (live) setSvg(result.svg);
      },
      () => {
        if (live) setSvg('');
      },
    );
    return () => {
      live = false;
    };
  }, [chart, id]);

  if (svg === null) return <div className="h-40 rounded-lg bg-panel" />;
  if (svg === '') return <pre className="overflow-x-auto text-sm text-mist">{chart}</pre>;
  return (
    <div
      className="overflow-x-auto rounded-lg bg-panel p-3 [&_svg]:mx-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
