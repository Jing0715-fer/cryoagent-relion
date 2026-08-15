// Simulated RELION executor.
// RELION itself cannot run in this sandbox; this module emulates the CLI behavior:
//   - emits realistic stdout-style log lines per task
//   - advances progress based on elapsed wall-clock time / typicalDuration
//   - computes plausible output summaries (particle counts, resolutions, defocus, etc.)
//
// The executor is deterministic-ish: outputs depend on the input parameters and on
// upstream job outputs (so the pipeline state evolves consistently).

import { getTask, RelionTask } from "./tasks";

export interface JobState {
  id: string;
  taskType: string;
  parameters: Record<string, string | number | boolean>;
  progress: number; // 0..100
  status: "queued" | "running" | "done" | "failed" | "skipped";
  startedAt: Date | null;
  outputSummary: Record<string, number | string>;
}

export interface LogLine {
  level: "info" | "warn" | "error" | "success";
  line: string;
}

// ---------------------------------------------------------------------------
// Output computation — derived from parameters + upstream outputs
// ---------------------------------------------------------------------------

interface PipelineContext {
  nMovies: number;
  pixelSize: number; // Å at specimen
  boxSize: number;
  nParticles: number;
  bestRes: number; // Å
  symmetry: string;
}

const initialCtx: PipelineContext = {
  nMovies: 0,
  pixelSize: 0.885,
  boxSize: 256,
  nParticles: 0,
  bestRes: 0,
  symmetry: "C1",
};

