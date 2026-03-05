/**
 * MeshRenderer — GPU-instanced Three.js renderer for the mesh network graph.
 *
 * Key performance properties:
 *  - All nodes rendered as a single THREE.InstancedMesh (1 draw call regardless of count).
 *  - All edges rendered as a single THREE.LineSegments (1 draw call regardless of count).
 *  - Per-instance color via InstancedMesh.setColorAt — no material swaps for highlights.
 *  - Per-edge vertex colors via a shared Float32Array — no per-edge objects.
 *  - Labels are individual Sprites, cached and only rebuilt when text/size changes.
 *  - D3 tick → updatePositions() only writes to typed arrays + sets needsUpdate; no React renders.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const MAX_NODES = 2048;
// 2 vertices per edge × 3 floats; enough for a densely connected graph
const MAX_EDGE_VERTS = MAX_NODES * 12;

// Module-level temporaries to avoid per-call allocations
const _dummy = new THREE.Object3D();
const _col = new THREE.Color();

// Default/selected/dimmed edge colours as pre-computed RGB components
const COL_EDGE_DEFAULT = new THREE.Color(0x2563eb);
const COL_EDGE_SEL     = new THREE.Color(0xfbbf24);
const COL_EDGE_DIM     = new THREE.Color(0x1e3558);

export interface SimNode {
  id: string;
  label: string;
  color: string;
  radius: number;
  x?: number;
  y?: number;
  z?: number;
}

export interface SimLink {
  source: SimNode | string;
  target: SimNode | string;
}

function linkEndId(v: SimNode | string): string {
  return typeof v === 'string' ? v : v.id;
}

/** Render a label string onto an offscreen canvas and return a cached Sprite. */
function makeLabelSprite(text: string, size: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fontSize = Math.round(size * 9);
  const font = `${fontSize}px monospace`;
  ctx.font = font;
  const tw = ctx.measureText(text).width;
  const pad = 4;
  canvas.width = Math.ceil(tw) + pad * 2;
  canvas.height = fontSize + pad * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = font;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, pad, fontSize + pad * 0.8);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(size * aspect * 1.8, size * 1.8, 1);
  return sprite;
}

