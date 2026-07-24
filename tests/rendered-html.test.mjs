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
  assert.match(html, /导入工程/);
  assert.match(html, /分享工程/);
  assert.match(html, /片段循环/);
  assert.match(html, /循环关闭 · 可先调整范围/);
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
  const demoSource = page.slice(page.indexOf("const DEMO_PROJECT"), page.indexOf("function createDemo"));
  assert.match(demoSource, /title: "春日回响 01"/);
  assert.match(demoSource, /bpm: 125/);
  assert.match(demoSource, /scale: "pentatonic"/);
  const demoShapesJson = demoSource.match(/const DEMO_SHAPES_JSON = '([^']+)';/)?.[1];
  assert.ok(demoShapesJson);
  assert.equal(JSON.parse(demoShapesJson).length, 189);
  assert.match(page, /setProjectTitle\(DEMO_PROJECT\.title\)/);
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
  assert.match(page, /const startPlayback = useCallback/);
  assert.match(page, /const loopRef = useRef\(false\)/);
  assert.match(page, /const \[loop, setLoop\] = useState\(false\)/);
  assert.match(page, /project\.loop === true/);
  assert.match(page, /requestedStep >= selectedRange\.startStep/);
  assert.match(page, /requestedStep < selectedRange\.endStep/);
  assert.match(page, /rangeStartSeconds/);
  assert.match(page, /startOffsetSeconds/);
  assert.match(page, /timelineDragRef/);
  assert.match(page, /timeline-loop-toggle/);
  assert.match(page, /data-loop-action="start"/);
  assert.match(page, /data-loop-action="end"/);
  assert.match(page, /role="slider"/);
  assert.match(page, /aria-label="播放头"/);
  assert.match(page, /stopPlayback\(false\)/);
  assert.match(page, /loopStartStep/);
  assert.match(page, /loopEndStep/);
  assert.match(page, /viewStartStep/);
  assert.match(page, /timelineZoomStops/);
  assert.match(page, /applyTimelineZoom/);
  assert.match(page, /viewStepsRef\.current/);
  assert.match(page, /aria-label="时间轴缩放"/);
  assert.match(page, /aria-valuetext=\{`一屏显示 \$\{viewBars\} 小节`\}/);
  assert.match(page, /wheelStepRemainderRef/);
  assert.match(page, /wheelZoomRemainderRef/);
  assert.match(page, /lastWheelZoomAtRef/);
  assert.match(page, /Math\.abs\(wheelZoomRemainderRef\.current\) >= 72/);
  assert.match(page, /gestureTime - lastWheelZoomAtRef\.current >= 180/);
  assert.match(page, /horizontalGesture/);
  assert.match(page, /canvasPointerGuardUntilRef/);
  assert.match(page, /cancelCanvasGestureForScroll/);
  assert.match(page, /event\.buttons & 1/);
  assert.match(page, /gestureTime \+ 240/);
  assert.match(page, /addEventListener\("wheel", onCanvasWheel, \{ passive: false, capture: true \}\)/);
  assert.match(page, /removeEventListener\("wheel", onCanvasWheel, true\)/);
  assert.match(page, /ref=\{canvasFrameRef\}/);
  assert.doesNotMatch(page, /onWheel=\{/);
  assert.match(page, /window\.addEventListener\("keydown", onKeyDown, true\)/);
  assert.match(page, /window\.addEventListener\("keyup", onKeyUp, true\)/);
  assert.match(page, /if \(!event\.repeat\) void play\(\)/);
  const playheadSetter = page.slice(
    page.indexOf("const setPlayheadPosition"),
    page.indexOf("const updateLoopRange"),
  );
  assert.match(playheadSetter, /Math\.max\(0, Math\.round\(step\)\)/);
  assert.doesNotMatch(playheadSetter, /projectEndStep|clamp/);
  assert.match(page, /const displayBeat = Math\.max\(0, playheadBeat\)/);
  assert.match(page, /requestedStep \+ Math\.max\(DEFAULT_VIEW_STEPS, viewStepsRef\.current\)/);
  const keyboardHandler = page.slice(
    page.indexOf("const onKeyDown = (event: KeyboardEvent)"),
    page.indexOf('window.addEventListener("keydown", onKeyDown, true)'),
  );
  assert.ok(keyboardHandler.indexOf('event.code === "Space"') < keyboardHandler.indexOf("event.target"));
  assert.ok(keyboardHandler.indexOf('event.key === "Enter"') < keyboardHandler.indexOf("event.target"));
  assert.match(keyboardHandler, /stopPlayback\(\)/);
  assert.match(keyboardHandler, /navigateToStep\(0\)/);
  assert.doesNotMatch(page, /timeline-zoom-(?:compress|stretch|fit)/);
  assert.doesNotMatch(page, /\bVIEW_STEPS\b/);
  assert.match(page, /indexedDB\.open/);
  assert.doesNotMatch(page, /MAX_SHAPES/);
  assert.match(wav, /RF64/);
  assert.match(wav, /showSaveFilePicker/);
  assert.doesNotMatch(page, /navigator\.clipboard|clipboard\.writeText|window\.prompt/);
  assert.match(page, /CompressionStream\("gzip"\)/);
  assert.match(page, /DecompressionStream\("gzip"\)/);
  assert.match(page, /SHARE_LINK_PREFIX = "#p="/);
  assert.match(page, /LEGACY_SHARE_LINK_PREFIX = "#s="/);
  assert.doesNotMatch(page, /SHARE_LINK_MAX_LENGTH/);
  assert.match(page, /SHARE_FILE_HEADER = "SYNESTHESIA-CANVAS:3:"/);
  assert.match(page, /\.synesthesia/);
  assert.match(page, /navigator\.canShare\(\{ files: \[file\] \}\)/);
  assert.match(page, /accept="\.synesthesia,application\/x-synesthesia-canvas,application\/json"/);
  assert.match(page, /id: makeId\(\)/);
  assert.doesNotMatch(page, /payload\.length > 900_000/);
  assert.match(page, /onPointerDown/);
  assert.match(page, /E 平调子/);
  assert.match(css, /timeline-navigation/);
  assert.match(css, /\.cycle-ruler/);
  assert.match(css, /\.cycle-range/);
  assert.match(css, /\.cycle-handle/);
  assert.match(css, /\.timeline-playhead-handle/);
  assert.match(css, /\.timeline-zoom input\[type="range"\]/);
  assert.match(css, /cursor: ew-resize/);
  assert.match(css, /\.canvas-frame[\s\S]*?overscroll-behavior: none/);
  assert.match(css, /\.project-file-input[\s\S]*?display: none/);
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
