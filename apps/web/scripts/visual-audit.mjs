/* global Buffer, URL, WebSocket, fetch, process, setTimeout */

import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(appRoot, "../..");
const outputDir = resolve(repositoryRoot, "work/ui-audit");
const expectedOutputRoot = resolve(repositoryRoot, "work");
if (!outputDir.startsWith(`${expectedOutputRoot}${sep}`)) {
  throw new Error("Visual audit output escaped the repository work directory");
}

const baseUrl = process.env.NPR_AUDIT_BASE_URL ?? "http://127.0.0.1:4321";
const browserPort = Number.parseInt(
  process.env.NPR_AUDIT_BROWSER_PORT ?? "9333",
  10,
);
const routes = [
  ["home", "/"],
  ["history", "/history/"],
  ["methodology", "/methodology/"],
  ["archive", "/archive/"],
  ["corrections", "/corrections/"],
  ["reconstruction", "/2025-26/"],
  ["current", "/2026-27/"],
  ["tournaments", "/2026-27/tournaments/"],
  ["archive-season", "/archive/2024-25/"],
  ["competitor", "/2025-26/competitors/1/"],
  ["not-found", "/missing-page-for-visual-audit/"],
];
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];
const narrowViewport = { name: "narrow", width: 320, height: 800 };

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.events = new Map();
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data));
      if (typeof message.id === "number") {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const listeners = this.events.get(message.method) ?? [];
      this.events.delete(message.method);
      for (const resolveEvent of listeners) resolveEvent(message.params);
    });
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolveMessage, rejectMessage) => {
      this.pending.set(id, {
        resolve: resolveMessage,
        reject: rejectMessage,
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method) {
    return new Promise((resolveEvent) => {
      const listeners = this.events.get(method) ?? [];
      listeners.push(resolveEvent);
      this.events.set(method, listeners);
    });
  }

  close() {
    this.socket.close();
  }
}

async function connectBrowser() {
  const response = await fetch(
    `http://127.0.0.1:${browserPort}/json/new?${encodeURIComponent("about:blank")}`,
    { method: "PUT" },
  );
  if (!response.ok) {
    throw new Error(`Browser target request failed with ${response.status}`);
  }
  const target = await response.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveSocket, rejectSocket) => {
    socket.addEventListener("open", resolveSocket, { once: true });
    socket.addEventListener("error", rejectSocket, { once: true });
  });
  return { client: new CdpClient(socket), targetId: target.id };
}

async function navigate(client, path, viewport) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const loaded = client.once("Page.loadEventFired");
  await client.send("Page.navigate", {
    url: new URL(path, baseUrl).toString(),
  });
  await loaded;
  await client.send("Runtime.evaluate", {
    expression: "document.fonts.ready",
    awaitPromise: true,
    returnByValue: true,
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
}

async function pageMetrics(client) {
  const result = await client.send("Runtime.evaluate", {
    expression: `(() => {
      const root = document.documentElement;
      const heading = document.querySelector("h1");
      return {
        title: document.title,
        pathname: location.pathname,
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        scrollHeight: root.scrollHeight,
        fontsStatus: document.fonts.status,
        bodyFont: getComputedStyle(document.body).fontFamily,
        headingFont: heading ? getComputedStyle(heading).fontFamily : null,
      };
    })()`,
    returnByValue: true,
  });
  return result.result.value;
}

async function capture(client, filePath, captureBeyondViewport) {
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport,
  });
  await writeFile(filePath, Buffer.from(result.data, "base64"));
}

async function scrollTo(client, ratio) {
  await client.send("Runtime.evaluate", {
    expression: `window.scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) * ${ratio}, behavior: "instant" })`,
    returnByValue: true,
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
}

function loadSharp() {
  const require = createRequire(import.meta.url);
  const astroPackage = require.resolve("astro/package.json");
  return require(require.resolve("sharp", { paths: [astroPackage] }));
}

async function createContactSheet(viewport, captures) {
  const sharp = loadSharp();
  const columns = viewport.name === "desktop" ? 3 : 4;
  const tileWidth = viewport.name === "desktop" ? 440 : 220;
  const tileHeight = Math.round((tileWidth * viewport.height) / viewport.width);
  const labelHeight = 32;
  const rows = Math.ceil(captures.length / columns);
  const canvas = sharp({
    create: {
      width: columns * tileWidth,
      height: rows * (tileHeight + labelHeight),
      channels: 4,
      background: "#fbfaf7",
    },
  });
  const composites = [];
  for (const [index, capturePath] of captures.entries()) {
    const left = (index % columns) * tileWidth;
    const top = Math.floor(index / columns) * (tileHeight + labelHeight);
    const input = await sharp(await readFile(capturePath))
      .resize(tileWidth, tileHeight, { fit: "cover", position: "top" })
      .png()
      .toBuffer();
    const label = basename(capturePath).replace(
      `-${viewport.name}-top.png`,
      "",
    );
    const labelSvg = Buffer.from(
      `<svg width="${tileWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#121212"/><text x="12" y="21" fill="#fbfaf7" font-family="sans-serif" font-size="13">${label}</text></svg>`,
    );
    composites.push({ input, left, top });
    composites.push({ input: labelSvg, left, top: top + tileHeight });
  }
  await canvas
    .composite(composites)
    .png()
    .toFile(resolve(outputDir, `contact-${viewport.name}.png`));
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const { client, targetId } = await connectBrowser();
await client.send("Page.enable");
await client.send("Runtime.enable");
const report = [];

try {
  for (const viewport of viewports) {
    const captures = [];
    for (const [name, path] of routes) {
      await navigate(client, path, viewport);
      const metrics = await pageMetrics(client);
      const topPath = resolve(outputDir, `${name}-${viewport.name}-top.png`);
      await capture(client, topPath, false);
      if (metrics.scrollHeight > viewport.height * 1.25) {
        await scrollTo(client, 0.5);
        await capture(
          client,
          resolve(outputDir, `${name}-${viewport.name}-middle.png`),
          false,
        );
        await scrollTo(client, 1);
        await capture(
          client,
          resolve(outputDir, `${name}-${viewport.name}-bottom.png`),
          false,
        );
      }
      captures.push(topPath);
      report.push({ name, path, viewport: viewport.name, ...metrics });
    }
    await createContactSheet(viewport, captures);
  }

  for (const [name, path] of routes) {
    await navigate(client, path, narrowViewport);
    const metrics = await pageMetrics(client);
    report.push({ name, path, viewport: narrowViewport.name, ...metrics });
  }
} finally {
  client.close();
  await fetch(`http://127.0.0.1:${browserPort}/json/close/${targetId}`, {
    method: "PUT",
  }).catch(() => undefined);
}

const failures = report.filter(
  ({ clientWidth, scrollWidth, fontsStatus, bodyFont, headingFont }) =>
    scrollWidth > clientWidth ||
    fontsStatus !== "loaded" ||
    !bodyFont.includes("Inter Variable") ||
    !headingFont?.includes("Source Serif 4 Variable"),
);
const finalReport = {
  baseUrl,
  generatedAt: new Date().toISOString(),
  routeCount: routes.length,
  viewportCount: viewports.length + 1,
  passed: failures.length === 0,
  failures,
  pages: report,
};
await writeFile(
  resolve(outputDir, "report.json"),
  `${JSON.stringify(finalReport, null, 2)}\n`,
);

if (failures.length > 0) {
  throw new Error(`Visual audit found ${failures.length} metric failures`);
}

process.stdout.write(
  `Visual audit passed for ${routes.length} routes at desktop, mobile, and 320px widths.\n`,
);