export class MeshRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private rafId: number | null = null;

  // ---- Nodes (InstancedMesh) ----
  private nodeMesh: THREE.InstancedMesh;
  /** id → InstancedMesh slot index */
  private nodeIndexMap = new Map<string, number>();
  /** slot index → id (for raycasting) */
  private indexNodeMap = new Map<number, string>();
  /** live world-space position for each node id */
  private nodePos = new Map<string, THREE.Vector3>();
  /** cached radius per node (for label offset) */
  private nodeRadius = new Map<string, number>();

  // ---- Edges (LineSegments with vertex colors) ----
  private edgeMesh: THREE.LineSegments;
  private edgePosBuf: Float32Array;
  private edgePosAttr: THREE.BufferAttribute;
  private edgeColBuf: Float32Array;
  private edgeColAttr: THREE.BufferAttribute;
  private edgeMaterial: THREE.LineBasicMaterial;
  /** stored source/target id pairs for fast per-tick position updates */
  private edgePairs: [string, string][] = [];

  // ---- Packet-trace state ----
  /** node ids currently on an active packet path — drives edge highlight */
  private packetHitSet = new Set<string>();
  /** last selectedId passed to updateColors — kept so setPacketHits can redraw */
  private currentSelectedId: string | null = null;
  /** user-configured opacity, restored when packet hits are cleared */
  private baseEdgeOpacity = 0.55;

  // ---- Packet-trace overlay (thick red Line2) ----
  private traceGeo: LineSegmentsGeometry;
  private traceMat: LineMaterial;
  private traceMesh: LineSegments2;

  // ---- Labels (individual Sprites, one per node) ----
  private labelMap = new Map<string, THREE.Sprite>();
  private labelTextMap = new Map<string, string>();
  private labelsVisible = true;
  private labelSize = 6;

  // ---- Camera fly-to ----
  private flyFrom = new THREE.Vector3();
  private flyDest = new THREE.Vector3();
  private flyLookTarget = new THREE.Vector3();
  private flyStartTime = -1;
  private readonly flyDurMs = 1000;
  private flying = false;

  // ---- Orbit mode ----
  private orbitMode = false;
  private orbitAngle: number | null = null;
  /** id of the node to orbit around (null = centroid) */
  private orbitFocusId: string | null = null;

  // ---- Input handling ----
  private readonly canvas: HTMLCanvasElement;
  private readonly onNodeClick: (id: string | null) => void;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  /** Start position of a touch — used to distinguish tap from drag/pan. */
  private touchStartPos: { x: number; y: number } | null = null;

  constructor(canvas: HTMLCanvasElement, onNodeClick: (id: string | null) => void) {
    this.canvas = canvas;
    this.onNodeClick = onNodeClick;

    // ---- WebGL renderer ----
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x030712);

    // ---- Scene ----
    this.scene = new THREE.Scene();

    // ---- Camera ----
    this.camera = new THREE.PerspectiveCamera(60, 1, 1, 50000);
    this.camera.position.set(0, 0, 800);

    // ---- Lighting (needed for MeshPhongMaterial on spheres) ----
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(1, 1, 1);
    this.scene.add(dir);

    // ---- OrbitControls ----
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    // ---- Node InstancedMesh ----
    // SphereGeometry(1, segments, segments) — radius=1, scaled per instance
    const sphereGeo = new THREE.SphereGeometry(1, 10, 8);
    const sphereMat = new THREE.MeshPhongMaterial();
    this.nodeMesh = new THREE.InstancedMesh(sphereGeo, sphereMat, MAX_NODES);
    this.nodeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.nodeMesh.count = 0;
    this.nodeMesh.frustumCulled = false;
    this.scene.add(this.nodeMesh);

    // ---- Edge LineSegments with per-vertex colour ----
    this.edgePosBuf = new Float32Array(MAX_EDGE_VERTS * 3);
    this.edgePosAttr = new THREE.BufferAttribute(this.edgePosBuf, 3);
    this.edgePosAttr.setUsage(THREE.DynamicDrawUsage);

    this.edgeColBuf = new Float32Array(MAX_EDGE_VERTS * 3);
    this.edgeColAttr = new THREE.BufferAttribute(this.edgeColBuf, 3);
    this.edgeColAttr.setUsage(THREE.DynamicDrawUsage);

    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', this.edgePosAttr);
    edgeGeo.setAttribute('color', this.edgeColAttr);
    edgeGeo.setDrawRange(0, 0);

    this.edgeMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
    });
    this.edgeMesh = new THREE.LineSegments(edgeGeo, this.edgeMaterial);
    this.edgeMesh.frustumCulled = false;
    this.scene.add(this.edgeMesh);

    // ---- Packet-trace overlay — thick 2 px red lines via Line2 ----
    this.traceGeo = new LineSegmentsGeometry();
    this.traceMat = new LineMaterial({ color: 0xef4444, linewidth: 2, transparent: true, opacity: 1.0 });
    this.traceMat.resolution.set(canvas.clientWidth || 800, canvas.clientHeight || 600);
    this.traceMesh = new LineSegments2(this.traceGeo, this.traceMat);
    this.traceMesh.frustumCulled = false;
    this.traceMesh.visible = false;
    this.scene.add(this.traceMesh);

    canvas.addEventListener('click', this.handleClick);
    // Touch equivalents — OrbitControls consumes touchstart/end for pan/zoom and
    // may suppress the synthetic click event on some mobile browsers, so we
    // implement tap detection directly.
    canvas.addEventListener('touchstart', this.handleTouchStart, { passive: true });
    canvas.addEventListener('touchend', this.handleTouchEnd);
    this.startLoop();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  setSize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.traceMat.resolution.set(w, h);
  }

  /**
   * Called when graph topology changes (node set or edge set changes).
   * Rebuilds index maps, initialises instance matrices and edge geometry.
   */
  setTopology(nodes: SimNode[], links: SimLink[]) {
    // ---- Rebuild node index maps ----
    const newIndexMap = new Map<string, number>();
    const newIndexNodeMap = new Map<number, string>();
    let idx = 0;
    for (const node of nodes) {
      if (idx >= MAX_NODES) break;
      newIndexMap.set(node.id, idx);
      newIndexNodeMap.set(idx, node.id);
      idx++;
    }
    this.nodeIndexMap = newIndexMap;
    this.indexNodeMap = newIndexNodeMap;
    this.nodeMesh.count = idx;

    // Prune position/radius caches for removed nodes
    for (const id of this.nodePos.keys()) {
      if (!newIndexMap.has(id)) {
        this.nodePos.delete(id);
        this.nodeRadius.delete(id);
      }
    }

    // Seed positions for brand-new nodes
    for (const n of nodes) {
      if (!this.nodePos.has(n.id)) {
        this.nodePos.set(n.id, new THREE.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0));
      }
      this.nodeRadius.set(n.id, n.radius);
    }

    // Write initial matrices and colours
    for (const node of nodes) {
      const i = newIndexMap.get(node.id);
      if (i === undefined) continue;
      const pos = this.nodePos.get(node.id)!;
      _dummy.position.copy(pos);
      _dummy.scale.setScalar(node.radius);
      _dummy.updateMatrix();
      this.nodeMesh.setMatrixAt(i, _dummy.matrix);
      _col.set(node.color);
      this.nodeMesh.setColorAt(i, _col);
    }
    this.nodeMesh.instanceMatrix.needsUpdate = true;
    if (this.nodeMesh.instanceColor) this.nodeMesh.instanceColor.needsUpdate = true;

    // ---- Edges ----
    this.edgePairs = links.map(l => [linkEndId(l.source), linkEndId(l.target)]);
    this.writeEdgePositions();
    this.writeEdgeColors(this.currentSelectedId);

    // ---- Labels ----
    this.syncLabels(nodes);
  }

  /**
   * Called on every D3 tick.
   * Updates node instance matrices, label sprite positions, and edge endpoint positions.
   * No React state mutations — runs entirely in typed arrays.
   */
  updatePositions(nodes: SimNode[]) {
    for (const node of nodes) {
      const i = this.nodeIndexMap.get(node.id);
      if (i === undefined) continue;
      const x = node.x ?? 0, y = node.y ?? 0, z = node.z ?? 0;

      const pos = this.nodePos.get(node.id);
      if (pos) pos.set(x, y, z);

      _dummy.position.set(x, y, z);
      _dummy.scale.setScalar(node.radius);
      _dummy.updateMatrix();
      this.nodeMesh.setMatrixAt(i, _dummy.matrix);

      const sprite = this.labelMap.get(node.id);
      if (sprite) sprite.position.set(x, y + node.radius + 5, z);
    }
    this.nodeMesh.instanceMatrix.needsUpdate = true;
    this.writeEdgePositions();
    if (this.traceMesh.visible) this.writeTracePositions();
  }

  /**
   * Lightweight update for when only node metadata (labels, base colour) changed
   * but the topology (set of nodes/edges) is unchanged.
   * Does NOT rebuild index maps or edge geometry — far cheaper than setTopology().
   */
  refreshMetadata(nodes: SimNode[]) {
    for (const node of nodes) {
      const i = this.nodeIndexMap.get(node.id);
      if (i === undefined) continue;
      _col.set(node.color);
      this.nodeMesh.setColorAt(i, _col);
      this.nodeRadius.set(node.id, node.radius);
    }
    if (this.nodeMesh.instanceColor) this.nodeMesh.instanceColor.needsUpdate = true;
    this.syncLabels(nodes);
  }

  /**
   * Called when selection changes.
   * Updates per-instance sphere colours and per-vertex edge colours.
   * When a node is selected:
   *   - selected node  → yellow
   *   - direct neighbours → full base colour
   *   - unconnected nodes → dimmed (25% brightness)
   * Packet-path highlighting is handled separately via setPacketHits().
   */
  updateColors(nodes: SimNode[], selectedId: string | null) {
    this.currentSelectedId = selectedId;

    // Build the set of nodes directly connected to the selected node so we can
    // dim everything else.  Uses the already-stored edgePairs array — O(edges).
    const neighborSet = new Set<string>();
    if (selectedId) {
      for (const [src, tgt] of this.edgePairs) {
        if (src === selectedId) neighborSet.add(tgt);
        if (tgt === selectedId) neighborSet.add(src);
      }
    }

    const hasSelection = selectedId !== null;
    for (const node of nodes) {
      const i = this.nodeIndexMap.get(node.id);
      if (i === undefined) continue;
      if (node.id === selectedId) {
        _col.set('#fbbf24');
      } else if (hasSelection && !neighborSet.has(node.id)) {
        // Non-connected node: dim to 25 % of base colour
        _col.set(node.color);
        _col.r *= 0.25; _col.g *= 0.25; _col.b *= 0.25;
      } else {
        _col.set(node.color);
      }
      this.nodeMesh.setColorAt(i, _col);
    }
    if (this.nodeMesh.instanceColor) this.nodeMesh.instanceColor.needsUpdate = true;

    this.writeEdgeColors(selectedId);
  }

  /**
   * Update the set of node ids that are on an active packet path.
   * Any edge whose both endpoints are in the set is drawn with the packet-hit colour.
   * Pass an empty set to clear all packet-path highlights.
   */
  setPacketHits(hits: Set<string>) {
    this.packetHitSet = hits;
    this.writeEdgeColors(this.currentSelectedId);  // dim non-trace edges when active
    if (hits.size === 0) {
      this.traceMesh.visible = false;
      this.edgeMaterial.opacity = this.baseEdgeOpacity;
      return;
    }
    this.edgeMaterial.opacity = Math.min(this.baseEdgeOpacity, 0.15); // dim background edges
    this.writeTracePositions();
  }

  setLinkOpacity(opacity: number) {
    this.baseEdgeOpacity = opacity;
    if (this.packetHitSet.size === 0) {
      this.edgeMaterial.opacity = opacity;
    }
  }

  setLabelsVisible(visible: boolean) {
    this.labelsVisible = visible;
    for (const sprite of this.labelMap.values()) {
      sprite.visible = visible;
    }
  }

  setLabelSize(size: number) {
    if (size === this.labelSize) return;
    this.labelSize = size;
    // Rebuild every sprite at the new text height
    for (const [id, old] of this.labelMap) {
      this.scene.remove(old);
      old.material.map?.dispose();
      old.material.dispose();
      const text = this.labelTextMap.get(id) ?? id;
      const sprite = makeLabelSprite(text, size);
      sprite.visible = this.labelsVisible;
      const pos = this.nodePos.get(id);
      const r = this.nodeRadius.get(id) ?? 9;
      if (pos) sprite.position.set(pos.x, pos.y + r + 5, pos.z);
      this.scene.add(sprite);
      this.labelMap.set(id, sprite);
    }
    this.labelSize = size;
  }

  /** Fly the camera to look at a specific world position. */
  flyTo(x: number, y: number, z: number) {
    this.flyFrom.copy(this.camera.position);
    this.flyDest.set(x, y + 50, z + 200);
    this.flyLookTarget.set(x, y, z);
    this.flyStartTime = performance.now();
    this.flying = true;
    this.controls.enabled = false;
  }

  /** Get current world position of a node (for orbit focus). */
  getNodePosition(id: string): THREE.Vector3 | undefined {
    return this.nodePos.get(id);
  }

  setOrbitMode(enabled: boolean, focusId: string | null = null) {
    this.orbitMode = enabled;
    this.orbitFocusId = focusId;
    if (!enabled) {
      this.orbitAngle = null;
      this.controls.enabled = true;
    }
  }

  resetOrbitAngle() {
    this.orbitAngle = null;
  }

  dispose() {
    this.stopLoop();
    this.canvas.removeEventListener('click', this.handleClick);
    this.canvas.removeEventListener('touchstart', this.handleTouchStart);
    this.canvas.removeEventListener('touchend', this.handleTouchEnd);
    this.controls.dispose();
    this.traceGeo.dispose();
    this.traceMat.dispose();
    this.renderer.dispose();
    for (const sprite of this.labelMap.values()) {
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
    this.labelMap.clear();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private startLoop() {
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      this.frame();
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private frame() {
    const now = performance.now();

    if (this.flying) {
      const t = Math.min(1, (now - this.flyStartTime) / this.flyDurMs);
      // Ease-in-out quadratic
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      this.camera.position.lerpVectors(this.flyFrom, this.flyDest, ease);
      this.controls.target.lerp(this.flyLookTarget, ease);
      if (t >= 1) {
        this.flying = false;
        this.controls.enabled = !this.orbitMode;
      }
    } else if (this.orbitMode) {
      this.doOrbit();
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private doOrbit() {
    // Orbit around the selected node, or the cluster centroid
    let cx = 0, cy = 0, cz = 0;
    if (this.orbitFocusId) {
      const p = this.nodePos.get(this.orbitFocusId);
      if (p) { cx = p.x; cy = p.y; cz = p.z; }
    } else {
      let count = 0;
      for (const p of this.nodePos.values()) {
        cx += p.x; cy += p.y; cz += p.z; count++;
      }
      if (count > 0) { cx /= count; cy /= count; cz /= count; }
    }

    const cam = this.camera;
    const dx = cam.position.x - cx;
    const dz = cam.position.z - cz;
    if (this.orbitAngle === null) {
      this.orbitAngle = Math.atan2(dx, dz);
    }
    const radius = Math.sqrt(dx * dx + dz * dz) || 400;
    this.orbitAngle += 0.004;
    cam.position.set(
      cx + radius * Math.sin(this.orbitAngle),
      cam.position.y,
      cz + radius * Math.cos(this.orbitAngle),
    );
    this.controls.target.set(cx, cy, cz);
    this.controls.enabled = false;
  }

  private readonly handleClick = (e: MouseEvent) => {
    this.raycastAt(e.clientX, e.clientY);
  };

  private readonly handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) { this.touchStartPos = null; return; }
    this.touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  private readonly handleTouchEnd = (e: TouchEvent) => {
    if (!this.touchStartPos || e.changedTouches.length !== 1) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - this.touchStartPos.x;
    const dy = touch.clientY - this.touchStartPos.y;
    this.touchStartPos = null;
    // Only treat as a tap if the finger barely moved (not a pan or zoom gesture)
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) return;
    e.preventDefault(); // prevent the follow-up synthetic click from double-firing
    this.raycastAt(touch.clientX, touch.clientY);
  };

  private raycastAt(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.nodeMesh);
    if (hits.length > 0 && hits[0].instanceId !== undefined) {
      const id = this.indexNodeMap.get(hits[0].instanceId);
      this.onNodeClick(id ?? null);
    } else {
      this.onNodeClick(null);
    }
  }

  /** Write current node positions into the edge position buffer. */
  private writeEdgePositions() {
    const buf = this.edgePosBuf;
    let i = 0;
    for (const [srcId, tgtId] of this.edgePairs) {
      if (i + 6 > buf.length) break;
      const sp = this.nodePos.get(srcId);
      const tp = this.nodePos.get(tgtId);
      buf[i++] = sp?.x ?? 0; buf[i++] = sp?.y ?? 0; buf[i++] = sp?.z ?? 0;
      buf[i++] = tp?.x ?? 0; buf[i++] = tp?.y ?? 0; buf[i++] = tp?.z ?? 0;
    }
    this.edgePosAttr.needsUpdate = true;
    this.edgeMesh.geometry.setDrawRange(0, this.edgePairs.length * 2);
  }

  /** Write per-vertex edge colours based on current selection and active packet hits. */
  private writeEdgeColors(selectedId: string | null) {
    const buf = this.edgeColBuf;
    const hits = this.packetHitSet;
    const hasHits = hits.size > 0;
    let i = 0;
    for (const [srcId, tgtId] of this.edgePairs) {
      if (i + 6 > buf.length) break;
      let col: THREE.Color;
      if (selectedId) {
        col = (srcId === selectedId || tgtId === selectedId) ? COL_EDGE_SEL : COL_EDGE_DIM;
      } else if (hasHits) {
        // Dim non-trace edges so the red overlay stands out; keep trace edges at normal colour.
        col = (hits.has(srcId) && hits.has(tgtId)) ? COL_EDGE_DEFAULT : COL_EDGE_DIM;
      } else {
        col = COL_EDGE_DEFAULT;
      }
      buf[i++] = col.r; buf[i++] = col.g; buf[i++] = col.b;
      buf[i++] = col.r; buf[i++] = col.g; buf[i++] = col.b;
    }
    this.edgeColAttr.needsUpdate = true;
  }

  /** Rebuild the Line2 trace overlay from current nodePos for all packet-hit edges. */
  private writeTracePositions() {
    const pts: number[] = [];
    for (const [srcId, tgtId] of this.edgePairs) {
      if (!this.packetHitSet.has(srcId) || !this.packetHitSet.has(tgtId)) continue;
      const sp = this.nodePos.get(srcId);
      const tp = this.nodePos.get(tgtId);
      if (!sp || !tp) continue;
      pts.push(sp.x, sp.y, sp.z, tp.x, tp.y, tp.z);
    }
    if (pts.length > 0) {
      this.traceGeo.setPositions(pts);
      this.traceMesh.visible = true;
    } else {
      this.traceMesh.visible = false;
    }
  }

  /** Add/update/remove label sprites to match the current node set. */
  private syncLabels(nodes: SimNode[]) {
    // Remove sprites for nodes that no longer exist
    for (const [id, sprite] of this.labelMap) {
      if (!this.nodeIndexMap.has(id)) {
        this.scene.remove(sprite);
        sprite.material.map?.dispose();
        sprite.material.dispose();
        this.labelMap.delete(id);
        this.labelTextMap.delete(id);
      }
    }
    // Create / update sprites for current nodes
    for (const node of nodes) {
      const text = node.label;
      const existing = this.labelMap.get(node.id);
      const existingText = this.labelTextMap.get(node.id);
      const pos = this.nodePos.get(node.id)!;
      if (!existing || existingText !== text) {
        if (existing) {
          this.scene.remove(existing);
          existing.material.map?.dispose();
          existing.material.dispose();
        }
        const sprite = makeLabelSprite(text, this.labelSize);
        sprite.visible = this.labelsVisible;
        sprite.position.set(pos.x, pos.y + node.radius + 5, pos.z);
        this.scene.add(sprite);
        this.labelMap.set(node.id, sprite);
        this.labelTextMap.set(node.id, text);
      }
    }
  }
}