export function computeOutput(
  task: RelionTask,
  params: Record<string, string | number | boolean>,
  ctx: PipelineContext,
): Record<string, number | string> {
  const p = params;
  switch (task.key) {
    case "import": {
      const nMovies = 120 + Math.floor(Math.random() * 60);
      const frames = 32;
      return {
        n_movies: nMovies,
        frame_count: frames,
        pixel_size: p.angpix ?? 0.885,
        voltage_kV: p.kV ?? 300,
        optics_group: p.optics_group_name ?? "opticsGroup1",
      };
    }
    case "motioncorr": {
      const n = ctx.nMovies || 120;
      const drift = 0.6 + Math.random() * 0.8;
      return { n_micrographs: n, avg_drift_px: Number(drift.toFixed(2)), dose_weighted: !!(p.dose_weighting ?? true) };
    }
    case "ctffind": {
      const n = ctx.nMovies || 120;
      const defocus = 8000 + Math.floor(Math.random() * 6000);
      const astig = 200 + Math.floor(Math.random() * 400);
      const fitRes = 3.5 + Math.random() * 2.5;
      return {
        n_micrographs: n,
        avg_defocus_A: defocus,
        astigmatism_A: astig,
        avg_resolution_A: Number(fitRes.toFixed(2)),
        discarded_low_quality: Math.floor(n * 0.05),
      };
    }
    case "manualpick": {
      const n = Math.floor((ctx.nMovies || 120) * 0.5);
      return { n_particles: n * 8, n_micrographs_picked: n };
    }
    case "autopick": {
      const n = ctx.nMovies || 120;
      const density = 0.6 + Math.random() * 0.4;
      const picked = Math.floor(n * 25 * density);
      return { n_particles: picked, n_micrographs: n, pick_density: Number(density.toFixed(2)) };
    }
    case "extract": {
      const box = Number(p.extract_size ?? 256);
      const rescale = p.do_rescale ? Number(p.rescale ?? 128) : box;
      return {
        n_particles: ctx.nParticles || 3000,
        box_size: box,
        rescaled_box: rescale,
        pixel_size: Number(p.angpix ?? ctx.pixelSize ?? 1.0),
      };
    }
    case "select": {
      const removed = Math.floor((ctx.nParticles || 3000) * 0.12);
      return { n_particles: (ctx.nParticles || 3000) - removed, n_removed: removed, removed_pct: 12 };
    }
    case "class2d": {
      const nrClasses = Number(p.nr_classes ?? 50);
      const goodClasses = Math.floor(nrClasses * 0.35);
      const inGood = Math.floor((ctx.nParticles || 3000) * 0.72);
      const bestRes = 8 + Math.random() * 4;
      return {
        n_classes: nrClasses,
        good_classes: goodClasses,
        particles_in_good_classes: inGood,
        best_class_resolution_A: Number(bestRes.toFixed(2)),
      };
    }
    case "initialmodel": {
      const sym = String(p.symmetry ?? "C1");
      const res = 18 + Math.random() * 6;
      return { resolution_estimate_A: Number(res.toFixed(2)), symmetry: sym, n_models: Number(p.nr_classes ?? 3) };
    }
    case "class3d": {
      const nrClasses = Number(p.nr_classes ?? 4);
      const best = 1 + Math.floor(Math.random() * nrClasses);
      const bestRes = 7 + Math.random() * 3;
      const perClass = Math.floor((ctx.nParticles || 3000) / nrClasses);
      return {
        n_classes: nrClasses,
        best_class: best,
        best_class_resolution_A: Number(bestRes.toFixed(2)),
        particles_per_class: perClass,
      };
    }
    case "refine3d": {
      const res = 3.0 + Math.random() * 2.2;
      const n = ctx.nParticles || 120000;
      return {
        resolution_A: Number(res.toFixed(2)),
        n_particles: n,
        map_size: `${ctx.boxSize || 256}^3`,
        symmetry: String(p.symmetry ?? "C1"),
        gold_standard_fsc: 0.143,
      };
    }
    case "maskcreate": {
      return {
        mask_volume_vox: 45000 + Math.floor(Math.random() * 20000),
        soft_edge_px: Number(p.soft_edge ?? 3),
        threshold: Number(p.ini_threshold ?? 0.02),
      };
    }
    case "postprocess": {
      const baseRes = ctx.bestRes || 3.5;
      const sharpened = Math.max(2.2, baseRes - 0.4);
      return {
        resolution_A: Number(sharpened.toFixed(2)),
        b_factor: -60 - Math.floor(Math.random() * 80),
        map_size: `${ctx.boxSize || 256}^3`,
        fsc_cutoff: 0.143,
      };
    }
    case "localres": {
      const min = 2.5 + Math.random();
      const max = 7 + Math.random() * 3;
      const median = 3.5 + Math.random();
      return { min_res_A: Number(min.toFixed(2)), max_res_A: Number(max.toFixed(2)), median_res_A: Number(median.toFixed(2)) };
    }
    case "multibody": {
      const nB = Number(p.n_bodies ?? 2);
      const res = 3.5 + Math.random() * 1.5;
      return { n_bodies: nB, body_resolutions_A: Array.from({ length: nB }, () => Number((res + Math.random()).toFixed(2))).join(",") };
    }
    case "polish": {
      const gain = 0.2 + Math.random() * 0.4;
      return { n_particles: ctx.nParticles || 120000, resolution_gain_A: Number(gain.toFixed(2)) };
    }
    case "movierefine": {
      const gain = 0.1 + Math.random() * 0.3;
      return { n_particles: ctx.nParticles || 120000, resolution_gain_A: Number(gain.toFixed(2)) };
    }
    case "external": {
      return { exit_code: 0, n_lines: 12 + Math.floor(Math.random() * 30) };
    }
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Per-task log generators — emit RELION-style stdout
// ---------------------------------------------------------------------------

interface LogPlan {
  lines: { at: number; level: LogLine["level"]; text: string }[]; // at = progress %
}

function buildLogPlan(
  task: RelionTask,
  params: Record<string, string | number | boolean>,
  ctx: PipelineContext,
): LogPlan {
  const p = params;
  const lines: LogPlan["lines"] = [];
  const cmd = task.relionBinary;
  // Build a fake command-line resembling RELION's
  const argStr = Object.entries(p)
    .slice(0, 6)
    .map(([k, v]) => `--${k} ${v}`)
    .join(" ");
  lines.push({ at: 1, level: "info", text: `$ ${cmd} ${argStr} --o job${task.key}/` });

  switch (task.key) {
    case "import":
      lines.push({ at: 10, level: "info", text: `Reading movies matching ${p.fn_in ?? "Movies/*.tiff"}` });
      lines.push({ at: 60, level: "info", text: `Found ${ctx.nMovies || 142} movies, ${p.frame_count ?? 32} frames each` });
      lines.push({ at: 100, level: "success", text: `Imported. Optics group: ${p.optics_group_name ?? "opticsGroup1"}, angpix=${p.angpix ?? 0.885}` });
      break;
    case "motioncorr":
      lines.push({ at: 5, level: "info", text: `Allocating GPU ${p.gpu_ids ?? "0"}` });
      lines.push({ at: 25, level: "info", text: `Patch grid: ${p.patch_x ?? 5} x ${p.patch_y ?? 5}, B=${p.bfactor ?? 150}` });
      lines.push({ at: 70, level: "info", text: `Dose-weighting ${p.dose_weighting ? "ON" : "OFF"}, dose/frame=${p.dose_per_frame ?? 1}` });
      lines.push({ at: 100, level: "success", text: `All micrographs corrected, avg drift ${(0.7).toFixed(2)} px` });
      break;
    case "ctffind":
      lines.push({ at: 8, level: "info", text: `Running ${p.do_ctffind_extra ? "Gctf" : "CTFFIND"} on corrected micrographs` });
      lines.push({ at: 50, level: "info", text: `box=${p.box_size ?? 512}, search [${p.min_defocus ?? 5000}-${p.max_defocus ?? 50000}] Å` });
      lines.push({ at: 90, level: "warn", text: `Discarded ${Math.floor((ctx.nMovies || 120) * 0.05)} micrographs with poor CTF fit` });
      lines.push({ at: 100, level: "success", text: `Avg defocus ~9000 Å, fit resolution ~4.2 Å` });
      break;
    case "autopick":
      lines.push({ at: 5, level: "info", text: `${p.do_topaz ? "Topaz" : p.do_LoG ? "LoG" : "Reference"} picker, threshold=${p.threshold ?? 0.4}` });
      lines.push({ at: 60, level: "info", text: `Picked across ${ctx.nMovies || 120} micrographs` });
      lines.push({ at: 100, level: "success", text: `Total picks: ~3000 (density 0.7)` });
      break;
    case "extract":
      lines.push({ at: 8, level: "info", text: `Box=${p.extract_size ?? 256}, rescale -> ${p.do_rescale ? p.rescale ?? 128 : "no"}` });
      lines.push({ at: 100, level: "success", text: `Extracted ${ctx.nParticles || 3000} particles, invert=${p.do_invert ? "yes" : "no"}` });
      break;
    case "select":
      lines.push({ at: 30, level: "info", text: `Filtering by sigma <= ${p.select_max_sigma ?? 3}` });
      lines.push({ at: 100, level: "success", text: `Removed duplicates < ${p.min_distance ?? 100} Å; ~12% particles discarded` });
      break;
    case "class2d":
      lines.push({ at: 5, level: "info", text: `Multi-reference 2D, classes=${p.nr_classes ?? 50}, T=${p.tau_fudge ?? 2}` });
      lines.push({ at: 35, level: "info", text: `Iteration 5/25: likelihood improving` });
      lines.push({ at: 75, level: "info", text: `Iteration 20/25: classes converging` });
      lines.push({ at: 100, level: "success", text: `Done. Best class resolution ~9.2 Å, 18 good classes` });
      break;
    case "initialmodel":
      lines.push({ at: 10, level: "info", text: `SGD initial model, models=${p.nr_classes ?? 3}, sym=${p.symmetry ?? "C1"}` });
      lines.push({ at: 60, level: "info", text: `Random phase flipping + multi-model convergence` });
      lines.push({ at: 100, level: "success", text: `Model ready (resolution ~18 Å). Picking most consistent model.` });
      break;
    case "class3d":
      lines.push({ at: 5, level: "info", text: `3D classification, classes=${p.nr_classes ?? 4}, T=${p.tau_fudge ?? 4}` });
      lines.push({ at: 50, level: "info", text: `Iteration 12/25: class separation emerging` });
      lines.push({ at: 100, level: "success", text: `Class 2 dominant (~40% particles), resolution ~7.5 Å` });
      break;
    case "refine3d":
      lines.push({ at: 5, level: "info", text: `Auto-refine, sym=${p.symmetry ?? "C1"}, ini_lowpass=${p.ini_highres ?? 30} Å` });
      lines.push({ at: 30, level: "info", text: `Iteration 2: resolution ~6.1 Å` });
      lines.push({ at: 60, level: "info", text: `Iteration 4: resolution ~4.2 Å` });
      lines.push({ at: 90, level: "info", text: `Iteration 6: resolution ~3.4 Å` });
      lines.push({ at: 100, level: "success", text: `Converged at 3.2 Å (FSC=0.143). Saving half-maps.` });
      break;
    case "maskcreate":
      lines.push({ at: 20, level: "info", text: `Threshold=${p.ini_threshold ?? 0.02}, extend=${p.extend_mask ?? 3}, soft=${p.soft_edge ?? 3}` });
      lines.push({ at: 100, level: "success", text: `Mask created (volume ~52000 voxels)` });
      break;
    case "postprocess":
      lines.push({ at: 10, level: "info", text: `Rosenthal-Henderson auto-B, MTF ${p.fn_mtf ? "applied" : "none"}` });
      lines.push({ at: 70, level: "info", text: `Auto-B estimate: -95` });
      lines.push({ at: 100, level: "success", text: `Final map resolution: 3.1 Å (FSC=0.143)` });
      break;
    case "localres":
      lines.push({ at: 20, level: "info", text: `relion_locres: block-based FSC, range ${p.min_res ?? 10}-${p.max_res ?? 1.5} Å` });
      lines.push({ at: 100, level: "success", text: `Local resolution map written (median 3.8 Å)` });
      break;
    case "multibody":
      lines.push({ at: 10, level: "info", text: `Multi-body, bodies=${p.n_bodies ?? 2}` });
      lines.push({ at: 100, level: "success", text: `Per-body maps + PCA of body motion written` });
      break;
    case "polish":
      lines.push({ at: 15, level: "info", text: `${p.do_optimize_params ? "Training params on subset..." : "Fixed params."}` });
      lines.push({ at: 70, level: "info", text: `Frame re-alignment in progress (min ${p.minres ?? 15} - max ${p.maxres ?? 5} Å)` });
      lines.push({ at: 100, level: "success", text: `Polished particles ready. Estimated gain ~0.3 Å.` });
      break;
    case "movierefine":
      lines.push({ at: 30, level: "info", text: `Per-frame refinement (box=${p.extract_size ?? 256})` });
      lines.push({ at: 100, level: "success", text: `Shiny particles written` });
      break;
    case "external":
      lines.push({ at: 30, level: "info", text: `Running: ${p.exe} ${p.args}` });
      lines.push({ at: 100, level: "success", text: `External command exited 0` });
      break;
    default:
      lines.push({ at: 100, level: "success", text: `Done.` });
  }
  return { lines };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Build a fresh pipeline context from a list of completed jobs
export function buildContext(jobs: JobState[]): PipelineContext {
  const ctx: PipelineContext = { ...initialCtx };
  for (const j of jobs) {
    if (j.status !== "done") continue;
    const o = j.outputSummary;
    if (j.taskType === "import") {
      ctx.nMovies = Number(o.n_movies ?? 0) || ctx.nMovies;
      ctx.pixelSize = Number(o.pixel_size ?? ctx.pixelSize);
    } else if (j.taskType === "autopick" || j.taskType === "manualpick") {
      ctx.nParticles = Number(o.n_particles ?? ctx.nParticles);
    } else if (j.taskType === "extract") {
      ctx.boxSize = Number(o.rescaled_box ?? o.box_size ?? ctx.boxSize);
      ctx.nParticles = Number(o.n_particles ?? ctx.nParticles);
    } else if (j.taskType === "select") {
      ctx.nParticles = Number(o.n_particles ?? ctx.nParticles);
    } else if (j.taskType === "refine3d") {
      ctx.bestRes = Number(o.resolution_A ?? ctx.bestRes);
      ctx.symmetry = String(o.symmetry ?? ctx.symmetry);
    }
  }
  return ctx;
}

// Compute the full log plan for a job (used when starting + advancing)
export function getLogPlan(
  taskType: string,
  params: Record<string, string | number | boolean>,
  ctx: PipelineContext,
): { at: number; level: LogLine["level"]; text: string }[] {
  const task = getTask(taskType);
  if (!task) return [];
  return buildLogPlan(task, params, ctx).lines;
}

// Compute final output summary
export function getOutput(
  taskType: string,
  params: Record<string, string | number | boolean>,
  ctx: PipelineContext,
): Record<string, number | string> {
  const task = getTask(taskType);
  if (!task) return {};
  return computeOutput(task, params, ctx);
}

export function taskDuration(taskType: string): number {
  const task = getTask(taskType);
  return task?.typicalDuration ?? 10;
}
