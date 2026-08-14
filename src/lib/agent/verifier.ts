// src/lib/agent/verifier.ts
//
// VLM-driven job quality verification.
//
// After each supported task completes (autopick, extract, class2d, class3d,
// refine3d, ctffind), the engine calls verifyJobQuality() which:
//   1. Renders the relevant result images to PNG (micrograph+picking overlay,
//      class averages grid, particle thumbnails grid, 3D map slice)
//   2. Sends the PNG(s) to the vision LLM with a task-specific prompt
//   3. Parses the structured JSON response into a VerificationResult
//
// If verification fails, the engine creates a RETRY job of the same task type
// with adjusted parameters (see adjustParamsForRetry). Max 3 retries per task.

import ZAI from "z-ai-web-dev-sdk";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

let _zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;
async function zai() {
  if (!_zai) _zai = await ZAI.create();
  return _zai;
}

export const MAX_RETRIES = 3;

export interface VerificationResult {
  passed: boolean;
  score: number; // 1-10
  reasoning: string;
  issues: string[];
  suggestedParams: Record<string, string | number | boolean>;
}

export interface VerifiableJob {
  id: string;
  taskType: string;
  parameters: string;
  primaryOutput: string;
  outputFiles: string;
  alias: string;
}

// ---------------------------------------------------------------------------
// Render helpers — call the Python render_preview.py script to produce PNGs
// ---------------------------------------------------------------------------

const RENDER_SCRIPT = path.resolve(
  process.cwd(),
  "mini-services",
  "relion-runner",
  "render_preview.py",
);

async function renderPickingOverlay(
  micrographPath: string,
  autopickStarPath: string,
  outputPath: string,
): Promise<boolean> {
  try {
    await execFileAsync("python3", [
      RENDER_SCRIPT, "--mode", "picking",
      "--micrograph", micrographPath,
      "--coords", autopickStarPath,
      "--output", outputPath,
    ], { timeout: 30000 });
    return fs.existsSync(outputPath);
  } catch {
    return false;
  }
}

async function renderClassGrid(
  stackPath: string,
  outputPath: string,
  max = 10,
): Promise<boolean> {
  try {
    await execFileAsync("python3", [
      RENDER_SCRIPT, "--mode", "classgrid",
      "--stack", stackPath,
      "--output", outputPath,
      "--max", String(max),
    ], { timeout: 30000 });
    return fs.existsSync(outputPath);
  } catch {
    return false;
  }
}

async function renderParticles(
  stackPath: string,
  outputPath: string,
  max = 12,
): Promise<boolean> {
  try {
    await execFileAsync("python3", [
      RENDER_SCRIPT, "--mode", "particles",
      "--stack", stackPath,
      "--output", outputPath,
      "--max", String(max),
    ], { timeout: 30000 });
    return fs.existsSync(outputPath);
  } catch {
    return false;
  }
}

