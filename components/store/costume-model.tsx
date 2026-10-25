"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { focusRegion } from "@/lib/try-on-3d/focus";
import type { FocusPiece } from "@/lib/try-on-3d/types";

type Viewer = { focus: (piece?: FocusPiece, immediate?: boolean) => void; turn: (angle: number) => void };
function disposeModel(model: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    }
  });
  for (const texture of textures) { texture.dispose(); if (texture.source.data instanceof ImageBitmap) texture.source.data.close(); }
}

export default function CostumeModel({ url, pieces }: { url: string; pieces: FocusPiece[] }) {
  const mount = useRef<HTMLDivElement>(null);
  const border = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const selectedPiece = pieces.find((piece) => piece.id === selected);

  useEffect(() => {
    const element = mount.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" }); }
    // WebGL support is only known after creating the browser renderer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    catch { setError("This browser cannot display 3D. Your photo preview is still available."); setState("error"); return; }
    let disposed = false;
    const abort = new AbortController();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, .01, 50);
    camera.position.set(.45, 1.15, 4.2);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.minDistance = .5; controls.maxDistance = 8;
    controls.minPolarAngle = .15; controls.maxPolarAngle = Math.PI * .85;
    controls.target.set(0, 1, 0);
    controls.update();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x82818b, 2.4));
    const key = new THREE.DirectionalLight(0xfff5e8, 3); key.position.set(3, 4, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0xddeaff, 2); rim.position.set(-3, 3, -2); scene.add(rim);
    let model: THREE.Group | undefined;
    let width = .8, depth = .5;
    let region: ReturnType<typeof focusRegion> | null = null;
    let focusedPiece: FocusPiece | undefined;
    let transition: { from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; start: number } | null = null;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const projected = new THREE.Vector3();
    function drawBorder() {
      const overlay = border.current;
      if (!overlay || !region || !model) { if (overlay) overlay.hidden = true; return; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const w = element.clientWidth, h = element.clientHeight;
      for (const x of [-width * region.width / 2, width * region.width / 2]) for (const y of [region.bottom * 2, region.top * 2]) for (const z of [-depth / 2, depth / 2]) {
        projected.set(x, y, z).project(camera);
        if (projected.z < -1 || projected.z > 1) { overlay.hidden = true; return; }
        const px = (projected.x + 1) * w / 2, py = (1 - projected.y) * h / 2;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      if (x1 < 0 || y1 < 0 || x0 > w || y0 > h) { overlay.hidden = true; return; }
      x0 = Math.max(12, x0 - 10); y0 = Math.max(48, y0 - 20); x1 = Math.min(w - 12, x1 + 10); y1 = Math.min(h - 34, y1 + 10);
      overlay.hidden = false;
      overlay.style.transform = `translate(${x0}px, ${y0}px)`;
      overlay.style.width = `${Math.max(30, x1 - x0)}px`; overlay.style.height = `${Math.max(30, y1 - y0)}px`;
    }
    function render(now = performance.now()) {
      frame = 0;
      if (disposed) return;
      if (transition) {
        const t = Math.min(1, (now - transition.start) / 280), eased = 1 - Math.pow(1 - t, 3);
        camera.position.lerpVectors(transition.from, transition.to, eased);
        controls.target.lerpVectors(transition.fromTarget, transition.toTarget, eased);
        if (t === 1) transition = null;
        controls.update();
      }
      camera.updateMatrixWorld(); renderer.render(scene, camera); drawBorder();
      if (transition && !frame) frame = requestAnimationFrame(render);
    }
    function invalidate() { if (!frame && !disposed) frame = requestAnimationFrame(render); }
    function focus(piece?: FocusPiece, immediate = false) {
      focusedPiece = piece;
      const area = focusRegion(piece); region = piece ? area : null;
      const center = (area.bottom + area.top);
      // Fit both height and width so boots and wide hats remain visible on phones.
      const radius = Math.max((area.top - area.bottom) * 2, width * area.width / camera.aspect) * .7 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) + depth * .5;
      const target = new THREE.Vector3(0, center, 0);
      const position = new THREE.Vector3(Math.sin(area.yaw) * radius, center + radius * .045, Math.cos(area.yaw) * radius);
      if (immediate || motion.matches) { transition = null; camera.position.copy(position); controls.target.copy(target); controls.update(); }
      else transition = { from: camera.position.clone(), to: position, fromTarget: controls.target.clone(), toTarget: target, start: performance.now() };
      invalidate();
    }
    viewer.current = { focus, turn(angle) {
      transition = null;
      camera.position.sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).add(controls.target);
      controls.update(); invalidate();
    } };
    controls.addEventListener("change", invalidate);
    controls.addEventListener("start", () => { transition = null; });
    const resize = new ResizeObserver(() => {
      const w = element.clientWidth, h = element.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      if (model) focus(focusedPiece, true); else invalidate();
    });
    resize.observe(element);
    const lost = (event: Event) => { event.preventDefault(); setError("The 3D view was interrupted. Reload the model to continue."); setState("error"); };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    const draco = new DRACOLoader(); draco.setDecoderPath("/draco/");
    const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
    // Fetch is abortable. Parsing can finish after unmount, so dispose late results.
    fetch(url, { signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error("The model download failed.");
      if (Number(response.headers.get("content-length")) > 120 * 1024 * 1024) throw new Error("This model is too large for the preview.");
      const data = await response.arrayBuffer();
      if (data.byteLength > 120 * 1024 * 1024) throw new Error("This model is too large for the preview.");
      return loader.parseAsync(data, new URL(".", new URL(url, window.location.href)).href);
    }).then((gltf) => {
      if (disposed) { disposeModel(gltf.scene); return; }
      model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
      if (!Number.isFinite(size.y) || size.y <= 0) throw new Error("The model has no visible shape.");
      const scale = 2 / size.y, center = bounds.getCenter(new THREE.Vector3());
      model.scale.multiplyScalar(scale);
      model.position.add(new THREE.Vector3(-center.x * scale, -bounds.min.y * scale, -center.z * scale));
      width = size.x * scale; depth = size.z * scale;
      scene.add(model); focus(undefined, true); setSelected(null); setState("ready");
    }).catch((caught) => {
      if (!disposed) { setError(caught instanceof Error ? caught.message : "The 3D model could not be opened."); setState("error"); }
    });
    return () => {
      disposed = true; abort.abort(); cancelAnimationFrame(frame); resize.disconnect(); controls.dispose(); draco.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      if (model) disposeModel(model);
      renderer.dispose(); renderer.domElement.remove(); viewer.current = null;
    };
  }, [url, retry]);

  function select(piece?: FocusPiece, immediate = false) { setSelected(piece?.id ?? null); viewer.current?.focus(piece, immediate); }
  return <div className="costume-model">
    <div className="costume-model-stage" tabIndex={0} role="group" aria-label="3D costume. Drag to rotate, pinch to zoom. Arrow keys rotate. Escape resets."
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (["ArrowLeft", "ArrowRight", "Escape", "Home"].includes(event.key)) event.preventDefault();
        if (event.key === "ArrowLeft") viewer.current?.turn(-.18);
        if (event.key === "ArrowRight") viewer.current?.turn(.18);
        if (["Escape", "Home"].includes(event.key)) select(undefined, true);
      }}>
      <div className="costume-model-canvas" ref={mount} />
      <div className="costume-model-kicker"><span className="costume-model-dot" />YOUR LOOK / 3D</div>
      <div className="costume-model-border" ref={border} hidden aria-hidden="true"><span>{selectedPiece?.name}</span><i>+</i></div>
      {state === "loading" && <div className="costume-model-message" role="status">Opening your 3D look…</div>}
      {state === "error" && <div className="costume-model-message" role="alert"><p>{error}</p><button type="button" onClick={() => { setState("loading"); setRetry((n) => n + 1); }}>Reload model</button></div>}
      {state === "ready" && <div className="costume-model-hint">Drag to rotate · Pinch or scroll to zoom</div>}
    </div>
    <nav className="costume-model-index" aria-label="Explore costume pieces">
      <div className="costume-model-index-title">The details <span>SELECT TO EXPLORE</span></div>
      <button type="button" aria-pressed={selected === null} disabled={state !== "ready"} onClick={(event) => select(undefined, event.detail === 0)}><span>00</span>Whole look<span>↗</span></button>
      {pieces.map((piece, index) => <button type="button" key={piece.id} aria-pressed={selected === piece.id} disabled={state !== "ready"} onClick={(event) => select(piece, event.detail === 0)}><span>{String(index + 1).padStart(2, "0")}</span>{piece.name}<span>↗</span></button>)}
    </nav>
    <p className="costume-model-note" aria-live="polite">{selectedPiece ? `Viewing ${selectedPiece.name}. ` : ""}AI appearance preview. Focus areas are approximate; unseen details are generated.</p>
  </div>;
}
