"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

type InstrumentId = "brass" | "organ" | "keys" | "drums" | "strings";
type ToolId = "select" | "draw" | "stamp" | "erase";
type ShapeForm = "triangle" | "ring" | "diamond" | "block" | "wave";
type ScaleId = "hirajoshi" | "minor" | "pentatonic";

type SoundShape = {
  id: string;
  x: number;
  y: number;
  width: number;
  size: number;
  instrument: InstrumentId;
  rotation: number;
};

type Instrument = {
  id: InstrumentId;
  code: string;
  name: string;
  subtitle: string;
  color: string;
  form: ShapeForm;
  defaultSize: number;
};

type AudioGraph = {
  tonal: GainNode;
  drums: GainNode;
  pump: GainNode;
  master: GainNode;
};

type Interaction =
  | { kind: "draw"; pointerId: number; lastX: number; lastY: number }
  | { kind: "erase"; pointerId: number; lastX: number; lastY: number }
  | {
      kind: "stamp";
      pointerId: number;
      id: string;
      startX: number;
      startY: number;
    }
  | {
      kind: "move";
      pointerId: number;
      id: string;
      offsetX: number;
      offsetY: number;
    };

const EPSILON = 0.0001;
const MAX_SHAPES = 180;
const BAR_BEATS = 16;

const INSTRUMENTS: Instrument[] = [
  {
    id: "brass",
    code: "01",
    name: "NEON BRASS",
    subtitle: "霓虹铜管",
    color: "#ffd84d",
    form: "triangle",
    defaultSize: 0.072,
  },
  {
    id: "organ",
    code: "02",
    name: "PIXEL ORGAN",
    subtitle: "像素风琴",
    color: "#41e7ff",
    form: "ring",
    defaultSize: 0.067,
  },
  {
    id: "keys",
    code: "03",
    name: "GLASS KEYS",
    subtitle: "玻璃键音",
    color: "#ff4fba",
    form: "diamond",
    defaultSize: 0.061,
  },
  {
    id: "drums",
    code: "04",
    name: "CIRCUIT DRUMS",
    subtitle: "电路鼓组",
    color: "#baff4a",
    form: "block",
    defaultSize: 0.054,
  },
  {
    id: "strings",
    code: "05",
    name: "SAKURA STRINGS",
    subtitle: "樱色弦乐",
    color: "#9879ff",
    form: "wave",
    defaultSize: 0.082,
  },
];

const SCALES: Record<ScaleId, { name: string; root: number; intervals: number[] }> = {
  hirajoshi: { name: "E HIRAJOSHI", root: 40, intervals: [0, 2, 3, 7, 8] },
  minor: { name: "F♯ MINOR", root: 42, intervals: [0, 2, 3, 5, 7, 8, 10] },
  pentatonic: { name: "A MIN. PENTA", root: 45, intervals: [0, 3, 5, 7, 10] },
};

const TOOL_ITEMS: { id: ToolId; key: string; glyph: string; label: string }[] = [
  { id: "select", key: "V", glyph: "⌖", label: "选择 / 移动" },
  { id: "draw", key: "B", glyph: "∿", label: "声音画笔" },
  { id: "stamp", key: "S", glyph: "◇", label: "图形印章" },
  { id: "erase", key: "E", glyph: "⌫", label: "擦除" },
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
  const raw = 0.25 + clamp(shape.width, 0.02, 0.34) * 7;
  const values = [0.25, 0.5, 0.75, 1, 1.5, 2, 4];
  const closest = values.reduce((best, value) =>
    Math.abs(value - raw) < Math.abs(best - raw) ? value : best,
  );
  if (shape.instrument === "drums") return 0.25;
  if (shape.instrument === "brass" || shape.instrument === "keys") {
    return Math.min(1.5, closest);
  }
  return closest;
}

function eventVelocity(shape: SoundShape) {
  return clamp(0.3 + Math.sqrt(clamp(shape.size / 0.16)) * 0.6, 0.25, 0.92);
}

function shapeStartBeat(shape: SoundShape) {
  const step = Math.min(63, Math.round(clamp(shape.x) * 63));
  const swing = step % 2 === 1 ? 0.03 : 0;
  return step / 4 + swing;
}

