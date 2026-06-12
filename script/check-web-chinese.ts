import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

type Issue = {
  file: string;
  line: number;
  col: number;
  kind: string;
  text: string;
};

const ROOT = join(process.cwd(), "apps", "web", "src");

const SKIP_DIR_PARTS = [
  "__tests__",
  "blog",
  "changelog",
  "migrations",
  "node_modules",
  ".next",
  "site",
  "types",
];

const SKIP_FILE_PARTS = [
  `${join("app", "brand", "page.tsx")}`,
  `${join("app", "contributors", "page.tsx")}`,
  `${join("app", "globals.css")}`,
  `${join("app", "page.tsx")}`,
  `${join("app", "privacy", "page.tsx")}`,
  `${join("app", "roadmap", "page.tsx")}`,
  `${join("app", "rss.xml", "route.ts")}`,
  `${join("app", "sitemap.ts")}`,
  `${join("app", "sponsors", "page.tsx")}`,
  `${join("app", "terms", "page.tsx")}`,
  `${join("components", "footer.tsx")}`,
  `${join("components", "gitHub-contribute-section.tsx")}`,
  `${join("components", "header.tsx")}`,
  `${join("components", "landing")}`,
  `${join("data", "colors")}`,
  `${join("gradients", "parser.ts")}`,
  `${join("gradients", "canvas.ts")}`,
  `${join("services", "renderer")}`,
  `${join("wasm", "media-time.ts")}`,
];

const VISIBLE_ATTRIBUTES = new Set([
  "aria-label",
  "ariaLabel",
  "alt",
  "label",
  "message",
  "placeholder",
  "title",
  "tooltipText",
]);

const VISIBLE_PROPERTY_NAMES = new Set([
  "category",
  "description",
  "emptyText",
  "error",
  "label",
  "message",
  "placeholder",
  "searchPlaceholder",
  "summary",
  "title",
  "tooltip",
  "tooltipText",
]);

const VISIBLE_VARIABLE_PATTERN =
  /(label|title|message|description|placeholder|tooltip|displayText|displayLabel)$/i;

const ALLOWED_WORDS = new Set(
  [
    "ai",
    "api",
    "ass",
    "bg",
    "bun",
    "css",
    "chrome",
    "dB",
    "dBFS",
    "databuddy",
    "data",
    "buddy",
    "discord",
    "dsl",
    "ffmpeg",
    "ffprobe",
    "fps",
    "freesound",
    "github",
    "gpu",
    "h",
    "hex",
    "hsl",
    "html",
    "hsv",
    "id",
    "ipad",
    "json",
    "mcp",
    "mit",
    "marble",
    "mp",
    "mp4",
    "next",
    "oklch",
    "opencut",
    "qc",
    "rgb",
    "rgba",
    "reels",
    "shorts",
    "srt",
    "tiktok",
    "svg",
    "url",
    "vercel",
    "vp",
    "wasm",
    "web",
    "webgpu",
    "webm",
    "x",
    "y",
  ].map((word) => word.toLowerCase()),
);

function shouldScanFile(file: string): boolean {
  const rel = relative(ROOT, file);
  const normalizedRel = rel.replace(/\\/g, "/");
  if (!/\.(ts|tsx)$/.test(file)) return false;
  if (SKIP_DIR_PARTS.some((part) => rel.split(/[\\/]/).includes(part))) {
    return false;
  }
  if (
    SKIP_FILE_PARTS.some((part) => {
      const normalizedPart = part.replace(/\\/g, "/");
      return (
        normalizedRel === normalizedPart ||
        normalizedRel.startsWith(`${normalizedPart}/`) ||
        normalizedRel.endsWith(normalizedPart)
      );
    })
  ) {
    return false;
  }
  return true;
}

function collectFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!SKIP_DIR_PARTS.includes(entry)) collectFiles(full, files);
      continue;
    }
    if (shouldScanFile(full)) files.push(full);
  }
  return files;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function wordsIn(value: string): string[] {
  return value.match(/[A-Za-z][A-Za-z']*/g) ?? [];
}

function looksTechnicalValue(value: string): boolean {
  const text = normalizeText(value);
  return (
    /^[a-z0-9.[\]]+(?:-[a-z0-9.[\]]+)+(?::[a-z0-9-]+)?$/.test(text) ||
    /^group-\[[^\]]+\]:[a-z0-9-]+$/.test(text)
  );
}

function hasUntranslatedEnglish(value: string): boolean {
  const text = normalizeText(value);
  if (!text) return false;
  if (looksTechnicalValue(text)) return false;
  const words = wordsIn(text);
  if (words.length === 0) return false;
  return words.some((word) => !ALLOWED_WORDS.has(word.toLowerCase()));
}

function propName(node: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return undefined;
}

function expressionText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return [
      node.head.text,
      ...node.templateSpans.map((span) => span.literal.text),
    ].join(" ");
  }
  return undefined;
}

