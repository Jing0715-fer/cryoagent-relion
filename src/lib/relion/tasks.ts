// RELION task registry — comprehensive knowledge base of all RELION GUI tasks.
// Reference: RELION 3.1 / 4.0 (https://github.com/3dem/relion)
//
// Each task definition includes:
//   - key: canonical RELION task identifier
//   - name, category, stage, icon
//   - description: human-readable summary
//   - inputs: upstream job types this task depends on
//   - outputs: what this task produces (for downstream tasks / agent decisions)
//   - parameters: structured list of relion-style parameters with defaults
//   - decisionHints: when the agent should run this and what decisions it makes
//   - typicalDuration: simulated seconds for the executor
//
// Categories: prep | picking | classify | refine | analyze | utility

export type ParamType = "string" | "int" | "float" | "bool" | "select" | "path" | "range";

export interface TaskParam {
  key: string;
  label: string;
  type: ParamType;
  default: string | number | boolean;
  options?: string[];
  help: string;
  group?: string;
  advanced?: boolean;
}

export interface TaskOutput {
  key: string;
  label: string;
  kind: "movies" | "micrographs" | "particles" | "star" | "map" | "mask" | "halfmap" | "log" | "metadata";
  metrics?: string[];
}

export interface RelionTask {
  key: string;
  name: string;
  short: string;
  category: "prep" | "picking" | "classify" | "refine" | "analyze" | "utility";
  stage: number;
  icon: string;
  color: string;
  description: string;
  inputs: { types: string[]; label: string; optional?: boolean }[];
  outputs: TaskOutput[];
  parameters: TaskParam[];
  decisionHints: {
    when: string;
    decides: string;
  };
  typicalDuration: number;
  relionBinary: string;
  docUrl: string;
}

