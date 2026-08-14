// Create a fresh bin4 EMPIAR test project with VLM verification enabled,
// and run the full pipeline through the engine tick loop.
// Usage: bunx tsx scripts/run-verifier-test.ts
import { db } from "../src/lib/db";

const PROJECT_NAME = "EMPIAR-10017 bin4 VLM verify";
const SRC = "/home/z/my-project/data/projects/empiar10017_bin4";
const USER_GOAL = `Run the full RELION pipeline on bin4 EMPIAR-10017 (β-galactosidase, 1024×1024 @ 7.08 Å/px). Steps: import → ctffind → autopick → extract → class2d. Use known particle coords for autopick. For class2d use 10 classes, 5 iterations. After each task, the agent verifies result quality via vision LLM and retries with adjusted params if needed.`;

async function main() {
  const project = await db.project.create({
    data: {
      name: PROJECT_NAME,
      description: "bin4 EMPIAR-10017 with VLM-based quality verification + retry loop",
      datasetMeta: JSON.stringify({
        angpix: 7.08,
        kV: 300,
        Cs: 2.7,
        Q0: 0.1,
        particle_diameter: 130,
        symmetry: "C1",
        bin_factor: 1,
      }),
      sourceDataset: SRC,
      executorMode: "real",
      status: "idle",
    },
  });
  console.log("project:", project.id);

  await db.message.create({
    data: {
      projectId: project.id,
      role: "assistant",
      content: `👋 Hi! I'm **CryoAgent** with VLM-powered quality verification.

This project runs the bin4 EMPIAR-10017 dataset. After each task completes, I'll use a vision LLM to inspect the results and judge quality. If results are poor, I'll automatically adjust parameters and retry.`,
    },
  });

  await db.message.create({
    data: { projectId: project.id, role: "user", content: USER_GOAL },
  });

  console.log("triggering chatReply...");
  const { chatReply } = await import("../src/lib/agent/engine");
  const result = await chatReply(project.id, USER_GOAL);
  console.log("chatReply:", JSON.stringify(result, null, 2));

  const { runTick } = await import("../src/lib/agent/engine");
  let tick = await runTick(project.id);
  console.log("tick 1:", JSON.stringify({ status: tick?.workflowStatus, advanced: tick?.advanced, finished: tick?.finishedNow?.length }));
  let safety = 0;
  while (tick && tick.workflowStatus === "running" && safety < 120) {
    await new Promise((r) => setTimeout(r, 8000));
    tick = await runTick(project.id);
    safety++;
    console.log(`tick ${safety + 1}: status=${tick?.workflowStatus}, advanced=${tick?.advanced}, finishedNow=${tick?.finishedNow?.length}, decisions=${tick?.decisionsMade?.length}`);
  }
  console.log("FINAL:", JSON.stringify(tick, null, 2));
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
