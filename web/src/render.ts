/**
 * Markdown + maths rendering.
 * 1. Pull out code and maths so Markdown doesn't mangle them.
 * 2. Render Markdown and sanitise it with DOMPurify.
 * 3. Put rendered KaTeX (generated locally, trust disabled) back in place of the maths.
 */
import DOMPurify from "dompurify";
import katex from "katex";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

const TOKEN =
  /(```[\s\S]*?(?:```|$)|`[^`\n]+`)|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\d$])/g;

export function renderMarkdown(src: string, inline = false): string {
  const maths: string[] = [];
  const protectedSrc = src.replace(TOKEN, (match, code, dbl, brk, paren, inline) => {
    if (code) return code;
    const display = Boolean(dbl ?? brk);
    const tex = (dbl ?? brk ?? paren ?? inline ?? "").trim();
    let html: string;
    try {
      html = katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false, output: "htmlAndMathml" });
    } catch {
      html = match.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
    }
    maths.push(html);
    return `KATEXPLACEHOLDER${maths.length - 1}END`;
  });
  const parsed = inline ? marked.parseInline(protectedSrc, { async: false }) : marked.parse(protectedSrc, { async: false });
  const html = DOMPurify.sanitize(parsed as string, {
    USE_PROFILES: { html: true },
  });
  return html.replace(/KATEXPLACEHOLDER(\d+)END/g, (_, i) => DOMPurify.sanitize(maths[Number(i)], {
    USE_PROFILES: { html: true, mathMl: true },
  }));
}

/** Find and remove the machine-readable score line the tutor adds after marking. */
export function extractScore(text: string): { text: string; score?: { got: number; max: number } } {
  const re = /\[\[\s*SCORE:\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*\]\]/i;
  const m = text.match(re);
  const clean = text.replace(/\n?\[\[\s*SCORE:[^\]]*\]\]\s*/gi, "").trimEnd();
  if (!m) return { text: clean };
  const got = Number(m[1]);
  const max = Number(m[2]);
  return max > 0 && got >= 0 && got <= max ? { text: clean, score: { got, max } } : { text: clean };
}
