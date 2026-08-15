// Test the VLM verifier on an existing project's jobs.
// Usage: bunx tsx scripts/test-verifier.ts <projectId> [taskType]
import { db } from "../src/lib/db";
import { verifyJobQuality } from "../src/lib/agent/verifier";

async function main() {
  const projectId = process.argv[2];
  const taskFilter = process.argv[3];
  if (!projectId) {
    console.error("usage: test-verifier.ts <projectId> [taskType]");
    process.exit(1);
  }
  const where: any = { workflow: { projectId }, status: "done" };
  if (taskFilter) where.taskType = taskFilter;
  const jobs = await db.job.findMany({
    where,
    select: { id: true, taskType: true, alias: true, parameters: true, primaryOutput: true, outputFiles: true },
    orderBy: { createdAt: "asc" },
  });
  const verifiable = ["autopick", "extract", "class2d", "class3d", "refine3d", "initialmodel", "ctffind"];
  const targets = jobs.filter((j) => verifiable.includes(j.taskType));
  console.log(`found ${targets.length} verifiable jobs (of ${jobs.length} total done)`);
  for (const j of targets) {
    console.log(`\n=== ${j.taskType} (${j.alias}) ===`);
    console.log("params:", j.parameters.slice(0, 200));
    const t0 = Date.now();
    try {
      const result = await verifyJobQuality(projectId, {
        id: j.id,
        taskType: j.taskType,
        parameters: j.parameters,
        primaryOutput: j.primaryOutput,
        outputFiles: j.outputFiles,
        alias: j.alias,
      });
      console.log(`VLM result (${Date.now() - t0}ms):`);
      console.log("  passed:", result.passed, "score:", result.score);
      console.log("  reasoning:", result.reasoning);
      console.log("  issues:", result.issues);
      console.log("  suggestedParams:", result.suggestedParams);
    } catch (e: any) {
      console.error("  ERROR:", e?.message || e);
    }
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
