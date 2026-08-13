# CryoAgent — Autonomous Cryo-EM RELION Processing Agent

An autonomous AI agent that builds and executes full **RELION** cryo-EM
data-processing workflows from natural-language instructions. Inspired by the
[Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) framework and
built to drive the real [RELION](https://github.com/3dem/relion) binaries.

## What it does

You describe a cryo-EM dataset in plain English ("Process a 300kV dataset,
0.885 Å/px movies of apoferritin, target 2.5 Å, D4 symmetry"). CryoAgent:

1. **Plans** a RELION workflow (DAG of 13+ jobs) using an LLM, picking
   parameters (pixel size, box size, classes, symmetry, masks) autonomously.
2. **Executes** the workflow by shelling out to the real `relion_*` binaries
   (RELION 3.1.3 + ctffind 4.1.14), capturing real stdout/stderr, and writing
   real star files / MRC maps / FSC curves.
3. **Decides autonomously** at decision points (after 2D classification, after
   3D classification, after refinement) — the LLM picks which classes to keep,
   whether to polish, etc., and records every decision in an audit log.
4. **Visualizes** the results CryoSPARC-style: FSC curve, angular-distribution
   heatmap, 2D class-averages gallery, and a 3D map slice viewer.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (single page)                                       │
│  ┌──────────┬─────────────────┬───────────────────────────┐  │
│  │ projects │  chat with the  │  Workflow DAG  |  Job    │  │
│  │ +         │  CryoAgent LLM  │  inspector     |  Viz    │  │
│  │ decisions │  (plan/decide)  │  + logs        |  tab    │  │
│  └──────────┴─────────────────┴───────────────────────────┘  │
└───────────────────────┬─────────────────────────────────────┘
                        │ fetch
┌───────────────────────▼─────────────────────────────────────┐
│  Next.js 16 API routes (/api/agent/run, /api/analyze,        │
│  /api/slice, /api/files, /api/job-files, /api/jobs/retry)    │
│  + Prisma (SQLite) for projects / messages / jobs / logs     │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTP (localhost:3004)
┌───────────────────────▼─────────────────────────────────────┐
│  relion-runner mini-service (Python stdlib)                 │
│  shells out to real RELION 3.1.3 + ctffind 4.1.14 binaries  │
│  + CPU motioncorr/extract stand-ins                         │
└─────────────────────────────────────────────────────────────┘
```

## The 18 RELION tasks supported

`import`, `motioncorr`, `ctffind`, `manualpick`, `autopick`, `extract`,
`select`, `class2d`, `initialmodel`, `class3d`, `refine3d`, `maskcreate`,
`postprocess`, `localres`, `multibody`, `polish`, `movierefine`, `external`.

Each task is defined in `src/lib/relion/tasks.ts` with its parameters,
prerequisites, outputs, and decision hints — this is the agent's domain
knowledge base.

## Visualizations (CryoSPARC-style)

- **FSC curve** — Fourier-Shell Correlation vs resolution, with the 0.143
  cutoff line and the resolution at which the curve crosses it.
- **Angular-distribution heatmap** — Mollweide projection of every particle's
  (rot, tilt) Euler angles, binned and colored with a viridis ramp.
- **2D class-averages gallery** — every class average rendered as a
  viridis-colored thumbnail, with a per-class metrics table (distribution,
  estimated resolution, accuracy).
- **3D map slice viewer** — scrub through z-slices of any MRC map (mask,
  postprocess, refine3d) with a slider.

## Tech stack

- **Framework**: Next.js 16 (App Router) + TypeScript 5
- **Styling**: Tailwind CSS 4 + shadcn/ui (New York) + Lucide icons
- **Database**: Prisma ORM (SQLite)
- **Agent brain**: z-ai-web-dev-sdk LLM (planner + decider + summarizer)
- **Executor**: real RELION 3.1.3 + ctffind 4.1.14 (user-space install)
- **Visualization**: HTML canvas (FSC + heatmap), Python+mrcfile+Pillow (slices)

## Running locally

### 1. Install dependencies

```bash
bun install
```

### 2. Install RELION (user-space, no root)

The repo expects RELION 3.1.3 + ctffind 4.1.14 extracted to `relion-pkg/`.
On Debian/Ubuntu you can reproduce the install with:

```bash
apt-get download relion ctffind libopenmpi40 libpsm2-2 libfabric1 libucx0 \
  libevent-core-2.1-7t64 libevent-pthreads-2.1-7t64 libhwloc15 libpmix2t64 \
  librdmacm1t64 libibverbs1 ibverbs-providers libnl-3-200 libnl-route-3-200 \
  libmunge2 libwxbase3.2-1t64 libwxgtk3.2-1t64
for d in *.deb; do dpkg-deb -x "$d" relion-pkg/; done
```

Then `source relion-env.sh` to put the binaries on PATH.

### 3. Generate the test dataset

```bash
python3 data-gen/make_dataset.py --out_dir data/projects/test_d4
```

### 4. Start the relion-runner mini-service

```bash
source relion-env.sh
cd mini-services/relion-runner
python3 server.py   # listens on port 3004
```

### 5. Start the Next.js app

```bash
bun run dev   # listens on port 3000
```

Open http://localhost:3000, create a project, and tell the agent what to do.

## Project structure

```
prisma/schema.prisma                 — Project, Message, Workflow, Job, JobLog, Decision
src/lib/relion/tasks.ts              — RELION task registry (18 tasks)
src/lib/relion/executor.ts           — simulated executor (fallback)
src/lib/agent/engine.ts              — LLM planner + autonomous run loop + decider
src/lib/agent/prompts.ts             — system prompts
src/lib/runner-client.ts             — fetch client to relion-runner
src/app/api/*                        — API routes (analyze, slice, files, job-files, ...)
src/app/page.tsx                     — single-page 3-pane UI
src/components/cryo/                 — header, chat, workflow DAG, job inspector
src/components/cryo/viz/             — FSC curve, angular heatmap, class gallery, slice viewer
mini-services/relion-runner/         — Python HTTP service running real RELION binaries
data-gen/make_dataset.py             — synthetic cryo-EM dataset generator
```

## License

MIT
