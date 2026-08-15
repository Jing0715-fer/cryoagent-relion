import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// GET /api/analyze?projectId=...&jobId=...
// Parses a job's RELION output star files and returns structured data for
// visualization:
//   - model_classes: per-class distribution, accuracy, estimated resolution
//   - orientations: particle Euler angles (rot, tilt, psi) + class assignment
//   - fsc: Fourier-shell correlation curve (from postprocess.star if present)
//   - class_averages: list of class-average image thumbnails (from _classes.mrcs)
//   - map_slice: thumbnail of the primary map (for the slice viewer)
//
// All parsing is done server-side; the browser just renders the JSON.

interface ModelClass {
  classNumber: number;
  distribution: number;
  accuracyRotations: number;
  accuracyTranslations: number;
  estimatedResolution: number;
  fourierCompleteness: number;
}

interface Orientation {
  rot: number;
  tilt: number;
  psi: number;
  classNumber: number;
  x: number;
  y: number;
}

interface FscPoint {
  resolution: number;       // Angstrom
  frequency: number;         // 1/resolution
  fsc: number;               // corrected FSC (main curve)
  fscRandom: number;         // random-phase FSC
  fscUnmasked: number;       // unmasked maps FSC
  fscMasked: number;         // masked maps FSC
  fscParticleMask: number;   // particle mask fraction FSC
}

interface GuinierPoint {
  resolutionSquared: number; // 1/Å²
  resolution: number;        // Å
  logAmpOriginal: number;
  logAmpWeighted: number;
  logAmpSharpened: number;
  logAmpIntercept: number;
}

interface GuinierFit {
  slope: number;
  intercept: number;
  correlation: number;
}

interface AnalyzeResult {
  jobId: string;
  taskType: string;
  modelClasses: ModelClass[];
  orientations: Orientation[];
  fsc: FscPoint[];
  guinier: GuinierPoint[];
  guinierFit: GuinierFit | null;
  classAverageCount: number;
  boxSize: number;
  pixelSize: number;
  nParticles: number;
  nClasses: number;
  primaryMapSlice?: string;  // path to a PNG slice thumbnail
  hasClassesMrcs: boolean;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const projectId = sp.get("projectId");
  const jobId = sp.get("jobId");
  if (!projectId || !jobId) {
    return NextResponse.json({ error: "projectId and jobId required" }, { status: 400 });
  }
  // Find the job to get its task type + primary output + output files
  const { db } = await import("@/lib/db");
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

  const projectRoot = path.resolve(process.cwd(), "data", "projects", projectId);
  const jobDir = path.join(projectRoot, job.primaryOutput ? path.dirname(job.primaryOutput) : "");
  const outputFiles: { path: string }[] = job.outputFiles ? JSON.parse(job.outputFiles) : [];

  const result: AnalyzeResult = {
    jobId,
    taskType: job.taskType,
    modelClasses: [],
    orientations: [],
    fsc: [],
    guinier: [],
    guinierFit: null,
    classAverageCount: 0,
    boxSize: 0,
    pixelSize: 0,
    nParticles: 0,
    nClasses: 0,
    hasClassesMrcs: false,
  };