function makeNoiseBuffer(context: BaseAudioContext, seconds: number, seed: number) {
  const length = Math.max(1, Math.ceil(context.sampleRate * seconds));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  const random = seededNoise(seed);
  for (let index = 0; index < length; index += 1) data[index] = random();
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
  drums.gain.value = 0.9;
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
  const pan = shape.x * 1.44 - 0.72;
  const seed = hashString(shape.id);
  const variant = seed & 3;
  const amp = context.createGain();
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = shape.instrument === "brass" ? 4.5 : 1.1;
  filter.frequency.setValueAtTime(
    shape.instrument === "strings" ? 2600 : 6200,
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
  } else {
    addOscillator("sawtooth", 1, -9, 0.1);
    addOscillator("sawtooth", 1, 9, 0.1);
    addOscillator("triangle", 0.5, 0, 0.065);
    filter.frequency.setValueAtTime(2300, time);
    filter.frequency.exponentialRampToValueAtTime(5200, time + 0.12);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.42, time + 0.075);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.3, Math.min(end, time + 0.26));
  }

  const releaseLevel =
    shape.instrument === "keys"
      ? velocity * 0.12
      : shape.instrument === "brass"
        ? velocity * 0.24
        : shape.instrument === "organ"
          ? velocity * 0.34
          : velocity * 0.3;
  amp.gain.setValueAtTime(Math.max(EPSILON, releaseLevel), end);
  amp.gain.exponentialRampToValueAtTime(EPSILON, end + (shape.instrument === "strings" ? 0.62 : 0.28));

  if (variant === 3 && shape.width > 0.07 && shape.instrument !== "strings") {
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

function scheduleDrum(
  context: BaseAudioContext,
  graph: AudioGraph,
  shape: SoundShape,
  time: number,
  bucket?: Set<AudioScheduledSourceNode>,
) {
  const velocity = eventVelocity(shape);
  const pan = shape.x * 1.1 - 0.55;
  const seed = hashString(shape.id);

  if (shape.y > 0.7) {
    const oscillator = context.createOscillator();
    const amp = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(165, time);
    oscillator.frequency.exponentialRampToValueAtTime(45, time + 0.1);
    amp.gain.setValueAtTime(velocity * 0.86, time);
    amp.gain.exponentialRampToValueAtTime(EPSILON, time + 0.24);
    oscillator.connect(amp);
    connectWithPan(context, amp, graph.drums, pan * 0.2);
    oscillator.start(time);
    oscillator.stop(time + 0.26);
    registerSource(oscillator, bucket);
    graph.pump.gain.setValueAtTime(0.48, time);
    graph.pump.gain.exponentialRampToValueAtTime(1, time + 0.14);
    return;
  }

  const noise = context.createBufferSource();
  const amp = context.createGain();
  const filter = context.createBiquadFilter();
  const isSnare = shape.y > 0.39;
  const isHat = shape.y > 0.16;
  const duration = isSnare ? 0.17 : isHat ? 0.065 : 0.12;
  noise.buffer = makeNoiseBuffer(context, duration + 0.02, seed);
  filter.type = isSnare ? "bandpass" : "highpass";
  filter.frequency.value = isSnare ? 1850 : isHat ? 7200 : 5100;
  filter.Q.value = isSnare ? 0.8 : 1.4;
  amp.gain.setValueAtTime(velocity * (isSnare ? 0.42 : 0.23), time);
  amp.gain.exponentialRampToValueAtTime(EPSILON, time + duration);
  noise.connect(filter);
  filter.connect(amp);
  connectWithPan(context, amp, graph.drums, pan);
  noise.start(time);
  noise.stop(time + duration + 0.02);
  registerSource(noise, bucket);

  if (isSnare) {
    const body = context.createOscillator();
    const bodyGain = context.createGain();
    body.type = "triangle";
    body.frequency.setValueAtTime(190, time);
    body.frequency.exponentialRampToValueAtTime(128, time + 0.1);
    bodyGain.gain.setValueAtTime(velocity * 0.2, time);
    bodyGain.gain.exponentialRampToValueAtTime(EPSILON, time + 0.12);
    body.connect(bodyGain);
    connectWithPan(context, bodyGain, graph.drums, pan * 0.2);
    body.start(time);
    body.stop(time + 0.14);
    registerSource(body, bucket);
  }
}

function scheduleSequence(
  context: BaseAudioContext,
  graph: AudioGraph,
  shapes: SoundShape[],
  bpm: number,
  scale: ScaleId,
  startTime: number,
  bucket?: Set<AudioScheduledSourceNode>,
) {
  const secondsPerBeat = 60 / bpm;
  shapes
    .slice(0, MAX_SHAPES)
    .sort((left, right) => left.x - right.x)
    .forEach((shape) => {
      const time = startTime + shapeStartBeat(shape) * secondsPerBeat;
      if (shape.instrument === "drums") {
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
    });
}

function encodeWav(buffer: AudioBuffer) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const bytesPerSample = 2;
  const arrayBuffer = new ArrayBuffer(44 + frames * channels * bytesPerSample);
  const view = new DataView(arrayBuffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + frames * channels * bytesPerSample, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, frames * channels * bytesPerSample, true);

  let peak = EPSILON;
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < frames; index += 1) {
      peak = Math.max(peak, Math.abs(data[index]));
    }
  }
  const normalization = Math.min(1, 0.96 / peak);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = clamp(buffer.getChannelData(channel)[frame] * normalization, -1, 1);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
}

