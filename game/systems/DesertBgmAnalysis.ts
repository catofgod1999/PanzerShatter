export type DesertBgmTimelinePoint = {
  timeSec: number;
  intensity: number;
  drumDensity: number;
  synthDrive: number;
  stringLift: number;
};

export type DesertBgmDesignSection = {
  index: number;
  startSec: number;
  endSec: number;
  terrainRelief: number;
  terrainRhythm: number;
  enemyPressure: number;
  lowHpBias: number;
  vegetationDensity: number;
  drumDensity: number;
  synthDrive: number;
  stringLift: number;
  label: string;
};

export type DesertBgmAnalysis = {
  version: 1;
  durationSec: number;
  windowSec: number;
  timeline: DesertBgmTimelinePoint[];
  sections: DesertBgmDesignSection[];
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const mean = (arr: number[]) => {
  if (!arr.length) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
};

const smooth = (arr: number[], radius: number): number[] => {
  if (arr.length <= 1 || radius <= 0) return arr.slice();
  const out = new Array<number>(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const from = Math.max(0, i - radius);
    const to = Math.min(arr.length - 1, i + radius);
    let sum = 0;
    let count = 0;
    for (let j = from; j <= to; j++) {
      sum += arr[j];
      count++;
    }
    out[i] = count > 0 ? sum / count : arr[i];
  }
  return out;
};

const normalizeSeries = (arr: number[]): number[] => {
  if (!arr.length) return [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = Math.max(1e-8, max - min);
  const out = new Array<number>(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = clamp01((arr[i] - min) / span);
  return out;
};

const downmixAudio = (buffer: AudioBuffer): Float32Array => {
  const channels = Math.max(1, buffer.numberOfChannels | 0);
  const len = buffer.length | 0;
  const mono = new Float32Array(len);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += data[i] / channels;
  }
  return mono;
};

const describeSection = (drumDensity: number, synthDrive: number, stringLift: number, intensity: number): string => {
  const energetic = intensity > 0.68 || drumDensity > 0.66;
  if (drumDensity >= synthDrive && drumDensity >= stringLift) return energetic ? '鼓组冲刺段' : '鼓组推进段';
  if (synthDrive >= drumDensity && synthDrive >= stringLift) return energetic ? '合成器压迫段' : '合成器铺底段';
  if (stringLift >= 0.62) return energetic ? '弦乐爆发段' : '弦乐抬升段';
  return energetic ? '综合高动态段' : '缓冲过渡段';
};

export function pickDesertSectionAtProgress(
  analysis: DesertBgmAnalysis | null | undefined,
  progress: number
): DesertBgmDesignSection | null {
  if (!analysis || !analysis.sections.length) return null;
  const p = clamp01(progress);
  const sectionCount = analysis.sections.length;
  const idx = Math.min(sectionCount - 1, Math.floor(p * sectionCount));
  return analysis.sections[idx] ?? analysis.sections[sectionCount - 1] ?? null;
}

export function analyzeDesertBgmBuffer(buffer: AudioBuffer): DesertBgmAnalysis {
  const mono = downmixAudio(buffer);
  const sampleRate = Math.max(1, buffer.sampleRate | 0);
  const durationSec = Math.max(0.1, buffer.duration || mono.length / sampleRate);

  const windowSec = 0.24;
  const hopSec = 0.12;
  const windowSize = Math.max(128, Math.floor(sampleRate * windowSec));
  const hopSize = Math.max(64, Math.floor(sampleRate * hopSec));

  const rmsRaw: number[] = [];
  const lowRaw: number[] = [];
  const midRaw: number[] = [];
  const highRaw: number[] = [];
  const transientRaw: number[] = [];
  const timelineTime: number[] = [];

  let start = 0;
  while (start + windowSize <= mono.length) {
    let sumSq = 0;
    let lowSq = 0;
    let midSq = 0;
    let highSq = 0;
    let diffAbs = 0;
    let prev = mono[start];
    let lpSlow = 0;
    let lpFast = 0;
    const alphaSlow = 0.01;
    const alphaFast = 0.055;

    for (let i = start; i < start + windowSize; i++) {
      const x = mono[i];
      lpSlow += (x - lpSlow) * alphaSlow;
      lpFast += (x - lpFast) * alphaFast;
      const low = lpSlow;
      const mid = lpFast - lpSlow;
      const high = x - lpFast;

      sumSq += x * x;
      lowSq += low * low;
      midSq += mid * mid;
      highSq += high * high;
      diffAbs += Math.abs(x - prev);
      prev = x;
    }

    const denom = Math.max(1, windowSize);
    rmsRaw.push(Math.sqrt(sumSq / denom));
    lowRaw.push(Math.sqrt(lowSq / denom));
    midRaw.push(Math.sqrt(midSq / denom));
    highRaw.push(Math.sqrt(highSq / denom));
    transientRaw.push(diffAbs / denom);
    timelineTime.push((start + windowSize * 0.5) / sampleRate);
    start += hopSize;
  }

  const rms = smooth(normalizeSeries(rmsRaw), 2);
  const low = smooth(normalizeSeries(lowRaw), 3);
  const mid = smooth(normalizeSeries(midRaw), 2);
  const high = smooth(normalizeSeries(highRaw), 1);
  const transient = smooth(normalizeSeries(transientRaw), 1);

  const onset: number[] = new Array(rms.length).fill(0);
  const rise: number[] = new Array(rms.length).fill(0);
  for (let i = 1; i < rms.length; i++) {
    const dr = Math.max(0, rms[i] - rms[i - 1]);
    const dt = Math.max(0, transient[i] - transient[i - 1]);
    rise[i] = dr;
    onset[i] = clamp01(dr * 1.2 + dt * 1.5);
  }
  const onsetSmooth = smooth(onset, 2);
  const riseSmooth = smooth(rise, 3);

  const intensity: number[] = new Array(rms.length).fill(0);
  const drumDensity: number[] = new Array(rms.length).fill(0);
  const synthDrive: number[] = new Array(rms.length).fill(0);
  const stringLift: number[] = new Array(rms.length).fill(0);

  for (let i = 0; i < rms.length; i++) {
    const iVal = clamp01(rms[i] * 0.62 + low[i] * 0.2 + mid[i] * 0.18);
    const dVal = clamp01(onsetSmooth[i] * 0.68 + transient[i] * 0.32);
    const sVal = clamp01(mid[i] * 0.48 + high[i] * 0.34 + iVal * 0.28 - dVal * 0.2);
    const strVal = clamp01(low[i] * 0.2 + mid[i] * 0.38 + iVal * 0.42 + riseSmooth[i] * 0.25 - high[i] * 0.22);
    intensity[i] = iVal;
    drumDensity[i] = dVal;
    synthDrive[i] = sVal;
    stringLift[i] = strVal;
  }

  const smIntensity = smooth(intensity, 3);
  const smDrum = smooth(drumDensity, 2);
  const smSynth = smooth(synthDrive, 3);
  const smString = smooth(stringLift, 4);

  const targetTimelinePoints = 240;
  const stride = Math.max(1, Math.ceil(smIntensity.length / targetTimelinePoints));
  const timeline: DesertBgmTimelinePoint[] = [];
  for (let i = 0; i < smIntensity.length; i += stride) {
    timeline.push({
      timeSec: timelineTime[i] ?? (i * hopSec),
      intensity: clamp01(smIntensity[i]),
      drumDensity: clamp01(smDrum[i]),
      synthDrive: clamp01(smSynth[i]),
      stringLift: clamp01(smString[i])
    });
  }

  const desiredSections = Math.max(8, Math.min(22, Math.round(durationSec / 8)));
  const sectionDur = durationSec / desiredSections;
  const sections: DesertBgmDesignSection[] = [];

  for (let sectionIndex = 0; sectionIndex < desiredSections; sectionIndex++) {
    const startSec = sectionIndex * sectionDur;
    const endSec = sectionIndex === desiredSections - 1 ? durationSec : (sectionIndex + 1) * sectionDur;
    const bucket: number[] = [];
    for (let i = 0; i < timeline.length; i++) {
      const t = timeline[i].timeSec;
      if (t >= startSec && t < endSec) bucket.push(i);
    }
    if (!bucket.length && timeline.length) bucket.push(Math.min(timeline.length - 1, Math.floor((sectionIndex / desiredSections) * timeline.length)));

    const bIntensity = mean(bucket.map(i => timeline[i].intensity));
    const bDrum = mean(bucket.map(i => timeline[i].drumDensity));
    const bSynth = mean(bucket.map(i => timeline[i].synthDrive));
    const bString = mean(bucket.map(i => timeline[i].stringLift));

    const terrainRelief = clamp01(0.24 + bIntensity * 0.56 + bString * 0.2);
    const terrainRhythm = clamp01(0.2 + bDrum * 0.6 + bSynth * 0.2);
    const enemyPressure = clamp01(0.08 + bDrum * 0.58 + bIntensity * 0.34 + bSynth * 0.12);
    const lowHpBias = clamp01(0.45 + enemyPressure * 0.42 + bDrum * 0.2);
    const vegetationDensity = clamp01(0.2 + bString * 0.55 + (1 - bDrum) * 0.25 + bSynth * 0.1);

    sections.push({
      index: sectionIndex,
      startSec,
      endSec,
      terrainRelief,
      terrainRhythm,
      enemyPressure,
      lowHpBias,
      vegetationDensity,
      drumDensity: bDrum,
      synthDrive: bSynth,
      stringLift: bString,
      label: describeSection(bDrum, bSynth, bString, bIntensity)
    });
  }

  return {
    version: 1,
    durationSec,
    windowSec,
    timeline,
    sections
  };
}