  // Find the latest iteration's star files in the job dir
  if (fs.existsSync(jobDir)) {
    const files = fs.readdirSync(jobDir);

    // --- extract: parse particles.star for ground-truth orientations
    if (job.taskType === "extract" || job.taskType === "select") {
      const particlesStar = path.join(jobDir, "particles.star");
      if (fs.existsSync(particlesStar)) {
        const parsed = parseDataStar(particlesStar);
        result.orientations = parsed.orientations;
        result.nParticles = parsed.orientations.length;
      }
    }

    // --- class2d / class3d: parse model.star (per-class metrics) + data.star (orientations)
    if (job.taskType === "class2d" || job.taskType === "class3d") {
      const modelStars = files.filter((f) => /_model\.star$/.test(f)).sort();
      const dataStars = files.filter((f) => /_data\.star$/.test(f)).sort();
      if (modelStars.length) {
        const modelStar = path.join(jobDir, modelStars[modelStars.length - 1]);
        const parsed = parseModelStar(modelStar);
        result.modelClasses = parsed.classes;
        result.nClasses = parsed.classes.length;
        result.boxSize = parsed.boxSize;
        result.pixelSize = parsed.pixelSize;
      }
      if (dataStars.length) {
        const dataStar = path.join(jobDir, dataStars[dataStars.length - 1]);
        const parsed = parseDataStar(dataStar);
        result.orientations = parsed.orientations;
        result.nParticles = parsed.orientations.length;
      }
      // classes.mrcs present?
      result.hasClassesMrcs = files.some((f) => /_classes\.mrcs$/.test(f));
      result.classAverageCount = result.modelClasses.length;
    }

    // --- refine3d: parse model.star + data.star + sampling.star
    if (job.taskType === "refine3d") {
      const modelStars = files.filter((f) => /_model\.star$/.test(f)).sort();
      const dataStars = files.filter((f) => /_data\.star$/.test(f)).sort();
      if (modelStars.length) {
        const parsed = parseModelStar(path.join(jobDir, modelStars[modelStars.length - 1]));
        result.modelClasses = parsed.classes;
        result.boxSize = parsed.boxSize;
        result.pixelSize = parsed.pixelSize;
      }
      if (dataStars.length) {
        result.orientations = parseDataStar(path.join(jobDir, dataStars[dataStars.length - 1])).orientations;
        result.nParticles = result.orientations.length;
      }
    }

    // --- postprocess: parse the postprocess.star FSC table + Guinier plot
    if (job.taskType === "postprocess") {
      const ppStar = files.find((f) => f === "postprocess.star");
      if (ppStar) {
        const ppPath = path.join(jobDir, ppStar);
        result.fsc = parseFscStar(ppPath);
        const g = parseGuinierStar(ppPath);
        result.guinier = g.points;
        result.guinierFit = g.fit;
      }
    }
  }

  // Primary map slice (for the slice viewer) — generate on demand
  if (job.primaryOutput && /\.(mrc|mrcs)$/.test(job.primaryOutput)) {
    result.primaryMapSlice = `/api/files?projectId=${projectId}&path=${encodeURIComponent(job.primaryOutput)}&thumb=1`;
  }

  return NextResponse.json(result);
}

// ---------------------------------------------------------------------------
// STAR file parsers
// ---------------------------------------------------------------------------

