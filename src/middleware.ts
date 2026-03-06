import { defineMiddleware } from "astro:middleware";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { SITE, SOCIALS } from "@consts";

const CLI_USER_AGENT_PATTERN = /\b(curl|wget|httpie|xh)\b/i;

const COLORS = {
  text: "\u001b[38;2;205;214;244m",
  subtext0: "\u001b[38;2;186;194;222m",
  subtext1: "\u001b[38;2;166;173;200m",
  base: "\u001b[48;2;30;30;46m",
  mauve: "\u001b[38;2;203;166;247m",
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
} as const;

const AVATAR_PATH = fileURLToPath(new URL("../public/kshitij.jpeg", import.meta.url));
let cachedAvatarAnsi = "";
let avatarPromise: Promise<string> | null = null;

const getSocialLink = (name: string): string | undefined =>
  SOCIALS.find((social) => social.NAME.toLowerCase() === name.toLowerCase())?.HREF;

const toLabelValue = (href: string | undefined, fallback: string): string =>
  (href ?? fallback).replace(/^mailto:/i, "");

const padAround = (content: string): string =>
  content
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");

const renderAvatarAnsi = async (width: number): Promise<string> => {
  try {
    const base = { r: 30, g: 30, b: 46 };
    const srcMeta = await sharp(AVATAR_PATH).metadata();
    const srcWidth = srcMeta.width ?? 0;
    const srcHeight = srcMeta.height ?? 0;
    if (!srcWidth || !srcHeight) {
      return "";
    }

    const targetWidth = Math.max(8, Math.min(width, srcWidth));
    const targetPixelHeight = Math.max(
      8,
      Math.round((srcHeight / srcWidth) * targetWidth),
    );

    const { data, info } = await sharp(AVATAR_PATH)
      .ensureAlpha()
      .resize({ width: targetWidth, height: targetPixelHeight, fit: "cover" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const lines: string[] = [];
    for (let y = 0; y < info.height; y += 2) {
      let row = "";
      for (let x = 0; x < info.width; x++) {
        const topIndex = (y * info.width + x) * 4;
        const rt = data[topIndex] ?? 0;
        const gt = data[topIndex + 1] ?? 0;
        const bt = data[topIndex + 2] ?? 0;
        const at = data[topIndex + 3] ?? 255;

        const bottomY = Math.min(info.height - 1, y + 1);
        const bottomIndex = (bottomY * info.width + x) * 4;
        const rb = data[bottomIndex] ?? 0;
        const gb = data[bottomIndex + 1] ?? 0;
        const bb = data[bottomIndex + 2] ?? 0;
        const ab = data[bottomIndex + 3] ?? 255;

        const alphaTop = at / 255;
        const alphaBottom = ab / 255;

        const rTop = Math.round(rt * alphaTop + base.r * (1 - alphaTop));
        const gTop = Math.round(gt * alphaTop + base.g * (1 - alphaTop));
        const bTop = Math.round(bt * alphaTop + base.b * (1 - alphaTop));

        const rBottom = Math.round(rb * alphaBottom + base.r * (1 - alphaBottom));
        const gBottom = Math.round(gb * alphaBottom + base.g * (1 - alphaBottom));
        const bBottom = Math.round(bb * alphaBottom + base.b * (1 - alphaBottom));

        row += `\u001b[38;2;${rTop};${gTop};${bTop}m\u001b[48;2;${rBottom};${gBottom};${bBottom}m▀`;
      }
      lines.push(`${row}${COLORS.reset}`);
    }

    return lines.join("\n");
  } catch {
    return "";
  }
};

const getAvatarAnsi = async (): Promise<string> => {
  if (cachedAvatarAnsi) {
    return cachedAvatarAnsi;
  }

  if (!avatarPromise) {
    avatarPromise = renderAvatarAnsi(48).then((value) => {
      cachedAvatarAnsi = value;
      return value;
    });
  }

  return avatarPromise;
};

const renderTerminalCard = async (): Promise<string> => {
  const website = "https://kshitijk.com";
  const github = getSocialLink("github");
  const linkedin = getSocialLink("linkedin");
  const email = toLabelValue(getSocialLink("email"), SITE.EMAIL);
  const avatar = await getAvatarAnsi();

  const lines: string[] = [COLORS.base];
  if (avatar) {
    lines.push(avatar, "");
  }

  lines.push(`${COLORS.mauve}${COLORS.bold}${SITE.NAME.toLowerCase()}${COLORS.reset}`);
  lines.push(
    `${COLORS.text}full stack developer | cs + cybersecurity${COLORS.reset}`,
    "",
    `${COLORS.subtext0}${COLORS.bold}focus${COLORS.reset}`,
    `${COLORS.text}- systems${COLORS.reset}`,
    `${COLORS.text}- compiler design${COLORS.reset}`,
    `${COLORS.text}- cryptography${COLORS.reset}`,
    `${COLORS.text}- distributed systems${COLORS.reset}`,
    "",
    `${COLORS.subtext0}${COLORS.bold}links${COLORS.reset}`,
    `${COLORS.subtext1}website${COLORS.reset}${COLORS.text}: ${COLORS.mauve}${website}${COLORS.reset}`,
    `${COLORS.subtext1}blog${COLORS.reset}${COLORS.text}: ${COLORS.mauve}${website}/blog${COLORS.reset}`,
    `${COLORS.subtext1}github${COLORS.reset}${COLORS.text}: ${COLORS.mauve}${github ?? "not set"}${COLORS.reset}`,
    `${COLORS.subtext1}linkedin${COLORS.reset}${COLORS.text}: ${COLORS.mauve}${linkedin ?? "not set"}${COLORS.reset}`,
    `${COLORS.subtext1}email${COLORS.reset}${COLORS.text}: ${COLORS.mauve}${email}${COLORS.reset}`,
    "",
    `${COLORS.dim}${COLORS.subtext1}tip: curl -sL https://kshitijk.com | less -R${COLORS.reset}`,
    "",
    COLORS.reset,
  );

  return `${padAround(lines.join("\n"))}\n${COLORS.reset}`;
};

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;

  if (url.pathname !== "/" || !["GET", "HEAD"].includes(request.method)) {
    return next();
  }

  const userAgent = (request.headers.get("user-agent") ?? "").toLowerCase();
  const accept = (request.headers.get("accept") ?? "").toLowerCase();
  const isTerminalClient =
    CLI_USER_AGENT_PATTERN.test(userAgent) || accept.includes("text/plain");

  if (!isTerminalClient) {
    return next();
  }

  const body = await renderTerminalCard();
  return new Response(request.method === "HEAD" ? null : body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=600",
      Vary: "User-Agent",
    },
  });
});
