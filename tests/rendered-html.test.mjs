import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the finished Synesthesia Canvas shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Synesthesia Canvas｜通感画布<\/title>/i);
  assert.match(html, /通感画布/);
  assert.match(html, /明亮铜管/);
  assert.match(html, /电光三味线/);
  assert.match(html, /电光贝斯/);
  assert.match(html, /虹彩和弦/);
  assert.match(html, /竹风主奏/);
  assert.match(html, /旋律与和声/);
  assert.match(html, /节奏与鼓组/);
  assert.match(html, /和祭太鼓/);
  assert.match(html, /像素鼓机/);
  assert.match(html, /故障切片鼓/);
  assert.match(html, /霓虹祭典鼓/);
  assert.doesNotMatch(html, /泡沫人声/);
  assert.match(html, /13(?:<!-- -->)? 种/);
  assert.match(html, /instrument-scroll/);
  assert.match(html, /tool-scroll/);
  assert.match(html, /播放作品/);
  assert.match(html, /音阶 · .*13.* 种/);
  assert.match(html, /D 阴音阶 · 樱花/);
  assert.match(html, /E 岩户音阶/);
  assert.match(html, /C 自然大调/);
  assert.match(html, /C 全音音阶/);
  assert.match(html, /无限画布/);
  assert.match(html, /1\/16 · 无限延展/);
  assert.match(html, /不设上限/);
  assert.match(html, /节奏模板/);
  assert.match(html, /Four-on-the-floor/);
  assert.match(html, /2-Step/);
  assert.match(html, /Breakbeat/);
  assert.match(html, /Half-time/);
  assert.match(html, /Syncopated 16th/);
  assert.match(html, /Drum &amp; Bass Two-Step/);
  assert.match(html, /段落长度/);
  assert.match(html, /复杂度/);
  assert.match(html, /Swing/);
  assert.match(html, /icon\.svg/);

  const drumNames = ["活力鼓组", "和祭太鼓", "像素鼓机", "故障切片鼓", "霓虹祭典鼓"];
  const firstDrumPositions = drumNames.map((name) => html.indexOf(name));
  assert.ok(firstDrumPositions.every((position) => position >= 0));
  assert.deepEqual(firstDrumPositions, [...firstDrumPositions].sort((a, b) => a - b));
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships the audio, canvas, export, sharing, and responsive product code", async () => {
  const [page, wav, css, favicon, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/wav.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/icon.svg", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /new OfflineAudioContext/);
  assert.match(page, /encodePcm16/);
  assert.match(page, /LOOKAHEAD_SECONDS/);
  assert.match(page, /stringFeedback/);
  assert.match(page, /addNoiseLayer/);
  assert.match(page, /addVibrato/);
  assert.match(page, /makeChipNoiseBuffer/);
  assert.match(page, /isDrumInstrument\(shape\.instrument\)/);
  assert.match(page, /shape\.instrument === "taiko"/);
  assert.match(page, /shape\.instrument === "chipDrums"/);
  assert.match(page, /shape\.instrument === "glitchDrums"/);
  assert.match(page, /shape\.instrument === "festivalDrums"/);
  assert.match(page, /RHYTHM_PATTERNS/);
  assert.match(page, /RHYTHM_LENGTHS.*1, 2, 4, 8/);
  assert.match(page, /makeRhythmShapes/);
  assert.match(page, /commitShapes\(\[\.\.\.shapesRef\.current, \.\.\.inserted\]\)/);
  assert.match(page, /occupiedDrumSlots/);
  assert.match(page, /shapeStartBeat\(shape, swing\)/);
  assert.match(page, /swing\?: number/);
  assert.match(page, /shouldNudgeDetail/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /aria-modal="true"/);
  assert.match(page, /button, a, summary/);
  assert.doesNotMatch(page, /<strong>56% Swing/);
  assert.doesNotMatch(page, /\bvocal\b|泡沫人声/);
  assert.match(page, /setInterval\(pump/);
  assert.match(page, /viewStartStep/);
  assert.match(page, /indexedDB\.open/);
  assert.doesNotMatch(page, /MAX_SHAPES/);
  assert.match(wav, /RF64/);
  assert.match(wav, /showSaveFilePicker/);
  assert.match(page, /navigator\.clipboard/);
  assert.match(page, /onPointerDown/);
  assert.match(page, /E 平调子/);
  assert.match(css, /timeline-navigation/);
  assert.match(css, /tool-pan/);
  assert.match(css, /rail-section--voices/);
  assert.match(css, /rail-section--tools/);
  assert.match(css, /instrument-group-heading/);
  assert.match(css, /rhythm-popover/);
  assert.match(css, /rhythm-pattern-card/);
  assert.match(css, /rhythm-parameters/);
  assert.match(css, /mini-shape--spark/);
  assert.match(css, /@media \(max-width: 780px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(favicon, /viewBox="0 0 64 64"/);
  assert.match(favicon, /#3867FF/);
  assert.match(favicon, /#FF526F/);
  assert.match(favicon, /#FFD31A/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