function parseModelStar(modelStarPath: string): {
  classes: ModelClass[];
  boxSize: number;
  pixelSize: number;
} {
  const text = fs.readFileSync(modelStarPath, "utf8");
  const classes: ModelClass[] = [];
  let boxSize = 0;
  let pixelSize = 0;

  // General block: original image size + pixel size
  const sizeMatch = text.match(/_rlnOriginalImageSize\s+(\d+)/);
  if (sizeMatch) boxSize = parseInt(sizeMatch[1]);
  const pxMatch = text.match(/_rlnPixelSize\s+([\d.]+)/);
  if (pxMatch) pixelSize = parseFloat(pxMatch[1]);

  // data_model_classes block
  const classesBlock = extractDataBlock(text, "data_model_classes");
  if (classesBlock) {
    const lines = classesBlock.split("\n");
    // find the column header indices
    const colLines = lines.filter((l) => l.trim().startsWith("_rln"));
    const cols = colLines.map((l) => {
      const m = l.trim().match(/^(_\S+)\s+#(\d+)/);
      return m ? { name: m[1], idx: parseInt(m[2]) } : null;
    }).filter(Boolean) as { name: string; idx: number }[];
    const colIdx: Record<string, number> = {};
    for (const c of cols) colIdx[c.name] = c.idx;

    // data rows: lines that don't start with _ or # or data or loop
    for (const line of lines) {
      const s = line.trim();
      if (!s || s.startsWith("_") || s.startsWith("#") || s.startsWith("data_") || s.startsWith("loop_")) continue;
      const parts = s.split(/\s+/);
      if (parts.length < cols.length) continue;
      const dist = parseFloat(parts[(colIdx["_rlnClassDistribution"] || 2) - 1] || "0");
      const accRot = parseFloat(parts[(colIdx["_rlnAccuracyRotations"] || 3) - 1] || "0");
      const accTrans = parseFloat(parts[(colIdx["_rlnAccuracyTranslationsAngst"] || 4) - 1] || "0");
      const res = parseFloat(parts[(colIdx["_rlnEstimatedResolution"] || 5) - 1] || "0");
      const fourier = parseFloat(parts[(colIdx["_rlnOverallFourierCompleteness"] || 6) - 1] || "0");
      const classNum = classes.length + 1;
      // skip classes with zero distribution AND no resolution (junk classes)
      if (dist === 0 && (res === 999 || !isFinite(res))) continue;
      classes.push({
        classNumber: classNum,
        distribution: dist,
        accuracyRotations: accRot,
        accuracyTranslations: accTrans,
        estimatedResolution: isFinite(res) ? res : 0,
        fourierCompleteness: isFinite(fourier) ? fourier : 0,
      });
    }
  }
  return { classes, boxSize, pixelSize };
}

function parseDataStar(dataStarPath: string): { orientations: Orientation[] } {
  const text = fs.readFileSync(dataStarPath, "utf8");
  const orientations: Orientation[] = [];
  const particlesBlock = extractDataBlock(text, "data_particles");
  if (!particlesBlock) return { orientations };
  const lines = particlesBlock.split("\n");
  const colLines = lines.filter((l) => l.trim().startsWith("_rln"));
  const colIdx: Record<string, number> = {};
  for (const l of colLines) {
    const m = l.trim().match(/^(_\S+)\s+#(\d+)/);
    if (m) colIdx[m[1]] = parseInt(m[2]);
  }
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith("_") || s.startsWith("#") || s.startsWith("data_") || s.startsWith("loop_")) continue;
    const parts = s.split(/\s+/);
    if (parts.length < 10) continue;
    orientations.push({
      rot: parseFloat(parts[(colIdx["_rlnAngleRot"] || 8) - 1] || "0"),
      tilt: parseFloat(parts[(colIdx["_rlnAngleTilt"] || 9) - 1] || "0"),
      psi: parseFloat(parts[(colIdx["_rlnAnglePsi"] || 10) - 1] || "0"),
      classNumber: parseInt(parts[(colIdx["_rlnClassNumber"] || 14) - 1] || "0") || 1,
      x: parseFloat(parts[(colIdx["_rlnCoordinateX"] || 3) - 1] || "0"),
      y: parseFloat(parts[(colIdx["_rlnCoordinateY"] || 4) - 1] || "0"),
    });
  }
  return { orientations };
}

function parseFscStar(fscStarPath: string): FscPoint[] {
  const text = fs.readFileSync(fscStarPath, "utf8");
  const fscBlock = extractDataBlock(text, "data_fsc");
  if (!fscBlock) return [];
  const lines = fscBlock.split("\n");
  const colLines = lines.filter((l) => l.trim().startsWith("_rln"));
  const colIdx: Record<string, number> = {};
  for (const l of colLines) {
    const m = l.trim().match(/^(_\S+)\s+#(\d+)/);
    if (m) colIdx[m[1]] = parseInt(m[2]);
  }
  // RELION postprocess.star uses _rlnAngstromResolution for the resolution in Å
  // (some versions use _rlnResolution in 1/Å — prefer Å when present).
  const resCol = colIdx["_rlnAngstromResolution"] || colIdx["_rlnResolution"] || 3;
  const fscCol = colIdx["_rlnFourierShellCorrelationCorrected"]
    || colIdx["_rlnFourierShellCorrelationMaskedMaps"]
    || colIdx["_rlnFourierShellCorrelation"]
    || 4;
  const fscUnmaskedCol = colIdx["_rlnFourierShellCorrelationUnmaskedMaps"]
    || colIdx["_rlnFourierShellCorrelationParticleMaskFraction"]
    || 6;
  const points: FscPoint[] = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith("_") || s.startsWith("#") || s.startsWith("data_") || s.startsWith("loop_")) continue;
    const parts = s.split(/\s+/);
    if (parts.length < 4) continue;
    let resolution = parseFloat(parts[resCol - 1] || "0");
    // If _rlnResolution (1/Å) was used, convert to Å
    if (!colIdx["_rlnAngstromResolution"] && resolution > 0 && resolution < 1) {
      resolution = 1 / resolution;
    }
    if (resolution <= 0 || resolution > 9999 || resolution === 999) continue;
    // Parse all FSC columns from RELION postprocess.star
    const fscCorrected = parseFloat(parts[(colIdx["_rlnFourierShellCorrelationCorrected"] || 4) - 1] || "0");
    const fscParticleMask = parseFloat(parts[(colIdx["_rlnFourierShellCorrelationParticleMaskFraction"] || 5) - 1] || "0");
    const fscUnmasked = parseFloat(parts[(colIdx["_rlnFourierShellCorrelationUnmaskedMaps"] || 6) - 1] || "0");
    const fscMasked = parseFloat(parts[(colIdx["_rlnFourierShellCorrelationMaskedMaps"] || 7) - 1] || "0");
    const fscRandom = parseFloat(parts[(colIdx["_rlnCorrectedFourierShellCorrelationPhaseRandomizedMaskedMaps"] || 8) - 1] || "0");
    points.push({
      resolution,
      frequency: 1 / resolution,
      fsc: fscCorrected,
      fscRandom,
      fscUnmasked,
      fscMasked,
      fscParticleMask,
    });
  }
  return points;
}

