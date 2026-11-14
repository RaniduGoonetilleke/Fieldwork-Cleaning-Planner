import * as THREE from './lib/three.module.js';
import { OrbitControls } from './lib/OrbitControls.js';

// This scene explains the cases. Its geometry and animation are illustrative,
// and never supply a fact, decision, trajectory or measurement to the planner.
const COLORS = {
  background: 0x081d25, floor: 0x102b33, silver: 0xb5c7cc,
  ceramic: 0xd6e0df, graphite: 0x243e48, dark: 0x10232b,
  teal: 0x58d6bc, blue: 0x4f9bb7, amber: 0xf5bb65,
  red: 0xf28d80, white: 0xebf5ed, line: 0x496d72
};
const OFFSETS = { A: [-0.08, 0.02], B: [0.08, 0], C: [-0.08, 0], D: [0, 0.08], E: [0, 0], F: [0, -0.08] };
const STATUS_COLOR = { SELECT: COLORS.teal, CONFIRM: COLORS.amber, ASK: COLORS.amber, WAIT: COLORS.blue, WITHHOLD: 0x809da7, REFUSE: COLORS.red };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a.clone().lerp(b, t);

export class PlanningScene {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.robot = 'G1';
    this.target = 'B';
    this.force = 7;
    this.decision = null;
    this.progress = 0;
    this.playing = false;
    this.disposed = false;
    this.dirty = true;
    this.lastTime = 0;
    this.lastPhase = '';
    this.layers = { labels: true, path: true, visibility: false, camera: false, grid: true };
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pickables = [];
    this.materials = [];
    this.textures = [];
    this.resizeObserver = null;
    this.frame = null;
    try { this.init(); }
    catch (error) {
      this.dispose();
      callbacks.onError?.(error);
    }
  }

  init() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.background);
    this.scene.fog = new THREE.Fog(COLORS.background, 5, 13);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.02, 60);
    this.camera.position.set(2.55, 2.0, 3.35);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const canvas = this.renderer.domElement;
    canvas.setAttribute('aria-label', 'Interactive illustrative robot scene. Drag to orbit, scroll to zoom. Location markers also have controls outside this view.');
    canvas.setAttribute('role', 'img');
    canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;';
    this.container.appendChild(canvas);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.98, -0.12);
    this.controls.enableDamping = !this.reducedMotion;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 6;
    this.controls.minPolarAngle = 0.1;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.055;
    this.controls.maxTargetRadius = 2;
    this.controls.enablePan = true;
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.controls.addEventListener('start', () => { this.cameraTween = null; });

    this.makeLights();
    this.makeGround();
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.cases = {};
    this.cases.G1 = this.makeG1();
    this.cases.UR3 = this.makeArmCase('UR3');
    this.cases.UR5 = this.makeArmCase('UR5');
    for (const [name, record] of Object.entries(this.cases)) {
      record.root.visible = name === this.robot;
      this.world.add(record.root);
    }
    this.makeTooltip();
    this.onPointerDown = e => { this.pointerStart = { x: e.clientX, y: e.clientY }; };
    this.onPointerUp = e => {
      if (!this.pointerStart || Math.hypot(e.clientX - this.pointerStart.x, e.clientY - this.pointerStart.y) > 6) return;
      const hit = this.pick(e);
      if (hit?.target) { this.setTarget(hit.target); this.callbacks.onSelectTarget?.(hit.target); }
      else if (hit?.robot) this.callbacks.onSelectRobot?.(hit.robot);
    };
    this.onPointerMove = e => {
      const hit = this.pick(e);
      canvas.style.cursor = hit?.target ? 'pointer' : 'grab';
      this.showTooltip(hit?.target ? `Location ${hit.target} · ${OFFSETS[hit.target][0] * 1000}, ${OFFSETS[hit.target][1] * 1000} mm` : '', e);
      if (this.hovered !== hit?.target) { this.hovered = hit?.target; this.updateTargets(); }
    };
    this.onPointerLeave = () => { this.tooltip.hidden = true; this.hovered = null; this.updateTargets(); };
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.onVisibility = () => { this.lastTime = 0; this.dirty = true; };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onContextLost = e => { e.preventDefault(); this.playing = false; this.dispose(); callbacksSafe(this.callbacks.onError, new Error('The 3D graphics context was interrupted. Reload this page to restore the scene.')); };
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.setTarget(this.target);
    this.setLayer('visibility', false);
    this.resize();
    this.animate(0);
    queueMicrotask(() => { if (!this.disposed) this.callbacks.onReady?.({ renderer: 'WebGL', illustrative: true }); });
  }

  material(color, options = {}) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.16, ...options });
    this.materials.push(m); return m;
  }

  mesh(parent, geometry, material, position, rotation) {
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.copy(position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh); return mesh;
  }

  box(parent, size, position, material, radius = 0) {
    // Rounded edges use small bevelled profiles, avoiding an extra geometry dependency.
    if (!radius) return this.mesh(parent, new THREE.BoxGeometry(...size), material, position);
    const [w, h, d] = size, r = Math.min(radius, w / 2, h / 2);
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2); shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r); shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2); shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r); shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.005, d - r), bevelEnabled: true, bevelThickness: r / 2, bevelSize: r / 2, bevelSegments: 2, steps: 1, curveSegments: 5 });
    geometry.translate(0, 0, -d / 2 + r / 2);
    return this.mesh(parent, geometry, material, position);
  }

  cylinder(parent, r, length, position, material, rotation = null) {
    return this.mesh(parent, new THREE.CylinderGeometry(r, r, length, 28), material, position, rotation);
  }

  sphere(parent, r, position, material) {
    return this.mesh(parent, new THREE.SphereGeometry(r, 24, 16), material, position);
  }

  link(parent, start, end, radius, material, radiusEnd = radius) {
    const mesh = this.mesh(parent, new THREE.CylinderGeometry(radiusEnd, radius, 1, 24), material);
    this.placeLink(mesh, start, end); return mesh;
  }

  placeLink(mesh, start, end) {
    const direction = end.clone().sub(start);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.scale.y = direction.length();
    mesh.quaternion.setFromUnitVectors(V(0, 1, 0), direction.normalize());
  }

  line(parent, points, color = COLORS.teal, opacity = 1, dashed = false) {
    const g = new THREE.BufferGeometry().setFromPoints(points);
    const m = dashed ? new THREE.LineDashedMaterial({ color, opacity, transparent: opacity < 1, dashSize: 0.025, gapSize: 0.016 }) : new THREE.LineBasicMaterial({ color, opacity, transparent: opacity < 1 });
    this.materials.push(m);
    const line = new THREE.Line(g, m);
    if (dashed) line.computeLineDistances();
    parent.add(line); return line;
  }

  label(parent, text, position, options = {}) {
    const { color = '#d8eeea', background = '#16363f', width = 0.42, height = 0.105, fontSize = 32, compact = false } = options;
    const displayWidth = width * (compact ? 1.05 : 1.16);
    const displayHeight = height * (compact ? 1.05 : 1.25);
    const canvas = document.createElement('canvas');
    canvas.height = compact ? 128 : 64;
    canvas.width = compact ? 128 : Math.max(128, Math.min(1024, Math.round(64 * displayWidth / displayHeight)));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background;
    ctx.beginPath(); ctx.roundRect(3, 3, canvas.width - 6, canvas.height - 6, compact ? 24 : 13); ctx.fill();
    ctx.strokeStyle = 'rgba(176,218,213,.25)'; ctx.lineWidth = compact ? 2 : 1.5; ctx.stroke();
    ctx.fillStyle = color;
    let fittedSize = compact ? fontSize : Math.min(46, fontSize * 1.4);
    const padding = compact ? 20 : 22;
    ctx.font = `600 ${fittedSize}px system-ui, sans-serif`;
    while (ctx.measureText(text).width > canvas.width - padding && fittedSize > 12) {
      fittedSize -= 1; ctx.font = `600 ${fittedSize}px system-ui, sans-serif`;
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(texture);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
    this.materials.push(material);
    const sprite = new THREE.Sprite(material); sprite.position.copy(position); sprite.scale.set(displayWidth, displayHeight, 1); sprite.renderOrder = 20;
    parent.add(sprite); return sprite;
  }

  makeLights() {
    const ambient = new THREE.HemisphereLight(0xc8e7eb, 0x173c40, 2.3); this.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xfff0da, 3.5); key.position.set(2.5, 5.5, 3.8); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -3; key.shadow.camera.right = 3;
    key.shadow.camera.top = 3; key.shadow.camera.bottom = -3; key.shadow.camera.near = 0.1; key.shadow.camera.far = 14;
    key.shadow.normalBias = 0.025; key.shadow.bias = -0.0002; key.shadow.radius = 3; this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x57c9dc, 2.8); rim.position.set(-3, 2.8, -2.5); this.scene.add(rim);
    const fill = new THREE.PointLight(0x91eed1, 4.2, 7, 2); fill.position.set(-1.7, 1.4, 2.2); this.scene.add(fill);
  }

  makeGround() {
    const ground = this.mesh(this.scene, new THREE.PlaneGeometry(200, 200), this.material(COLORS.floor, { roughness: 0.96, metalness: 0.05 }), V(0, -0.012, 0), [-Math.PI / 2, 0, 0]);
    ground.castShadow = false;
    this.grid = new THREE.GridHelper(10, 50, 0x2e5259, 0x1b3b44); this.grid.position.y = -0.006;
    this.grid.material.transparent = true; this.grid.material.opacity = 0.45; this.scene.add(this.grid);
    const stage = this.cylinder(this.scene, 1.28, 0.025, V(0, 0, -0.08), this.material(0x15363e, { roughness: 0.9 }), null);
    stage.castShadow = false;
    const ring = this.mesh(this.scene, new THREE.TorusGeometry(1.28, 0.003, 5, 128), this.material(0x365c62, { roughness: 1 }), V(0, 0.014, -0.08), [Math.PI / 2, 0, 0]);
    ring.castShadow = false;
  }

  makeG1() {
    const root = new THREE.Group(), model = new THREE.Group(); root.add(model);
    const labels = new THREE.Group(), path = new THREE.Group(), visibility = new THREE.Group(); root.add(labels, path, visibility);
    const silver = this.material(COLORS.silver, { metalness: 0.55, roughness: 0.3 });
    const shell = this.material(COLORS.ceramic, { metalness: 0.25 });
    const dark = this.material(COLORS.graphite, { metalness: 0.5, roughness: 0.4 });
    const black = this.material(COLORS.dark, { metalness: 0.3 });
    const teal = this.material(COLORS.teal, { emissive: 0x1b695a, emissiveIntensity: 0.5, roughness: 0.32 });
    const pad = this.material(0xe4c98c, { metalness: 0, roughness: 0.98 });
    const support = this.material(0x637f84, { metalness: 0.7, roughness: 0.45 });

    // The stand visibly supports the pelvis. The illustration is not a free-standing robot.
    this.box(model, [0.62, 0.055, 0.39], V(0, 0.05, 0.23), support, 0.035);
    this.box(model, [0.075, 0.83, 0.075], V(0, 0.48, 0.3), support, 0.01);
    this.box(model, [0.33, 0.095, 0.29], V(0, 0.91, 0.16), support, 0.035);
    this.box(model, [0.37, 0.16, 0.24], V(0, 0.94, 0), dark, 0.045);
    this.box(model, [0.29, 0.15, 0.20], V(0, 1.065, 0), silver, 0.025);
    this.cylinder(model, 0.087, 0.05, V(0, 1.16, 0), dark);
    this.box(model, [0.40, 0.35, 0.225], V(0, 1.34, -0.005), shell, 0.07);
    this.box(model, [0.20, 0.20, 0.035], V(0, 1.35, 0.13), dark, 0.025);
    for (let i = 0; i < 5; i++) this.box(model, [0.12, 0.009, 0.012], V(0, 1.30 + i * 0.024, 0.151), black, 0.002);
    this.box(model, [0.045, 0.013, 0.008], V(0, 1.46, 0.13), teal, 0.003);
    this.cylinder(model, 0.058, 0.08, V(0, 1.56, 0), dark);
    this.box(model, [0.205, 0.215, 0.185], V(0, 1.69, -0.01), shell, 0.065);
    this.box(model, [0.16, 0.07, 0.018], V(0, 1.71, -0.112), black, 0.02);
    for (const x of [-0.047, 0.047]) this.sphere(model, 0.012, V(x, 1.71, -0.124), teal);
    this.box(model, [0.055, 0.025, 0.018], V(0, 1.65, -0.113), dark, 0.008);
    for (const side of [-1, 1]) {
      const x = side * 0.105;
      this.cylinder(model, 0.077, 0.13, V(x, 0.86, 0), dark, [0, 0, Math.PI / 2]);
      this.link(model, V(x, 0.83, 0), V(x, 0.53, -0.02), 0.068, silver, 0.058);
      this.box(model, [0.115, 0.22, 0.08], V(x, 0.68, 0.052), shell, 0.03);
      this.cylinder(model, 0.065, 0.12, V(x, 0.49, -0.02), dark, [0, 0, Math.PI / 2]);
      this.link(model, V(x, 0.46, -0.02), V(x, 0.18, 0), 0.05, silver, 0.04);
      this.box(model, [0.095, 0.21, 0.07], V(x, 0.32, 0.045), shell, 0.02);
      this.cylinder(model, 0.044, 0.095, V(x, 0.15, 0), dark, [0, 0, Math.PI / 2]);
      this.box(model, [0.135, 0.075, 0.27], V(x, 0.09, -0.06), black, 0.025);
      this.box(model, [0.12, 0.02, 0.24], V(x, 0.045, -0.06), silver, 0.012);
    }

    const arms = [];
    for (const side of [-1, 1]) {
      const shoulder = V(side * 0.25, 1.45, -0.005), elbow = V(side * 0.40, 1.23, -0.18), hand = V(side * 0.36, 1.20, -0.51);
      const shoulderMesh = this.sphere(model, 0.079, shoulder, dark);
      this.cylinder(model, 0.065, 0.16, shoulder.clone(), shell, [0, 0, Math.PI / 2]);
      const upper = this.link(model, shoulder, elbow, 0.055, shell, 0.047);
      const elbowMesh = this.sphere(model, 0.055, elbow, dark);
      const lower = this.link(model, elbow, hand, 0.044, silver, 0.033);
      const wrist = this.sphere(model, 0.039, hand, dark);
      const palm = this.box(model, [0.082, 0.10, 0.055], hand.clone().add(V(0, 0, -0.035)), shell, 0.016);
      const sponge = this.box(model, [0.095, 0.115, 0.025], hand.clone().add(V(0, 0, -0.07)), pad, 0.008);
      const fingers = [];
      for (let i = 0; i < 4; i++) fingers.push(this.box(model, [0.012, 0.062, 0.018], hand.clone().add(V(-0.029 + i * 0.02, -0.032, -0.07)), dark, 0.004));
      const thumb = this.box(model, [0.018, 0.04, 0.022], hand.clone().add(V(side * 0.05, 0.005, -0.048)), dark, 0.005);
      arms.push({ side, shoulder, elbow, hand, upper, elbowMesh, lower, wrist, palm, sponge, fingers, thumb, shoulderMesh });
    }

    const wall = new THREE.Group(); root.add(wall);
    this.box(wall, [1.65, 1.24, 0.055], V(0, 1.34, -0.67), this.material(0x97aeb0, { roughness: 0.87 }), 0.035);
    this.box(wall, [1.55, 1.14, 0.014], V(0, 1.34, -0.633), this.material(0xccd7cf, { roughness: 0.72 }), 0.018);
    const standMat = this.material(0x3a5960, { metalness: 0.55 });
    for (const x of [-0.67, 0.67]) {
      this.box(wall, [0.035, 1.80, 0.045], V(x, 0.91, -0.70), standMat, 0.008);
      this.box(wall, [0.16, 0.045, 0.42], V(x, 0.045, -0.66), standMat, 0.015);
    }
    this.label(labels, 'SUPPORTED WALL CASE', V(0.16, 1.98, -0.64), { width: 0.68, height: 0.10, fontSize: 27 });
    this.label(labels, 'PELVIS SUPPORT', V(0.41, 0.78, 0.30), { width: 0.45, height: 0.09, fontSize: 29 });
    this.line(labels, [V(0.19, 0.80, 0.29), V(0.05, 0.91, 0.26)], COLORS.line, 0.8);
    const origin = V(0.36, 1.20, -0.611);
    const targets = {};
    const externalLabels = { A: [0.04, 1.54], B: [0.64, 1.24], C: [0.04, 1.15], D: [0.36, 1.68], E: [0.64, 1.45], F: [0.36, 0.94] };
    for (const [name, [dx, dy]] of Object.entries(OFFSETS)) {
      const pos = origin.clone().add(V(dx, dy, 0));
      const color = 'ABCD'.includes(name) ? COLORS.teal : name === 'E' ? COLORS.amber : COLORS.red;
      const mat = this.material(color, { roughness: 0.6, emissive: color, emissiveIntensity: 0.14, depthTest: false });
      const anchor = this.mesh(wall, new THREE.CircleGeometry(0.0045, 24), mat, pos);
      anchor.castShadow = false; anchor.renderOrder = 8;
      const ring = this.mesh(wall, new THREE.RingGeometry(0.007, 0.009, 32), mat, pos.clone().add(V(0, 0, 0.001)));
      ring.castShadow = false; ring.renderOrder = 8;
      const hit = this.mesh(wall, new THREE.SphereGeometry(0.009, 12, 8), this.material(color, { transparent: true, opacity: 0, depthWrite: false }), pos);
      hit.castShadow = false; hit.userData = { target: name, root }; this.pickables.push(hit);
      const [lx, ly] = externalLabels[name];
      const label = this.label(labels, name, V(lx, ly, -0.595), { width: 0.16, height: 0.13, fontSize: 58, compact: true, color: '#' + new THREE.Color(color).getHexString() });
      label.userData = { target: name, root }; this.pickables.push(label);
      const leader = this.line(labels, [pos.clone().add(V(0, 0, 0.002)), V(lx, ly, -0.603)], color, 0.42);
      leader.material.depthTest = false; leader.renderOrder = 7;
      targets[name] = { pos, anchor, ring, label, leader, color, mat };
    }
    this.label(labels, 'Markers to scale · labels offset', V(0.30, 0.79, -0.60), { width: 0.64, height: 0.08, fontSize: 24 });

    const orbitPath = [];
    for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2; orbitPath.push(origin.clone().add(V(Math.cos(a) * 0.052, Math.sin(a) * 0.052, 0.006))); }
    const wipePath = this.line(path, orbitPath, COLORS.teal, 0.6, true);
    wipePath.material.depthTest = false; wipePath.renderOrder = 6;
    const previewDot = this.sphere(path, 0.009, origin.clone(), teal); previewDot.visible = false;
    const cameraModel = this.makeCamera(visibility, V(0.02, 1.54, 0.87), origin, 0.24, 0.20);
    this.label(visibility, 'VIEWING CONE · SCHEMATIC', V(0.50, 1.76, 0.82), { width: 0.64, height: 0.08, fontSize: 23 });
    const gesture = this.makeHand(root, V(-0.88, 1.32, 0.02)); gesture.visible = false;
    const forceArrow = new THREE.ArrowHelper(V(0, 0, -1), V(0.36, 1.20, -0.33), 0.24, COLORS.amber, 0.045, 0.025); path.add(forceArrow);
    const forceLabel = this.label(path, '7 N request', V(0.67, 1.06, -0.20), { width: 0.32, height: 0.085, color: '#f2c879', fontSize: 32 });
    this.tagModel(model, 'G1', root);
    return { root, model, labels, path, visibility, targets, origin, arms, wipePath, previewDot, cameraModel, gesture, forceArrow, forceLabel };
  }

  makeHand(parent, position) {
    const hand = new THREE.Group(); hand.position.copy(position); parent.add(hand);
    const m = this.material(0xe2b88e, { roughness: 0.67, metalness: 0 });
    this.box(hand, [0.095, 0.14, 0.043], V(0, 0, 0), m, 0.021);
    for (let i = 0; i < 4; i++) this.box(hand, [0.018, i === 0 ? 0.13 : 0.07, 0.02], V(-0.035 + i * 0.022, i === 0 ? 0.12 : 0.07, 0), m, 0.006);
    const thumb = this.box(hand, [0.025, 0.073, 0.028], V(-0.067, 0.005, 0), m, 0.008); thumb.rotation.z = -0.8;
    return hand;
  }

  makeCamera(parent, position, target, width, height) {
    const g = new THREE.Group(); g.position.copy(position); g.lookAt(target); parent.add(g);
    this.box(g, [0.12, 0.085, 0.07], V(0, 0, 0), this.material(COLORS.graphite), 0.012);
    this.cylinder(g, 0.028, 0.04, V(0, 0, 0.045), this.material(COLORS.dark), [Math.PI / 2, 0, 0]);
    const corners = [V(target.x - width, target.y - height, target.z), V(target.x + width, target.y - height, target.z), V(target.x + width, target.y + height, target.z), V(target.x - width, target.y + height, target.z)];
    corners.forEach(c => this.line(parent, [position, c], COLORS.blue, 0.37, true));
    this.line(parent, [...corners, corners[0]], COLORS.blue, 0.6);
    const positions = [];
    for (let i = 0; i < 4; i++) positions.push(...position.toArray(), ...corners[i].toArray(), ...corners[(i + 1) % 4].toArray());
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals();
    this.mesh(parent, geometry, this.material(COLORS.blue, { transparent: true, opacity: 0.045, side: THREE.DoubleSide, depthWrite: false }));
    return g;
  }

  makeArmCase(name) {
    const root = new THREE.Group(), model = new THREE.Group(); root.add(model);
    const labels = new THREE.Group(), path = new THREE.Group(), visibility = new THREE.Group(); root.add(labels, path, visibility);
    const metal = this.material(0xc7d0ce, { metalness: 0.65, roughness: 0.25 });
    const blue = this.material(name === 'UR3' ? 0x609cba : 0x498bac, { metalness: 0.2, roughness: 0.34 });
    const graphite = this.material(0x263e45, { metalness: 0.55 });
    const table = this.material(0xb2aa89, { metalness: 0.06, roughness: 0.86 });
    this.box(root, [1.55, 0.075, 1.08], V(0, 0.76, 0), table, 0.035);
    const legMat = this.material(0x365159, { metalness: 0.72 });
    for (const x of [-0.64, 0.64]) for (const z of [-0.40, 0.40]) this.box(root, [0.052, 0.69, 0.052], V(x, 0.38, z), legMat, 0.007);
    this.box(root, [1.33, 0.045, 0.045], V(0, 0.16, -0.40), legMat, 0.006);
    const origin = V(-0.37, 0.81, 0.03);
    this.cylinder(model, 0.115, 0.06, origin, graphite);
    this.cylinder(model, 0.088, 0.16, origin.clone().add(V(0, 0.09, 0)), metal);
    const shoulder = origin.clone().add(V(0, 0.19, 0)), elbow = V(-0.36, 1.47, -0.04), wrist1 = V(0.18, 1.37, -0.09), wrist2 = V(0.27, 1.25, -0.10), tip = V(0.36, 1.21, -0.12);
    const baseJoint = this.cylinder(model, 0.092, 0.16, shoulder, blue, [Math.PI / 2, 0, 0]);
    const upper = this.link(model, shoulder, elbow, 0.06, metal, 0.055);
    const elbowMesh = this.cylinder(model, 0.075, 0.14, elbow, blue, [Math.PI / 2, 0, 0]);
    const forearm = this.link(model, elbow, wrist1, 0.05, metal, 0.045);
    const wrist1Mesh = this.cylinder(model, 0.063, 0.12, wrist1, blue, [Math.PI / 2, 0, 0]);
    const wristLink = this.link(model, wrist1, wrist2, 0.038, metal);
    const wrist2Mesh = this.cylinder(model, 0.051, 0.10, wrist2, blue, [0, 0, Math.PI / 2]);
    const toolLink = this.link(model, wrist2, tip, 0.032, metal);
    const tool = new THREE.Group(); tool.position.copy(tip); model.add(tool);
    this.box(tool, [0.10, 0.055, 0.065], V(0, -0.028, 0), graphite, 0.015);
    const fingers = [];
    for (const sign of [-1, 1]) {
      fingers.push(this.box(tool, [0.018, 0.085, 0.025], V(sign * 0.047, -0.088, 0), graphite, 0.006));
      this.box(tool, [0.034, 0.014, 0.025], V(sign * 0.032, -0.13, 0), graphite, 0.004);
    }
    const statusLight = this.sphere(model, 0.012, origin.clone().add(V(0.07, 0.05, 0.06)), this.material(COLORS.teal, { emissive: COLORS.teal, emissiveIntensity: 1 }));
    const arm = { shoulder, elbow, wrist1, wrist2, tip, upper, elbowMesh, forearm, wrist1Mesh, wristLink, wrist2Mesh, toolLink, tool, fingers, baseJoint, statusLight };
    this.label(labels, name + ' · HARDWARE CASE', V(-0.05, 1.80, 0), { width: 0.62, height: 0.10, fontSize: 28 });
    let cubes = [], scanner = null, boardRegion = null, hand = null;
    if (name === 'UR3') {
      const cubeSpecs = [[-0.05, 0x3c84a5, 'BLUE'], [0.20, 0xd4ad50, 'YELLOW'], [0.45, 0xae605b, 'RED']];
      for (const [x, color, label] of cubeSpecs) {
        const cube = this.box(root, [0.09, 0.09, 0.09], V(x, 0.846, 0.30), this.material(color, { roughness: 0.57 }), 0.007);
        cubes.push(cube);
        const ring = this.mesh(path, new THREE.RingGeometry(0.076, 0.079, 40), this.material(color, { transparent: true, opacity: 0.8, side: THREE.DoubleSide }), V(x, 0.806, 0.30), [-Math.PI / 2, 0, 0]); ring.castShadow = false;
      }
      this.label(labels, 'REGISTERED CUBES', V(0.24, 0.69, 0.67), { width: 0.50, height: 0.085, fontSize: 28 });
      this.box(root, [0.17, 0.045, 0.12], V(-0.58, 0.82, 0.33), graphite, 0.01);
      this.cylinder(root, 0.036, 0.034, V(-0.58, 0.85, 0.33), this.material(COLORS.red, { roughness: 0.6 }));
      this.label(labels, 'STOP', V(-0.61, 0.99, 0.38), { width: 0.17, height: 0.07, color: '#f6a79d', fontSize: 36 });
      hand = this.makeHand(root, V(0.85, 1.06, 0.18)); hand.rotation.z = -Math.PI / 4; hand.visible = false;
      const route = new THREE.CatmullRomCurve3([tip, V(0.20, 1.15, 0.20), V(0.20, 0.99, 0.30), V(0.38, 1.21, 0.22), V(0.66, 1.1, 0.22)]);
      this.line(path, route.getPoints(64), COLORS.teal, 0.65, true);
      this.label(path, 'ILLUSTRATIVE ROUTE', V(0.38, 1.47, 0.30), { width: 0.48, height: 0.075, fontSize: 25 });
      this.makeCamera(visibility, V(0, 1.70, 0.58), V(0.20, 0.82, 0.22), 0.52, 0.12);
    } else {
      this.box(root, [1.14, 0.78, 0.055], V(0.22, 1.21, -0.46), this.material(0x718e96, { metalness: 0.6 }), 0.025);
      this.box(root, [1.06, 0.70, 0.014], V(0.22, 1.21, -0.421), this.material(0xdde2d7, { roughness: 0.55 }), 0.009);
      const targetMat = this.material(0xe2bc5c, { roughness: 0.65 });
      const cx = 0.35, cy = 1.23, z = -0.40;
      for (const sign of [-1, 1]) { this.box(root, [0.43, 0.012, 0.004], V(cx, cy + sign * 0.20, z), targetMat); this.box(root, [0.012, 0.40, 0.004], V(cx + sign * 0.215, cy, z), targetMat); }
      const marks = new THREE.Group(); root.add(marks);
      for (let i = 0; i < 4; i++) {
        const mark = this.box(marks, [0.11, 0.017, 0.005], V(0.30 + (i % 2) * 0.11, 1.16 + Math.floor(i / 2) * 0.12, -0.389), this.material(0xc05b56, { roughness: 0.9 }), 0.005); mark.rotation.z = -0.5 + i * 0.28;
      }
      boardRegion = this.mesh(path, new THREE.PlaneGeometry(0.41, 0.38), this.material(COLORS.teal, { transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }), V(cx, cy, -0.386)); boardRegion.castShadow = false;
      this.line(path, [V(cx - 0.22, cy - 0.21, z + 0.02), V(cx + 0.22, cy - 0.21, z + 0.02), V(cx + 0.22, cy + 0.21, z + 0.02), V(cx - 0.22, cy + 0.21, z + 0.02), V(cx - 0.22, cy - 0.21, z + 0.02)], COLORS.teal, 0.9);
      scanner = this.line(path, [V(cx - 0.205, cy, -0.375), V(cx + 0.205, cy, -0.375)], COLORS.teal, 1); scanner.visible = false;
      this.label(labels, 'TAPED TARGET REGION', V(0.31, 1.72, -0.42), { width: 0.60, height: 0.08, fontSize: 28 });
      this.label(labels, 'DETECTION PROFILE', V(0.33, 0.83, -0.28), { width: 0.54, height: 0.08, fontSize: 29 });
      this.makeCamera(visibility, V(-0.63, 1.35, 0.37), V(cx, cy, z), 0.26, 0.24);
    }
    this.tagModel(model, name, root);
    return { root, model, labels, path, visibility, arm, cubes, scanner, boardRegion, hand };
  }

  tagModel(model, robot, root) {
    model.traverse(item => { if (item.isMesh) { item.userData = { robot, root }; this.pickables.push(item); } });
  }

  makeTooltip() {
    this.tooltip = document.createElement('div');
    this.tooltip.hidden = true;
    this.tooltip.style.cssText = 'position:absolute;z-index:8;pointer-events:none;background:rgba(9,29,36,.94);color:#e3f3ee;padding:8px 11px;border:1px solid #41616a;border-radius:8px;font:500 12px system-ui,sans-serif;white-space:nowrap;box-shadow:0 8px 30px #0004;';
    if (getComputedStyle(this.container).position === 'static') this.container.style.position = 'relative';
    this.container.appendChild(this.tooltip);
  }

  showTooltip(text, event) {
    if (!text) { this.tooltip.hidden = true; return; }
    const rect = this.container.getBoundingClientRect();
    this.tooltip.textContent = text; this.tooltip.hidden = false;
    this.tooltip.style.left = Math.max(8, Math.min(rect.width - 205, event.clientX - rect.left + 14)) + 'px';
    this.tooltip.style.top = Math.max(8, event.clientY - rect.top - 42) + 'px';
  }

  pick(event) {
    if (!this.renderer || this.disposed) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const active = this.pickables.filter(mesh => mesh.userData.root?.visible && mesh.visible && (!mesh.isSprite || this.layers.labels));
    const hits = this.raycaster.intersectObjects(active, false);
    // Prefer a location marker to a model part underneath its screen-space label.
    return (hits.find(h => h.object.userData.target) || hits[0])?.object.userData || null;
  }

  setRobot(robot) {
    if (this.disposed || !this.cases?.[robot]) return;
    const changed = this.robot !== robot;
    this.robot = robot;
    Object.entries(this.cases).forEach(([name, record]) => { record.root.visible = name === robot; });
    if (changed) { this.playing = false; this.setProgress(0); this.setCamera('overview'); }
    this.updateLayerVisibility(); this.dirty = true;
  }

  setTarget(target) {
    if (this.disposed || !OFFSETS[target]) return;
    const changed = this.target !== target;
    this.target = target;
    if (changed) { this.playing = false; this.setProgress(0); }
    this.updateTargets(); this.updatePreview(); this.dirty = true;
  }

  updateTargets() {
    if (this.disposed || !this.cases?.G1) return;
    const record = this.cases.G1;
    for (const [name, target] of Object.entries(record.targets)) {
      const selected = name === this.target, hovered = name === this.hovered;
      target.ring.scale.setScalar(selected ? 1.5 : hovered ? 1.3 : 1);
      target.mat.emissiveIntensity = selected ? 0.9 : hovered ? 0.6 : 0.13;
      target.leader.material.opacity = selected ? 0.95 : hovered ? 0.8 : 0.35;
      target.label.material.opacity = selected || hovered ? 1 : 0.8;
    }
    const [dx, dy] = OFFSETS[this.target];
    record.wipePath.position.set(dx, dy, 0);
    this.dirty = true;
  }

  setDecision(decision) {
    if (this.disposed) return;
    this.decision = typeof decision === 'string' ? decision : decision?.decision || decision?.result?.decision || null;
    if (this.decision !== 'SELECT') {
      this.playing = false; this.progress = 0;
      this.updatePreview(); this.emitProgress();
    }
    const color = STATUS_COLOR[this.decision] || COLORS.teal;
    const record = this.cases?.[this.robot];
    if (record?.arm) { record.arm.statusLight.material.color.setHex(color); record.arm.statusLight.material.emissive.setHex(color); }
    this.dirty = true;
  }

  setForce(force, label = null) {
    if (this.disposed || (force !== null && (typeof force !== 'number' || !Number.isFinite(force)))) return;
    if (label !== null && typeof label !== 'string') return;
    this.force = force;
    const caption = label?.trim() || (force === null ? 'No force setting selected' : `${force.toLocaleString(undefined, { maximumFractionDigits: 2 })} N request`);
    const record = this.cases?.G1;
    if (!record) return;
    const old = record.forceLabel;
    record.path.remove(old);
    const texture = old.material.map;
    texture?.dispose(); old.material.dispose();
    this.textures = this.textures.filter(item => item !== texture);
    this.materials = this.materials.filter(item => item !== old.material);
    record.forceLabel = this.label(record.path, caption.slice(0, 72), V(0.67, 1.06, -0.20), { width: caption.length > 16 ? 0.57 : 0.36, height: 0.085, color: '#f2c879', fontSize: caption.length > 30 ? 24 : 30 });
    // A range has no single force arrow. Its label states the accepted range.
    // A numeric arrow keeps a fixed length; it never depicts a measured force.
    this.updatePreview(); this.dirty = true;
  }

  setLayer(name, enabled) {
    if (this.disposed) return;
    const aliases = { vision: 'visibility', frustum: 'visibility', camera: 'visibility', targets: 'labels' };
    name = aliases[name] || name;
    if (!Object.hasOwn(this.layers, name)) return;
    this.layers[name] = Boolean(enabled); this.updateLayerVisibility(); this.dirty = true;
  }

  updateLayerVisibility() {
    if (!this.cases) return;
    for (const record of Object.values(this.cases)) {
      record.labels.visible = this.layers.labels;
      record.path.visible = this.layers.path;
      record.visibility.visible = this.layers.visibility;
    }
    if (this.grid) this.grid.visible = this.layers.grid;
  }

  setCamera(name = 'overview') {
    if (this.disposed || !this.camera || !this.controls) return;
    const presets = this.robot === 'G1' ? {
      overview: [V(2.55, 2.0, 3.35), V(-0.02, 1.02, -0.16)],
      front: [V(-0.22, 1.45, 3.2), V(-0.10, 1.12, -0.45)],
      top: [V(0.03, 4.0, 0.6), V(0, 0.80, -0.28)],
      robot: [V(0.12, 1.73, -0.18), V(0.36, 1.22, -0.64)]
    } : {
      overview: [V(2.45, 2.05, 3.1), V(0, 1.02, -0.05)],
      front: [V(0, 1.47, 3.0), V(0, 1.06, -0.1)],
      top: [V(0.04, 3.8, 0.35), V(0, 0.78, 0)],
      robot: [V(-0.95, 1.64, 0.63), V(0.25, 1.1, -0.20)]
    };
    const p = presets[name] || presets.overview;
    this.controls.minDistance = name === 'robot' ? 0.10 : 1.2;
    if (this.reducedMotion) { this.camera.position.copy(p[0]); this.controls.target.copy(p[1]); this.controls.update(); }
    else this.cameraTween = { from: this.camera.position.clone(), targetFrom: this.controls.target.clone(), to: p[0], targetTo: p[1], elapsed: 0, duration: 0.7 };
    this.dirty = true;
  }

  setPlaying(playing) {
    if (this.disposed || !this.cases) return;
    if (playing && this.decision !== 'SELECT') {
      this.playing = false; this.setProgress(0);
      this.container.dispatchEvent(new CustomEvent('scene-preview-blocked', { detail: { reason: 'Select a supported option in the planner before previewing its illustrative workflow.' } }));
      return;
    }
    if (playing && this.robot === 'G1' && ['E', 'F'].includes(this.target)) {
      this.playing = false; this.setProgress(0);
      this.container.dispatchEvent(new CustomEvent('scene-preview-blocked', { detail: { target: this.target, reason: this.target === 'E' ? 'E was refused before wiping because the target was hidden. No wipe is animated.' : 'F failed the offline joint-margin screen and was not run. No wipe is animated.' } }));
      return;
    }
    this.playing = Boolean(playing);
    if (this.playing && this.progress >= 1) this.setProgress(0);
    this.lastTime = 0; this.dirty = true; this.emitProgress();
  }

  setProgress(progress) {
    if (this.disposed || !Number.isFinite(Number(progress))) return;
    if (this.decision !== 'SELECT') { progress = 0; this.playing = false; }
    if (this.robot === 'G1' && ['E', 'F'].includes(this.target)) progress = 0;
    this.progress = clamp(Number(progress));
    this.updatePreview(); this.emitProgress(); this.dirty = true;
  }

  phaseInfo() {
    if (this.robot === 'UR5') return this.progress < 0.18 ? ['observe', 'Observe the taped region'] : this.progress < 0.76 ? ['detect', 'Illustrative region scan'] : ['record', 'Detection result available'];
    if (this.robot === 'UR3') return this.progress < 0.18 ? ['confirm', 'Request and confirmation'] : this.progress < 0.46 ? ['approach', 'Approach the registered cube'] : this.progress < 0.78 ? ['handover', 'Illustrative handover'] : ['hold', 'Wait for the operator'];
    if (['E', 'F'].includes(this.target)) return ['not-run', 'No wiping preview at this location'];
    return this.progress < 0.18 ? ['confirm', 'Point and confirm'] : this.progress < 0.36 ? ['approach', 'Approach the wall'] : this.progress < 0.82 ? ['wipe', 'Illustrative circular wipe'] : ['hold', 'Hold the final position'];
  }

  emitProgress() {
    const [phase, label] = this.phaseInfo();
    this.container.dispatchEvent(new CustomEvent('scene-progress', { detail: { progress: this.progress, phase, label, playing: this.playing } }));
    this.callbacks.onProgress?.({ progress: this.progress, phase, label, playing: this.playing });
  }

  updatePreview() {
    if (this.disposed || !this.cases?.[this.robot]) return;
    const p = this.progress;
    if (this.robot === 'G1') {
      const r = this.cases.G1, offsets = OFFSETS[this.target];
      const supported = !['E', 'F'].includes(this.target);
      const base = V(0.36, 1.20, -0.51), goal = base.clone().add(V(offsets[0], offsets[1], 0));
      const approach = smooth((p - 0.18) / 0.18);
      const pos = lerp(base, goal.clone().add(V(0.052, 0, 0)), approach);
      const wipe = clamp((p - 0.36) / 0.46);
      if (p >= 0.36 && supported) pos.copy(goal).add(V(Math.cos(wipe * Math.PI * 2) * 0.052, Math.sin(wipe * Math.PI * 2) * 0.052, 0));
      const arm = r.arms[1];
      this.updateG1Arm(arm, pos);
      r.gesture.visible = supported && p > 0 && p < 0.19;
      r.gesture.rotation.z = p < 0.09 ? -0.7 : -0.1;
      r.previewDot.visible = supported && p > 0.36;
      r.previewDot.position.copy(pos).add(V(0, 0, -0.10));
      r.wipePath.visible = supported;
      r.forceArrow.position.copy(pos).add(V(0, 0, 0.18));
      r.forceArrow.visible = supported && this.force !== null;
      r.forceLabel.visible = supported;
    } else {
      const r = this.cases[this.robot], a = r.arm;
      if (this.robot === 'UR3') {
        const down = smooth((p - 0.18) / 0.22), move = smooth((p - 0.46) / 0.30);
        const tip = lerp(a.tip, V(0.20, 1.03, 0.30), down).lerp(V(0.67, 1.19, 0.20), move);
        const elbow = a.elbow.clone().add(V(move * 0.12, -down * 0.08 + move * 0.10, move * 0.10));
        const wrist1 = tip.clone().add(V(-0.16, 0.14, -0.06));
        const wrist2 = tip.clone().add(V(-0.08, 0.06, -0.02));
        this.updateIndustrialArm(a, elbow, wrist1, wrist2, tip);
        const cube = r.cubes[1];
        cube.position.copy(p >= 0.46 ? tip.clone().add(V(0, -0.16, 0)) : V(0.20, 0.846, 0.30));
        r.hand.visible = p >= 0.70;
      } else {
        r.scanner.visible = p > 0.18 && p < 0.82;
        r.scanner.position.y = p > 0.18 ? Math.sin((p - 0.18) / 0.64 * Math.PI * 3) * 0.18 : 0;
        r.boardRegion.material.opacity = p > 0.76 ? 0.28 : 0.12;
      }
    }
    this.dirty = true;
  }

  updateG1Arm(arm, hand) {
    const dx = hand.x - arm.hand.x, dy = hand.y - arm.hand.y;
    const elbow = arm.elbow.clone().add(V(dx * 0.45, dy * 0.42, 0));
    this.placeLink(arm.upper, arm.shoulder, elbow); arm.elbowMesh.position.copy(elbow);
    this.placeLink(arm.lower, elbow, hand); arm.wrist.position.copy(hand);
    arm.palm.position.copy(hand).add(V(0, 0, -0.035));
    arm.sponge.position.copy(hand).add(V(0, 0, -0.07));
    arm.fingers.forEach((finger, i) => finger.position.copy(hand).add(V(-0.029 + i * 0.02, -0.032, -0.07)));
    arm.thumb.position.copy(hand).add(V(arm.side * 0.05, 0.005, -0.048));
  }

  updateIndustrialArm(a, elbow, wrist1, wrist2, tip) {
    this.placeLink(a.upper, a.shoulder, elbow); a.elbowMesh.position.copy(elbow);
    this.placeLink(a.forearm, elbow, wrist1); a.wrist1Mesh.position.copy(wrist1);
    this.placeLink(a.wristLink, wrist1, wrist2); a.wrist2Mesh.position.copy(wrist2);
    this.placeLink(a.toolLink, wrist2, tip); a.tool.position.copy(tip);
  }

  resize() {
    if (!this.renderer || this.disposed) return;
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height, false); this.dirty = true;
  }

  animate(time) {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(t => this.animate(t));
    if (document.hidden || this.container.clientHeight < 2 || this.container.clientWidth < 2) { this.lastTime = 0; return; }
    const delta = this.lastTime ? Math.min(0.05, (time - this.lastTime) / 1000) : 0; this.lastTime = time;
    if (this.cameraTween) {
      const tween = this.cameraTween; tween.elapsed += delta;
      const f = smooth(tween.elapsed / tween.duration);
      this.camera.position.copy(tween.from).lerp(tween.to, f);
      this.controls.target.copy(tween.targetFrom).lerp(tween.targetTo, f);
      if (f >= 1) this.cameraTween = null;
      this.dirty = true;
    }
    if (this.playing && this.decision !== 'SELECT') { this.playing = false; this.setProgress(0); }
    if (this.playing) {
      this.progress = Math.min(1, this.progress + delta / (this.robot === 'UR5' ? 9 : 16));
      if (this.progress >= 1) this.playing = false;
      this.updatePreview(); this.emitProgress(); this.dirty = true;
    }
    this.controls.update();
    if (this.dirty) { this.renderer.render(this.scene, this.camera); this.dirty = false; }
  }

  dispose() {
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility);
    const canvas = this.renderer?.domElement;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.onPointerDown);
      canvas.removeEventListener('pointerup', this.onPointerUp);
      canvas.removeEventListener('pointermove', this.onPointerMove);
      canvas.removeEventListener('pointerleave', this.onPointerLeave);
      canvas.removeEventListener('webglcontextlost', this.onContextLost);
    }
    this.controls?.dispose();
    this.scene?.traverse(item => { item.geometry?.dispose(); });
    this.materials?.forEach(m => m.dispose()); this.textures?.forEach(t => t.dispose());
    this.renderer?.dispose(); canvas?.remove(); this.tooltip?.remove();
  }
}

function callbacksSafe(callback, value) { if (typeof callback === 'function') callback(value); }
