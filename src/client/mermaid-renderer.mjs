import mermaid from "mermaid";

export const MERMAID_MAX_SOURCE_LENGTH = 100_000;

let diagramCounter = 0;
let renderQueue = Promise.resolve();

export function mermaidConfiguration(theme = "light") {
  const dark = String(theme).toLowerCase() === "dark";
  const palette = dark
    ? {
        background: "#191b1e",
        border: "#3a3e45",
        text: "#eef0f3",
        muted: "#a4abb5",
        primary: "#26292e",
        secondary: "#1e2f4c",
        tertiary: "#37271d",
      }
    : {
        background: "#ffffff",
        border: "#dee2e8",
        text: "#1e232b",
        muted: "#66707e",
        primary: "#f7f9fc",
        secondary: "#ebf2ff",
        tertiary: "#fff7ed",
      };

  return {
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    maxTextSize: MERMAID_MAX_SOURCE_LENGTH,
    theme: "base",
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    flowchart: {
      curve: "basis",
      htmlLabels: true,
      nodeSpacing: 34,
      rankSpacing: 52,
      useMaxWidth: true,
    },
    sequence: {
      useMaxWidth: true,
    },
    themeVariables: {
      background: palette.background,
      primaryColor: palette.primary,
      primaryTextColor: palette.text,
      primaryBorderColor: palette.border,
      secondaryColor: palette.secondary,
      tertiaryColor: palette.tertiary,
      lineColor: palette.muted,
      textColor: palette.text,
      titleColor: palette.text,
      mainBkg: palette.primary,
      nodeBorder: palette.border,
      clusterBkg: palette.background,
      clusterBorder: palette.border,
      edgeLabelBackground: palette.background,
      fontSize: "14px",
    },
  };
}

export function renderMermaidDiagram(source, { theme = "light" } = {}) {
  const text = String(source ?? "").trim();
  if (!text) {
    return Promise.reject(new Error("Mermaid source is empty."));
  }
  if (text.length > MERMAID_MAX_SOURCE_LENGTH) {
    return Promise.reject(new Error("Mermaid source exceeds the supported size."));
  }

  const run = async () => {
    mermaid.initialize(mermaidConfiguration(theme));
    const parsed = await mermaid.parse(text, { suppressErrors: true });
    if (!parsed) {
      throw new Error("Mermaid source is invalid.");
    }
    const id = `git-leaf-mermaid-${Date.now().toString(36)}-${diagramCounter += 1}`;
    const { svg } = await mermaid.render(id, text);
    return { svg: safeMermaidSvg(svg) };
  };

  const result = renderQueue.then(run, run);
  renderQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function safeMermaidSvg(value) {
  const svg = String(value ?? "").trim();
  if (
    !/^<svg(?:\s|>)/i.test(svg)
    || /<(?:script|iframe|object|embed|image|img|link)\b/i.test(svg)
    || /\son[a-z]+\s*=/i.test(svg)
    || /(?:href|xlink:href)\s*=\s*["']\s*javascript:/i.test(svg)
    || /(?:href|xlink:href|src)\s*=\s*["']\s*(?!#)[^"']+/i.test(svg)
    || /url\(\s*(?!["']?#)/i.test(svg)
    || /@import\b/i.test(svg)
  ) {
    throw new Error("Mermaid returned unsafe SVG.");
  }
  return svg;
}