// ---------------------------------------------------------------------------
// All 18 RELION tasks
// ---------------------------------------------------------------------------
export const RELION_TASKS: RelionTask[] = [
  {
    key: "import",
    name: "Import",
    short: "Import",
    category: "prep",
    stage: 0,
    icon: "FolderInput",
    color: "text-sky-400",
    description:
      "Import movies, micrographs, particles or coordinates from disk into the RELION project. Creates the input star files that feed the downstream pipeline.",
    inputs: [],
    outputs: [
      { key: "movies", label: "Imported movies", kind: "movies", metrics: ["n_movies", "frame_count", "pixel_size"] },
    ],
    parameters: [
      { key: "do_movies", label: "Import movies?", type: "bool", default: true, group: "I/O", help: "Import movie stacks (.mrcs/.tiff) rather than single micrographs." },
      { key: "fn_in", label: "Input file pattern", type: "path", default: "Movies/*.tiff", group: "I/O", help: "Wildcard pattern or star file describing input images." },
      { key: "optics_group_name", label: "Optics group name", type: "string", default: "opticsGroup1", group: "I/O", help: "Name assigned to the optics group." },
      { key: "angpix", label: "Pixel size (Å)", type: "float", default: 0.885, group: "I/O", help: "Pixel size at the specimen level." },
      { key: "kV", label: "Voltage (kV)", type: "int", default: 300, group: "I/O", help: "Accelerating voltage." },
      { key: "Cs", label: "Cs (mm)", type: "float", default: 2.7, group: "I/O", help: "Spherical aberration of the microscope." },
      { key: "Q0", label: "Amplitude contrast", type: "float", default: 0.1, group: "I/O", help: "Fraction of amplitude contrast." },
      { key: "beamtilt_x", label: "Beam tilt X (mrad)", type: "float", default: 0, group: "I/O", advanced: true, help: "Beam tilt along x for aberration correction." },
      { key: "beamtilt_y", label: "Beam tilt Y (mrad)", type: "float", default: 0, group: "I/O", advanced: true, help: "Beam tilt along y." },
    ],
    decisionHints: {
      when: "Always the first task: needed before any processing when raw movies/micrographs are provided.",
      decides: "Optics group geometry (pixel size, voltage, Cs) — drives every downstream CTF and reconstruction step.",
    },
    typicalDuration: 8,
    relionBinary: "relion_import",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/Import.html",
  },
  {
    key: "motioncorr",
    name: "Motion Correction",
    short: "MotionCorr",
    category: "prep",
    stage: 1,
    icon: "Waves",
    color: "text-cyan-400",
    description:
      "Align movie frames to correct beam-induced and stage drift using MotionCor2. Produces dose-weighted, drift-corrected micrographs and per-particle trajectories.",
    inputs: [{ types: ["import"], label: "Movies" }],
    outputs: [
      { key: "corr_micrographs", label: "Corrected micrographs", kind: "micrographs", metrics: ["n_micrographs", "avg_drift"] },
      { key: "patches_log", label: "Patch-based trajectories", kind: "log" },
    ],
    parameters: [
      { key: "do_own_motioncor2", label: "Use internal motioncor2", type: "bool", default: true, group: "Motion", help: "Use RELION's built-in motioncor2." },
      { key: "bfactor", label: "B-factor", type: "int", default: 150, group: "Motion", help: "B-factor for MotionCor2 alignment." },
      { key: "patch_x", label: "Patches X", type: "int", default: 5, group: "Motion", help: "Number of patches along x." },
      { key: "patch_y", label: "Patches Y", type: "int", default: 5, group: "Motion", help: "Number of patches along y." },
      { key: "group_frames", label: "Group frames", type: "int", default: 1, group: "Motion", help: "Number of frames to group before alignment." },
      { key: "fn_motioncor2_exe", label: "MotionCor2 binary", type: "path", default: "", group: "Motion", advanced: true, help: "Optional external MotionCor2 executable." },
      { key: "dose_weighting", label: "Dose weighting", type: "bool", default: true, group: "Motion", help: "Apply dose weighting to frames." },
      { key: "dose_per_frame", label: "Dose per frame (e-/A2)", type: "float", default: 1.0, group: "Motion", help: "Dose per frame for weighting." },
      { key: "gpu_ids", label: "GPU ids", type: "string", default: "0", group: "Compute", help: "Comma-separated GPU ids." },
    ],
    decisionHints: {
      when: "Runs right after Import for all movie data. Mandatory for dose weighting and drift compensation.",
      decides: "Patch grid (5x5 default) and dose-per-frame based on the acquisition dose. Higher drift movies may need finer patches.",
    },
    typicalDuration: 45,
    relionBinary: "relion_motioncorr",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/Motioncorrection.html",
  },
  {
    key: "ctffind",
    name: "CTF Estimation",
    short: "CTFFind",
    category: "prep",
    stage: 2,
    icon: "Aperture",
    color: "text-emerald-400",
    description:
      "Estimate the Contrast Transfer Function (CTF) on corrected micrographs using CTFFIND or Gctf. Reports defocus, astigmatism, phase shift and fit quality per micrograph.",
    inputs: [{ types: ["motioncorr"], label: "Corrected micrographs" }],
    outputs: [
      { key: "ctf_star", label: "Micrograph CTF star", kind: "star", metrics: ["n_micrographs", "avg_defocus", "avg_resolution", "astigmatism"] },
    ],
    parameters: [
      { key: "do_ctffind_extra", label: "Use Gctf", type: "bool", default: false, group: "CTF", help: "Use Gctf instead of CTFFIND." },
      { key: "box_size", label: "CTF box size (px)", type: "int", default: 512, group: "CTF", help: "Box size for power spectrum estimation." },
      { key: "min_res", label: "Min resolution (Å)", type: "float", default: 30, group: "CTF", help: "Lowest resolution to fit." },
      { key: "max_res", label: "Max resolution (Å)", type: "float", default: 5, group: "CTF", help: "Highest resolution to fit." },
      { key: "min_defocus", label: "Min defocus (Å)", type: "float", default: 5000, group: "CTF", help: "Lower defocus search bound." },
      { key: "max_defocus", label: "Max defocus (Å)", type: "float", default: 50000, group: "CTF", help: "Upper defocus search bound." },
      { key: "dstep", label: "Step size defocus (Å)", type: "float", default: 500, group: "CTF", help: "Defocus search step." },
      { key: "do_phaseshift", label: "Estimate phase shift", type: "bool", default: false, group: "CTF", help: "Search phase shift (useful for phase plates)." },
      { key: "gpu_ids", label: "GPU ids", type: "string", default: "0", group: "Compute", help: "Comma-separated GPU ids (Gctf)." },
    ],
    decisionHints: {
      when: "Immediately after motion correction, before any particle picking.",
      decides: "Whether to estimate phase shift (phase-plate data), and which micrographs to discard based on max resolution fit (low-quality micrographs removed before picking).",
    },
    typicalDuration: 30,
    relionBinary: "relion_ctffind",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/Ctfestimation.html",
  },
  {
    key: "manualpick",
    name: "Manual Picking",
    short: "ManualPick",
    category: "picking",
    stage: 3,
    icon: "MousePointerClick",
    color: "text-amber-400",
    description:
      "Manually pick particles in the RELION GUI. Used to build a reference set for autopicking or to curate particle coordinates by eye.",
    inputs: [{ types: ["motioncorr"], label: "Corrected micrographs" }],
    outputs: [
      { key: "coords", label: "Particle coordinates", kind: "star", metrics: ["n_particles", "n_micrographs_picked"] },
    ],
    parameters: [
      { key: "diameter", label: "Particle diameter (Å)", type: "int", default: 160, group: "Picking", help: "Circle diameter drawn around particles." },
      { key: "black_point", label: "Black point", type: "float", default: 0, group: "Picking", advanced: true, help: "Display black point." },
      { key: "white_point", label: "White point", type: "float", default: 0, group: "Picking", advanced: true, help: "Display white point." },
      { key: "lowpass", label: "Lowpass filter (Å)", type: "float", default: 0, group: "Picking", advanced: true, help: "Lowpass filter for display." },
      { key: "do_lasso", label: "Lasso mode", type: "bool", default: false, group: "Picking", advanced: true, help: "Use lasso selection." },
    ],
    decisionHints: {
      when: "Used to bootstrap references for autopicking, or for small/low-contrast datasets where autopicking fails.",
      decides: "Particle diameter (drives autopick LoG diameter range and extraction box size).",
    },
    typicalDuration: 20,
    relionBinary: "relion_manualpick",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/Picking.html",
  },
  {
    key: "autopick",
    name: "Auto-Picking",
    short: "AutoPick",
    category: "picking",
    stage: 3,
    icon: "Target",
    color: "text-orange-400",
    description:
      "Automatically pick particles using Laplacian-of-Gaussian (LoG), references from 2D averages, or Topaz (deep learning). Generates particle coordinates across all micrographs.",
    inputs: [
      { types: ["motioncorr"], label: "Corrected micrographs" },
      { types: ["class2d"], label: "2D references", optional: true },
    ],
    outputs: [
      { key: "coords", label: "Particle coordinates", kind: "star", metrics: ["n_particles", "n_micrographs", "pick_density"] },
    ],
    parameters: [
      { key: "do_LoG", label: "Laplacian of Gaussian", type: "bool", default: true, group: "Picking", help: "Reference-free LoG picker." },
      { key: "do_topaz", label: "Use Topaz", type: "bool", default: false, group: "Picking", help: "Use Topaz deep-learning picker." },
      { key: "diameter_min", label: "LoG min diameter (Å)", type: "int", default: 140, group: "Picking", help: "Minimum diameter for LoG." },
      { key: "diameter_max", label: "LoG max diameter (Å)", type: "int", default: 180, group: "Picking", help: "Maximum diameter for LoG." },
      { key: "threshold", label: "Picking threshold", type: "float", default: 0.4, group: "Picking", help: "Particle score threshold." },
      { key: "min_distance", label: "Min inter-particle dist (Å)", type: "int", default: 0, group: "Picking", help: "Minimum distance between picks (0 = diameter)." },
      { key: "shrink", label: "Shrink factor", type: "float", default: 1, group: "Picking", advanced: true, help: "Downscale micrographs before picking." },
      { key: "gpu_ids", label: "GPU ids", type: "string", default: "0", group: "Compute", help: "GPUs for Topaz/references." },
    ],
    decisionHints: {
      when: "After CTF estimation; default picker when no references exist. Reference-based picking used once good 2D classes are available.",
      decides: "Picker type (LoG/Topaz/reference), threshold, diameter range — tuning threshold trades recall vs precision. Low precision → re-run with higher threshold.",
    },
    typicalDuration: 40,
    relionBinary: "relion_autopick",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/Autopicking.html",
  },
  {
    key: "extract",
    name: "Extract Particles",
    short: "Extract",
    category: "picking",
    stage: 4,
    icon: "ScanSearch",
    color: "text-lime-400",
    description:
      "Extract particle boxes from motion-corrected micrographs at the picked coordinates. Optionally re-scales the box and phase-flips based on the CTF.",
    inputs: [
      { types: ["autopick", "manualpick"], label: "Coordinates" },
      { types: ["motioncorr"], label: "Micrographs" },
      { types: ["ctffind"], label: "CTF star", optional: true },
    ],
    outputs: [
      { key: "particles", label: "Extracted particles", kind: "particles", metrics: ["n_particles", "box_size", "pixel_size"] },
    ],
    parameters: [
      { key: "extract_size", label: "Extract box size (px)", type: "int", default: 256, group: "Extract", help: "Box size for extraction." },
      { key: "do_rescale", label: "Rescale particles", type: "bool", default: true, group: "Extract", help: "Rescale to a smaller box size." },
      { key: "rescale", label: "Rescale size (px)", type: "int", default: 128, group: "Extract", help: "Final box size after rescaling." },
      { key: "do_invert", label: "Invert contrast", type: "bool", default: true, group: "Extract", help: "Flip contrast so protein is white." },
      { key: "do_phase_flip", label: "Phase flip", type: "bool", default: false, group: "Extract", help: "Apply CTF phase flipping (legacy)." },
      { key: "set_dose_weighting", label: "Use dose-weighted", type: "bool", default: true, group: "Extract", help: "Read dose-weighted micrographs." },
      { key: "recenter_x", label: "Recenter X (px)", type: "int", default: 0, group: "Extract", help: "Shift box center along x." },
      { key: "recenter_y", label: "Recenter Y (px)", type: "int", default: 0, group: "Extract", help: "Shift box center along y." },
    ],
    decisionHints: {
      when: "After autopicking/manual picking. Must run before any 2D/3D classification.",
      decides: "Box size (driven by particle diameter and target resolution) and rescale size for compute efficiency.",
    },
    typicalDuration: 18,
    relionBinary: "relion_extract",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/Extraction.html",
  },
  {
    key: "select",
    name: "Particle Selection",
    short: "Select",
    category: "picking",
    stage: 4,
    icon: "Filter",
    color: "text-teal-400",
    description:
      "Filter particles based on statistics (autocorrelation, mean, sigma) or remove duplicates. Cleans up the particle set before classification.",
    inputs: [{ types: ["extract"], label: "Particles" }],
    outputs: [
      { key: "particles", label: "Selected particles", kind: "particles", metrics: ["n_particles", "n_removed"] },
    ],
    parameters: [
      { key: "do_select_on_stats", label: "Select on statistics", type: "bool", default: true, group: "Extract", help: "Filter by image statistics." },
      { key: "select_min_autoperc", label: "Min auto-pick percentile", type: "float", default: 0, group: "Extract", help: "Lowest percentile of autopick score to keep." },
      { key: "select_max_sigma", label: "Max sigma", type: "float", default: 3, group: "Extract", help: "Discard particles above this sigma." },
      { key: "do_remove_duplicates", label: "Remove duplicates", type: "bool", default: true, group: "Extract", help: "Remove particles closer than the minimum distance." },
      { key: "min_distance", label: "Min distance (Å)", type: "int", default: 100, group: "Extract", help: "Minimum allowed inter-particle distance." },
    ],
    decisionHints: {
      when: "After extraction and optionally after each classification to discard junk classes.",
      decides: "Sigma thresholds and duplicate removal distance — informed by visual inspection of 2D class averages.",
    },
    typicalDuration: 6,
    relionBinary: "relion_select",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/Select.html",
  },
  {
    key: "class2d",
    name: "2D Classification",
    short: "Class2D",
    category: "classify",
    stage: 5,
    icon: "Layers",
    color: "text-violet-400",
    description:
      "Run multi-reference 2D classification to sort particles into class averages. Used for cleaning and to generate references for autopicking and 3D classification.",
    inputs: [{ types: ["extract", "select"], label: "Particles" }],
    outputs: [
      { key: "class_averages", label: "2D class averages", kind: "star", metrics: ["n_classes", "best_class_resolution", "particles_in_good_classes"] },
      { key: "class_assignments", label: "Particle to class map", kind: "star" },
    ],
    parameters: [
      { key: "nr_classes", label: "Number of classes", type: "int", default: 50, group: "Classify", help: "Number of 2D references." },
      { key: "tau_fudge", label: "Regularization T", type: "float", default: 2, group: "Classify", help: "T regularization factor." },
      { key: "do_fast_subsets", label: "Fast subsets", type: "bool", default: false, group: "Classify", help: "Split into subsets for speed." },
      { key: "iter_nr_iter", label: "Iterations", type: "int", default: 25, group: "Optimisation", help: "Number of EM iterations." },
      { key: "particle_diameter", label: "Mask diameter (Å)", type: "int", default: 160, group: "Classify", help: "Circular mask diameter." },
      { key: "do_center", label: "Center classes", type: "bool", default: true, group: "Optimisation", help: "Re-center class averages." },
      { key: "do_ctf_correction", label: "CTF correction", type: "bool", default: true, group: "Classify", help: "Apply CTF during classification." },
      { key: "do_ignore_curls", label: "Skip curling", type: "bool", default: true, group: "Optimisation", advanced: true, help: "Skip high-curvature particles." },
      { key: "gpu_ids", label: "GPU ids", type: "string", default: "0", group: "Compute", help: "GPUs to use." },
      { key: "nr_pool", label: "Pool size", type: "int", default: 3, group: "Compute", advanced: true, help: "Number of pooled particles per thread." },
    ],
    decisionHints: {
      when: "After extraction; central quality-gate task. Also re-run after selecting good classes to regenerate references.",
      decides: "Which classes to keep (good averages vs junk). The agent selects classes with clear secondary structure and high particle count, dropping edge/junk classes before 3D processing.",
    },
    typicalDuration: 60,
    relionBinary: "relion_refine",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/2Dclassification.html",
  },
  {
    key: "initialmodel",
    name: "3D Initial Model",
    short: "InitModel",
    category: "classify",
    stage: 6,
    icon: "Box",
    color: "text-fuchsia-400",
    description:
      "Generate a de-novo 3D initial model from 2D class averages using SGD-based stochastic gradient descent. Produces a starting reference for 3D classification.",
    inputs: [{ types: ["class2d"], label: "Particles (selected 2D classes)" }],
    outputs: [
      { key: "init_map", label: "Initial 3D model", kind: "map", metrics: ["resolution_estimate", "symmetry"] },
    ],
    parameters: [
      { key: "nr_classes", label: "Number of models", type: "int", default: 3, group: "Classify", help: "Independent SGD models (pick best)." },
      { key: "symmetry", label: "Symmetry", type: "string", default: "C1", group: "Classify", help: "Point group symmetry." },
      { key: "particle_diameter", label: "Mask diameter (Å)", type: "int", default: 160, group: "Classify", help: "Spherical mask diameter." },
      { key: "do_flipping", label: "Random phase flipping", type: "bool", default: true, group: "Optimisation", help: "Random phase flipping to reduce model bias." },
      { key: "sgd_iter", label: "SGD iterations", type: "int", default: 50, group: "Optimisation", help: "Number of SGD iterations." },
      { key: "sgd_resol", label: "SGD resolution (Å)", type: "float", default: 15, group: "Sampling", help: "High-res limit during SGD." },
      { key: "gpu_ids", label: "GPU ids", type: "string", default: "0", group: "Compute", help: "GPUs to use." },
    ],
    decisionHints: {
      when: "When no trusted reference exists — required before 3D classification / refinement.",
      decides: "Symmetry (C1 unless known), number of independent models, and which of the N models looks most consistent.",
    },
    typicalDuration: 50,
    relionBinary: "relion_refine",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/Initialmodel.html",
  },
  {
    key: "class3d",
    name: "3D Classification",
    short: "Class3D",
    category: "classify",
    stage: 6,
    icon: "Boxes",
    color: "text-purple-400",
    description:
      "Sort particles into 3D conformational/structural classes using multi-reference refinement. Identifies the dominant state(s) and removes heterogeneous / junk particles.",
    inputs: [
      { types: ["initialmodel", "class2d"], label: "Reference" },
      { types: ["class2d"], label: "Particles" },
    ],
    outputs: [
      { key: "classes", label: "3D class volumes", kind: "map", metrics: ["n_classes", "best_class_resolution", "particles_per_class"] },
      { key: "assignments", label: "Particle to class map", kind: "star" },
    ],
    parameters: [
      { key: "nr_classes", label: "Number of classes", type: "int", default: 4, group: "Classify", help: "Number of 3D classes." },
      { key: "tau_fudge", label: "Regularization T", type: "float", default: 4, group: "Classify", help: "T regularization (higher = sharper)." },
      { key: "symmetry", label: "Symmetry", type: "string", default: "C1", group: "Classify", help: "Point group symmetry." },
      { key: "particle_diameter", label: "Mask diameter (Å)", type: "int", default: 160, group: "Classify", help: "Spherical mask diameter." },
      { key: "do_ctf_correction", label: "CTF correction", type: "bool", default: true, group: "Classify", help: "CTF correction in refinement." },
      { key: "iter_nr_iter", label: "Iterations", type: "int", default: 25, group: "Optimisation", help: "EM iterations." },
      { key: "highres_limit", label: "High-res limit (Å)", type: "float", default: 8, group: "Sampling", help: "Limit frequencies to avoid overfitting." },
      { key: "gpu_ids", label: "GPU ids", type: "string", default: "0", group: "Compute", help: "GPUs to use." },
    ],
    decisionHints: {
      when: "After initial model — separates conformations / states. Run again on a chosen class if heterogeneity persists.",
      decides: "Which class to take into refinement (best-resolved, most-populated, biologically correct). Re-runs with different class counts if no clean separation.",
    },
    typicalDuration: 70,
    relionBinary: "relion_refine",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/3Dclassification.html",
  },
  {
    key: "refine3d",
    name: "3D Auto-Refine",
    short: "Refine3D",
    category: "refine",
    stage: 7,
    icon: "Focus",
    color: "text-rose-400",
    description:
      "Automated gold-standard 3D refinement. Iteratively refines orientations, translations and the density map until convergence, reaching the Nyquist-limited resolution.",
    inputs: [
      { types: ["initialmodel", "class3d"], label: "Reference" },
      { types: ["class2d", "select"], label: "Particles" },
    ],
    outputs: [
      { key: "halfmap", label: "Refined half-maps", kind: "halfmap", metrics: ["resolution", "map_size"] },
      { key: "map", label: "Refined density map", kind: "map", metrics: ["resolution"] },
      { key: "particles", label: "Refined particles", kind: "particles", metrics: ["n_particles", "orientations"] },
    ],
    parameters: [
      { key: "symmetry", label: "Symmetry", type: "string", default: "C1", group: "Refine", help: "Symmetry to impose." },
      { key: "particle_diameter", label: "Mask diameter (Å)", type: "int", default: 160, group: "Refine", help: "Spherical mask." },
      { key: "do_ctf_correction", label: "CTF correction", type: "bool", default: true, group: "Refine", help: "Full CTF correction." },
      { key: "do_ctf_intact_firstpeak", label: "Intact first peak", type: "bool", default: false, group: "Refine", advanced: true, help: "Keep first CTF peak intact." },
      { key: "highres_limit", label: "High-res limit (Å)", type: "float", default: 0, group: "Sampling", help: "Cap on high frequencies (0 = Nyquist)." },
      { key: "ini_highres", label: "Initial low-pass (Å)", type: "float", default: 30, group: "Sampling", help: "Low-pass filter on reference." },
      { key: "flatten_solvent", label: "Flatten solvent", type: "bool", default: true, group: "Refine", help: "Flatten solvent region." },
      { key: "do_zero_mask", label: "Zero-mask", type: "bool", default: true, group: "Refine", help: "Mask outside the sphere with zeros." },
      { key: "gpu_ids", label: "GPU ids", type: "string", default: "0", group: "Compute", help: "GPUs to use." },
    ],
    decisionHints: {
      when: "Once a homogeneous 3D class is chosen — the core refinement step. Re-run with focus masks for local refinement.",
      decides: "Symmetry, initial low-pass, and whether to apply focus masks for sub-region refinement.",
    },
    typicalDuration: 90,
    relionBinary: "relion_refine",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/3Dautorefine.html",
  },
  {
    key: "maskcreate",
    name: "Mask Creation",
    short: "MaskCreate",
    category: "utility",
    stage: 7,
    icon: "Hexagon",
    color: "text-stone-400",
    description:
      "Create a soft-edged 3D mask around the refined density. Used for post-processing, focused refinement and local-resolution estimation.",
    inputs: [{ types: ["refine3d", "class3d", "initialmodel"], label: "Map to mask" }],
    outputs: [
      { key: "mask", label: "Soft mask", kind: "mask", metrics: ["mask_volume", "soft_edge"] },
    ],
    parameters: [
      { key: "do_threshold", label: "Density threshold", type: "bool", default: true, group: "Mask", help: "Threshold the map to make a mask." },
      { key: "ini_threshold", label: "Threshold level", type: "float", default: 0.02, group: "Mask", help: "Initial threshold value." },
      { key: "extend_mask", label: "Extend by (px)", type: "int", default: 3, group: "Mask", help: "Grow the mask by N voxels." },
      { key: "soft_edge", label: "Soft edge (px)", type: "int", default: 3, group: "Mask", help: "Cosine soft-edge width." },
      { key: "lowpass_filter", label: "Lowpass (Å)", type: "float", default: 10, group: "Mask", help: "Lowpass the mask before thresholding." },
    ],
    decisionHints: {
      when: "After refine3d / class3d — masks are needed for postprocess, localres and focus refinement.",
      decides: "Threshold level (drives mask tightness), extension, soft edge. The agent aims for a tight mask excluding solvent without cutting the density.",
    },
    typicalDuration: 8,
    relionBinary: "relion_maskcreate",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/Maskcreation.html",
  },
  {
    key: "postprocess",
    name: "Post-Processing",
    short: "PostProcess",
    category: "analyze",
    stage: 8,
    icon: "Sparkles",
    color: "text-yellow-400",
    description:
      "Sharpen the refined map, apply the mask, estimate B-factor and compute the gold-standard FSC resolution. Produces the final deposited density map.",
    inputs: [
      { types: ["refine3d"], label: "Half-maps" },
      { types: ["maskcreate"], label: "Mask" },
    ],
    outputs: [
      { key: "post_map", label: "Sharpened map", kind: "map", metrics: ["resolution", "b_factor", "map_size"] },
    ],
    parameters: [
      { key: "fn_mask", label: "Mask", type: "path", default: "", group: "Postprocess", help: "Input mask star/map." },
      { key: "do_auto_b", label: "Estimate B-factor", type: "bool", default: true, group: "Postprocess", help: "Rosenthal-Henderson auto-B." },
      { key: "do_auto_mask", label: "Auto-loose mask", type: "bool", default: true, group: "Postprocess", help: "Loosen mask automatically if too tight." },
      { key: "fn_mtf", label: "MTF file", type: "path", default: "", group: "Postprocess", help: "Detector MTF file (optional)." },
      { key: "angpix", label: "Pixel size (Å)", type: "float", default: 1.0, group: "Postprocess", help: "Pixel size of the map." },
    ],
    decisionHints: {
      when: "Final step of every refinement — gives the reported resolution and the sharpened map. Re-run after each refine3d improvement.",
      decides: "Mask tightness, MTF application, and B-factor sharpening. The agent reports the global resolution in Å.",
    },
    typicalDuration: 10,
    relionBinary: "relion_postprocess",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/Post-processing.html",
  },
  {
    key: "localres",
    name: "Local Resolution",
    short: "LocalRes",
    category: "analyze",
    stage: 8,
    icon: "Grid3x3",
    color: "text-indigo-300",
    description:
      "Estimate local resolution using the ResMap or relion's own block-based FSC. Produces a resolution map highlighting flexible / well-ordered regions.",
    inputs: [
      { types: ["refine3d"], label: "Half-maps" },
      { types: ["maskcreate"], label: "Mask (optional)", optional: true },
    ],
    outputs: [
      { key: "locres_map", label: "Local-resolution map", kind: "map", metrics: ["min_res", "max_res", "median_res"] },
    ],
    parameters: [
      { key: "do_resmap", label: "Use ResMap", type: "bool", default: false, group: "Compute", help: "Use external ResMap." },
      { key: "resmap_resstep", label: "ResMap step (Å)", type: "float", default: 1, group: "Sampling", help: "Resolution step size." },
      { key: "angpix", label: "Pixel size (Å)", type: "float", default: 1.0, group: "Postprocess", help: "Pixel size." },
      { key: "min_res", label: "Min resolution (Å)", type: "float", default: 10, group: "Sampling", help: "Lowest resolution to evaluate." },
      { key: "max_res", label: "Max resolution (Å)", type: "float", default: 1.5, group: "Sampling", help: "Highest resolution to evaluate." },
    ],
    decisionHints: {
      when: "After a successful postprocess — to assess map heterogeneity before deposition or focused refinement.",
      decides: "Resolution range and step; the agent interprets the local-resolution spread to recommend focused refinement or multi-body.",
    },
    typicalDuration: 35,
    relionBinary: "relion_locres",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/Localres.html",
  },
  {
    key: "multibody",
    name: "Multi-Body Refinement",
    short: "MultiBody",
    category: "refine",
    stage: 9,
    icon: "Boxes",
    color: "text-pink-400",
    description:
      "Refine independent rigid bodies within the complex simultaneously. Useful for flexible multi-domain complexes; produces separate maps per body and PCA of body motion.",
    inputs: [
      { types: ["refine3d"], label: "Refined particles & map" },
      { types: ["maskcreate"], label: "Body masks" },
    ],
    outputs: [
      { key: "body_maps", label: "Per-body maps", kind: "map", metrics: ["n_bodies", "body_resolutions"] },
      { key: "pca", label: "Body-motion PCA", kind: "star" },
    ],
    parameters: [
      { key: "n_bodies", label: "Number of bodies", type: "int", default: 2, group: "Refine", help: "Number of rigid bodies." },
      { key: "do_sgd", label: "Use SGD", type: "bool", default: false, group: "Refine", advanced: true, help: "SGD in multi-body." },
      { key: "max_cc", label: "Max cross-correlation", type: "float", default: 1.0, group: "Optimisation", advanced: true, help: "Cross-correlation limit." },
      { key: "gpu_ids", label: "GPU ids", type: "string", default: "0", group: "Compute", help: "GPUs to use." },
    ],
    decisionHints: {
      when: "When local resolution analysis reveals rigid domains with flexible linkers — separates them for better resolution.",
      decides: "Number of bodies and their masks — the agent proposes bodies based on the structure's domain decomposition.",
    },
    typicalDuration: 60,
    relionBinary: "relion_refine",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/Multi-body.html",
  },
  {
    key: "polish",
    name: "Bayesian Polishing",
    short: "Polish",
    category: "refine",
    stage: 7,
    icon: "Gem",
    color: "text-amber-300",
    description:
      "Re-align per-particle movie frames using Bayesian statistics. Produces a polished particle set that often improves resolution by 0.2-0.5 Å.",
    inputs: [
      { types: ["refine3d"], label: "Refined particles" },
      { types: ["motioncorr"], label: "Movies & optics" },
    ],
    outputs: [
      { key: "particles", label: "Polished particles", kind: "particles", metrics: ["n_particles", "resolution_gain"] },
    ],
    parameters: [
      { key: "do_optimize_params", label: "Optimize params", type: "bool", default: true, group: "Polish", help: "Train sigma values on a subset." },
      { key: "opt_perframe", label: "Per-frame weights", type: "bool", default: true, group: "Polish", help: "Optimize per-frame dose weight." },
      { key: "minres", label: "Min resolution (Å)", type: "float", default: 15, group: "Sampling", help: "Lowest resolution used." },
      { key: "maxres", label: "Max resolution (Å)", type: "float", default: 5, group: "Sampling", help: "Highest resolution used." },
      { key: "gpu_ids", label: "GPU ids", type: "string", default: "0", group: "Compute", help: "GPUs to use." },
    ],
    decisionHints: {
      when: "After a first refine3d (>=4 Å). Requires the original movies. Re-run refine3d + postprocess on polished particles.",
      decides: "Whether to optimize parameters first (recommended), resolution range, then re-refine.",
    },
    typicalDuration: 55,
    relionBinary: "relion_motionrefine",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/Bayesianpolishing.html",
  },
  {
    key: "movierefine",
    name: "Movie Refinement",
    short: "MovieRefine",
    category: "refine",
    stage: 7,
    icon: "Film",
    color: "text-cyan-300",
    description:
      "Per-frame alignment of particles within movies (older Bayesian movie-refinement step). Largely superseded by Bayesian polishing; still used for specific cases.",
    inputs: [
      { types: ["refine3d"], label: "Refined particles" },
      { types: ["motioncorr"], label: "Movies" },
    ],
    outputs: [
      { key: "shiny_particles", label: "Shiny particles", kind: "particles", metrics: ["n_particles", "resolution_gain"] },
    ],
    parameters: [
      { key: "extract_size", label: "Movie box (px)", type: "int", default: 256, group: "Polish", help: "Box size for movie extraction." },
      { key: "minres", label: "Min resolution (Å)", type: "float", default: 15, group: "Sampling", help: "Lowest resolution used." },
      { key: "maxres", label: "Max resolution (Å)", type: "float", default: 5, group: "Sampling", help: "Highest resolution used." },
      { key: "run_in_parallel", label: "Run in parallel", type: "bool", default: true, group: "Compute", help: "Run frame alignment in parallel." },
      { key: "gpu_ids", label: "GPU ids", type: "string", default: "0", group: "Compute", help: "GPUs to use." },
    ],
    decisionHints: {
      when: "Rare; preferred over polish only when full-frame dose weighting is unavailable. The agent prefers Bayesian polishing.",
      decides: "Resolution range and box size; the agent generally defers to Bayesian polishing unless requested.",
    },
    typicalDuration: 45,
    relionBinary: "relion_movierefine",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/Movierefine.html",
  },
  {
    key: "external",
    name: "External",
    short: "External",
    category: "utility",
    stage: 99,
    icon: "Terminal",
    color: "text-slate-400",
    description:
      "Run an arbitrary external command on the project star files (e.g. integrate Topaz, CryoSPARC export, or custom scripts).",
    inputs: [{ types: ["import", "motioncorr", "ctffind", "autopick", "extract", "select", "class2d", "class3d", "refine3d", "maskcreate", "postprocess", "localres", "multibody", "polish", "movierefine"], label: "Any job", optional: true }],
    outputs: [
      { key: "output", label: "External output", kind: "log", metrics: ["exit_code", "n_lines"] },
    ],
    parameters: [
      { key: "exe", label: "Command", type: "string", default: "echo", group: "Compute", help: "External command to run." },
      { key: "args", label: "Arguments", type: "string", default: "", group: "Compute", help: "Arguments passed to the command." },
      { key: "do_instar", label: "Pass input star", type: "bool", default: true, group: "Compute", help: "Pass the input star file as last arg." },
    ],
    decisionHints: {
      when: "When the agent needs a tool outside RELION (e.g. ChimeraX scripting, Topaz training, CryoSPARC import).",
      decides: "Command and arguments; the agent scripts the invocation and parses the output.",
    },
    typicalDuration: 5,
    relionBinary: "relion_external",
    docUrl: "https://relion.readthedocs.io/en/release-3.1/SPA_tutorial/External.html",
  },
];