function isRenderedJsxString(node: ts.Node): boolean {
  let current: ts.Node = node;
  let parent: ts.Node | undefined = node.parent;
  while (parent) {
    if (ts.isParenthesizedExpression(parent)) {
      current = parent;
      parent = parent.parent;
      continue;
    }
    if (ts.isConditionalExpression(parent)) {
      if (parent.whenTrue !== current && parent.whenFalse !== current) {
        return false;
      }
      current = parent;
      parent = parent.parent;
      continue;
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      current = parent;
      parent = parent.parent;
      continue;
    }
    break;
  }

  if (parent && ts.isJsxExpression(parent)) {
    const jsxParent = parent.parent;
    if (ts.isJsxAttribute(jsxParent)) {
      return VISIBLE_ATTRIBUTES.has(jsxParent.name.text);
    }
    return true;
  }
  if (parent && ts.isJsxAttribute(parent)) {
    return VISIBLE_ATTRIBUTES.has(parent.name.text);
  }
  return false;
}

function isVisibleCall(node: ts.Node): boolean {
  const parent = node.parent;
  if (!ts.isCallExpression(parent)) return false;
  if (parent.arguments[0] !== node) return false;
  const callee = parent.expression.getText();
  return /^toast\.(error|success|warning|info|message|promise)$/.test(callee);
}

function isVisibleNameProperty(file: string): boolean {
  const rel = relative(ROOT, file);
  return /(?:^|[\\/])(masks|effects|graphics|timeline|core|project)(?:[\\/]|$)/.test(
    rel,
  );
}

function isVisibleInitializer(node: ts.Node, file: string): boolean {
  const parent = node.parent;
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    const name = propName(parent.name);
    if (!name) return false;
    if (name === "name") return isVisibleNameProperty(file);
    return VISIBLE_PROPERTY_NAMES.has(name);
  }
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
    return (
      ts.isIdentifier(parent.name) &&
      VISIBLE_VARIABLE_PATTERN.test(parent.name.text)
    );
  }
  return false;
}

function addIssue({
  issues,
  source,
  file,
  node,
  kind,
  text,
}: {
  issues: Issue[];
  source: ts.SourceFile;
  file: string;
  node: ts.Node;
  kind: string;
  text: string;
}): void {
  const normalized = normalizeText(text);
  if (!hasUntranslatedEnglish(normalized)) return;
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  issues.push({
    file: relative(process.cwd(), file),
    line: pos.line + 1,
    col: pos.character + 1,
    kind,
    text: normalized,
  });
}

function scanFile(file: string): Issue[] {
  const sourceText = readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const issues: Issue[] = [];

  function visit(node: ts.Node): void {
    if (ts.isJsxText(node)) {
      addIssue({
        issues,
        source,
        file,
        node,
        kind: "jsx-text",
        text: node.getText(source),
      });
    }

    if (ts.isJsxAttribute(node) && VISIBLE_ATTRIBUTES.has(node.name.text)) {
      if (node.initializer && ts.isStringLiteral(node.initializer)) {
        addIssue({
          issues,
          source,
          file,
          node,
          kind: `jsx-attr:${node.name.text}`,
          text: node.initializer.text,
        });
      }
    }

    const text = expressionText(node);
    if (text && ts.isJsxAttribute(node.parent)) {
      ts.forEachChild(node, visit);
      return;
    }
    if (
      text &&
      (isRenderedJsxString(node) ||
        isVisibleCall(node) ||
        isVisibleInitializer(node, file))
    ) {
      addIssue({
        issues,
        source,
        file,
        node,
        kind: "string",
        text,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  return issues;
}

if (!existsSync(ROOT)) {
  console.error(`找不到 Web 源码目录: ${ROOT}`);
  process.exit(2);
}

const issues = collectFiles(ROOT).flatMap(scanFile);

if (issues.length > 0) {
  console.error(`Web 汉化检查失败：发现 ${issues.length} 个疑似未汉化文案。`);
  for (const issue of issues) {
    console.error(
      `${issue.file}:${issue.line}:${issue.col} [${issue.kind}] ${JSON.stringify(
        issue.text,
      )}`,
    );
  }
  process.exit(1);
}

console.log("Web 汉化检查通过：0 个疑似未汉化文案。");