function createDemo(): SoundShape[] {
  const result: SoundShape[] = [];
  const add = (
    instrument: InstrumentId,
    x: number,
    y: number,
    width: number,
    size: number,
    rotation = 0,
  ) => result.push({ id: makeId(), instrument, x, y, width, size, rotation });

  [0.015, 0.255, 0.51, 0.765].forEach((x) => add("drums", x, 0.84, 0.025, 0.07));
  [0.255, 0.765].forEach((x) => add("drums", x, 0.52, 0.025, 0.06));
  [0.13, 0.37, 0.63, 0.88].forEach((x) => add("drums", x, 0.28, 0.02, 0.038, 0.25));
  [0.07, 0.2, 0.32, 0.45, 0.57, 0.69, 0.82, 0.94].forEach((x, index) =>
    add("organ", x, [0.67, 0.62, 0.72, 0.58][index % 4], 0.048, 0.057, index * 0.18),
  );
  [0.03, 0.16, 0.29, 0.41, 0.54, 0.66, 0.79, 0.91].forEach((x, index) =>
    add("keys", x, [0.32, 0.22, 0.38, 0.17, 0.29, 0.12, 0.25, 0.2][index], 0.032, 0.052, Math.PI / 4),
  );
  [0.095, 0.345, 0.595, 0.845].forEach((x, index) =>
    add("brass", x, [0.45, 0.36, 0.48, 0.31][index], 0.075, 0.075, index % 2 ? 0.16 : -0.12),
  );
  add("strings", 0.16, 0.57, 0.28, 0.095, -0.08);
  add("strings", 0.62, 0.49, 0.29, 0.1, 0.08);
  return result;
}

