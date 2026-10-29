// Usage : node render.mjs <dossier-scenes> <sortie.mp4> [--draft]
// Chaque scene-*.html expose window.__duration et window.__seek(t).
import puppeteer from "puppeteer";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, mkdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const [dir, out] = process.argv.slice(2);
const draft = process.argv.includes("--draft");
if (!dir || !out) { console.error("Usage: node render.mjs <dossier-scenes> <sortie.mp4> [--draft]"); process.exit(1); }

const W = draft ? 854 : 1920, H = draft ? 480 : 1080, FPS = draft ? 15 : 30;
const tag = draft ? "draft" : "final";
const build = join(resolve(dir), "..", "build");
mkdirSync(build, { recursive: true });

const scenes = readdirSync(dir).filter(f => f.endsWith(".html")).sort();
const browser = await puppeteer.launch();
const clips = [];

for (const f of scenes) {
  const file = join(resolve(dir), f);
  const hash = createHash("sha1").update(readFileSync(file)).update(`${W}x${H}@${FPS}`).digest("hex").slice(0, 12);
  const clip = join(build, `${f}.${tag}.${hash}.mp4`);
  clips.push(clip);
  if (existsSync(clip)) { console.log(`= ${f} (cache)`); continue; }

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(pathToFileURL(file).href, { waitUntil: "networkidle0" });
  const dur = await page.evaluate(() => window.__duration);
  if (!dur) throw new Error(`${f}: window.__duration manquant`);
  const frames = join(build, `frames-${f}`);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames);
  const n = Math.round(dur * FPS);
  for (let i = 0; i < n; i++) {
    await page.evaluate(t => window.__seek(t), i / FPS);
    await page.screenshot({ path: join(frames, `${String(i).padStart(5, "0")}.png`), type: "png" });
  }
  await page.close();
  const r = spawnSync("ffmpeg", ["-y", "-framerate", String(FPS), "-i", join(frames, "%05d.png"),
    "-vf", `scale=${W}:${H}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", clip], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`ffmpeg a échoué sur ${f}`);
  rmSync(frames, { recursive: true, force: true });
  console.log(`+ ${f} (${n} images)`);
}
await browser.close();

const list = join(build, `list-${tag}.txt`);
writeFileSync(list, clips.map(c => `file '${c.replace(/\\/g, "/")}'`).join("\n"));
const r = spawnSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out], { stdio: "inherit" });
process.exit(r.status ?? 1);