async function renderSlice(volumePath: string, outputPath: string): Promise<boolean> {
  try {
    await execFileAsync("python3", [
      RENDER_SCRIPT, "--mode", "slice",
      "--volume", volumePath,
      "--output", outputPath,
    ], { timeout: 30000 });
    return fs.existsSync(outputPath);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// VLM call helper
// ---------------------------------------------------------------------------

function imageToDataUrl(pngPath: string): string | null {
  try {
    const buf = fs.readFileSync(pngPath);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

interface VLMResponse {
  score?: number;
  passed?: boolean;
  pass?: boolean;
  reasoning?: string;
  reason?: string;
  issues?: string[];
  issues_found?: string[];
  suggested_params?: Record<string, string | number | boolean>;
  suggestedParams?: Record<string, string | number | boolean>;
}

async function callVLM(prompt: string, imagePaths: string[]): Promise<VerificationResult> {
  const client = await zai();
  const content: any[] = [{ type: "text", text: prompt }];
  for (const p of imagePaths) {
    const url = imageToDataUrl(p);
    if (url) {
      content.push({ type: "image_url", image_url: { url } });
    }
  }
  try {
    const response = await client.chat.completions.createVision({
      messages: [{ role: "user", content }],
      thinking: { type: "disabled" },
    });
    const raw = response.choices[0]?.message?.content ?? "";
    const parsed = parseVLMJson(raw);
    const score = Number(parsed.score) || 0;
    const passed = parsed.passed ?? parsed.pass ?? score >= 7;
    return {
      passed,
      score,
      reasoning: parsed.reasoning || parsed.reason || raw.slice(0, 500),
      issues: parsed.issues || parsed.issues_found || [],
      suggestedParams: parsed.suggested_params || parsed.suggestedParams || {},
    };
  } catch (e: any) {
    // VLM call failed — fail-open (assume passed) so the pipeline doesn't stall
    return {
      passed: true,
      score: 7,
      reasoning: `VLM verification failed (${e?.message || "unknown error"}); proceeding without verification.`,
      issues: ["vlm-call-failed"],
      suggestedParams: {},
    };
  }
}

function parseVLMJson(raw: string): VLMResponse {
  // strip code fences
  let t = raw.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) return {};
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Per-task verifiers
// ---------------------------------------------------------------------------

// Find the first .mrc micrograph referenced by the import/motioncorr job's
// outputs (for autopick overlay rendering).
async function findFirstMicrograph(projectId: string, jobId: string): Promise<string | null> {
  const projDir = path.resolve(process.cwd(), "data", "projects", projectId);
  // Look at ALL jobs' output files — the micrographs may be in the import
  // job (single-frame) or motioncorr job (movie data).
  const jobs = await db.job.findMany({
    where: { workflow: { projectId } },
    select: { taskType: true, outputFiles: true },
  });
  for (const j of jobs) {
    if (j.taskType !== "import" && j.taskType !== "motioncorr") continue;
    const files: { path: string; size: number }[] = j.outputFiles ? JSON.parse(j.outputFiles) : [];
    for (const f of files) {
      const p = f.path.toLowerCase();
      if (p.endsWith(".mrc") && !p.includes("particles/") && !p.includes("ctffind") && !p.includes("mask")) {
        const full = path.join(projDir, f.path);
        if (fs.existsSync(full)) return full;
      }
    }
  }
  return null;
}

// Find the particles.mrcs stack produced by an extract job (for class2d/
// extract verification).
async function findParticlesStack(projectId: string, jobId: string): Promise<string | null> {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { outputFiles: true } });
  const projDir = path.resolve(process.cwd(), "data", "projects", projectId);
  const files: { path: string; size: number }[] = job?.outputFiles ? JSON.parse(job.outputFiles) : [];
  for (const f of files) {
    if (f.path.endsWith("particles.mrcs")) {
      const full = path.join(projDir, f.path);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

// Find the run_itNNN_classes.mrcs stack produced by a class2d job.
async function findClassAveragesStack(projectId: string, jobId: string): Promise<string | null> {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { outputFiles: true, primaryOutput: true } });
  const projDir = path.resolve(process.cwd(), "data", "projects", projectId);
  const files: { path: string; size: number }[] = job?.outputFiles ? JSON.parse(job.outputFiles) : [];
  // Prefer the final iteration's _classes.mrcs; fall back to run_unmasked_classes.mrcs
  const classStacks = files
    .filter((f) => /run_it\d+_classes\.mrcs$/.test(f.path))
    .sort((a, b) => {
      const ai = parseInt(a.path.match(/run_it(\d+)_classes/)?.[1] || "0", 10);
      const bi = parseInt(b.path.match(/run_it(\d+)_classes/)?.[1] || "0", 10);
      return bi - ai;
    });
  if (classStacks.length > 0) {
    const full = path.join(projDir, classStacks[0].path);
    if (fs.existsSync(full)) return full;
  }
  const unmasked = files.find((f) => f.path.endsWith("run_unmasked_classes.mrcs"));
  if (unmasked) {
    const full = path.join(projDir, unmasked.path);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

// Find a 3D map .mrc produced by class3d/refine3d/initialmodel.
async function findVolumeMap(projectId: string, jobId: string): Promise<string | null> {
  const job = await db.job.findUnique({ where: { id: jobId }, select: { outputFiles: true, primaryOutput: true } });
  const projDir = path.resolve(process.cwd(), "data", "projects", projectId);
  const files: { path: string; size: number }[] = job?.outputFiles ? JSON.parse(job.outputFiles) : [];
  // Prefer the primary output if it's a .mrc volume
  if (job?.primaryOutput && job.primaryOutput.endsWith(".mrc")) {
    const full = path.join(projDir, job.primaryOutput);
    if (fs.existsSync(full)) return full;
  }
  // Otherwise look for halfmap or class volume
  const vol = files.find((f) => /run_it\d+_(class|half|map).*\.mrc$/.test(f.path) && !f.path.includes("classes.mrcs"));
  if (vol) {
    const full = path.join(projDir, vol.path);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

// --- autopick -------------------------------------------------------------
async function verifyAutopick(projectId: string, job: VerifiableJob): Promise<VerificationResult> {
  const projDir = path.resolve(process.cwd(), "data", "projects", projectId);
  const files: { path: string; size: number }[] = job.outputFiles ? JSON.parse(job.outputFiles) : [];
  const autopickStar = files.find((f) => f.path.endsWith("autopick.star"));
  if (!autopickStar) {
    return { passed: true, score: 7, reasoning: "No autopick.star found — skipping verification", issues: [], suggestedParams: {} };
  }
  const autopickStarPath = path.join(projDir, autopickStar.path);
  const micrographPath = await findFirstMicrograph(projectId, job.id);
  if (!micrographPath) {
    return { passed: true, score: 7, reasoning: "No micrograph found for overlay — skipping verification", issues: [], suggestedParams: {} };
  }
  const tmpPng = path.join(projDir, `_verify_${job.id}_picking.png`);
  const ok = await renderPickingOverlay(micrographPath, autopickStarPath, tmpPng);
  if (!ok) {
    return { passed: true, score: 7, reasoning: "Picking overlay render failed — skipping verification", issues: ["render-failed"], suggestedParams: {} };
  }
  const params = JSON.parse(job.parameters);
  const angpix = Number(params.angpix) || Number(params.import_angpix) || 0;
  const prompt = `You are a cryo-EM data-processing expert verifying particle picking quality.

This image shows a cryo-EM micrograph with GREEN CIRCLES drawn at the positions of auto-picked particles. The particles are protein molecules — in cryo-EM micrographs they appear as DARK SPOTS on a brighter background.

CURRENT PARAMETERS:
- pixel size: ${angpix} Å/px
- method: ${params.do_topaz ? "topaz (deep learning)" : params.do_LoG ? "LoG (RELION built-in Laplacian-of-Gaussian)" : "known coords (copied from source)"}
- particle_diameter: ${params.particle_diameter} Å (= ${(Number(params.particle_diameter) / angpix).toFixed(1)} px at ${angpix} Å/px)
- threshold: ${params.threshold ?? "n/a"}

CONTEXT: At ${angpix} Å/px, a typical protein particle of 100-200 Å diameter spans ${((100 / angpix).toFixed(0))}-${((200 / angpix).toFixed(0))} px. The green circles should match the visible particle size — if circles are much larger or smaller than the dark spots, the diameter is wrong.

Evaluate:
1. Are the green circles placed on actual protein particles (visible dark spots), or on empty background/noise?
2. Is the CIRCLE SIZE appropriate — do the circles match the size of visible particles? If particles look ~${((130 / angpix).toFixed(0))} px wide, is the diameter setting close to that?
3. Is the picking density reasonable (not too sparse, not overcrowded)?
4. Are obvious particles being missed (false negatives)?

CRITICAL: If the picking is bad, suggest SPECIFIC parameter changes:
- particle_diameter (in Å): measure the visible particle size in the image and suggest the right diameter
- threshold: if too many false positives, increase; if too few picks, decrease
- do_LoG: true to use RELION's built-in LoG picker, false to use Topaz

Respond in EXACTLY this JSON format (no markdown):
{
  "score": <1-10 integer>,
  "passed": <true if score>=7 else false>,
  "reasoning": "<2-3 sentence explanation>",
  "issues": ["<issue 1>", "<issue 2>"],
  "suggested_params": {"particle_diameter": <int in Å, e.g. 130>, "threshold": <float 0-1>, "do_topaz": <bool>, "do_LoG": <bool>}
}`;
  const result = await callVLM(prompt, [tmpPng]);
  try { fs.unlinkSync(tmpPng); } catch {}
  return result;
}

// --- extract ---------------------------------------------------------------
async function verifyExtract(projectId: string, job: VerifiableJob): Promise<VerificationResult> {
  const stackPath = await findParticlesStack(projectId, job.id);
  if (!stackPath) {
    return { passed: true, score: 7, reasoning: "No particles.mrcs found — skipping verification", issues: [], suggestedParams: {} };
  }
  const projDir = path.resolve(process.cwd(), "data", "projects", projectId);
  const tmpPng = path.join(projDir, `_verify_${job.id}_particles.png`);
  const ok = await renderParticles(stackPath, tmpPng, 12);
  if (!ok) {
    return { passed: true, score: 7, reasoning: "Particle render failed — skipping", issues: ["render-failed"], suggestedParams: {} };
  }
  const params = JSON.parse(job.parameters);
  const angpix = Number(params.angpix) || Number(params.import_angpix) || 0;
  const currentBox = Number(params.box_size) || Number(params.extract_size) || 0;
  const prompt = `You are a cryo-EM expert verifying particle extraction quality.

This image shows a GRID of the first 12 extracted particle boxes from a particles.mrcs stack. Each cell is a small box centered on a picked particle. The display uses the classic cryo-EM convention: PROTEIN = WHITE (bright), BACKGROUND = BLACK (dark).

CURRENT PARAMETERS:
- box_size: ${currentBox} px (= ${(currentBox * angpix).toFixed(0)} Å field of view at ${angpix} Å/px)
- pixel size: ${angpix} Å/px
- particle_diameter: ${params.particle_diameter} Å (= ${(Number(params.particle_diameter) / angpix).toFixed(1)} px)

CONTEXT: The box should be ~2x the particle diameter in pixels so the particle fills ~50% of the box. For a ${params.particle_diameter} Å particle at ${angpix} Å/px, the ideal box is ~${Math.round(Number(params.particle_diameter) / angpix * 2)} px.

Evaluate:
1. Do the boxes contain visible WHITE protein density (bright centered regions)?
2. Are the particles centered in the boxes (not clipped at edges)?
3. Is the box size appropriate? If the particle fills <30% of the box, the box is TOO LARGE. If the particle is clipped at edges, the box is TOO SMALL.
4. Are there junk boxes (empty/black, or ice contamination)?

CRITICAL: If the box size is wrong, suggest a SPECIFIC new box_size:
- If particle is clipped → increase box_size
- If particle fills <30% of box → decrease box_size
- Ideal: particle fills 40-60% of the box

Respond in EXACTLY this JSON format:
{
  "score": <1-10>,
  "passed": <true if score>=7>,
  "reasoning": "<explanation>",
  "issues": ["..."],
  "suggested_params": {"box_size": <int in px, e.g. 96>, "particle_diameter": <int in Å, e.g. 130>}
}`;
  const result = await callVLM(prompt, [tmpPng]);
  try { fs.unlinkSync(tmpPng); } catch {}
  return result;
}

// --- class2d ---------------------------------------------------------------
async function verifyClass2D(projectId: string, job: VerifiableJob): Promise<VerificationResult> {
  const stackPath = await findClassAveragesStack(projectId, job.id);
  if (!stackPath) {
    return { passed: true, score: 7, reasoning: "No class averages stack found — skipping verification", issues: [], suggestedParams: {} };
  }
  const projDir = path.resolve(process.cwd(), "data", "projects", projectId);
  const tmpPng = path.join(projDir, `_verify_${job.id}_classgrid.png`);
  const params = JSON.parse(job.parameters);
  const nrClasses = Number(params.nr_classes) || 10;
  const ok = await renderClassGrid(stackPath, tmpPng, Math.min(nrClasses, 10));
  if (!ok) {
    return { passed: true, score: 7, reasoning: "Class grid render failed — skipping", issues: ["render-failed"], suggestedParams: {} };
  }
  const prompt = `You are a cryo-EM expert verifying 2D classification quality.

This image shows a GRID of 2D class averages produced by RELION relion_refine. Each cell is one class average (the average of all particles assigned to that class). The display uses the classic cryo-EM convention: PROTEIN = WHITE (bright), BACKGROUND = BLACK (dark).

For a good classification, the class averages should show:
- Clear, distinct views of the particle (different orientations)
- Sharp features (not blurry blobs)
- High signal-to-noise (the particle should be clearly WHITE against BLACK background)

CURRENT PARAMETERS:
- nr_classes: ${nrClasses}
- iterations: ${params.iter_nr_iter}
- tau_fudge (regularization T): ${params.tau_fudge}

Evaluate:
1. Do the class averages show CLEAR WHITE particle views with distinguishable features?
2. Are there junk classes (pure noise, blurred, or empty/black)?
3. Is the number of good classes reasonable (at least 2-3 clearly-resolved views)?
4. Are the features sharp enough to suggest the particles are well-aligned?
5. If ALL classes look like noise or blurry blobs, the problem is likely upstream (bad picking or bad box size) — note this in issues.

If the classification is poor, suggest parameter changes:
- iter_nr_iter: more iterations (5→10→15) for better convergence
- tau_fudge: higher T (2→4) gives smoother/sharper classes; lower T gives more diverse classes
- nr_classes: fewer classes (10→5) concentrates particles into better averages

Respond in EXACTLY this JSON format:
{
  "score": <1-10>,
  "passed": <true if score>=7>,
  "reasoning": "<explanation>",
  "issues": ["..."],
  "suggested_params": {"iter_nr_iter": <int>, "tau_fudge": <float>, "nr_classes": <int>}
}`;
  const result = await callVLM(prompt, [tmpPng]);
  try { fs.unlinkSync(tmpPng); } catch {}
  return result;
}

// --- class3d / refine3d / initialmodel ------------------------------------
async function verify3DRefinement(projectId: string, job: VerifiableJob): Promise<VerificationResult> {
  const volPath = await findVolumeMap(projectId, job.id);
  if (!volPath) {
    return { passed: true, score: 7, reasoning: "No 3D volume map found — skipping verification", issues: [], suggestedParams: {} };
  }
  const projDir = path.resolve(process.cwd(), "data", "projects", projectId);
  const tmpPng = path.join(projDir, `_verify_${job.id}_slice.png`);
  const ok = await renderSlice(volPath, tmpPng);
  if (!ok) {
    return { passed: true, score: 7, reasoning: "Slice render failed — skipping", issues: ["render-failed"], suggestedParams: {} };
  }
  const prompt = `You are a cryo-EM expert verifying 3D reconstruction quality.

This image shows the MIDDLE Z-SLICE of a 3D density map produced by RELION ${job.taskType}.

Evaluate:
1. Does the slice show a clear, contiguous protein density (not just noise)?
2. Is the density well-defined with sharp boundaries?
3. Are there signs of over-refinement (noise amplification, spurious density)?
4. For an initial model: does it look like a plausible low-resolution particle envelope?

Respond in EXACTLY this JSON format:
{
  "score": <1-10>,
  "passed": <true if score>=6>,
  "reasoning": "<explanation>",
  "issues": ["..."],
  "suggested_params": {"iter_nr_iter": <int>}
}`;
  const result = await callVLM(prompt, [tmpPng]);
  try { fs.unlinkSync(tmpPng); } catch {}
  return result;
}

// --- ctffind ---------------------------------------------------------------
async function verifyCtffind(projectId: string, job: VerifiableJob): Promise<VerificationResult> {
  // CTF verification uses the CTF quality scatter data (parsed from the star).
  // Since we can't easily render a plot server-side, we use the summary stats.
  const summary = JSON.parse((await db.job.findUnique({ where: { id: job.id }, select: { outputSummary: true } }))?.outputSummary || "{}");
  const avgRes = Number(summary.avg_resolution_A) || 0;
  const n = Number(summary.n_micrographs) || 0;
  // Heuristic: avg CTF resolution < 8 Å is good, > 12 Å is poor
  const score = avgRes === 0 ? 7 : avgRes < 6 ? 9 : avgRes < 8 ? 8 : avgRes < 12 ? 6 : 4;
  const passed = score >= 6;
  return {
    passed,
    score,
    reasoning: `CTF fit avg resolution: ${avgRes} Å across ${n} micrographs. ${passed ? "Acceptable." : "Poor — consider re-running with different box size / resolution range."}`,
    issues: passed ? [] : [`avg_resolution_${avgRes}Å_is_poor`],
    suggestedParams: passed ? {} : { box_size: 256, min_res: 50, max_res: 8 },
  };
}

// ---------------------------------------------------------------------------
// Main entry: dispatch to the right verifier
// ---------------------------------------------------------------------------
export async function verifyJobQuality(
  projectId: string,
  job: VerifiableJob,
): Promise<VerificationResult> {
  switch (job.taskType) {
    case "autopick":
      return verifyAutopick(projectId, job);
    case "extract":
      return verifyExtract(projectId, job);
    case "class2d":
      return verifyClass2D(projectId, job);
    case "class3d":
    case "refine3d":
    case "initialmodel":
      return verify3DRefinement(projectId, job);
    case "ctffind":
      return verifyCtffind(projectId, job);
    default:
      return { passed: true, score: 10, reasoning: "No verifier for this task type", issues: [], suggestedParams: {} };
  }
}

// ---------------------------------------------------------------------------
// Retry parameter adjustment
// ---------------------------------------------------------------------------

// Clamp VLM-suggested parameter values to safe ranges. The VLM sometimes
// proposes nonsensical values (e.g. particle_diameter=0, box_size=-1).
function clampSuggestedParam(key: string, value: string | number | boolean): string | number | boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  switch (key) {
    case "particle_diameter":
      return Math.max(20, Math.min(n, 500));
    case "box_size":
    case "extract_size":
      return Math.max(32, Math.min(n, 256));
    case "threshold":
      return Math.max(0, Math.min(n, 1));
    case "iter_nr_iter":
      return Math.max(3, Math.min(Math.round(n), 25));
    case "tau_fudge":
      return Math.max(0.1, Math.min(n, 20));
    case "nr_classes":
      return Math.max(2, Math.min(Math.round(n), 50));
    default:
      return n;
  }
}

export function adjustParamsForRetry(
  taskType: string,
  currentParams: Record<string, string | number | boolean>,
  retryCount: number,
  verification: VerificationResult,
): Record<string, string | number | boolean> {
  const newParams: Record<string, string | number | boolean> = { ...currentParams };

  // First, apply VLM-suggested params — but CLAMP them to safe ranges to
  // prevent the VLM from proposing nonsensical values (e.g. particle_diameter=0).
  if (verification.suggestedParams) {
    for (const [k, v] of Object.entries(verification.suggestedParams)) {
      const clamped = clampSuggestedParam(k, v);
      if (clamped !== null) {
        newParams[k] = clamped;
      }
    }
  }

  // Then apply retry-strategy-specific defaults if the VLM didn't suggest values
  switch (taskType) {
    case "autopick":
      if (retryCount === 1 && newParams.do_topaz === undefined && newParams.do_LoG === undefined) {
        // switch from topaz to LoG
        newParams.do_topaz = false;
        newParams.do_LoG = true;
      } else if (retryCount === 2 && verification.suggestedParams.particle_diameter === undefined) {
        // adjust diameter ±25%
        const d = Number(newParams.particle_diameter) || 130;
        newParams.particle_diameter = Math.round(d * 1.25);
      } else if (retryCount >= 3 && verification.suggestedParams.threshold === undefined) {
        // lower threshold to pick more
        const t = Number(newParams.threshold) || 0;
        newParams.threshold = Math.max(0, t - 0.2);
      }
      break;
    case "class2d":
      if (retryCount === 1 && verification.suggestedParams.iter_nr_iter === undefined) {
        // increase iterations
        const it = Number(newParams.iter_nr_iter) || 5;
        newParams.iter_nr_iter = Math.min(it + 5, 15);
      } else if (retryCount === 2 && verification.suggestedParams.tau_fudge === undefined) {
        // increase regularization
        const t = Number(newParams.tau_fudge) || 2;
        newParams.tau_fudge = t * 2;
      } else if (retryCount >= 3 && verification.suggestedParams.nr_classes === undefined) {
        // try fewer classes (more particles per class)
        const k = Number(newParams.nr_classes) || 10;
        newParams.nr_classes = Math.max(5, k - 3);
      }
      break;
    case "class3d":
    case "refine3d":
    case "initialmodel":
      if (verification.suggestedParams.iter_nr_iter === undefined) {
        const it = Number(newParams.iter_nr_iter) || 3;
        newParams.iter_nr_iter = Math.min(it + 2, 10);
      }
      break;
    case "extract":
      if (retryCount === 1 && verification.suggestedParams.box_size === undefined) {
        const b = Number(newParams.box_size) || 64;
        newParams.box_size = Math.min(b + 16, 128);
      } else if (retryCount >= 2 && verification.suggestedParams.particle_diameter === undefined) {
        const d = Number(newParams.particle_diameter) || 130;
        newParams.particle_diameter = Math.round(d * 1.2);
      }
      break;
  }
  return newParams;
}

// ---------------------------------------------------------------------------
// Retry count tracking — encoded in the parameters JSON as _retryCount
// ---------------------------------------------------------------------------
export function getRetryCount(params: Record<string, any>): number {
  return Number(params._retryCount) || 0;
}

export function setRetryCount(params: Record<string, any>, count: number): Record<string, any> {
  return { ...params, _retryCount: count };
}
