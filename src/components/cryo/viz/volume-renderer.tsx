"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  projectId: string;
  path: string;          // path to an .mrc file (3D map)
  label?: string;
}

// Lightweight WebGL volume renderer for 3D MRC maps — CryoSPARC-style.
// Renders the density as a ray-marched volume with a viridis-like color ramp
// and a density threshold slider. No external dependencies (raw WebGL).
// Falls back to the slice viewer if WebGL is unavailable.
export function VolumeRenderer({ projectId, path, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [depth, setDepth] = useState<number | null>(null);
  const [threshold, setThreshold] = useState(0.3);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rotY, setRotY] = useState(0.5);
  const [rotX, setRotX] = useState(-0.3);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const texRef = useRef<WebGLTexture | null>(null);
  const progRef = useRef<WebGLProgram | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // probe the map dimensions
  useEffect(() => {
    let cancelled = false;
    async function probe() {
      try {
        const res = await fetch(`/api/slice?projectId=${projectId}&path=${encodeURIComponent(path)}&probe=1`);
        const d = await res.json();
        if (!cancelled) {
          if (d.depth) setDepth(d.depth);
          else setError(d.error || "could not read map");
        }
      } catch (e: any) { if (!cancelled) setError(e.message); }
      finally { if (!cancelled) setLoading(false); }
    }
    probe();
    return () => { cancelled = true; };
  }, [projectId, path]);

  // load the full 3D volume as a Float32 texture
  useEffect(() => {
    if (!depth || !canvasRef.current) return;
    let cancelled = false;
    async function loadVolume() {
      try {
        // Fetch the raw MRC file and parse it client-side (just the data grid).
        const res = await fetch(`/api/files?projectId=${projectId}&path=${encodeURIComponent(path)}`);
        const buf = await res.arrayBuffer();
        // MRC header is 1024 bytes; data starts at offset 1024.
        // We read nx, ny, nz from the header (words at offset 0, 1, 2).
        const dv = new DataView(buf);
        const nx = dv.getInt32(0, true);
        const ny = dv.getInt32(4, true);
        const nz = dv.getInt32(8, true);
        const mode = dv.getInt32(12, true); // 2 = float32
        if (mode !== 2) { setError(`unsupported MRC mode ${mode}`); return; }
        const dataOffset = 1024;
        const total = nx * ny * nz;
        if (buf.byteLength < dataOffset + total * 4) { setError("MRC truncated"); return; }
        const floats = new Float32Array(buf, dataOffset, total);
        // normalize to 0..1
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < total; i++) {
          const v = floats[i];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        const range = mx - mn || 1;
        const norm = new Uint8Array(total);
        for (let i = 0; i < total; i++) {
          norm[i] = Math.max(0, Math.min(255, Math.round((floats[i] - mn) / range * 255)));
        }
        if (cancelled) return;
        initWebGL(norm, nx, ny, nz);
      } catch (e: any) { if (!cancelled) setError(e.message); }
    }
    loadVolume();
    return () => { cancelled = true; };
  }, [projectId, path, depth]);

  function initWebGL(data: Uint8Array, nx: number, ny: number, nz: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const gl = (canvas.getContext("webgl2", { antialias: true, alpha: true }) ||
                  canvas.getContext("webgl", { antialias: true, alpha: true })) as WebGL2RenderingContext | null;
      if (!gl) { setError("WebGL not available in this browser"); return; }
      if (!("texImage3D" in gl)) {
        setError("WebGL2 not available — use the z-slice viewer below instead");
        return;
      }
      glRef.current = gl;

    const vsSrc = `#version 300 es
      in vec2 a_pos;
      out vec2 v_uv;
      void main() {
        v_uv = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;
    // Simple single-pass ray-marched volume renderer (GLSL ES 3.00 for sampler3D).
    const fsSrc = `#version 300 es
      precision highp float;
      uniform highp sampler3D u_vol;
      uniform vec2 u_res;
      uniform float u_threshold;
      uniform float u_rotX;
      uniform float u_rotY;
      in vec2 v_uv;
      out vec4 fragColor;
      // viridis-like color ramp
      vec3 viridis(float t) {
        vec3 c0 = vec3(0.267, 0.005, 0.329);
        vec3 c1 = vec3(0.231, 0.322, 0.545);
        vec3 c2 = vec3(0.129, 0.567, 0.551);
        vec3 c3 = vec3(0.369, 0.788, 0.384);
        vec3 c4 = vec3(0.993, 0.906, 0.144);
        float s = t * 4.0;
        if (s < 1.0) return mix(c0, c1, s);
        if (s < 2.0) return mix(c1, c2, s - 1.0);
        if (s < 3.0) return mix(c2, c3, s - 2.0);
        return mix(c3, c4, s - 3.0);
      }
      void main() {
        vec2 uv = (v_uv - 0.5) * 2.0;
        uv.x *= u_res.x / u_res.y;
        vec3 rayDir = normalize(vec3(uv, -2.0));
        vec3 eye = vec3(0.0, 0.0, 2.5);
        mat3 rotx = mat3(1.0, 0.0, 0.0, 0.0, cos(u_rotX), sin(u_rotX), 0.0, -sin(u_rotX), cos(u_rotX));
        mat3 roty = mat3(cos(u_rotY), 0.0, -sin(u_rotY), 0.0, 1.0, 0.0, sin(u_rotY), 0.0, cos(u_rotY));
        eye = roty * rotx * eye;
        rayDir = roty * rotx * rayDir;
        vec3 ro = eye;
        vec3 rd = rayDir;
        vec3 t0 = (-0.5 - ro) / rd;
        vec3 t1 = (0.5 - ro) / rd;
        vec3 tmin = min(t0, t1);
        vec3 tmax = max(t0, t1);
        float tnear = max(max(tmin.x, tmin.y), tmin.z);
        float tfar = min(min(tmax.x, tmax.y), tmax.z);
        if (tnear > tfar || tfar < 0.0) { fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        tnear = max(tnear, 0.0);
        vec4 color = vec4(0.0);
        // reduced steps for headless/slow GPU
        int STEPS = 40;
        float dt = (tfar - tnear) / float(STEPS);
        for (int i = 0; i < 40; i++) {
          float t = tnear + float(i) * dt;
          if (t >= tfar) break;
          vec3 p = ro + rd * t;
          vec3 uvw = p + 0.5;
          float d = texture(u_vol, uvw).r;
          if (d < u_threshold) continue;
          float a = (d - u_threshold) / (1.0 - u_threshold);
          a = clamp(a, 0.0, 1.0) * 0.12;
          vec3 c = viridis(d);
          color.rgb += c * a * (1.0 - color.a);
          color.a += a;
          if (color.a > 0.95) break;
        }
        fragColor = vec4(color.rgb, 1.0);
      }
    `;
    function compile(type: number, src: string): WebGLShader | null {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        setError(`shader compile error: ${log}`);
        return null;
      }
      return s;
    }
    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setError("shader link failed: " + gl.getProgramInfoLog(prog));
      return;
    }
    progRef.current = prog;

    // full-screen quad — WebGL2 requires a VAO
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // 3D texture — WebGL2 uses R8/RED instead of LUMINANCE
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    // MRC is stored as (nx, ny, nz) with x fastest. WebGL2 expects (width=x, height=y, depth=z).
    // Use R8 internalformat + RED format for single-channel 8-bit data.
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, nx, ny, nz, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    texRef.current = tex;
    render();
    } catch (e: any) {
      setError(`WebGL init failed: ${e?.message || e}. Use the z-slice viewer below.`);
    }
  }

  function render() {
    const gl = glRef.current;
    const canvas = canvasRef.current;
    const prog = progRef.current;
    if (!gl || !canvas || !prog) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.uniform2f(gl.getUniformLocation(prog, "u_res"), w, h);
    gl.uniform1f(gl.getUniformLocation(prog, "u_threshold"), threshold);
    gl.uniform1f(gl.getUniformLocation(prog, "u_rotX"), rotX);
    gl.uniform1f(gl.getUniformLocation(prog, "u_rotY"), rotY);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // re-render on threshold/rotation change
  useEffect(() => { render(); }, [threshold, rotX, rotY]);

  function onDown(e: React.MouseEvent) {
    dragRef.current = { x: e.clientX, y: e.clientY };
  }
  function onMoveDrag(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setRotY((r) => r + dx * 0.01);
    setRotX((r) => Math.max(-1.5, Math.min(1.5, r + dy * 0.01)));
    dragRef.current = { x: e.clientX, y: e.clientY };
  }
  function onUp() { dragRef.current = null; }

  if (loading) return <div className="text-xs text-muted-foreground p-4">Loading 3D volume…</div>;
  if (error || !depth) return (
    <div className="text-xs text-muted-foreground p-4 text-center">{error || "No 3D map."}</div>
  );

  return (
    <div className="flex flex-col gap-2">
      {label && <div className="text-[11px] text-muted-foreground font-mono truncate">{label}</div>}
      <div className="relative bg-black rounded-md border border-border/50 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-[260px] block cursor-grab active:cursor-grabbing"
          onMouseDown={onDown}
          onMouseMove={onMoveDrag}
          onMouseUp={onUp}
          onMouseLeave={onUp}
        />
        <div className="absolute top-1 left-2 text-[10px] font-mono text-emerald-300 bg-black/60 rounded px-1.5 py-0.5">
          3D volume · {depth}³
        </div>
        <div className="absolute top-1 right-2 text-[9px] text-muted-foreground bg-black/60 rounded px-1.5 py-0.5">
          drag to rotate
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground font-mono shrink-0">density</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={threshold}
          onChange={(e) => setThreshold(parseFloat(e.target.value))}
          className="flex-1 accent-emerald-400 h-1"
        />
        <span className="text-[10px] text-muted-foreground font-mono w-8 text-right">{threshold.toFixed(2)}</span>
      </div>
    </div>
  );
}