// Parse the data_guinier block + the fitted slope/intercept/correlation from
// the data_general block of postprocess.star.
function parseGuinierStar(ppStarPath: string): { points: GuinierPoint[]; fit: GuinierFit | null } {
  const text = fs.readFileSync(ppStarPath, "utf8");
  const points: GuinierPoint[] = [];
  const guinierBlock = extractDataBlock(text, "data_guinier");
  if (guinierBlock) {
    const lines = guinierBlock.split("\n");
    const colLines = lines.filter((l) => l.trim().startsWith("_rln"));
    const colIdx: Record<string, number> = {};
    for (const l of colLines) {
      const m = l.trim().match(/^(_\S+)\s+#(\d+)/);
      if (m) colIdx[m[1]] = parseInt(m[2]);
    }
    for (const line of lines) {
      const s = line.trim();
      if (!s || s.startsWith("_") || s.startsWith("#") || s.startsWith("data_") || s.startsWith("loop_")) continue;
      const parts = s.split(/\s+/);
      if (parts.length < 5) continue;
      const resSq = parseFloat(parts[(colIdx["_rlnResolutionSquared"] || 1) - 1] || "0");
      const logOrig = parseFloat(parts[(colIdx["_rlnLogAmplitudesOriginal"] || 2) - 1] || "0");
      const logWeighted = parseFloat(parts[(colIdx["_rlnLogAmplitudesWeighted"] || 3) - 1] || "0");
      const logSharp = parseFloat(parts[(colIdx["_rlnLogAmplitudesSharpened"] || 4) - 1] || "0");
      const logIntercept = parseFloat(parts[(colIdx["_rlnLogAmplitudesIntercept"] || 5) - 1] || "0");
      // skip -99 placeholders (RELION writes these beyond the fitting range)
      if (logOrig <= -90 || logWeighted <= -90) continue;
      const resolution = resSq > 0 ? Math.sqrt(1 / resSq) : 0;
      points.push({
        resolutionSquared: resSq,
        resolution,
        logAmpOriginal: logOrig,
        logAmpWeighted: logWeighted,
        logAmpSharpened: logSharp,
        logAmpIntercept: logIntercept,
      });
    }
  }
  // fit from data_general
  let fit: GuinierFit | null = null;
  const slopeMatch = text.match(/_rlnFittedSlopeGuinierPlot\s+(-?[\d.]+)/);
  const interceptMatch = text.match(/_rlnFittedInterceptGuinierPlot\s+(-?[\d.]+)/);
  const corrMatch = text.match(/_rlnCorrelationFitGuinierPlot\s+(-?[\d.]+)/);
  if (slopeMatch && interceptMatch) {
    fit = {
      slope: parseFloat(slopeMatch[1]),
      intercept: parseFloat(interceptMatch[1]),
      correlation: corrMatch ? parseFloat(corrMatch[1]) : 0,
    };
  }
  return { points, fit };
}

function extractDataBlock(text: string, blockName: string): string | null {
  // Returns the content of a `data_xxx` block (from its `data_xxx` line until
  // the next `data_` line or EOF).
  const idx = text.indexOf(blockName);
  if (idx === -1) return null;
  const after = text.slice(idx + blockName.length);
  const nextData = after.indexOf("\ndata_");
  return nextData === -1 ? after : after.slice(0, nextData);
}
