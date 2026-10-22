import { Fragment, memo, type ReactNode } from "react";

import type { MdBlock } from "@/lib/md-blocks";

/**
 * Markdown links are authored in imported files, which are untrusted, so the scheme is
 * restricted. Anything with an explicit scheme other than http(s)/mailto/tel (for example
 * `javascript:` or `data:`) collapses to a harmless anchor instead of becoming executable.
 */
function safeHref(raw: string | undefined): string {
  const href = (raw || "").trim();
  if (!href) return "#";
  if (/^(https?:|mailto:|tel:)/i.test(href)) return href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return "#";
  return href;
}

/** Render a small subset of inline Markdown as React nodes. */
function inline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]*\)|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) nodes.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) nodes.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const mm = tok.match(/^\[([^\]]+)\]\(([^)]*)\)$/);
      nodes.push(
        <a key={key} href={safeHref(mm?.[2])} target="_blank" rel="noopener noreferrer">
          {mm?.[1]}
        </a>,
      );
    } else nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export const MarkdownRead = memo(function MarkdownRead({
  blocks,
  speakingRange,
  onSelect,
}: {
  blocks: MdBlock[];
  speakingRange?: { l: number; le: number } | null;
  onSelect?: (text: string) => void;
}) {
  const speaking = (b: MdBlock) => !!speakingRange && b.line >= speakingRange.l && b.line <= speakingRange.le;

  const cls = (b: MdBlock, extra = "") => `md-b${extra ? " " + extra : ""}${speaking(b) ? " speaking" : ""}`;

  return (
    <article
      className="md"
      onMouseUp={() => {
        const sel = window.getSelection()?.toString().trim();
        if (sel && sel.length > 2) onSelect?.(sel);
      }}
    >
      {blocks.map((b, i) => {
        const key = `${b.kind}-${b.line}-${i}`;
        switch (b.kind) {
          case "h": {
            const Tag = `h${Math.min(6, b.level)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
            return (
              <div className={cls(b)} data-l={b.line} key={key}>
                <Tag>{inline(b.text, key)}</Tag>
              </div>
            );
          }
          case "p":
            return (
              <div className={cls(b)} data-l={b.line} key={key}>
                <p>{inline(b.text, key)}</p>
              </div>
            );
          case "ul":
            return (
              <div className={cls(b)} data-l={b.line} key={key}>
                <ul>
                  {b.items.map((it, k) => (
                    <li key={k}>{inline(it, `${key}-${k}`)}</li>
                  ))}
                </ul>
              </div>
            );
          case "ol":
            return (
              <div className={cls(b)} data-l={b.line} key={key}>
                <ol>
                  {b.items.map((it, k) => (
                    <li key={k}>{inline(it, `${key}-${k}`)}</li>
                  ))}
                </ol>
              </div>
            );
          case "quote":
            return (
              <div className={cls(b, "md-note")} data-l={b.line} key={key}>
                <blockquote>{inline(b.text, key)}</blockquote>
              </div>
            );
          case "hr":
            return (
              <div className={cls(b)} data-l={b.line} key={key}>
                <hr />
              </div>
            );
          case "code":
            return (
              <div className={cls(b)} data-l={b.line} key={key}>
                <pre className="md-code">
                  <code>{b.text}</code>
                </pre>
              </div>
            );
          case "front":
            return (
              <div className={cls(b)} data-l={b.line} key={key}>
                <dl className="md-front">
                  {b.pairs.map(([k, v], n) => (
                    <Fragment key={n}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </Fragment>
                  ))}
                </dl>
              </div>
            );
          case "table":
            return (
              <div className={cls(b)} data-l={b.line} key={key}>
                <table>
                  <thead>
                    <tr>
                      {b.head.map((h, n) => (
                        <th key={n}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, ri) => (
                      <tr key={ri}>
                        {r.map((c, ci) => (
                          <td key={ci}>{c}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </article>
  );
});