export const RELION_TASK_MAP: Record<string, RelionTask> = Object.fromEntries(
  RELION_TASKS.map((t) => [t.key, t]),
);

export function getTask(key: string): RelionTask | undefined {
  return RELION_TASK_MAP[key];
}

// Canonical single-particle analysis pipeline (the default the agent proposes)
export const CANONICAL_PIPELINE: { task: string; dependsOn: string[] }[] = [
  { task: "import", dependsOn: [] },
  { task: "motioncorr", dependsOn: ["import"] },
  { task: "ctffind", dependsOn: ["motioncorr"] },
  { task: "autopick", dependsOn: ["motioncorr", "ctffind"] },
  { task: "extract", dependsOn: ["autopick", "motioncorr", "ctffind"] },
  { task: "select", dependsOn: ["extract"] },
  { task: "class2d", dependsOn: ["select"] },
  { task: "initialmodel", dependsOn: ["class2d"] },
  { task: "class3d", dependsOn: ["initialmodel", "class2d"] },
  { task: "refine3d", dependsOn: ["class3d"] },
  { task: "maskcreate", dependsOn: ["refine3d"] },
  { task: "postprocess", dependsOn: ["refine3d", "maskcreate"] },
  { task: "localres", dependsOn: ["refine3d", "maskcreate"] },
  { task: "polish", dependsOn: ["refine3d", "motioncorr"] },
  { task: "multibody", dependsOn: ["refine3d", "maskcreate"] },
];
