import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import process from "node:process";

// New launcher artwork only. Existing application logos are never overwritten.
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await mkdir(new URL("../public/icons/", import.meta.url), { recursive: true });
  for (const [name, size] of [
    ["app-192.png", 192],
    ["app-512.png", 512],
    ["app-maskable-512.png", 512],
  ]) {
    const png = await page.evaluate((dimension) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = dimension;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#080d0a";
      ctx.fillRect(0, 0, dimension, dimension);
      ctx.strokeStyle = "#39ff14";
      ctx.lineWidth = dimension * 0.025;
      ctx.beginPath();
      ctx.arc(dimension / 2, dimension / 2, dimension * 0.34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#39ff14";
      ctx.font = `bold ${dimension * 0.48}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("S", dimension / 2, dimension * 0.52);
      return canvas.toDataURL("image/png").split(",")[1];
    }, size);
    await writeFile(
      new URL(`../public/icons/${name}`, import.meta.url),
      Buffer.from(png, "base64"),
    );
  }
} finally {
  await browser.close();
}
