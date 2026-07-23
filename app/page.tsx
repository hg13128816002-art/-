"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { createWavHeader, encodePcm16, suggestWavFile, type WavWritableStream } from "./wav";

type TonalInstrumentId =
  | "brass"
  | "organ"
  | "keys"
  | "strings"
  | "pluck"
  | "bass"
  | "chord"
  | "flute";
type DrumInstrumentId =
  | "drums"
  | "taiko"
  | "chipDrums"
  | "glitchDrums"
  | "festivalDrums";
type InstrumentId = TonalInstrumentId | DrumInstrumentId;
type ToolId = "select" | "draw" | "stamp" | "erase" | "pan";
type ShapeForm =
  | "triangle"
  | "ring"
  | "diamond"
  | "block"
  | "wave"
  | "spark"
  | "capsule"
  | "petal"
  | "slash"
  | "drop";
type ScaleId =
  | "hirajoshi"
  | "in"
  | "insen"
  | "iwato"
  | "yo"
  | "major"
  | "minor"
  | "harmonicMinor"
  | "dorian"
  | "lydian"
  | "pentatonic"
  | "phrygianDominant"
  | "wholeTone";
type ScaleGroup = "和风五声" | "旋律调式" | "电子色彩";

type ScaleDefinition = {
  name: string;
  root: number;
  intervals: number[];
  group: ScaleGroup;
};

type SoundShape = {
  id: string;
  startStep: number;
  durationSteps: number;
  y: number;
  size: number;
  pan: number;
  instrument: InstrumentId;
  rotation: number;
};

type Instrument = {
  id: InstrumentId;
  code: string;
  name: string;
  subtitle: string;
  color: string;
  accent: string;
  form: ShapeForm;
  defaultSize: number;
};

type AudioGraph = {
  tonal: GainNode;
  drums: GainNode;
  pump: GainNode;
  master: GainNode;
};

type PreparedEvent = {
  shape: SoundShape;
  offsetSeconds: number;
};

type TransportState = {
  token: number;
  origin: number;
  duration: number;
  secondsPerBeat: number;
  cycle: number;
  eventIndex: number;
  events: PreparedEvent[];
};

type StoredProject = {
  version: 2;
  shapes: SoundShape[];
  bpm: number;
  scale: ScaleId;
  title: string;
};

type Interaction =
  | { kind: "draw"; pointerId: number; lastStep: number; lastY: number }
  | { kind: "erase"; pointerId: number; lastStep: number; lastY: number }
  | {
      kind: "stamp";
      pointerId: number;
      id: string;
      startStep: number;
      startY: number;
    }
  | {
      kind: "move";
      pointerId: number;
      id: string;
      offsetStep: number;
      offsetY: number;
    }
  | {
      kind: "pan";
      pointerId: number;
      startClientX: number;
      startViewStep: number;
    };

const EPSILON = 0.0001;
const STEPS_PER_BEAT = 4;
const BEATS_PER_BAR = 4;
const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR;
const VIEW_BARS = 4;
const VIEW_STEPS = VIEW_BARS * STEPS_PER_BAR;
const DEFAULT_PROJECT_STEPS = VIEW_STEPS;
const MAX_NOTE_STEPS = 64;
const LOOKAHEAD_SECONDS = 0.24;
const LATE_GRACE_SECONDS = 0.08;
const SCHEDULER_TICK_MS = 40;
const START_DELAY_SECONDS = 0.08;
const PROJECT_DB = "synesthesia-canvas-v2";
const PROJECT_STORE = "projects";
const PROJECT_KEY = "current";

const INSTRUMENTS: Instrument[] = [
  {
    id: "brass",
    code: "01",
    name: "明亮铜管",
    subtitle: "清脆 · 有冲劲",
    color: "#ffbf19",
    accent: "#ff4f9a",
    form: "triangle",
    defaultSize: 0.072,
  },
  {
    id: "organ",
    code: "02",
    name: "泡泡风琴",
    subtitle: "圆润 · 有颗粒",
    color: "#22a7ff",
    accent: "#ffd31a",
    form: "ring",
    defaultSize: 0.067,
  },
  {
    id: "keys",
    code: "03",
    name: "玻璃琴键",
    subtitle: "轻盈 · 闪亮",
    color: "#ff4f9a",
    accent: "#22a7ff",
    form: "diamond",
    defaultSize: 0.061,
  },
  {
    id: "drums",
    code: "04",
    name: "活力鼓组",
    subtitle: "清爽 · 有弹性",
    color: "#ff7338",
    accent: "#7657ff",
    form: "block",
    defaultSize: 0.054,
  },
  {
    id: "strings",
    code: "05",
    name: "樱花弦乐",
    subtitle: "柔和 · 有延展",
    color: "#8a68ff",
    accent: "#20c8ff",
    form: "wave",
    defaultSize: 0.082,
  },
  {
    id: "pluck",
    code: "06",
    name: "电光三味线",
    subtitle: "圆润 · 木质弹拨",
    color: "#ffe600",
    accent: "#ff3f9b",
    form: "spark",
    defaultSize: 0.058,
  },
  {
    id: "bass",
    code: "07",
    name: "电光贝斯",
    subtitle: "低沉 · 弹跳切片",
    color: "#8b72ff",
    accent: "#ff7417",
    form: "capsule",
    defaultSize: 0.076,
  },
  {
    id: "chord",
    code: "08",
    name: "虹彩和弦",
    subtitle: "宽阔 · 未来感",
    color: "#ff55d7",
    accent: "#16bdff",
    form: "petal",
    defaultSize: 0.09,
  },
  {
    id: "flute",
    code: "09",
    name: "竹风主奏",
    subtitle: "清亮 · 和风呼吸",
    color: "#a7e51c",
    accent: "#7657ff",
    form: "drop",
    defaultSize: 0.065,
  },
  {
    id: "taiko",
    code: "10",
    name: "和祭太鼓",
    subtitle: "深沉 · 祭典回响",
    color: "#ff334f",
    accent: "#ffd600",
    form: "ring",
    defaultSize: 0.086,
  },
  {
    id: "chipDrums",
    code: "11",
    name: "像素鼓机",
    subtitle: "轻快 · 8-bit 碎拍",
    color: "#00bfff",
    accent: "#6c4cff",
    form: "block",
    defaultSize: 0.055,
  },
  {
    id: "glitchDrums",
    code: "12",
    name: "故障切片鼓",
    subtitle: "凶脆 · 跳切翻转",
    color: "#7456ff",
    accent: "#ff4f9a",
    form: "slash",
    defaultSize: 0.064,
  },
  {
    id: "festivalDrums",
    code: "13",
    name: "霓虹祭典鼓",
    subtitle: "明亮 · 拍手铃音",
    color: "#ff8a00",
    accent: "#ffe600",
    form: "spark",
    defaultSize: 0.072,
  },
];

const DRUM_INSTRUMENTS = new Set<DrumInstrumentId>([
  "drums",
  "taiko",
  "chipDrums",
  "glitchDrums",
  "festivalDrums",
]);

const SCALES: Record<ScaleId, ScaleDefinition> = {
  hirajoshi: { name: "E 平调子", root: 40, intervals: [0, 2, 3, 7, 8], group: "和风五声" },
  in: { name: "D 阴音阶 · 樱花", root: 38, intervals: [0, 1, 5, 7, 8], group: "和风五声" },
  insen: { name: "D 阴旋音阶", root: 38, intervals: [0, 1, 5, 7, 10], group: "和风五声" },
  iwato: { name: "E 岩户音阶", root: 40, intervals: [0, 1, 5, 6, 10], group: "和风五声" },
  yo: { name: "D 阳音阶", root: 38, intervals: [0, 2, 5, 7, 9], group: "和风五声" },
  major: { name: "C 自然大调", root: 36, intervals: [0, 2, 4, 5, 7, 9, 11], group: "旋律调式" },
  minor: { name: "F♯ 自然小调", root: 42, intervals: [0, 2, 3, 5, 7, 8, 10], group: "旋律调式" },
  harmonicMinor: { name: "F♯ 和声小调", root: 42, intervals: [0, 2, 3, 5, 7, 8, 11], group: "旋律调式" },
  dorian: { name: "D 多利亚", root: 38, intervals: [0, 2, 3, 5, 7, 9, 10], group: "旋律调式" },
  lydian: { name: "C 利底亚", root: 36, intervals: [0, 2, 4, 6, 7, 9, 11], group: "旋律调式" },
  pentatonic: { name: "A 小调五声音阶", root: 45, intervals: [0, 3, 5, 7, 10], group: "电子色彩" },
  phrygianDominant: { name: "E 弗里吉亚属", root: 40, intervals: [0, 1, 4, 5, 7, 8, 10], group: "电子色彩" },
  wholeTone: { name: "C 全音音阶", root: 36, intervals: [0, 2, 4, 6, 8, 10], group: "电子色彩" },
};

const SCALE_GROUPS: ScaleGroup[] = ["和风五声", "旋律调式", "电子色彩"];
const SCALE_ENTRIES = Object.entries(SCALES) as [ScaleId, ScaleDefinition][];

const TOOL_ITEMS: { id: ToolId; key: string; glyph: string; label: string }[] = [
  { id: "select", key: "V", glyph: "⌖", label: "选择 / 移动" },
  { id: "draw", key: "B", glyph: "∿", label: "声音画笔" },
  { id: "stamp", key: "S", glyph: "◇", label: "图形印章" },
  { id: "erase", key: "E", glyph: "⌫", label: "擦除" },
  { id: "pan", key: "H", glyph: "↔", label: "平移画布" },
];

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededNoise(seed: number) {
  let value = seed || 1;
  return () => {
    value = Math.imul(1664525, value) + 1013904223;
    return ((value >>> 0) / 4294967296) * 2 - 1;
  };
}

function getInstrument(id: InstrumentId) {
  return INSTRUMENTS.find((instrument) => instrument.id === id) ?? INSTRUMENTS[0];
}

function isScaleId(value: unknown): value is ScaleId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SCALES, value);
}

function isInstrumentId(value: unknown): value is InstrumentId {
  return INSTRUMENTS.some((item) => item.id === value);
}

function isDrumInstrument(value: InstrumentId): value is DrumInstrumentId {
  return DRUM_INSTRUMENTS.has(value as DrumInstrumentId);
}

function normalizeShape(value: unknown): SoundShape | null {
  if (!value || typeof value !== "object") return null;
  const shape = value as Partial<SoundShape>;
  if (
    typeof shape.id !== "string" ||
    !isInstrumentId(shape.instrument) ||
    !Number.isFinite(shape.startStep) ||
    !Number.isFinite(shape.durationSteps) ||
    !Number.isFinite(shape.y) ||
    !Number.isFinite(shape.size) ||
    !Number.isFinite(shape.pan) ||
    !Number.isFinite(shape.rotation)
  ) {
    return null;
  }
  return {
    id: shape.id,
    instrument: shape.instrument,
    startStep: Math.max(0, Math.round(shape.startStep as number)),
    durationSteps: clamp(Math.round(shape.durationSteps as number), 1, MAX_NOTE_STEPS),
    y: clamp(shape.y as number),
    size: clamp(shape.size as number, 0.035, 0.18),
    pan: clamp(shape.pan as number, -1, 1),
    rotation: shape.rotation as number,
  };
}

function openProjectDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(PROJECT_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PROJECT_STORE)) {
        request.result.createObjectStore(PROJECT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadStoredProject(): Promise<StoredProject | null> {
  if (typeof indexedDB === "undefined") return null;
  const database = await openProjectDatabase();
  try {
    return await new Promise<StoredProject | null>((resolve, reject) => {
      const transaction = database.transaction(PROJECT_STORE, "readonly");
      const request = transaction.objectStore(PROJECT_STORE).get(PROJECT_KEY);
      request.onsuccess = () => resolve((request.result as StoredProject | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function saveStoredProject(project: StoredProject) {
  if (typeof indexedDB === "undefined") return;
  const database = await openProjectDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(PROJECT_STORE, "readwrite");
      transaction.objectStore(PROJECT_STORE).put(project, PROJECT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function midiFromShape(shape: SoundShape, scaleId: ScaleId) {
  const scale = SCALES[scaleId];
  const degrees = scale.intervals.length * 4;
  const degree = Math.round((1 - clamp(shape.y)) * (degrees - 1));
  let midi =
    scale.root +
    Math.floor(degree / scale.intervals.length) * 12 +
    scale.intervals[degree % scale.intervals.length];
  const range: Record<InstrumentId, [number, number]> = {
    brass: [57, 86],
    organ: [45, 78],
    keys: [52, 90],
    drums: [36, 60],
    strings: [50, 86],
    pluck: [58, 94],
    bass: [36, 62],
    chord: [48, 78],
    flute: [60, 91],
    taiko: [36, 55],
    chipDrums: [48, 72],
    glitchDrums: [36, 72],
    festivalDrums: [45, 76],
  };
  const [low, high] = range[shape.instrument];
  while (midi < low) midi += 12;
  while (midi > high) midi -= 12;
  return midi;
}

function midiToFrequency(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function midiToName(midi: number) {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function eventDuration(shape: SoundShape) {
  if (shape.instrument === "taiko") return 0.5;
  if (shape.instrument === "festivalDrums") return 0.375;
  if (isDrumInstrument(shape.instrument)) return 0.25;
  return clamp(Math.round(shape.durationSteps), 1, MAX_NOTE_STEPS) / STEPS_PER_BEAT;
}

function defaultDurationSteps(instrument: InstrumentId, stamp = false) {
  const brushDurations: Record<InstrumentId, number> = {
    brass: 1,
    organ: 2,
    keys: 1,
    drums: 1,
    strings: 4,
    pluck: 1,
    bass: 2,
    chord: 4,
    flute: 2,
    taiko: 2,
    chipDrums: 1,
    glitchDrums: 1,
    festivalDrums: 1,
  };
  if (!stamp) return brushDurations[instrument];
  if (isDrumInstrument(instrument)) return brushDurations[instrument];
  return instrument === "strings"
    ? 8
    : instrument === "chord"
      ? 6
      : Math.max(2, brushDurations[instrument] * 2);
}

function eventVelocity(shape: SoundShape) {
  return clamp(0.3 + Math.sqrt(clamp(shape.size / 0.16)) * 0.6, 0.25, 0.92);
}

function shapeStartBeat(shape: SoundShape) {
  const step = Math.max(0, Math.round(shape.startStep));
  const swing = step % 2 === 1 ? 0.03 : 0;
  return step / STEPS_PER_BEAT + swing;
}

function projectEndStep(shapes: SoundShape[]) {
  let end = DEFAULT_PROJECT_STEPS;
  for (const shape of shapes) {
    end = Math.max(end, shape.startStep + shape.durationSteps);
  }
  return Math.ceil(end / STEPS_PER_BAR) * STEPS_PER_BAR;
}

function effectTailSeconds(bpm: number) {
  return 0.9 + 6 * (0.75 * 60 / bpm);
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function makeNoiseBuffer(context: BaseAudioContext, seconds: number, seed: number) {
  const length = Math.max(1, Math.ceil(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  const random = seededNoise(seed);
  for (let index = 0; index < length; index += 1) data[index] = random();
  return buffer;
}

function makeChipNoiseBuffer(
  context: BaseAudioContext,
  seconds: number,
  seed: number,
  levels = 8,
  holdSamples = 6,
) {
  const length = Math.max(1, Math.ceil(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  const random = seededNoise(seed);
  let held = 0;
  for (let index = 0; index < length; index += 1) {
    if (index % holdSamples === 0) {
      const normalized = (random() + 1) * 0.5;
      held = (Math.round(normalized * (levels - 1)) / (levels - 1)) * 2 - 1;
    }
    data[index] = held;
  }
  return buffer;
}

function registerSource(
  source: AudioScheduledSourceNode,
  bucket?: Set<AudioScheduledSourceNode>,
) {
  if (!bucket) return;
  bucket.add(source);
  source.addEventListener("ended", () => bucket.delete(source), { once: true });
}

function createAudioGraph(context: BaseAudioContext, bpm: number, volume: number): AudioGraph {
  const tonal = context.createGain();
  const drums = context.createGain();
  const pump = context.createGain();
  const mix = context.createGain();
  const delay = context.createDelay(2);
  const feedback = context.createGain();
  const delayFilter = context.createBiquadFilter();
  const wet = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const master = context.createGain();

  tonal.gain.value = 0.72;
  drums.gain.value = 0.82;
  pump.gain.value = 1;
  delay.delayTime.value = (60 / bpm) * 0.75;
  feedback.gain.value = 0.2;
  delayFilter.type = "lowpass";
  delayFilter.frequency.value = 5600;
  wet.gain.value = 0.13;
  compressor.threshold.value = -12;
  compressor.knee.value = 6;
  compressor.ratio.value = 10;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.12;
  master.gain.value = volume * 0.78;

  tonal.connect(pump);
  tonal.connect(delay);
  delay.connect(delayFilter);
  delayFilter.connect(wet);
  wet.connect(pump);
  delayFilter.connect(feedback);
  feedback.connect(delay);
  pump.connect(mix);
  drums.connect(mix);
  mix.connect(compressor);
  compressor.connect(master);
  master.connect(context.destination);
  return { tonal, drums, pump, master };
}

function connectWithPan(
  context: BaseAudioContext,
  source: AudioNode,
  destination: AudioNode,
  pan: number,
) {
  const panner = context.createStereoPanner();
  panner.pan.value = clamp(pan, -0.72, 0.72);
  source.connect(panner);
  panner.connect(destination);
}

function scheduleTone(
  context: BaseAudioContext,
  graph: AudioGraph,
  shape: SoundShape,
  time: number,
  seconds: number,
  scale: ScaleId,
  bucket?: Set<AudioScheduledSourceNode>,
) {
  const frequency = midiToFrequency(midiFromShape(shape, scale));
  const velocity = eventVelocity(shape);
  const pan = shape.pan * (shape.instrument === "bass" ? 0.32 : 0.72);
  const seed = hashString(shape.id);
  const variant = seed & 3;
  const amp = context.createGain();
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value =
    shape.instrument === "brass"
      ? 4.5
      : shape.instrument === "pluck"
        ? 1.65
        : shape.instrument === "bass"
          ? 6.5
          : 1.1;
  filter.frequency.setValueAtTime(
    shape.instrument === "strings"
      ? 2600
      : shape.instrument === "bass"
        ? 900
        : shape.instrument === "flute"
          ? 5200
          : 6200,
    time,
  );
  filter.connect(amp);
  connectWithPan(context, amp, graph.tonal, pan);

  const end = time + Math.max(0.07, seconds);
  amp.gain.setValueAtTime(EPSILON, time);

  const oscillators: OscillatorNode[] = [];
  const addOscillator = (
    type: OscillatorType,
    ratio: number,
    detune: number,
    level: number,
  ) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = Math.min(10000, frequency * ratio);
    oscillator.detune.value = detune;
    gain.gain.value = level;
    oscillator.connect(gain);
    gain.connect(filter);
    oscillator.start(time);
    oscillator.stop(end + 0.75);
    registerSource(oscillator, bucket);
    oscillators.push(oscillator);
    return oscillator;
  };

  const addNoiseLayer = (
    filterType: BiquadFilterType,
    filterFrequency: number,
    level: number,
    loopNoise = false,
  ) => {
    const noise = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    noise.buffer = makeNoiseBuffer(
      context,
      loopNoise ? 0.22 : Math.min(0.42, Math.max(0.08, seconds)),
      seed ^ 0x9e3779b9,
    );
    noise.loop = loopNoise;
    noiseFilter.type = filterType;
    noiseFilter.frequency.value = filterFrequency;
    noiseFilter.Q.value = filterType === "bandpass" ? 1.4 : 0.7;
    noiseGain.gain.value = level;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(amp);
    noise.start(time);
    noise.stop(loopNoise ? end + 0.2 : Math.min(end + 0.08, time + 0.5));
    registerSource(noise, bucket);
  };

  const addVibrato = (depth: number, rate: number) => {
    const lfo = context.createOscillator();
    const lfoGain = context.createGain();
    lfo.frequency.value = rate;
    lfoGain.gain.value = depth;
    lfo.connect(lfoGain);
    oscillators.forEach((oscillator) => lfoGain.connect(oscillator.detune));
    lfo.start(time);
    lfo.stop(end + 0.55);
    registerSource(lfo, bucket);
  };

  if (shape.instrument === "brass") {
    addOscillator("sawtooth", variant === 2 ? 2 : 1, -7, 0.12);
    addOscillator("sawtooth", 1, 7, 0.1);
    filter.frequency.setValueAtTime(720, time);
    filter.frequency.exponentialRampToValueAtTime(6800, time + 0.026);
    filter.frequency.exponentialRampToValueAtTime(1900, Math.min(end, time + 0.18));
    amp.gain.exponentialRampToValueAtTime(velocity * 0.62, time + 0.008);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.26, Math.min(end, time + 0.11));
  } else if (shape.instrument === "organ") {
    addOscillator("sine", 1, -3, 0.15);
    addOscillator("triangle", 2, 3, 0.07);
    addOscillator("sine", 3, 0, 0.035);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.5, time + 0.022);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.34, Math.min(end, time + 0.12));
  } else if (shape.instrument === "keys") {
    addOscillator("triangle", 1, 8, 0.15);
    addOscillator("sine", 2, -5, 0.055);
    filter.frequency.value = 9800;
    amp.gain.exponentialRampToValueAtTime(velocity * 0.72, time + 0.003);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.12, Math.min(end, time + 0.15));
  } else if (shape.instrument === "strings") {
    addOscillator("sawtooth", 1, -9, 0.1);
    addOscillator("sawtooth", 1, 9, 0.1);
    addOscillator("triangle", 0.5, 0, 0.065);
    filter.frequency.setValueAtTime(2300, time);
    filter.frequency.exponentialRampToValueAtTime(5200, time + 0.12);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.42, time + 0.075);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.3, Math.min(end, time + 0.26));
  } else if (shape.instrument === "pluck") {
    const attack = addOscillator("triangle", 1, variant % 2 ? 3 : -3, 0.072);
    addOscillator("sine", 2, -2, 0.032);
    addOscillator("sine", 3, 2, 0.009);
    const stringExciter = context.createBufferSource();
    const exciterGain = context.createGain();
    const stringDelay = context.createDelay(0.1);
    const stringDamping = context.createBiquadFilter();
    const stringFeedback = context.createGain();
    const stringLevel = context.createGain();
    stringExciter.buffer = makeNoiseBuffer(context, 0.018, seed ^ 0x85ebca6b);
    stringDelay.delayTime.setValueAtTime(Math.min(0.1, 1 / frequency), time);
    exciterGain.gain.value = 0.14;
    stringDamping.type = "lowpass";
    stringDamping.frequency.setValueAtTime(2900, time);
    stringDamping.frequency.exponentialRampToValueAtTime(1450, end + 0.25);
    stringFeedback.gain.setValueAtTime(0.8, time);
    stringFeedback.gain.exponentialRampToValueAtTime(0.57, end);
    stringFeedback.gain.exponentialRampToValueAtTime(EPSILON, end + 0.36);
    stringLevel.gain.value = 0.16;
    stringExciter.connect(exciterGain);
    exciterGain.connect(stringDelay);
    stringDelay.connect(stringDamping);
    stringDamping.connect(stringFeedback);
    stringFeedback.connect(stringDelay);
    stringDelay.connect(stringLevel);
    stringLevel.connect(amp);
    stringExciter.start(time);
    stringExciter.stop(time + 0.02);
    registerSource(stringExciter, bucket);
    attack.frequency.setValueAtTime(Math.min(10000, frequency * 1.12), time);
    attack.frequency.exponentialRampToValueAtTime(frequency, time + 0.032);
    filter.frequency.setValueAtTime(5200, time);
    filter.frequency.exponentialRampToValueAtTime(1050, Math.min(end, time + 0.22));
    amp.gain.exponentialRampToValueAtTime(velocity * 0.48, time + 0.007);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.075, Math.min(end, time + 0.21));
  } else if (shape.instrument === "bass") {
    const body = addOscillator("sawtooth", 1, -4, 0.13);
    addOscillator("sine", 0.5, 0, 0.19);
    addOscillator("square", 1, 7, 0.032);
    body.frequency.setValueAtTime(Math.min(10000, frequency * 1.75), time);
    body.frequency.exponentialRampToValueAtTime(frequency, time + 0.035);
    filter.frequency.setValueAtTime(180, time);
    filter.frequency.exponentialRampToValueAtTime(3600, time + 0.027);
    filter.frequency.exponentialRampToValueAtTime(440, Math.min(end, time + 0.22));
    amp.gain.exponentialRampToValueAtTime(velocity * 0.76, time + 0.004);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.31, Math.min(end, time + 0.13));
  } else if (shape.instrument === "chord") {
    const fifth = 2 ** (7 / 12);
    addOscillator("sawtooth", 1, -10, 0.052);
    addOscillator("sawtooth", 1, 10, 0.052);
    addOscillator("triangle", fifth, -5, 0.065);
    addOscillator("sawtooth", 2, 5, 0.038);
    filter.frequency.setValueAtTime(1500, time);
    const chordOpenTime = Math.min(end, time + 0.085);
    filter.frequency.exponentialRampToValueAtTime(8200, chordOpenTime);
    if (end > chordOpenTime + 0.001) {
      filter.frequency.exponentialRampToValueAtTime(3100, Math.min(end, time + 0.5));
    }
    amp.gain.exponentialRampToValueAtTime(velocity * 0.45, time + 0.024);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.29, Math.min(end, time + 0.21));
  } else {
    addOscillator("sine", 1, -2, 0.17);
    addOscillator("triangle", 2, 3, 0.026);
    addOscillator("sine", 3, 0, 0.009);
    addNoiseLayer("bandpass", 2750, 0.018, true);
    filter.frequency.setValueAtTime(3500, time);
    filter.frequency.exponentialRampToValueAtTime(6100, time + 0.09);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.42, time + 0.038);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.27, Math.min(end, time + 0.24));
    addVibrato(7.5, 5.25 + variant * 0.14);
  }

  const envelope: Record<TonalInstrumentId, [number, number]> = {
    brass: [0.24, 0.28],
    organ: [0.34, 0.3],
    keys: [0.12, 0.28],
    strings: [0.3, 0.62],
    pluck: [0.04, 0.2],
    bass: [0.24, 0.24],
    chord: [0.28, 0.56],
    flute: [0.25, 0.48],
  };
  const [sustain, release] = envelope[shape.instrument as TonalInstrumentId];
  const releaseLevel = sustain <= EPSILON ? EPSILON : velocity * sustain;
  amp.gain.setValueAtTime(Math.max(EPSILON, releaseLevel), end);
  amp.gain.exponentialRampToValueAtTime(EPSILON, end + release);

  if (
    variant === 3 &&
    shape.durationSteps >= 4 &&
    !["strings", "chord", "flute", "pluck"].includes(shape.instrument)
  ) {
    const glitch = context.createOscillator();
    const glitchGain = context.createGain();
    glitch.type = "square";
    glitch.frequency.value = Math.min(10000, frequency * 2);
    glitchGain.gain.setValueAtTime(EPSILON, time + 0.055);
    glitchGain.gain.exponentialRampToValueAtTime(velocity * 0.045, time + 0.06);
    glitchGain.gain.exponentialRampToValueAtTime(EPSILON, time + 0.095);
    glitch.connect(glitchGain);
    connectWithPan(context, glitchGain, graph.tonal, -pan * 0.5);
    glitch.start(time + 0.05);
    glitch.stop(time + 0.11);
    registerSource(glitch, bucket);
  }
}

type DrumZone = "low" | "mid" | "high";
type DrumFilterSettings = {
  type: BiquadFilterType;
  frequency: number;
  q?: number;
};

function drumZone(y: number): DrumZone {
  return y >= 0.68 ? "low" : y >= 0.34 ? "mid" : "high";
}

function drumPieceName(shape: SoundShape) {
  if (!isDrumInstrument(shape.instrument)) return "旋律音符";
  const names: Record<DrumInstrumentId, Record<DrumZone, string>> = {
    drums: { low: "弹性底鼓", mid: "清脆军鼓", high: "亮色踩镲" },
    taiko: { low: "大太鼓", mid: "締太鼓", high: "拍子木" },
    chipDrums: { low: "像素底鼓", mid: "8-bit 军鼓", high: "像素踩镲" },
    glitchDrums: { low: "切片底鼓", mid: "碎片军鼓", high: "故障点拍" },
    festivalDrums: { low: "祭典重鼓", mid: "霓虹拍手", high: "铃音沙锤" },
  };
  return names[shape.instrument][drumZone(shape.y)];
}

function shapePitchLabel(shape: SoundShape, scale: ScaleId) {
  return isDrumInstrument(shape.instrument)
    ? drumPieceName(shape)
    : midiToName(midiFromShape(shape, scale));
}

function triggerDrumPump(graph: AudioGraph, time: number, depth: number, release: number) {
  graph.pump.gain.cancelScheduledValues(time);
  graph.pump.gain.setValueAtTime(Math.max(EPSILON, depth), time);
  graph.pump.gain.exponentialRampToValueAtTime(1, time + release);
}

function scheduleDrumOscillator(
  context: BaseAudioContext,
  destination: AudioNode,
  time: number,
  settings: {
    type: OscillatorType;
    startFrequency: number;
    endFrequency?: number;
    pitchDuration?: number;
    duration: number;
    level: number;
    pan: number;
    filter?: DrumFilterSettings;
  },
  bucket?: Set<AudioScheduledSourceNode>,
) {
  const oscillator = context.createOscillator();
  const amp = context.createGain();
  oscillator.type = settings.type;
  oscillator.frequency.setValueAtTime(Math.max(1, settings.startFrequency), time);
  if (settings.endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(1, settings.endFrequency),
      time + Math.min(settings.duration, settings.pitchDuration ?? settings.duration * 0.5),
    );
  }
  amp.gain.setValueAtTime(EPSILON, time);
  amp.gain.exponentialRampToValueAtTime(
    Math.max(EPSILON, settings.level),
    time + Math.min(0.003, settings.duration * 0.2),
  );
  amp.gain.exponentialRampToValueAtTime(EPSILON, time + settings.duration);
  if (settings.filter) {
    const filter = context.createBiquadFilter();
    filter.type = settings.filter.type;
    filter.frequency.value = settings.filter.frequency;
    filter.Q.value = settings.filter.q ?? 0.7;
    oscillator.connect(filter);
    filter.connect(amp);
  } else {
    oscillator.connect(amp);
  }
  connectWithPan(context, amp, destination, settings.pan);
  oscillator.start(time);
  oscillator.stop(time + settings.duration + 0.03);
  registerSource(oscillator, bucket);
}

function scheduleDrumNoise(
  context: BaseAudioContext,
  destination: AudioNode,
  time: number,
  seed: number,
  settings: {
    duration: number;
    level: number;
    pan: number;
    filter: DrumFilterSettings;
    secondFilter?: DrumFilterSettings;
    chip?: { levels: number; holdSamples: number };
  },
  bucket?: Set<AudioScheduledSourceNode>,
) {
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const secondFilter = settings.secondFilter ? context.createBiquadFilter() : null;
  const amp = context.createGain();
  source.buffer = settings.chip
    ? makeChipNoiseBuffer(
        context,
        settings.duration + 0.02,
        seed,
        settings.chip.levels,
        settings.chip.holdSamples,
      )
    : makeNoiseBuffer(context, settings.duration + 0.02, seed);
  filter.type = settings.filter.type;
  filter.frequency.value = settings.filter.frequency;
  filter.Q.value = settings.filter.q ?? 0.8;
  amp.gain.setValueAtTime(EPSILON, time);
  amp.gain.exponentialRampToValueAtTime(
    Math.max(EPSILON, settings.level),
    time + Math.min(0.0025, settings.duration * 0.2),
  );
  amp.gain.exponentialRampToValueAtTime(EPSILON, time + settings.duration);
  source.connect(filter);
  if (secondFilter && settings.secondFilter) {
    secondFilter.type = settings.secondFilter.type;
    secondFilter.frequency.value = settings.secondFilter.frequency;
    secondFilter.Q.value = settings.secondFilter.q ?? 0.7;
    filter.connect(secondFilter);
    secondFilter.connect(amp);
  } else {
    filter.connect(amp);
  }
  connectWithPan(context, amp, destination, settings.pan);
  source.start(time);
  source.stop(time + settings.duration + 0.025);
  registerSource(source, bucket);
}

function scheduleDrum(
  context: BaseAudioContext,
  graph: AudioGraph,
  shape: SoundShape,
  time: number,
  bucket?: Set<AudioScheduledSourceNode>,
) {
  if (!isDrumInstrument(shape.instrument)) return;
  const velocity = eventVelocity(shape);
  const pan = shape.pan * 0.55;
  const seed = hashString(shape.id);
  const zone = drumZone(shape.y);

  if (shape.instrument === "taiko") {
    if (zone === "low") {
      scheduleDrumOscillator(context, graph.drums, time, { type: "sine", startFrequency: 138, endFrequency: 48, pitchDuration: 0.07, duration: 0.58, level: velocity * 0.34, pan: pan * 0.18, filter: { type: "lowpass", frequency: 1100 } }, bucket);
      scheduleDrumOscillator(context, graph.drums, time, { type: "triangle", startFrequency: 78, endFrequency: 46, pitchDuration: 0.12, duration: 0.42, level: velocity * 0.12, pan: -pan * 0.12 }, bucket);
      scheduleDrumNoise(context, graph.drums, time, seed, { duration: 0.09, level: velocity * 0.07, pan, filter: { type: "bandpass", frequency: 240, q: 0.85 }, secondFilter: { type: "lowpass", frequency: 1500 } }, bucket);
      triggerDrumPump(graph, time, 0.68, 0.14);
    } else if (zone === "mid") {
      scheduleDrumOscillator(context, graph.drums, time, { type: "triangle", startFrequency: 270, endFrequency: 165, pitchDuration: 0.065, duration: 0.18, level: velocity * 0.13, pan: pan * 0.2 }, bucket);
      scheduleDrumNoise(context, graph.drums, time, seed, { duration: 0.14, level: velocity * 0.16, pan, filter: { type: "bandpass", frequency: 1900, q: 1.2 }, secondFilter: { type: "lowpass", frequency: 4800 } }, bucket);
      scheduleDrumNoise(context, graph.drums, time, seed ^ 0x9e37, { duration: 0.026, level: velocity * 0.035, pan: -pan, filter: { type: "highpass", frequency: 3600 }, secondFilter: { type: "lowpass", frequency: 6200 } }, bucket);
    } else {
      scheduleDrumOscillator(context, graph.drums, time, { type: "sine", startFrequency: 920, duration: 0.15, level: velocity * 0.07, pan, filter: { type: "lowpass", frequency: 4800 } }, bucket);
      scheduleDrumOscillator(context, graph.drums, time, { type: "sine", startFrequency: 1510, duration: 0.1, level: velocity * 0.032, pan: -pan, filter: { type: "lowpass", frequency: 4800 } }, bucket);
      scheduleDrumNoise(context, graph.drums, time, seed, { duration: 0.035, level: velocity * 0.03, pan, filter: { type: "bandpass", frequency: 2900, q: 2 }, secondFilter: { type: "lowpass", frequency: 4800 } }, bucket);
    }
    return;
  }

  if (shape.instrument === "chipDrums") {
    if (zone === "low") {
      scheduleDrumOscillator(context, graph.drums, time, { type: "sine", startFrequency: 110, endFrequency: 45, pitchDuration: 0.045, duration: 0.18, level: velocity * 0.28, pan: pan * 0.14 }, bucket);
      scheduleDrumOscillator(context, graph.drums, time, { type: "square", startFrequency: 220, endFrequency: 65, pitchDuration: 0.03, duration: 0.075, level: velocity * 0.052, pan: -pan * 0.12, filter: { type: "lowpass", frequency: 1700 } }, bucket);
      triggerDrumPump(graph, time, 0.58, 0.12);
    } else if (zone === "mid") {
      scheduleDrumNoise(context, graph.drums, time, seed, { duration: 0.1, level: velocity * 0.16, pan, filter: { type: "bandpass", frequency: 1800, q: 0.9 }, chip: { levels: 8, holdSamples: 6 } }, bucket);
      scheduleDrumOscillator(context, graph.drums, time, { type: "triangle", startFrequency: 190, endFrequency: 125, pitchDuration: 0.05, duration: 0.09, level: velocity * 0.07, pan: -pan * 0.2 }, bucket);
    } else {
      scheduleDrumNoise(context, graph.drums, time, seed, { duration: 0.045, level: velocity * 0.105, pan, filter: { type: "highpass", frequency: 6800 }, chip: { levels: 6, holdSamples: 8 } }, bucket);
      scheduleDrumOscillator(context, graph.drums, time, { type: "square", startFrequency: 4200, duration: 0.025, level: velocity * 0.012, pan: -pan, filter: { type: "lowpass", frequency: 8500 } }, bucket);
      scheduleDrumOscillator(context, graph.drums, time, { type: "square", startFrequency: 6200, duration: 0.022, level: velocity * 0.008, pan, filter: { type: "lowpass", frequency: 8500 } }, bucket);
    }
    return;
  }

  if (shape.instrument === "glitchDrums") {
    const jitterPan = clamp(pan + ((seed & 1) ? 0.16 : -0.16), -0.72, 0.72);
    if (zone === "low") {
      scheduleDrumOscillator(context, graph.drums, time, { type: "sine", startFrequency: 145, endFrequency: 44, pitchDuration: 0.035, duration: 0.2, level: velocity * 0.27, pan: pan * 0.14 }, bucket);
      scheduleDrumOscillator(context, graph.drums, time + 0.075, { type: "sine", startFrequency: 72, endFrequency: 46, pitchDuration: 0.018, duration: 0.025, level: velocity * 0.055, pan: -jitterPan }, bucket);
      scheduleDrumOscillator(context, graph.drums, time + 0.105, { type: "triangle", startFrequency: 68, endFrequency: 45, pitchDuration: 0.016, duration: 0.025, level: velocity * 0.04, pan: jitterPan }, bucket);
      scheduleDrumNoise(context, graph.drums, time, seed, { duration: 0.018, level: velocity * 0.035, pan: jitterPan, filter: { type: "highpass", frequency: 4200 } }, bucket);
      triggerDrumPump(graph, time, 0.6, 0.11);
    } else if (zone === "mid") {
      [0, 0.024, 0.048, 0.072].forEach((offset, index) => {
        scheduleDrumNoise(context, graph.drums, time + offset, seed ^ (index * 0x45d9), { duration: 0.013, level: velocity * (0.11 - index * 0.012), pan: index % 2 ? -jitterPan : jitterPan, filter: { type: "bandpass", frequency: 1100 + index * 700, q: 1.1 }, chip: { levels: 12, holdSamples: 4 } }, bucket);
      });
      scheduleDrumOscillator(context, graph.drums, time, { type: "triangle", startFrequency: 205, endFrequency: 132, pitchDuration: 0.045, duration: 0.07, level: velocity * 0.055, pan: -pan * 0.2 }, bucket);
    } else {
      [0, 0.014, 0.028, 0.042, 0.056].forEach((offset, index) => {
        scheduleDrumNoise(context, graph.drums, time + offset, seed ^ (index * 0x9e37), { duration: 0.009, level: velocity * (0.06 - index * 0.007), pan: index % 2 ? -jitterPan : jitterPan, filter: { type: "highpass", frequency: 5400 }, chip: { levels: 8, holdSamples: 5 } }, bucket);
      });
      scheduleDrumOscillator(context, graph.drums, time, { type: "triangle", startFrequency: 3600, endFrequency: 880, pitchDuration: 0.04, duration: 0.045, level: velocity * 0.017, pan: -jitterPan, filter: { type: "lowpass", frequency: 6200 } }, bucket);
    }
    return;
  }

  if (shape.instrument === "festivalDrums") {
    if (zone === "low") {
      scheduleDrumOscillator(context, graph.drums, time, { type: "sine", startFrequency: 190, endFrequency: 50, pitchDuration: 0.038, duration: 0.27, level: velocity * 0.32, pan: pan * 0.14, filter: { type: "lowpass", frequency: 900 } }, bucket);
      scheduleDrumOscillator(context, graph.drums, time, { type: "triangle", startFrequency: 90, endFrequency: 48, pitchDuration: 0.075, duration: 0.18, level: velocity * 0.08, pan: -pan * 0.12 }, bucket);
      scheduleDrumNoise(context, graph.drums, time, seed, { duration: 0.013, level: velocity * 0.02, pan, filter: { type: "highpass", frequency: 5500 }, secondFilter: { type: "lowpass", frequency: 8200 } }, bucket);
      triggerDrumPump(graph, time, 0.48, 0.15);
    } else if (zone === "mid") {
      [0, 0.012, 0.025].forEach((offset, index) => {
        scheduleDrumNoise(context, graph.drums, time + offset, seed ^ (index * 0x85eb), { duration: index === 2 ? 0.16 : 0.05, level: velocity * [0.12, 0.1, 0.07][index], pan: index % 2 ? -pan : pan, filter: { type: "highpass", frequency: 800 }, secondFilter: { type: "lowpass", frequency: 7800 } }, bucket);
      });
      scheduleDrumOscillator(context, graph.drums, time, { type: "sine", startFrequency: 330, endFrequency: 210, pitchDuration: 0.045, duration: 0.08, level: velocity * 0.05, pan: -pan * 0.2 }, bucket);
    } else {
      scheduleDrumNoise(context, graph.drums, time, seed, { duration: 0.07, level: velocity * 0.08, pan, filter: { type: "highpass", frequency: 7200 }, secondFilter: { type: "lowpass", frequency: 9000 } }, bucket);
      [1280, 1910, 2865].forEach((frequency, index) => {
        scheduleDrumOscillator(context, graph.drums, time, { type: "sine", startFrequency: frequency, duration: [0.3, 0.22, 0.14][index], level: velocity * [0.035, 0.022, 0.01][index], pan: index % 2 ? -pan : pan, filter: { type: "lowpass", frequency: 5200 } }, bucket);
      });
    }
    return;
  }

  if (zone === "low") {
    scheduleDrumOscillator(context, graph.drums, time, { type: "sine", startFrequency: 165, endFrequency: 45, pitchDuration: 0.1, duration: 0.24, level: velocity * 0.72, pan: pan * 0.2 }, bucket);
    triggerDrumPump(graph, time, 0.48, 0.14);
    return;
  }

  const isSnare = zone === "mid";
  const duration = isSnare ? 0.17 : shape.y > 0.16 ? 0.065 : 0.12;
  scheduleDrumNoise(context, graph.drums, time, seed, { duration, level: velocity * (isSnare ? 0.42 : 0.23), pan, filter: { type: isSnare ? "bandpass" : "highpass", frequency: isSnare ? 1850 : shape.y > 0.16 ? 7200 : 5100, q: isSnare ? 0.8 : 1.4 } }, bucket);
  if (isSnare) {
    scheduleDrumOscillator(context, graph.drums, time, { type: "triangle", startFrequency: 190, endFrequency: 128, pitchDuration: 0.1, duration: 0.12, level: velocity * 0.2, pan: pan * 0.2 }, bucket);
  }
}

function scheduleShape(
  context: BaseAudioContext,
  graph: AudioGraph,
  shape: SoundShape,
  time: number,
  secondsPerBeat: number,
  scale: ScaleId,
  bucket?: Set<AudioScheduledSourceNode>,
) {
  if (isDrumInstrument(shape.instrument)) {
    scheduleDrum(context, graph, shape, time, bucket);
  } else {
    scheduleTone(
      context,
      graph,
      shape,
      time,
      eventDuration(shape) * secondsPerBeat,
      scale,
      bucket,
    );
  }
}

function createDemo(): SoundShape[] {
  const result: SoundShape[] = [];
  const add = (
    instrument: InstrumentId,
    startStep: number,
    y: number,
    durationSteps: number,
    size: number,
    pan = 0,
    rotation = 0,
  ) => result.push({ id: makeId(), instrument, startStep, y, durationSteps, size, pan, rotation });

  [0, 16, 32, 48].forEach((step) => add("drums", step, 0.84, 1, 0.07));
  [8, 24, 40, 56].forEach((step) => add("drums", step, 0.52, 1, 0.06));
  [4, 12, 20, 28, 36, 44, 52, 60].forEach((step) =>
    add("drums", step, 0.28, 1, 0.038, step % 16 ? 0.38 : -0.38, 0.25),
  );
  [0, 7, 16, 23, 32, 39, 48, 55].forEach((step, index) =>
    add("bass", step, [0.82, 0.76, 0.8, 0.72][index % 4], 2, 0.074, index % 2 ? 0.18 : -0.18),
  );
  [2, 10, 18, 26, 34, 42, 50, 58].forEach((step, index) =>
    add("pluck", step, [0.28, 0.18, 0.34, 0.22][index % 4], 1, 0.056, index % 2 ? 0.62 : -0.62, index * 0.2),
  );
  [0, 16, 32, 48].forEach((step, index) =>
    add("chord", step, [0.62, 0.56, 0.65, 0.52][index], 12, 0.084, index % 2 ? 0.24 : -0.24),
  );
  [0, 32].forEach((step) => add("taiko", step, 0.82, 2, 0.09, -0.22));
  [16, 48].forEach((step) => add("taiko", step, 0.5, 1, 0.068, 0.22));
  [6, 14, 22, 30, 38, 46, 54, 62].forEach((step, index) =>
    add("chipDrums", step, 0.18, 1, 0.047, index % 2 ? 0.46 : -0.46, 0.18),
  );
  [15, 31, 47, 63].forEach((step, index) =>
    add("glitchDrums", step, 0.46, 1, 0.061, index % 2 ? 0.58 : -0.58, -0.26),
  );
  [12, 28, 44, 60].forEach((step, index) =>
    add("festivalDrums", step, 0.12, 1, 0.062, index % 2 ? 0.36 : -0.36, 0.3),
  );
  [5, 21, 37, 53].forEach((step, index) =>
    add("flute", step, [0.2, 0.14, 0.25, 0.17][index], 3, 0.064, index % 2 ? 0.34 : -0.34, 0.1),
  );
  [3, 11, 19, 27, 35, 43, 51, 59].forEach((step, index) =>
    add("organ", step, [0.67, 0.62, 0.72, 0.58][index % 4], 3, 0.057, index % 2 ? 0.34 : -0.34, index * 0.18),
  );
  [1, 9, 17, 25, 33, 41, 49, 57].forEach((step, index) =>
    add("keys", step, [0.32, 0.22, 0.38, 0.17, 0.29, 0.12, 0.25, 0.2][index], 2, 0.052, index % 2 ? 0.55 : -0.55, Math.PI / 4),
  );
  [6, 22, 38, 54].forEach((step, index) =>
    add("brass", step, [0.45, 0.36, 0.48, 0.31][index], 5, 0.075, index % 2 ? 0.5 : -0.5, index % 2 ? 0.16 : -0.12),
  );
  add("strings", 8, 0.57, 18, 0.095, -0.22, -0.08);
  add("strings", 38, 0.49, 20, 0.1, 0.24, 0.08);
  return result;
}

function formClass(form: ShapeForm) {
  return `mini-shape mini-shape--${form}`;
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shapesRef = useRef<SoundShape[]>([]);
  const timelineShapesRef = useRef<SoundShape[]>([]);
  const interactionRef = useRef<Interaction | null>(null);
  const gestureSnapshotRef = useRef<SoundShape[] | null>(null);
  const gestureChangedRef = useRef(false);
  const historyRef = useRef<SoundShape[][]>([]);
  const futureRef = useRef<SoundShape[][]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioGraphRef = useRef<AudioGraph | null>(null);
  const audioSourcesRef = useRef(new Set<AudioScheduledSourceNode>());
  const schedulerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animationRef = useRef<number | null>(null);
  const playbackTokenRef = useRef(0);
  const transportRef = useRef<TransportState | null>(null);
  const loopRef = useRef(true);
  const viewStartStepRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredRef = useRef(false);

  const [shapes, setShapes] = useState<SoundShape[]>([]);
  const [instrument, setInstrument] = useState<InstrumentId>("keys");
  const [tool, setTool] = useState<ToolId>("draw");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyCount, setHistoryCount] = useState(0);
  const [futureCount, setFutureCount] = useState(0);
  const [bpm, setBpm] = useState(132);
  const [scale, setScale] = useState<ScaleId>("hirajoshi");
  const [loop, setLoop] = useState(true);
  const [volume, setVolume] = useState(0.72);
  const [muted, setMuted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playheadBeat, setPlayheadBeat] = useState(0);
  const [viewStartStep, setViewStartStep] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [toast, setToast] = useState("");
  const [clearArmed, setClearArmed] = useState(false);
  const [projectTitle, setProjectTitle] = useState("春日回响 01");
  const [saved, setSaved] = useState(true);

  const selectedShape = useMemo(
    () => shapes.find((shape) => shape.id === selectedId) ?? null,
    [selectedId, shapes],
  );

  const setShapesDirect = useCallback((next: SoundShape[]) => {
    shapesRef.current = next;
    timelineShapesRef.current = [...next].sort((left, right) => left.startStep - right.startStep);
    setShapes(next);
    setSaved(false);
  }, []);

  const syncStacks = useCallback(() => {
    setHistoryCount(historyRef.current.length);
    setFutureCount(futureRef.current.length);
  }, []);

  const commitShapes = useCallback(
    (next: SoundShape[]) => {
      if (next === shapesRef.current) return;
      historyRef.current = [...historyRef.current.slice(-39), shapesRef.current];
      futureRef.current = [];
      setShapesDirect(next);
      syncStacks();
    },
    [setShapesDirect, syncStacks],
  );

  const finishGesture = useCallback(() => {
    if (gestureChangedRef.current && gestureSnapshotRef.current) {
      historyRef.current = [...historyRef.current.slice(-39), gestureSnapshotRef.current];
      futureRef.current = [];
      syncStacks();
    }
    interactionRef.current = null;
    gestureSnapshotRef.current = null;
    gestureChangedRef.current = false;
  }, [syncStacks]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 2800);
  }, []);

  const undo = useCallback(() => {
    const previous = historyRef.current.at(-1);
    if (!previous) return;
    historyRef.current = historyRef.current.slice(0, -1);
    futureRef.current = [shapesRef.current, ...futureRef.current].slice(0, 40);
    setShapesDirect(previous);
    setSelectedId(null);
    syncStacks();
    showToast("已撤销上一步");
  }, [setShapesDirect, showToast, syncStacks]);

  const redo = useCallback(() => {
    const next = futureRef.current[0];
    if (!next) return;
    futureRef.current = futureRef.current.slice(1);
    historyRef.current = [...historyRef.current.slice(-39), shapesRef.current];
    setShapesDirect(next);
    setSelectedId(null);
    syncStacks();
    showToast("已重做");
  }, [setShapesDirect, showToast, syncStacks]);

  const stopPlayback = useCallback((reset = true) => {
    playbackTokenRef.current += 1;
    if (schedulerRef.current) clearInterval(schedulerRef.current);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    schedulerRef.current = null;
    animationRef.current = null;
    transportRef.current = null;
    const now = audioContextRef.current?.currentTime ?? 0;
    const graph = audioGraphRef.current;
    if (graph) {
      graph.master.gain.cancelScheduledValues(now);
      graph.master.gain.setValueAtTime(Math.max(EPSILON, graph.master.gain.value), now);
      graph.master.gain.exponentialRampToValueAtTime(EPSILON, now + 0.025);
    }
    audioSourcesRef.current.forEach((source) => {
      try {
        source.stop(now + 0.03);
      } catch {
        // A source that already ended is safe to ignore.
      }
    });
    audioSourcesRef.current.clear();
    audioGraphRef.current = null;
    setPlaying(false);
    if (reset) setPlayheadBeat(0);
  }, []);

  const navigateToStep = useCallback((step: number) => {
    const next = Math.max(0, Math.round(step));
    viewStartStepRef.current = next;
    setViewStartStep(next);
  }, []);

  const play = useCallback(async () => {
    if (playing) {
      stopPlayback();
      return;
    }
    if (shapesRef.current.length === 0) {
      showToast("先画下一个声音，或载入示例段落");
      return;
    }
    stopPlayback();
    const AudioCtor = window.AudioContext;
    if (!AudioCtor) {
      showToast("当前浏览器不支持 Web Audio");
      return;
    }
    const context = audioContextRef.current ?? new AudioCtor();
    audioContextRef.current = context;
    await context.resume();
    setAudioReady(true);

    const token = playbackTokenRef.current + 1;
    playbackTokenRef.current = token;
    const graph = createAudioGraph(context, bpm, muted ? 0 : volume);
    audioGraphRef.current = graph;
    const secondsPerBeat = 60 / bpm;
    const duration = projectEndStep(shapesRef.current) / STEPS_PER_BEAT * secondsPerBeat;
    const origin = context.currentTime + START_DELAY_SECONDS;
    const events = shapesRef.current
      .map((shape) => ({
        shape: { ...shape },
        offsetSeconds: shapeStartBeat(shape) * secondsPerBeat,
      }))
      .sort((left, right) => left.offsetSeconds - right.offsetSeconds);
    transportRef.current = {
      token,
      origin,
      duration,
      secondsPerBeat,
      cycle: 0,
      eventIndex: 0,
      events,
    };

    const pump = () => {
      const state = transportRef.current;
      if (!state || state.token !== playbackTokenRef.current) return;
      const now = context.currentTime;
      const horizon = now + LOOKAHEAD_SECONDS;
      if (loopRef.current && now > state.origin + (state.cycle + 1) * state.duration) {
        const currentCycle = Math.max(0, Math.floor((now - state.origin) / state.duration));
        if (currentCycle > state.cycle) {
          state.cycle = currentCycle;
          state.eventIndex = 0;
        }
      }

      while (true) {
        const cycleStart = state.origin + state.cycle * state.duration;
        const cycleEnd = cycleStart + state.duration;
        const event = state.events[state.eventIndex];
        if (event) {
          const eventTime = cycleStart + event.offsetSeconds;
          if (eventTime >= horizon) break;
          if (eventTime >= now - LATE_GRACE_SECONDS) {
            scheduleShape(
              context,
              graph,
              event.shape,
              Math.max(eventTime, now + 0.003),
              state.secondsPerBeat,
              scale,
              audioSourcesRef.current,
            );
          }
          state.eventIndex += 1;
          continue;
        }
        if (cycleEnd > horizon) break;
        if (!loopRef.current) break;
        state.cycle += 1;
        state.eventIndex = 0;
      }

      const currentCycleEnd = state.origin + (state.cycle + 1) * state.duration;
      if (!loopRef.current && now >= currentCycleEnd + effectTailSeconds(bpm)) {
        stopPlayback(false);
      }
    };

    pump();
    schedulerRef.current = setInterval(pump, SCHEDULER_TICK_MS);
    setPlaying(true);

    const animate = () => {
      if (token !== playbackTokenRef.current) return;
      const state = transportRef.current;
      if (!state) return;
      const elapsed = Math.max(0, context.currentTime - state.origin);
      const currentCycleEnd = (state.cycle + 1) * state.duration;
      const timelineSeconds = !loopRef.current && elapsed >= currentCycleEnd
        ? state.duration
        : elapsed % state.duration;
      const nextBeat = timelineSeconds / state.secondsPerBeat;
      setPlayheadBeat(nextBeat);
      const nextStep = nextBeat * STEPS_PER_BEAT;
      if (
        nextStep < viewStartStepRef.current ||
        nextStep >= viewStartStepRef.current + VIEW_STEPS
      ) {
        const nextView = Math.floor(nextStep / VIEW_STEPS) * VIEW_STEPS;
        viewStartStepRef.current = nextView;
        setViewStartStep(nextView);
      }
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
  }, [bpm, muted, playing, scale, showToast, stopPlayback, volume]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(bounds.width * dpr);
    const pixelHeight = Math.round(bounds.height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = bounds.width;
    const height = bounds.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    context.fillStyle = "#e8e8ef";
    const visibleStart = viewStartStep;
    const visibleEnd = visibleStart + VIEW_STEPS;
    for (let step = Math.ceil(visibleStart); step <= visibleEnd; step += 1) {
      const x = ((step - visibleStart) / VIEW_STEPS) * width;
      for (let line = 0; line <= 12; line += 1) {
        const y = (line / 12) * height;
        context.beginPath();
        context.arc(x, y, step % STEPS_PER_BEAT === 0 ? 1 : 0.65, 0, Math.PI * 2);
        context.fill();
      }
      if (step % STEPS_PER_BAR === 0) {
        context.strokeStyle = "#d7d7e1";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
    }

    const timeline = timelineShapesRef.current;
    let low = 0;
    let high = timeline.length;
    const earliestRelevantStart = Math.max(0, visibleStart - MAX_NOTE_STEPS);
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (timeline[middle].startStep < earliestRelevantStart) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < timeline.length; index += 1) {
      const shape = timeline[index];
      if (shape.startStep > visibleEnd) break;
      const shapeEnd = shape.startStep + shape.durationSteps;
      if (shapeEnd < visibleStart) continue;
      const config = getInstrument(shape.instrument);
      const x = ((shape.startStep + shape.durationSteps / 2 - visibleStart) / VIEW_STEPS) * width;
      const y = shape.y * height;
      const shapeWidth = Math.max(12, (shape.durationSteps / VIEW_STEPS) * width);
      const shapeHeight = Math.max(14, shape.size * height);
      const selected = shape.id === selectedId;
      context.save();
      context.translate(x, y);
      context.rotate(shape.rotation);
      context.shadowColor = "rgba(24, 24, 30, 0.18)";
      context.shadowBlur = selected ? 12 : 0;
      context.shadowOffsetY = selected ? 4 : 0;
      context.strokeStyle = config.color;
      context.fillStyle = config.color;
      context.lineWidth = Math.max(7, shapeHeight * 0.3);
      context.beginPath();
      if (config.form === "triangle") {
        context.moveTo(-shapeWidth / 2, shapeHeight / 2);
        context.lineTo(0, -shapeHeight / 2);
        context.lineTo(shapeWidth / 2, shapeHeight / 2);
        context.closePath();
        context.fill();
      } else if (config.form === "ring") {
        context.ellipse(0, 0, shapeWidth / 2, shapeHeight / 2, 0, 0, Math.PI * 2);
        context.fill();
      } else if (config.form === "diamond") {
        context.moveTo(0, -shapeHeight / 2);
        context.lineTo(shapeWidth / 2, 0);
        context.lineTo(0, shapeHeight / 2);
        context.lineTo(-shapeWidth / 2, 0);
        context.closePath();
        context.fill();
      } else if (config.form === "block") {
        context.rect(-shapeWidth / 2, -shapeHeight / 2, shapeWidth, shapeHeight);
        context.fill();
        context.fillStyle = "#ffffff";
        context.fillRect(-shapeWidth * 0.12, -shapeHeight / 2, shapeWidth * 0.24, shapeHeight);
      } else if (config.form === "wave") {
        context.moveTo(-shapeWidth / 2, 0);
        context.bezierCurveTo(-shapeWidth / 4, -shapeHeight, shapeWidth / 4, shapeHeight, shapeWidth / 2, 0);
        context.lineCap = "round";
        context.stroke();
      } else if (config.form === "spark") {
        for (let point = 0; point < 16; point += 1) {
          const angle = -Math.PI / 2 + point * Math.PI / 8;
          const radius = point % 2 === 0 ? 1 : 0.38;
          const px = Math.cos(angle) * shapeWidth / 2 * radius;
          const py = Math.sin(angle) * shapeHeight / 2 * radius;
          if (point === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.closePath();
        context.fill();
      } else if (config.form === "capsule") {
        context.roundRect(
          -shapeWidth / 2,
          -shapeHeight / 2,
          shapeWidth,
          shapeHeight,
          Math.min(shapeHeight / 2, 18),
        );
        context.fill();
        context.fillStyle = "#ffffff";
        context.beginPath();
        context.arc(-shapeWidth * 0.27, 0, Math.max(2.5, shapeHeight * 0.11), 0, Math.PI * 2);
        context.fill();
      } else if (config.form === "petal") {
        context.ellipse(-shapeWidth * 0.18, 0, shapeWidth * 0.27, shapeHeight * 0.25, -0.45, 0, Math.PI * 2);
        context.ellipse(shapeWidth * 0.18, 0, shapeWidth * 0.27, shapeHeight * 0.25, 0.45, 0, Math.PI * 2);
        context.ellipse(0, -shapeHeight * 0.18, shapeWidth * 0.18, shapeHeight * 0.28, 0, 0, Math.PI * 2);
        context.ellipse(0, shapeHeight * 0.18, shapeWidth * 0.18, shapeHeight * 0.28, 0, 0, Math.PI * 2);
        context.fill();
      } else if (config.form === "slash") {
        context.moveTo(-shapeWidth * 0.42, shapeHeight / 2);
        context.lineTo(-shapeWidth / 2, shapeHeight * 0.12);
        context.lineTo(shapeWidth * 0.42, -shapeHeight / 2);
        context.lineTo(shapeWidth / 2, -shapeHeight * 0.12);
        context.closePath();
        context.fill();
      } else {
        context.moveTo(0, -shapeHeight / 2);
        context.bezierCurveTo(
          shapeWidth * 0.42,
          -shapeHeight * 0.08,
          shapeWidth * 0.32,
          shapeHeight * 0.48,
          0,
          shapeHeight / 2,
        );
        context.bezierCurveTo(
          -shapeWidth * 0.32,
          shapeHeight * 0.48,
          -shapeWidth * 0.42,
          -shapeHeight * 0.08,
          0,
          -shapeHeight / 2,
        );
        context.fill();
      }
      if (selected) {
        context.shadowBlur = 0;
        context.shadowOffsetY = 0;
        context.fillStyle = "#19191f";
        context.beginPath();
        context.arc(shapeWidth / 2 + 6, -shapeHeight / 2 - 6, 4.5, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }
  }, [selectedId, viewStartStep]);

  useEffect(() => {
    drawCanvas();
    const observer = new ResizeObserver(drawCanvas);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [drawCanvas, shapes]);

  useEffect(() => {
    let active = true;
    queueMicrotask(async () => {
      if (!active) return;
      try {
        const encoded = window.location.hash.startsWith("#s=") ? window.location.hash.slice(3) : "";
        const padded = encoded
          ? `${encoded.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - (encoded.length % 4)) % 4)}`
          : "";
        const project = encoded
          ? JSON.parse(
              new TextDecoder().decode(
                Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)),
              ),
            ) as Partial<StoredProject>
          : await loadStoredProject();
        if (project?.version === 2 && Array.isArray(project.shapes)) {
          const safeShapes = project.shapes
            .map(normalizeShape)
            .filter((shape): shape is SoundShape => Boolean(shape));
          shapesRef.current = safeShapes;
          timelineShapesRef.current = [...safeShapes].sort(
            (left, right) => left.startStep - right.startStep,
          );
          setShapes(safeShapes);
          if (typeof project.bpm === "number") setBpm(clamp(project.bpm, 90, 180));
          if (isScaleId(project.scale)) setScale(project.scale);
          if (typeof project.title === "string") setProjectTitle(project.title.slice(0, 36));
          if (encoded) showToast("共享作品已载入，可以直接 Remix");
        } else if (project) {
          showToast("已启用新版无限画布；旧练习稿未迁移");
        }
        localStorage.removeItem("synesthesia-canvas-project");
      } catch {
        showToast("作品链接无法解析，已打开空白画布");
      }
      restoredRef.current = true;
      setSaved(true);
    });
    return () => {
      active = false;
    };
  }, [showToast]);

  useEffect(() => {
    if (!restoredRef.current) return;
    const timer = setTimeout(() => {
      void saveStoredProject({ version: 2, shapes, bpm, scale, title: projectTitle })
        .then(() => setSaved(true))
        .catch(() => showToast("本机存储空间不足，但当前画布仍可继续创作"));
    }, 420);
    return () => clearTimeout(timer);
  }, [bpm, projectTitle, scale, shapes, showToast]);

  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  useEffect(() => {
    if (audioGraphRef.current) {
      const now = audioContextRef.current?.currentTime ?? 0;
      audioGraphRef.current.master.gain.setTargetAtTime(muted ? EPSILON : volume * 0.78, now, 0.025);
    }
  }, [muted, volume]);

  useEffect(
    () => () => {
      if (schedulerRef.current) clearInterval(schedulerRef.current);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      audioSourcesRef.current.forEach((source) => {
        try {
          source.stop();
        } catch {
          // Cleanup after a completed source needs no action.
        }
      });
      void audioContextRef.current?.close();
    },
    [],
  );

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const screenX = clamp((event.clientX - bounds.left) / bounds.width);
    return {
      screenX,
      step: Math.max(0, Math.round(viewStartStepRef.current + screenX * VIEW_STEPS)),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  };

  const findShapeAt = (step: number, y: number) => {
    const timeline = timelineShapesRef.current;
    let low = 0;
    let high = timeline.length;
    const earliestStart = Math.max(0, step - MAX_NOTE_STEPS - 1);
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (timeline[middle].startStep < earliestStart) low = middle + 1;
      else high = middle;
    }
    const candidates: SoundShape[] = [];
    for (let index = low; index < timeline.length; index += 1) {
      const shape = timeline[index];
      if (shape.startStep > step + 1) break;
      const height = Math.max(0.04, shape.size) * 0.8;
      if (
        step >= shape.startStep - 1 &&
        step <= shape.startStep + shape.durationSteps + 1 &&
        Math.abs(shape.y - y) <= height
      ) {
        candidates.push(shape);
      }
    }
    return candidates.at(-1);
  };

  const addDrawShape = (step: number, y: number) => {
    const config = getInstrument(instrument);
    const next = [
      ...shapesRef.current,
      {
        id: makeId(),
        startStep: Math.max(0, step),
        y,
        durationSteps: defaultDurationSteps(instrument),
        size: config.defaultSize * 0.8,
        pan: 0,
        instrument,
        rotation: (step * 0.19 + y * 7) % 0.5 - 0.25,
      },
    ];
    setShapesDirect(next);
    gestureChangedRef.current = true;
  };

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = pointFromEvent(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "pan") {
      interactionRef.current = {
        kind: "pan",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startViewStep: viewStartStepRef.current,
      };
      return;
    }
    if (tool === "select") {
      const hit = findShapeAt(point.step, point.y);
      setSelectedId(hit?.id ?? null);
      if (hit) {
        gestureSnapshotRef.current = shapesRef.current;
        interactionRef.current = {
          kind: "move",
          pointerId: event.pointerId,
          id: hit.id,
          offsetStep: point.step - hit.startStep,
          offsetY: point.y - hit.y,
        };
      }
      return;
    }
    gestureSnapshotRef.current = shapesRef.current;
    if (tool === "draw") {
      interactionRef.current = { kind: "draw", pointerId: event.pointerId, lastStep: point.step, lastY: point.y };
      addDrawShape(point.step, point.y);
    } else if (tool === "erase") {
      interactionRef.current = { kind: "erase", pointerId: event.pointerId, lastStep: point.step, lastY: point.y };
      const hit = findShapeAt(point.step, point.y);
      if (hit) {
        setShapesDirect(shapesRef.current.filter((shape) => shape.id !== hit.id));
        if (selectedId === hit.id) setSelectedId(null);
        gestureChangedRef.current = true;
      }
    } else {
      const config = getInstrument(instrument);
      const id = makeId();
      interactionRef.current = {
        kind: "stamp",
        pointerId: event.pointerId,
        id,
        startStep: point.step,
        startY: point.y,
      };
      setShapesDirect([
        ...shapesRef.current,
        {
          id,
          startStep: point.step,
          y: point.y,
          durationSteps: defaultDurationSteps(instrument, true),
          size: config.defaultSize,
          pan: 0,
          instrument,
          rotation: instrument === "keys" ? Math.PI / 4 : 0,
        },
      ]);
      setSelectedId(id);
      gestureChangedRef.current = true;
    }
  };

  const onCanvasPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const point = pointFromEvent(event);
    if (interaction.kind === "pan") {
      const bounds = event.currentTarget.getBoundingClientRect();
      const deltaSteps = (event.clientX - interaction.startClientX) / bounds.width * VIEW_STEPS;
      navigateToStep(interaction.startViewStep - deltaSteps);
    } else if (interaction.kind === "move") {
      setShapesDirect(
        shapesRef.current.map((shape) =>
          shape.id === interaction.id
            ? {
                ...shape,
                startStep: Math.max(0, point.step - interaction.offsetStep),
                y: clamp(point.y - interaction.offsetY),
              }
            : shape,
        ),
      );
      gestureChangedRef.current = true;
    } else if (interaction.kind === "draw") {
      if (Math.abs(point.step - interaction.lastStep) >= 1 || Math.abs(point.y - interaction.lastY) > 0.035) {
        addDrawShape(point.step, point.y);
        interactionRef.current = { ...interaction, lastStep: point.step, lastY: point.y };
      }
    } else if (interaction.kind === "erase") {
      const hit = findShapeAt(point.step, point.y);
      if (hit) {
        setShapesDirect(shapesRef.current.filter((shape) => shape.id !== hit.id));
        gestureChangedRef.current = true;
      }
      interactionRef.current = { ...interaction, lastStep: point.step, lastY: point.y };
    } else {
      const left = Math.min(interaction.startStep, point.step);
      const right = Math.max(interaction.startStep, point.step);
      const durationSteps = clamp(right - left + 1, 1, MAX_NOTE_STEPS);
      const size = clamp(0.05 + Math.abs(point.y - interaction.startY) * 0.6, 0.04, 0.18);
      setShapesDirect(
        shapesRef.current.map((shape) =>
          shape.id === interaction.id
            ? { ...shape, startStep: left, durationSteps, size }
            : shape,
        ),
      );
    }
  };

  const onCanvasPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (interactionRef.current?.pointerId !== event.pointerId) return;
    finishGesture();
  };

  const onCanvasWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const direction = Math.sign(delta);
    const distance = Math.max(1, Math.round(Math.abs(delta) / 18));
    navigateToStep(viewStartStepRef.current + direction * distance);
  };

  const updateSelected = (patch: Partial<SoundShape>) => {
    if (!selectedId) return;
    commitShapes(
      shapesRef.current.map((shape) => (shape.id === selectedId ? { ...shape, ...patch } : shape)),
    );
  };

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    commitShapes(shapesRef.current.filter((shape) => shape.id !== selectedId));
    setSelectedId(null);
    showToast("声音事件已删除");
  }, [commitShapes, selectedId, showToast]);

  const clearCanvas = () => {
    if (!shapesRef.current.length) return;
    if (!clearArmed) {
      setClearArmed(true);
      showToast("再点一次确认清空画布");
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => setClearArmed(false), 3200);
      return;
    }
    stopPlayback();
    commitShapes([]);
    setSelectedId(null);
    setClearArmed(false);
    showToast("画布已清空");
  };

  const loadDemo = () => {
    stopPlayback();
    commitShapes(createDemo());
    setSelectedId(null);
    setBpm(132);
    setScale("hirajoshi");
    navigateToStep(0);
    showToast("已载入 4 小节 Complextro 示例");
  };

  const remix = () => {
    if (!shapesRef.current.length) {
      loadDemo();
      return;
    }
    const next = shapesRef.current.map((shape, index) => {
      const variant = hashString(`${shape.id}-${historyRef.current.length}`) % 7;
      if (isDrumInstrument(shape.instrument)) return shape;
      const stepShift = variant % 2 ? 1 : -1;
      const yShift = ((variant % 3) - 1) * 0.055;
      return {
        ...shape,
        startStep: Math.max(0, shape.startStep + stepShift),
        y: clamp(shape.y + yShift),
        pan: clamp(shape.pan + (variant % 2 ? 0.12 : -0.12), -1, 1),
        rotation: shape.rotation + (index % 2 ? 0.12 : -0.08),
      };
    });
    commitShapes(next);
    showToast("变奏完成：保留节奏，重新编排了旋律走向");
  };

  const shareProject = async () => {
    const payload = JSON.stringify({ version: 2, shapes: shapesRef.current, bpm, scale, title: projectTitle });
    if (payload.length > 900_000) {
      showToast("大型作品已完整保存在本机；当前作品过大，不适合放进分享链接");
      return;
    }
    const bytes = new TextEncoder().encode(payload);
    let binary = "";
    bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
    const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const url = `${window.location.origin}${window.location.pathname}#s=${encoded}`;
    try {
      await navigator.clipboard.writeText(url);
      window.history.replaceState(null, "", `#s=${encoded}`);
      showToast("作品链接已复制；打开即可继续 Remix");
    } catch {
      window.prompt("复制这个作品链接", url);
    }
  };

  const exportWav = async () => {
    if (!shapesRef.current.length || exporting) {
      if (!shapesRef.current.length) showToast("画布还是空的，先创作一些声音");
      return;
    }
    setExporting(true);
    setExportProgress(0);
    showToast("正在分段渲染 44.1 kHz WAV…");
    let writable: WavWritableStream | null = null;
    try {
      const sampleRate = 44100;
      const channels = 2;
      const secondsPerBeat = 60 / bpm;
      const musicalSeconds = projectEndStep(shapesRef.current) / STEPS_PER_BEAT * secondsPerBeat;
      const tailSeconds = effectTailSeconds(bpm);
      const renderSeconds = musicalSeconds + tailSeconds;
      const totalFrames = Math.ceil(renderSeconds * sampleRate);
      const coreFrames = sampleRate * 20;
      const preRollFrames = Math.ceil(
        (MAX_NOTE_STEPS / STEPS_PER_BEAT * secondsPerBeat + tailSeconds) * sampleRate,
      );
      const padFrames = Math.ceil(sampleRate * 0.02);
      const prepared = shapesRef.current
        .map((shape) => ({ shape: { ...shape }, startSeconds: shapeStartBeat(shape) * secondsPerBeat }))
        .sort((left, right) => left.startSeconds - right.startSeconds);
      const safeTitle = projectTitle.replace(/[^\w\u4e00-\u9fa5-]+/g, "-").replace(/-+/g, "-");
      const fileName = `${safeTitle || "synesthesia-canvas"}-${bpm}bpm.wav`;
      writable = await suggestWavFile(fileName);
      const parts: BlobPart[] = [];
      const header = createWavHeader(totalFrames, sampleRate, channels);
      if (writable) await writable.write(header);
      else parts.push(header.slice().buffer as ArrayBuffer);

      const lowerBound = (seconds: number) => {
        let low = 0;
        let high = prepared.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (prepared[middle].startSeconds < seconds) low = middle + 1;
          else high = middle;
        }
        return low;
      };

      for (let coreStart = 0; coreStart < totalFrames; coreStart += coreFrames) {
        const coreEnd = Math.min(totalFrames, coreStart + coreFrames);
        const currentCoreFrames = coreEnd - coreStart;
        const renderStart = Math.max(0, coreStart - preRollFrames);
        const renderStartSeconds = renderStart / sampleRate;
        const renderEndSeconds = coreEnd / sampleRate;
        const offlineLength = coreEnd - renderStart + padFrames;
        const offline = new OfflineAudioContext(channels, offlineLength, sampleRate);
        const graph = createAudioGraph(offline, bpm, 0.78);
        let eventIndex = lowerBound(renderStartSeconds);
        while (
          eventIndex < prepared.length &&
          prepared[eventIndex].startSeconds < renderEndSeconds
        ) {
          const event = prepared[eventIndex];
          scheduleShape(
            offline,
            graph,
            event.shape,
            padFrames / sampleRate + event.startSeconds - renderStartSeconds,
            secondsPerBeat,
            scale,
          );
          eventIndex += 1;
        }
        const rendered = await offline.startRendering();
        const fromFrame = coreStart - renderStart + padFrames;
        const pcm = encodePcm16(rendered, fromFrame, currentCoreFrames, channels);
        if (writable) await writable.write(pcm);
        else parts.push(pcm.slice().buffer as ArrayBuffer);
        setExportProgress(coreEnd / totalFrames);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }

      if (writable) {
        await writable.close();
        writable = null;
        showToast("WAV 已直接写入所选位置");
      } else {
        const blob = new Blob(parts, { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast("WAV 已完成并开始下载");
      }
    } catch (error) {
      if (writable) await writable.abort(error).catch(() => undefined);
      if (error instanceof DOMException && error.name === "AbortError") {
        showToast("已取消导出");
      } else {
        showToast("渲染失败；作品仍已安全保存在此设备");
      }
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        void play();
      } else if (event.key.toLowerCase() === "v") setTool("select");
      else if (event.key.toLowerCase() === "b") setTool("draw");
      else if (event.key.toLowerCase() === "s") setTool("stamp");
      else if (event.key.toLowerCase() === "e") setTool("erase");
      else if (event.key.toLowerCase() === "h") setTool("pan");
      else if (event.key === "Delete" || event.key === "Backspace") deleteSelected();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelected, play, redo, undo]);

  const instrumentCounts = useMemo(
    () =>
      Object.fromEntries(
        INSTRUMENTS.map((item) => [
          item.id,
          shapes.filter((shape) => shape.instrument === item.id).length,
        ]),
      ) as Record<InstrumentId, number>,
    [shapes],
  );
  const eventPreview = useMemo(
    () => [...shapes].sort((left, right) => left.startStep - right.startStep).slice(0, 100),
    [shapes],
  );

  const totalSteps = projectEndStep(shapes);
  const totalBeats = totalSteps / STEPS_PER_BEAT;
  const totalBars = totalSteps / STEPS_PER_BAR;
  const totalDuration = totalBeats * (60 / bpm);
  const displayBeat = Math.min(Math.max(0, playheadBeat), Math.max(0, totalBeats - EPSILON));
  const bar = Math.floor(displayBeat / BEATS_PER_BAR) + 1;
  const beat = Math.floor(displayBeat % BEATS_PER_BAR) + 1;
  const sixteenth = Math.floor((displayBeat % 1) * STEPS_PER_BEAT) + 1;
  const playheadStep = playheadBeat * STEPS_PER_BEAT;
  const playheadVisible =
    playing && playheadStep >= viewStartStep && playheadStep <= viewStartStep + VIEW_STEPS;
  const playheadLeft = (playheadStep - viewStartStep) / VIEW_STEPS * 100;
  const visibleBarMarkers: { step: number; bar: number; left: number }[] = [];
  const firstVisibleBarStep = Math.ceil(viewStartStep / STEPS_PER_BAR) * STEPS_PER_BAR;
  for (
    let step = firstVisibleBarStep;
    step <= viewStartStep + VIEW_STEPS;
    step += STEPS_PER_BAR
  ) {
    visibleBarMarkers.push({
      step,
      bar: step / STEPS_PER_BAR + 1,
      left: (step - viewStartStep) / VIEW_STEPS * 100,
    });
  }
  const firstVisibleBar = Math.floor(viewStartStep / STEPS_PER_BAR) + 1;
  const lastVisibleBar = Math.floor((viewStartStep + VIEW_STEPS - 1) / STEPS_PER_BAR) + 1;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">♪</span>
          <div>
            <h1>通感画布</h1>
            <p className="brand-subtitle">把颜色画成音乐</p>
          </div>
        </div>

        <label className="project-name">
          <span>作品名称</span>
          <input
            value={projectTitle}
            maxLength={36}
            aria-label="作品名称"
            onChange={(event) => {
              setProjectTitle(event.target.value);
              setSaved(false);
            }}
          />
        </label>

        <div className="top-settings" aria-label="工程设置">
          <label>
            <span>速度</span>
            <input
              type="number"
              min="90"
              max="180"
              value={bpm}
              onChange={(event) => {
                setBpm(clamp(Number(event.target.value) || 132, 90, 180));
                setSaved(false);
              }}
            />
          </label>
          <label>
            <span>音阶 · {SCALE_ENTRIES.length} 种</span>
            <select
              value={scale}
              onChange={(event) => {
                const nextScale = event.target.value;
                if (!isScaleId(nextScale)) return;
                if (playing) stopPlayback();
                setScale(nextScale);
                setSaved(false);
                showToast(`已切换到 ${SCALES[nextScale].name}`);
              }}
            >
              {SCALE_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {SCALE_ENTRIES.filter(([, item]) => item.group === group).map(([id, item]) => (
                    <option key={id} value={id}>{item.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="quantize-readout"><span>节拍网格</span><strong>1/16 · 无限延展</strong></div>
        </div>

        <div className="header-actions">
          <span className={`save-state ${saved ? "is-saved" : ""}`}>{saved ? "已保存" : "保存中…"}</span>
          <button type="button" className="button button--quiet" onClick={() => void shareProject()}>
            分享
          </button>
          <button
            type="button"
            className="button button--export"
            onClick={() => void exportWav()}
            disabled={exporting}
          >
            {exporting ? "正在生成…" : "导出 WAV"}
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="tool-rail" aria-label="声音画笔与绘图工具">
          <section className="rail-section rail-section--voices" aria-label="声音画笔列表">
            <header className="rail-heading">
              <span>声音画笔</span>
              <strong>{INSTRUMENTS.length} 种 · {shapes.length} 个声音</strong>
            </header>
            <div className="instrument-scroll">
              <div className="instrument-list">
                {INSTRUMENTS.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`instrument-button ${instrument === item.id ? "is-active" : ""}`}
                    style={{
                      "--instrument-color": item.color,
                      "--instrument-accent": item.accent,
                    } as CSSProperties}
                    aria-pressed={instrument === item.id}
                    onClick={() => {
                      setInstrument(item.id);
                      if (tool === "select" || tool === "erase" || tool === "pan") setTool("draw");
                    }}
                  >
                    <span className="instrument-code">{item.code}</span>
                    <span className={formClass(item.form)} aria-hidden="true" />
                    <span className="instrument-copy"><strong>{item.name}</strong><small>{item.subtitle}</small></span>
                    <span className="instrument-count">{instrumentCounts[item.id]}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="rail-section rail-section--tools" aria-label="绘图工具列表">
            <header className="rail-heading">
              <span>绘图工具</span>
              <strong>{TOOL_ITEMS.length} 种</strong>
            </header>
            <div className="tool-scroll">
              <div className="tool-grid">
                {TOOL_ITEMS.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`tool-button ${tool === item.id ? "is-active" : ""}`}
                    aria-pressed={tool === item.id}
                    title={`${item.label} (${item.key})`}
                    onClick={() => setTool(item.id)}
                  >
                    <span aria-hidden="true">{item.glyph}</span>
                    <strong>{item.label}</strong>
                    <kbd>{item.key}</kbd>
                  </button>
                ))}
              </div>
              <div className="history-actions">
                <button type="button" onClick={undo} disabled={!historyCount}>↶ 撤销</button>
                <button type="button" onClick={redo} disabled={!futureCount}>↷ 重做</button>
                <button
                  type="button"
                  className={clearArmed ? "is-danger" : ""}
                  onClick={clearCanvas}
                  disabled={!shapes.length}
                >
                  {clearArmed ? "确认清空" : "× 清空"}
                </button>
              </div>
            </div>
          </section>
        </aside>

        <section className="stage" aria-label="声音画布工作区">
          <div className="stage-status">
            <div className="live-status">
              <span className={`status-dot ${playing ? "is-live" : audioReady ? "is-ready" : ""}`} />
              <strong>{playing ? "正在播放" : audioReady ? "声音已就绪" : "点击播放启用声音"}</strong>
            </div>
            <div className="mapping-legend">
              <span>Y = 音高</span><i />
              <span>X = 时间</span><i />
              <span>宽度 = 音长</span><i />
              <span>大小 = 力度</span><i />
              <span>声像 = 独立控制</span>
            </div>
            <button type="button" className="mutation-button" onClick={remix}>生成变奏</button>
          </div>

          <div className="timeline-strip">
            <div className="timeline-navigation" aria-label="无限画布导航">
              <div>
                <button type="button" onClick={() => navigateToStep(0)} title="回到开头">|‹</button>
                <button type="button" onClick={() => navigateToStep(viewStartStep - VIEW_STEPS)} title="向前四小节">‹</button>
                <button type="button" onClick={() => navigateToStep(viewStartStep - STEPS_PER_BAR)} title="向前一小节">−1</button>
              </div>
              <label>
                <span>无限画布 · 跳到小节</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={firstVisibleBar}
                  onChange={(event) => navigateToStep((Math.max(1, Number(event.target.value) || 1) - 1) * STEPS_PER_BAR)}
                  aria-label="跳转到小节"
                />
                <b>当前 {firstVisibleBar}–{lastVisibleBar}</b>
              </label>
              <div>
                <button type="button" onClick={() => navigateToStep(viewStartStep + STEPS_PER_BAR)} title="向后一小节">+1</button>
                <button type="button" onClick={() => navigateToStep(viewStartStep + VIEW_STEPS)} title="向后四小节">›</button>
                <button type="button" onClick={() => navigateToStep(Math.max(0, totalSteps - VIEW_STEPS))} title="跳到作品结尾">›|</button>
              </div>
            </div>
            <div className="timeline-ruler" aria-hidden="true">
              {visibleBarMarkers.map((item) => (
                <span key={item.step} style={{ left: `${item.left}%` }}>第 {item.bar} 小节</span>
              ))}
            </div>
          </div>
          <div className={`canvas-frame tool-${tool}`}>
            <canvas
              ref={canvasRef}
              tabIndex={0}
              aria-label={`通感音乐画布，当前有 ${shapes.length} 个声音事件。当前工具：${TOOL_ITEMS.find((item) => item.id === tool)?.label}`}
              aria-describedby="canvas-help"
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={onCanvasPointerUp}
              onPointerCancel={onCanvasPointerUp}
              onWheel={onCanvasWheel}
            />
            <div className={`playhead ${playheadVisible ? "is-visible" : ""}`} style={{ left: `${playheadLeft}%` }} aria-hidden="true">
              <span />
            </div>
            <div className="pitch-labels" aria-hidden="true"><span>高音</span><span>中音</span><span>低音</span></div>
            {!shapes.length && (
              <div className="empty-state">
                <div className="ghost-composition" aria-hidden="true">
                  <i className="ghost-one" /><i className="ghost-two" /><i className="ghost-three" />
                </div>
                <p className="eyebrow">从这里开始</p>
                <h2>画一个形状，听见它的声音</h2>
                <p>选择左侧声音画笔，在网格点按或拖动。纵向决定音高或鼓件，横向决定它何时响起。</p>
                <div>
                  <button type="button" className="button button--primary" onClick={loadDemo}>载入示例作品</button>
                  <span>或直接在画布落笔</span>
                </div>
              </div>
            )}
          </div>
          <p className="stage-help" id="canvas-help">
            {tool === "draw" && "拖动画出一串量化音符 · B"}
            {tool === "stamp" && "拖拽印章：横向长度控制音长，纵向距离控制力度 · S"}
            {tool === "select" && "拖动声音事件改变时间与音高，右侧可精确编辑 · V"}
            {tool === "erase" && "划过声音事件即可擦除 · E"}
            {tool === "pan" && "拖动画布前往任意时间；滚轮也可以横向浏览 · H"}
            <span>SPACE 播放 / 停止</span>
          </p>
        </section>

        <aside className="inspector" aria-label="声音事件检查器">
          <div className="panel-heading">
            <div><p className="eyebrow">声音设置</p><h2>{selectedShape ? "调整这个声音" : "作品概览"}</h2></div>
            <span>{selectedShape ? "已选择" : "全部"}</span>
          </div>

          {selectedShape ? (
            <div className="selected-editor">
              <div
                className="selected-identity"
                style={{
                  "--instrument-color": getInstrument(selectedShape.instrument).color,
                  "--instrument-accent": getInstrument(selectedShape.instrument).accent,
                } as CSSProperties}
              >
                <span className={formClass(getInstrument(selectedShape.instrument).form)} aria-hidden="true" />
                <div><strong>{getInstrument(selectedShape.instrument).name}</strong><small>{shapePitchLabel(selectedShape, scale)} · 第 {(selectedShape.startStep / STEPS_PER_BEAT + 1).toFixed(2)} 拍</small></div>
              </div>
              <label className="field-row">
                <span>音色</span>
                <select value={selectedShape.instrument} onChange={(event) => updateSelected({ instrument: event.target.value as InstrumentId })}>
                  {INSTRUMENTS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="range-field">
                <span><b>{isDrumInstrument(selectedShape.instrument) ? "鼓件" : "音高"}</b><output>{shapePitchLabel(selectedShape, scale)}</output></span>
                <input type="range" min="0" max="1" step="0.01" value={1 - selectedShape.y} onChange={(event) => updateSelected({ y: 1 - Number(event.target.value) })} />
              </label>
              <label className="field-row">
                <span>开始位置 · 拍（可输入任意长度）</span>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={selectedShape.startStep / STEPS_PER_BEAT}
                  onChange={(event) => updateSelected({ startStep: Math.max(0, Math.round(Number(event.target.value) * STEPS_PER_BEAT)) })}
                />
              </label>
              <label className="range-field">
                <span><b>音符长度</b><output>{eventDuration(selectedShape)} 拍</output></span>
                <input type="range" min="1" max={MAX_NOTE_STEPS} step="1" value={selectedShape.durationSteps} onChange={(event) => updateSelected({ durationSteps: Number(event.target.value) })} />
              </label>
              <label className="range-field">
                <span><b>声像位置</b><output>{selectedShape.pan === 0 ? "中央" : `${selectedShape.pan < 0 ? "左" : "右"} ${Math.round(Math.abs(selectedShape.pan) * 100)}`}</output></span>
                <input type="range" min="-1" max="1" step="0.01" value={selectedShape.pan} onChange={(event) => updateSelected({ pan: Number(event.target.value) })} />
              </label>
              <label className="range-field">
                <span><b>力度</b><output>{Math.round(eventVelocity(selectedShape) * 100)}%</output></span>
                <input type="range" min="0.035" max="0.18" step="0.005" value={selectedShape.size} onChange={(event) => updateSelected({ size: Number(event.target.value) })} />
              </label>
              <div className="derived-values">
                <div><span>所在小节</span><strong>第 {Math.floor(selectedShape.startStep / STEPS_PER_BAR) + 1} 小节</strong></div>
                <div><span>节拍精度</span><strong>1/16</strong></div>
              </div>
              <button type="button" className="delete-event" onClick={deleteSelected}>删除这个声音事件</button>
            </div>
          ) : (
            <>
              <div className="dna-number"><strong>{shapes.length}</strong><span>个声音 · 不设上限</span></div>
              <div className="voice-meter-list">
                {INSTRUMENTS.map((item) => (
                  <div className="voice-meter" key={item.id}>
                    <span style={{ background: item.color }} />
                    <div><strong>{item.name}</strong><i style={{ width: `${Math.min(100, instrumentCounts[item.id] * 9)}%`, background: item.color }} /></div>
                    <b>{instrumentCounts[item.id]}</b>
                  </div>
                ))}
              </div>
              <div className="analysis-card">
                <p className="eyebrow">无限时间轴</p>
                <strong>当前作品 {totalBars} 小节</strong>
                <span>继续向右浏览即可延展；播放和导出会自动跟随最后一个声音。</span>
              </div>
              <div className="analysis-card analysis-card--accent">
                <p className="eyebrow">Complextro 律动</p>
                <strong>56% Swing · 动态呼吸</strong>
                <span>快速音色切换、碎拍细节与鼓组侧链已自动加入作品。</span>
              </div>
            </>
          )}

          <details className="event-list">
            <summary>无障碍事件列表 <span>{shapes.length}</span></summary>
            <ol>
              {eventPreview.map((shape) => (
                <li key={shape.id}>
                  <button type="button" onClick={() => { setSelectedId(shape.id); setTool("select"); navigateToStep(Math.floor(shape.startStep / VIEW_STEPS) * VIEW_STEPS); }}>
                    {getInstrument(shape.instrument).subtitle}，{shapePitchLabel(shape, scale)}，第 {(shape.startStep / STEPS_PER_BEAT + 1).toFixed(2)} 拍，力度 {Math.round(eventVelocity(shape) * 100)}
                  </button>
                </li>
              ))}
            </ol>
          </details>
        </aside>
      </section>

      <footer className="transport" aria-label="播放控制">
        <div className="transport-left">
          <button type="button" className={`loop-button ${loop ? "is-active" : ""}`} aria-pressed={loop} onClick={() => setLoop((value) => !value)}>↻ 循环 <span>{loop ? "开启" : "关闭"}</span></button>
          <button type="button" onClick={() => { stopPlayback(); setPlayheadBeat(0); navigateToStep(0); }} aria-label="停止并回到开头">■ 停止</button>
        </div>
        <div className="transport-main">
          <div className="position-readout"><span>播放位置</span><strong>{String(bar).padStart(2, "0")} : {String(beat).padStart(2, "0")} : {String(sixteenth).padStart(2, "0")}</strong></div>
          <button
            type="button"
            className={`play-button ${playing ? "is-playing" : ""}`}
            onClick={() => void play()}
            aria-label={playing ? "停止播放" : "播放序列"}
          >
            <span aria-hidden="true">{playing ? "■" : "▶"}</span>
            <strong>{playing ? "停止播放" : "播放作品"}</strong>
          </button>
          <div className="duration-readout"><span>{totalBars} 小节</span><strong>{formatDuration(totalDuration)}</strong></div>
        </div>
        <div className="master-control">
          <button type="button" onClick={() => setMuted((value) => !value)}>{muted ? "已静音" : "音量"}</button>
          <input aria-label="主音量" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
          <output>{muted ? "00" : String(Math.round(volume * 100)).padStart(2, "0")}</output>
        </div>
      </footer>

      <div className={`toast ${toast ? "is-visible" : ""}`} role="status" aria-live="polite">{toast}</div>
      {exporting && <div className="export-indicator" role="status"><span /><strong>正在分段生成音频 · {Math.round(exportProgress * 100)}%</strong><small>超长作品会直接流式写入磁盘，不占满内存</small><progress max="1" value={exportProgress} /></div>}
    </main>
  );
}
