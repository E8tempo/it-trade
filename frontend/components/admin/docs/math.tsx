import katex from "katex";

// Rendered on the server: the page gets ready HTML + MathML, no KaTeX JavaScript in the browser.
function render(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, { displayMode, throwOnError: false, output: "htmlAndMathml", strict: "ignore" });
}

/** Inline formula: <Tex>{String.raw`\alpha`}</Tex> */
export function Tex({ children }: { children: string }) {
  return <span dangerouslySetInnerHTML={{ __html: render(children, false) }} />;
}

/** Display formula on its own line, scrolls horizontally on narrow screens. */
export function TexBlock({ children }: { children: string }) {
  return <div className="my-5 overflow-x-auto overflow-y-hidden py-1" dangerouslySetInnerHTML={{ __html: render(children, true) }} />;
}
