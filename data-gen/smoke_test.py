#!/usr/bin/env python3
"""Smoke-test the relion-runner service end-to-end with the synthetic dataset."""
import json, urllib.request, sys, os, time

URL = "http://localhost:3004/run"

def run(job):
    data = json.dumps(job).encode()
    req = urllib.request.Request(URL, data=data, headers={"Content-Type": "application/json"})
    t0 = time.time()
    try:
        resp = urllib.request.urlopen(req, timeout=300)
        body = json.loads(resp.read())
    except Exception as e:
        print(f"  FAILED ({time.time()-t0:.1f}s): {e}")
        return None
    dt = time.time() - t0
    print(f"  {job['taskType']} {job['jobId']} done in {dt:.1f}s ok={body.get('ok')}")
    for l in body.get("logs", [])[-6:]:
        print(f"    [{l['level']}] {l['line']}")
    print(f"    summary: {body.get('summary')}")
    print(f"    primaryOutput: {body.get('primaryOutput')}")
    print(f"    outputs: {len(body.get('outputs', []))} files")
    return body

SRC = "/home/z/my-project/data/projects/test_d4"

print("=== 1. Import ===")
r1 = run({"projectId":"smoke","jobId":"import01","taskType":"import",
          "parameters":{"angpix":4.0,"kV":300,"Cs":2.7,"Q0":0.1},
          "sourceDataset": SRC, "inputs": {}})
import_star = f"/home/z/my-project/data/projects/smoke/relion_run/import01/movies.star"

print("\n=== 2. Motion Correction (CPU) ===")
r2 = run({"projectId":"smoke","jobId":"motioncorr01","taskType":"motioncorr",
          "parameters":{"angpix":4.0,"dose_per_frame":1.0,"dose_weighting":True},
          "inputs":{"import_star": import_star}})

print("\n=== 3. CTF Estimation (real ctffind 4.1.14) ===")
mc_star = f"/home/z/my-project/data/projects/smoke/relion_run/motioncorr01/corrected_micrographs.star"
r3 = run({"projectId":"smoke","jobId":"ctffind01","taskType":"ctffind",
          "parameters":{"angpix":4.0,"kV":300,"Cs":2.7,"Q0":0.1,"box_size":256,
                        "min_res":50,"max_res":8,"min_defocus":5000,"max_defocus":50000,"dstep":500},
          "inputs":{"motioncorr_star": mc_star}})

print("\n=== 4. AutoPick (coords from particles.star) ===")
ctf_star = f"/home/z/my-project/data/projects/smoke/relion_run/ctffind01/CtfFind/micrographs_ctf.star"
r4 = run({"projectId":"smoke","jobId":"autopick01","taskType":"autopick",
          "parameters":{"diameter":150},
          "inputs":{"motioncorr_star": mc_star, "ctf_star": ctf_star}})

print("\n=== 5. Extract (CPU) ===")
ap_star = f"/home/z/my-project/data/projects/smoke/relion_run/autopick01/autopick.star"
r5 = run({"projectId":"smoke","jobId":"extract01","taskType":"extract",
          "parameters":{"extract_size":64,"do_rescale":True,"rescale":64,"angpix":4.0},
          "inputs":{"autopick_star": ap_star, "motioncorr_star": mc_star}})

print("\n=== 6. Class2D (real relion_refine, 3 iterations) ===")
ex_star = f"/home/z/my-project/data/projects/smoke/relion_run/extract01/particles.star"
r6 = run({"projectId":"smoke","jobId":"class2d01","taskType":"class2d",
          "parameters":{"nr_classes":5,"iter_nr_iter":3,"particle_diameter":150,"nr_pool":3},
          "inputs":{"extract_star": ex_star}})

print("\n=== 6b. InitialModel (real relion_refine --denovo_3dref) ===")
r6b = run({"projectId":"smoke","jobId":"initmodel01","taskType":"initialmodel",
           "parameters":{"nr_classes":1,"symmetry":"C1","particle_diameter":150},
           "inputs":{"extract_star": ex_star}})

print("\n=== 6c. Class3D (real relion_refine 3D) ===")
ref_map = f"{SRC}/reference.mrc"
c2d_star = f"/home/z/my-project/data/projects/smoke/relion_run/class2d01/run_it003_model.star"
r6c = run({"projectId":"smoke","jobId":"class3d01","taskType":"class3d",
           "parameters":{"nr_classes":3,"symmetry":"C1","particle_diameter":150},
           "inputs":{"class2d_star": ex_star, "initialmodel_map": ref_map}})

print("\n=== 6d. Refine3D (real relion_refine --auto_refine) ===")
r6d = run({"projectId":"smoke","jobId":"refine3d01","taskType":"refine3d",
           "parameters":{"symmetry":"C1","particle_diameter":150},
           "inputs":{"extract_star": ex_star, "initialmodel_map": ref_map}})

print("\n=== 7. MaskCreate (real relion_mask_create) ===")
# use the class2d model star as the "map" input (we don't have a refine3d yet)
c2d_star = r6.get("primaryOutput") if r6 else None
print(f"  class2d primary: {c2d_star}")
# we need a map for maskcreate — use the reference.mrc from the dataset
ref_map = f"{SRC}/reference.mrc"
r7 = run({"projectId":"smoke","jobId":"maskcreate01","taskType":"maskcreate",
          "parameters":{"ini_threshold":0.02,"extend_mask":3,"soft_edge":3,"lowpass_filter":10,"angpix":4.0},
          "inputs":{"refine3d_map": ref_map}})

print("\n=== 8. PostProcess (real relion_postprocess) ===")
# use reference.mrc as the "halfmap" stand-in (for the smoke test)
mask = r7.get("primaryOutput") if r7 else None
if mask:
    mask_full = f"/home/z/my-project/data/projects/smoke/{mask}"
    r8 = run({"projectId":"smoke","jobId":"postprocess01","taskType":"postprocess",
              "parameters":{"angpix":4.0},
              "inputs":{"refine3d_halfmap": ref_map, "maskcreate_mask": mask_full}})

print("\n=== DONE ===")
print("All steps attempted. Check /home/z/my-project/data/projects/smoke/ for outputs.")
