import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * 常见字体名 → Windows 字体文件映射。
 * drawtext 优先用 fontfile（确定性强）；找不到时回退 font= 名称（走 fontconfig）。
 */
const FONT_FILES: Record<string, string[]> = {
  "microsoft yahei": ["msyh.ttc", "msyh.ttf"],
  微软雅黑: ["msyh.ttc", "msyh.ttf"],
  simhei: ["simhei.ttf"],
  黑体: ["simhei.ttf"],
  simsun: ["simsun.ttc"],
  宋体: ["simsun.ttc"],
  arial: ["arial.ttf"],
  "noto sans sc": ["NotoSansSC-Regular.otf", "NotoSansSC-Regular.ttf"],
};

export function findFontFile(fontFamily: string): string | null {
  if (process.platform !== "win32") return null;
  const fontsDir = join(process.env["WINDIR"] ?? "C:\\Windows", "Fonts");
  const candidates = FONT_FILES[fontFamily.toLowerCase()] ?? [];
  for (const file of candidates) {
    const full = join(fontsDir, file);
    if (existsSync(full)) return full;
  }
  return null;
}