function formClass(form: ShapeForm) {
  return `mini-shape mini-shape--${form}`;
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shapesRef = useRef<SoundShape[]>([]);
  const interactionRef = useRef<Interaction | null>(null);
  const gestureSnapshotRef = useRef<SoundShape[] | null>(null);
  const gestureChangedRef = useRef(false);
  const historyRef = useRef<SoundShape[][]>([]);
  const futureRef = useRef<SoundShape[][]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioGraphRef = useRef<AudioGraph | null>(null);
  const audioSourcesRef = useRef(new Set<AudioScheduledSourceNode>());
  const schedulerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationRef = useRef<number | null>(null);
  const playbackTokenRef = useRef(0);
  const playStartRef = useRef(0);
  const loopDurationRef = useRef(0);
  const nextCycleRef = useRef(0);
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
  const [playhead, setPlayhead] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState("");
  const [clearArmed, setClearArmed] = useState(false);
  const [projectTitle, setProjectTitle] = useState("NEON BLOOM_01");
  const [saved, setSaved] = useState(true);

  const selectedShape = useMemo(
    () => shapes.find((shape) => shape.id === selectedId) ?? null,
    [selectedId, shapes],
  );

  const setShapesDirect = useCallback((next: SoundShape[]) => {
    shapesRef.current = next;
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
      setShapesDirect(next.slice(0, MAX_SHAPES));
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
    if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    schedulerRef.current = null;
    finishTimerRef.current = null;
    animationRef.current = null;
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
    if (reset) setPlayhead(0);
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
    const loopDuration = BAR_BEATS * (60 / bpm);
    const start = context.currentTime + 0.07;
    playStartRef.current = start;
    loopDurationRef.current = loopDuration;
    nextCycleRef.current = start;
    const snapshot = shapesRef.current.map((shape) => ({ ...shape }));
    const scheduleCycle = () => {
      scheduleSequence(
        context,
        graph,
        snapshot,
        bpm,
        scale,
        nextCycleRef.current,
        audioSourcesRef.current,
      );
      nextCycleRef.current += loopDuration;
    };
    scheduleCycle();
    if (loop) {
      schedulerRef.current = setInterval(() => {
        if (token !== playbackTokenRef.current) return;
        while (nextCycleRef.current < context.currentTime + 1.25) scheduleCycle();
      }, 240);
    } else {
      finishTimerRef.current = setTimeout(() => {
        if (token === playbackTokenRef.current) stopPlayback(false);
      }, (loopDuration + 0.7) * 1000);
    }
    setPlaying(true);

    const animate = () => {
      if (token !== playbackTokenRef.current) return;
      const elapsed = Math.max(0, context.currentTime - start);
      setPlayhead(loop ? (elapsed % loopDuration) / loopDuration : Math.min(1, elapsed / loopDuration));
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
  }, [bpm, loop, muted, playing, scale, showToast, stopPlayback, volume]);

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
    context.fillStyle = "#0b0e17";
    context.fillRect(0, 0, width, height);

    for (let step = 0; step <= 64; step += 1) {
      const x = (step / 64) * width;
      context.strokeStyle = step % 16 === 0 ? "#39415a" : step % 4 === 0 ? "#242a3c" : "#171c2a";
      context.lineWidth = step % 16 === 0 ? 1.2 : 1;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let line = 0; line <= 12; line += 1) {
      const y = (line / 12) * height;
      context.strokeStyle = line % 3 === 0 ? "#242a3c" : "#171c2a";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    shapesRef.current.forEach((shape) => {
      const config = getInstrument(shape.instrument);
      const x = shape.x * width;
      const y = shape.y * height;
      const shapeWidth = Math.max(18, shape.width * width);
      const shapeHeight = Math.max(14, shape.size * height);
      const selected = shape.id === selectedId;
      context.save();
      context.translate(x, y);
      context.rotate(shape.rotation);
      context.shadowColor = config.color;
      context.shadowBlur = selected ? 22 : 8;
      context.strokeStyle = config.color;
      context.fillStyle = `${config.color}${selected ? "dd" : "a8"}`;
      context.lineWidth = selected ? 3 : 1.5;
      context.beginPath();
      if (config.form === "triangle") {
        context.moveTo(-shapeWidth / 2, shapeHeight / 2);
        context.lineTo(0, -shapeHeight / 2);
        context.lineTo(shapeWidth / 2, shapeHeight / 2);
        context.closePath();
        context.fill();
        context.stroke();
      } else if (config.form === "ring") {
        context.ellipse(0, 0, shapeWidth / 2, shapeHeight / 2, 0, 0, Math.PI * 2);
        context.stroke();
        context.globalAlpha = 0.22;
        context.fill();
      } else if (config.form === "diamond") {
        context.moveTo(0, -shapeHeight / 2);
        context.lineTo(shapeWidth / 2, 0);
        context.lineTo(0, shapeHeight / 2);
        context.lineTo(-shapeWidth / 2, 0);
        context.closePath();
        context.fill();
        context.stroke();
      } else if (config.form === "block") {
        context.rect(-shapeWidth / 2, -shapeHeight / 2, shapeWidth, shapeHeight);
        context.fill();
        context.stroke();
        context.fillStyle = "#0b0e17";
        context.fillRect(-shapeWidth * 0.12, -shapeHeight / 2, shapeWidth * 0.24, shapeHeight);
      } else {
        context.moveTo(-shapeWidth / 2, 0);
        context.bezierCurveTo(-shapeWidth / 4, -shapeHeight, shapeWidth / 4, shapeHeight, shapeWidth / 2, 0);
        context.lineWidth = Math.max(4, shapeHeight * 0.28);
        context.stroke();
      }
      if (selected) {
        context.shadowBlur = 0;
        context.strokeStyle = "#ffffff";
        context.setLineDash([5, 4]);
        context.lineWidth = 1;
        context.strokeRect(-shapeWidth / 2 - 7, -shapeHeight / 2 - 7, shapeWidth + 14, shapeHeight + 14);
      }
      context.restore();
    });
  }, [selectedId]);

  useEffect(() => {
    drawCanvas();
    const observer = new ResizeObserver(drawCanvas);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [drawCanvas, shapes]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const encoded = window.location.hash.startsWith("#s=") ? window.location.hash.slice(3) : "";
        const stored = localStorage.getItem("synesthesia-canvas-project");
        const padded = encoded
          ? `${encoded.replace(/-/g, "+").replace(/_/g, "/")}${"=".repeat((4 - (encoded.length % 4)) % 4)}`
          : "";
        const source = encoded
          ? new TextDecoder().decode(
              Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)),
            )
          : stored;
        if (source) {
          const project = JSON.parse(source) as {
            shapes?: SoundShape[];
            bpm?: number;
            scale?: ScaleId;
            title?: string;
          };
          if (Array.isArray(project.shapes)) {
            const safeShapes = project.shapes.slice(0, MAX_SHAPES);
            shapesRef.current = safeShapes;
            setShapes(safeShapes);
          }
          if (typeof project.bpm === "number") setBpm(clamp(project.bpm, 90, 180));
          if (project.scale && project.scale in SCALES) setScale(project.scale);
          if (typeof project.title === "string") setProjectTitle(project.title.slice(0, 36));
          if (encoded) showToast("共享作品已载入，可以直接 Remix");
        }
      } catch {
        showToast("作品链接无法解析，已打开空白画布");
      }
      restoredRef.current = true;
    });
    return () => {
      active = false;
    };
  }, [showToast]);

  useEffect(() => {
    if (!restoredRef.current) return;
    const timer = setTimeout(() => {
      localStorage.setItem(
        "synesthesia-canvas-project",
        JSON.stringify({ version: 1, shapes, bpm, scale, title: projectTitle }),
      );
      setSaved(true);
    }, 420);
    return () => clearTimeout(timer);
  }, [bpm, projectTitle, scale, shapes]);

  useEffect(() => {
    if (audioGraphRef.current) {
      const now = audioContextRef.current?.currentTime ?? 0;
      audioGraphRef.current.master.gain.setTargetAtTime(muted ? EPSILON : volume * 0.78, now, 0.025);
    }
  }, [muted, volume]);

  useEffect(
    () => () => {
      if (schedulerRef.current) clearInterval(schedulerRef.current);
      if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
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
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  };

  const findShapeAt = (x: number, y: number) =>
    [...shapesRef.current].reverse().find((shape) => {
      const width = Math.max(0.035, shape.width) * 0.7;
      const height = Math.max(0.04, shape.size) * 0.8;
      return Math.abs(shape.x - x) <= width && Math.abs(shape.y - y) <= height;
    });

  const addDrawShape = (x: number, y: number) => {
    if (shapesRef.current.length >= MAX_SHAPES) {
      showToast(`当前上限为 ${MAX_SHAPES} 个声音事件`);
      return;
    }
    const config = getInstrument(instrument);
    const next = [
      ...shapesRef.current,
      {
        id: makeId(),
        x,
        y,
        width: instrument === "strings" ? 0.065 : 0.027,
        size: config.defaultSize * 0.8,
        instrument,
        rotation: (x * 9 + y * 7) % 0.5 - 0.25,
      },
    ];
    setShapesDirect(next);
    gestureChangedRef.current = true;
  };

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = pointFromEvent(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "select") {
      const hit = findShapeAt(point.x, point.y);
      setSelectedId(hit?.id ?? null);
      if (hit) {
        gestureSnapshotRef.current = shapesRef.current;
        interactionRef.current = {
          kind: "move",
          pointerId: event.pointerId,
          id: hit.id,
          offsetX: point.x - hit.x,
          offsetY: point.y - hit.y,
        };
      }
      return;
    }
    gestureSnapshotRef.current = shapesRef.current;
    if (tool === "draw") {
      interactionRef.current = { kind: "draw", pointerId: event.pointerId, lastX: point.x, lastY: point.y };
      addDrawShape(point.x, point.y);
    } else if (tool === "erase") {
      interactionRef.current = { kind: "erase", pointerId: event.pointerId, lastX: point.x, lastY: point.y };
      const hit = findShapeAt(point.x, point.y);
      if (hit) {
        setShapesDirect(shapesRef.current.filter((shape) => shape.id !== hit.id));
        if (selectedId === hit.id) setSelectedId(null);
        gestureChangedRef.current = true;
      }
    } else {
      if (shapesRef.current.length >= MAX_SHAPES) {
        showToast(`当前上限为 ${MAX_SHAPES} 个声音事件`);
        return;
      }
      const config = getInstrument(instrument);
      const id = makeId();
      interactionRef.current = {
        kind: "stamp",
        pointerId: event.pointerId,
        id,
        startX: point.x,
        startY: point.y,
      };
      setShapesDirect([
        ...shapesRef.current,
        {
          id,
          x: point.x,
          y: point.y,
          width: instrument === "strings" ? 0.13 : 0.06,
          size: config.defaultSize,
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
    if (interaction.kind === "move") {
      setShapesDirect(
        shapesRef.current.map((shape) =>
          shape.id === interaction.id
            ? { ...shape, x: clamp(point.x - interaction.offsetX), y: clamp(point.y - interaction.offsetY) }
            : shape,
        ),
      );
      gestureChangedRef.current = true;
    } else if (interaction.kind === "draw") {
      const distance = Math.hypot(point.x - interaction.lastX, point.y - interaction.lastY);
      if (distance > 0.027) {
        addDrawShape(point.x, point.y);
        interactionRef.current = { ...interaction, lastX: point.x, lastY: point.y };
      }
    } else if (interaction.kind === "erase") {
      const hit = findShapeAt(point.x, point.y);
      if (hit) {
        setShapesDirect(shapesRef.current.filter((shape) => shape.id !== hit.id));
        gestureChangedRef.current = true;
      }
      interactionRef.current = { ...interaction, lastX: point.x, lastY: point.y };
    } else {
      const left = Math.min(interaction.startX, point.x);
      const right = Math.max(interaction.startX, point.x);
      const width = clamp(right - left, 0.025, 0.34);
      const size = clamp(0.05 + Math.abs(point.y - interaction.startY) * 0.6, 0.04, 0.18);
      setShapesDirect(
        shapesRef.current.map((shape) =>
          shape.id === interaction.id
            ? { ...shape, x: left + width / 2, width, size }
            : shape,
        ),
      );
    }
  };

  const onCanvasPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (interactionRef.current?.pointerId !== event.pointerId) return;
    finishGesture();
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
    showToast("已载入 4 小节 Complextro 示例");
  };

  const remix = () => {
    if (!shapesRef.current.length) {
      loadDemo();
      return;
    }
    const next = shapesRef.current.map((shape, index) => {
      const variant = hashString(`${shape.id}-${historyRef.current.length}`) % 7;
      if (shape.instrument === "drums") return shape;
      const xShift = variant % 2 ? 1 / 64 : -1 / 64;
      const yShift = ((variant % 3) - 1) * 0.055;
      return {
        ...shape,
        x: clamp(shape.x + xShift),
        y: clamp(shape.y + yShift),
        rotation: shape.rotation + (index % 2 ? 0.12 : -0.08),
      };
    });
    commitShapes(next);
    showToast("MUTATION 完成：保留节奏，重组旋律走向");
  };

  const shareProject = async () => {
    const payload = JSON.stringify({ version: 1, shapes: shapesRef.current, bpm, scale, title: projectTitle });
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
    showToast("正在离线渲染 44.1 kHz WAV…");
    try {
      const sampleRate = 44100;
      const loopSeconds = BAR_BEATS * (60 / bpm);
      const offline = new OfflineAudioContext(2, Math.ceil((loopSeconds + 1.4) * sampleRate), sampleRate);
      const graph = createAudioGraph(offline, bpm, 0.78);
      scheduleSequence(offline, graph, shapesRef.current, bpm, scale, 0.04);
      const rendered = await offline.startRendering();
      const blob = encodeWav(rendered);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeTitle = projectTitle.replace(/[^\w\u4e00-\u9fa5-]+/g, "-").replace(/-+/g, "-");
      anchor.href = url;
      anchor.download = `${safeTitle || "synesthesia-canvas"}-${bpm}bpm.wav`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("WAV 已完成并开始下载");
    } catch {
      showToast("渲染失败；作品仍已安全保存在此设备");
    } finally {
      setExporting(false);
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

  const totalDuration = BAR_BEATS * (60 / bpm);
  const currentBeat = Math.min(15.99, playhead * 16);
  const bar = Math.floor(currentBeat / 4) + 1;
  const beat = Math.floor(currentBeat % 4) + 1;
  const sixteenth = Math.floor((currentBeat % 1) * 4) + 1;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">SC</span>
          <div>
            <p className="eyebrow">SYNESTHESIA / AUDIOVISUAL LAB</p>
            <h1>通感画布 <span>CANVAS_01</span></h1>
          </div>
        </div>

        <label className="project-name">
          <span>PROJECT</span>
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
            <span>BPM</span>
            <input
              type="number"
              min="90"
              max="180"
              value={bpm}
              onChange={(event) => setBpm(clamp(Number(event.target.value) || 132, 90, 180))}
            />
          </label>
          <label>
            <span>SCALE</span>
            <select value={scale} onChange={(event) => setScale(event.target.value as ScaleId)}>
              {Object.entries(SCALES).map(([id, item]) => (
                <option key={id} value={id}>{item.name}</option>
              ))}
            </select>
          </label>
          <div className="quantize-readout"><span>GRID</span><strong>1/16 · 4 BAR</strong></div>
        </div>

        <div className="header-actions">
          <span className={`save-state ${saved ? "is-saved" : ""}`}>{saved ? "● 本地已保存" : "○ 保存中"}</span>
          <button type="button" className="button button--quiet" onClick={() => void shareProject()}>
            ↗ 分享
          </button>
          <button
            type="button"
            className="button button--export"
            onClick={() => void exportWav()}
            disabled={exporting}
          >
            {exporting ? "渲染中…" : "⇩ 导出 WAV"}
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="tool-rail" aria-label="声音画笔与绘图工具">
          <div className="rail-heading">
            <span>VOICE BRUSH</span>
            <strong>{String(shapes.length).padStart(2, "0")}/{MAX_SHAPES}</strong>
          </div>
          <div className="instrument-list">
            {INSTRUMENTS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`instrument-button ${instrument === item.id ? "is-active" : ""}`}
                style={{ "--instrument-color": item.color } as CSSProperties}
                aria-pressed={instrument === item.id}
                onClick={() => {
                  setInstrument(item.id);
                  if (tool === "select" || tool === "erase") setTool("draw");
                }}
              >
                <span className="instrument-code">{item.code}</span>
                <span className={formClass(item.form)} aria-hidden="true" />
                <span className="instrument-copy"><strong>{item.name}</strong><small>{item.subtitle}</small></span>
                <span className="instrument-count">{instrumentCounts[item.id]}</span>
              </button>
            ))}
          </div>

          <div className="rail-divider"><span>EDIT MODE</span></div>
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
        </aside>

        <section className="stage" aria-label="声音画布工作区">
          <div className="stage-status">
            <div className="live-status">
              <span className={`status-dot ${playing ? "is-live" : audioReady ? "is-ready" : ""}`} />
              <strong>{playing ? "SEQUENCE LIVE" : audioReady ? "AUDIO READY" : "点击播放唤醒音频"}</strong>
            </div>
            <div className="mapping-legend">
              <span>Y = 音高</span><i />
              <span>X = 时间 / 声像</span><i />
              <span>宽度 = 音长</span><i />
              <span>大小 = 力度</span>
            </div>
            <button type="button" className="mutation-button" onClick={remix}>⌁ MUTATE 变奏</button>
          </div>

          <div className="timeline-ruler" aria-hidden="true">
            {[1, 2, 3, 4].map((item) => <span key={item}>0{item} BAR</span>)}
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
            />
            <div className={`playhead ${playing ? "is-visible" : ""}`} style={{ left: `${playhead * 100}%` }} aria-hidden="true">
              <span />
            </div>
            <div className="pitch-labels" aria-hidden="true"><span>HIGH</span><span>MID</span><span>LOW</span></div>
            {!shapes.length && (
              <div className="empty-state">
                <div className="ghost-composition" aria-hidden="true">
                  <i className="ghost-one" /><i className="ghost-two" /><i className="ghost-three" />
                </div>
                <p className="eyebrow">BLANK SEQUENCE / 空白序列</p>
                <h2>先画下形状，再听见颜色。</h2>
                <p>选择左侧声音画笔，在网格点按或拖动。纵向决定音高，横向决定它何时响起。</p>
                <div>
                  <button type="button" className="button button--primary" onClick={loadDemo}>▶ 载入 4 小节示例</button>
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
            <span>SPACE 播放 / 停止</span>
          </p>
        </section>

        <aside className="inspector" aria-label="声音事件检查器">
          <div className="panel-heading">
            <div><p className="eyebrow">EVENT INSPECTOR</p><h2>{selectedShape ? "事件参数" : "序列 DNA"}</h2></div>
            <span>{selectedShape ? "ACTIVE" : "GLOBAL"}</span>
          </div>

          {selectedShape ? (
            <div className="selected-editor">
              <div
                className="selected-identity"
                style={{ "--instrument-color": getInstrument(selectedShape.instrument).color } as CSSProperties}
              >
                <span className={formClass(getInstrument(selectedShape.instrument).form)} aria-hidden="true" />
                <div><strong>{getInstrument(selectedShape.instrument).name}</strong><small>{midiToName(midiFromShape(selectedShape, scale))} · BEAT {shapeStartBeat(selectedShape).toFixed(2)}</small></div>
              </div>
              <label className="field-row">
                <span>VOICE / 音色</span>
                <select value={selectedShape.instrument} onChange={(event) => updateSelected({ instrument: event.target.value as InstrumentId })}>
                  {INSTRUMENTS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label className="range-field">
                <span><b>PITCH</b><output>{midiToName(midiFromShape(selectedShape, scale))}</output></span>
                <input type="range" min="0" max="1" step="0.01" value={1 - selectedShape.y} onChange={(event) => updateSelected({ y: 1 - Number(event.target.value) })} />
              </label>
              <label className="range-field">
                <span><b>START</b><output>{shapeStartBeat(selectedShape).toFixed(2)} beat</output></span>
                <input type="range" min="0" max="1" step="0.005" value={selectedShape.x} onChange={(event) => updateSelected({ x: Number(event.target.value) })} />
              </label>
              <label className="range-field">
                <span><b>DURATION</b><output>{eventDuration(selectedShape)} beat</output></span>
                <input type="range" min="0.02" max="0.34" step="0.005" value={selectedShape.width} onChange={(event) => updateSelected({ width: Number(event.target.value) })} />
              </label>
              <label className="range-field">
                <span><b>VELOCITY</b><output>{Math.round(eventVelocity(selectedShape) * 100)}%</output></span>
                <input type="range" min="0.035" max="0.18" step="0.005" value={selectedShape.size} onChange={(event) => updateSelected({ size: Number(event.target.value) })} />
              </label>
              <div className="derived-values">
                <div><span>PAN</span><strong>{selectedShape.x < 0.46 ? "L" : selectedShape.x > 0.54 ? "R" : "C"} {Math.round(Math.abs(selectedShape.x * 144 - 72))}</strong></div>
                <div><span>GRID</span><strong>1/16</strong></div>
              </div>
              <button type="button" className="delete-event" onClick={deleteSelected}>删除这个声音事件</button>
            </div>
          ) : (
            <>
              <div className="dna-number"><strong>{String(shapes.length).padStart(2, "0")}</strong><span>SOUND<br />EVENTS</span></div>
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
                <p className="eyebrow">HARMONIC ENGINE</p>
                <strong>{SCALES[scale].name}</strong>
                <span>所有音符自动吸附到音阶，随机绘画也保持和谐。</span>
              </div>
              <div className="analysis-card analysis-card--accent">
                <p className="eyebrow">COMPLEXTRO CORE</p>
                <strong>SWING 56 / SIDECHAIN ON</strong>
                <span>快速音色切换、碎拍细节与鼓组 ducking 已自动进入合成链。</span>
              </div>
            </>
          )}

          <details className="event-list">
            <summary>无障碍事件列表 <span>{shapes.length}</span></summary>
            <ol>
              {shapes.slice(0, 24).map((shape) => (
                <li key={shape.id}>
                  <button type="button" onClick={() => { setSelectedId(shape.id); setTool("select"); }}>
                    {getInstrument(shape.instrument).subtitle}，{midiToName(midiFromShape(shape, scale))}，第 {shapeStartBeat(shape).toFixed(2)} 拍，力度 {Math.round(eventVelocity(shape) * 100)}
                  </button>
                </li>
              ))}
            </ol>
          </details>
        </aside>
      </section>

      <footer className="transport" aria-label="播放控制">
        <div className="transport-left">
          <button type="button" className={`loop-button ${loop ? "is-active" : ""}`} aria-pressed={loop} onClick={() => setLoop((value) => !value)}>↻ LOOP <span>{loop ? "ON" : "OFF"}</span></button>
          <button type="button" onClick={() => { stopPlayback(); setPlayhead(0); }} aria-label="停止并回到开头">■ STOP</button>
        </div>
        <div className="transport-main">
          <div className="position-readout"><span>POSITION</span><strong>0{bar} : 0{beat} : 0{sixteenth}</strong></div>
          <button
            type="button"
            className={`play-button ${playing ? "is-playing" : ""}`}
            onClick={() => void play()}
            aria-label={playing ? "停止播放" : "播放序列"}
          >
            <span aria-hidden="true">{playing ? "■" : "▶"}</span>
            <strong>{playing ? "STOP SEQUENCE" : "PLAY SEQUENCE"}</strong>
          </button>
          <div className="duration-readout"><span>LENGTH</span><strong>{totalDuration.toFixed(1)} SEC</strong></div>
        </div>
        <div className="master-control">
          <button type="button" onClick={() => setMuted((value) => !value)}>{muted ? "MUTED" : "MASTER"}</button>
          <input aria-label="主音量" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
          <output>{muted ? "00" : String(Math.round(volume * 100)).padStart(2, "0")}</output>
        </div>
      </footer>

      <div className={`toast ${toast ? "is-visible" : ""}`} role="status" aria-live="polite">{toast}</div>
      {exporting && <div className="export-indicator" role="status"><span /><strong>OFFLINE RENDER</strong><small>正在合成完整立体声作品</small></div>}
    </main>
  );
}
