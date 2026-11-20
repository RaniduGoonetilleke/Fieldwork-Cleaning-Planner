import * as THREE from './lib/three.module.js';
import { GLTFLoader } from './lib/GLTFLoader.js';

const MODELS = Object.freeze({
  UR3: { asset: './models/ur3.glb', label: 'UR3 robot arm', rotation: 1.1, height: 1.5 },
  UR5: { asset: './models/ur5.glb', label: 'UR5 robot arm', rotation: 1.1, height: 1.7 },
  G1: { asset: './models/g1.glb', label: 'G1 humanoid robot', rotation: -Math.PI / 2, height: 1.8 },
  H1: { asset: './models/people/worker-man.glb', label: 'Example robot helper', rotation: Math.PI + .10, height: 1.9 },
  H2: { asset: './models/people/worker-woman.glb', label: 'Example cleaner', rotation: Math.PI + .10, height: 1.9 }
});

const WIDTH = 640, HEIGHT = 480;
const FRAME_INTERVAL = 1000 / 24;
const RADIANS_PER_SECOND = 2 * Math.PI / 25;
const loader = new GLTFLoader();
const assets = new Map(), views = new Set(), angles = new Map();
let renderer = null, unavailable = false, frame = null, lastPaint = -Infinity;
let motionQuery = null, environmentListening = false;

function disposeObject(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    const local = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
    local.forEach(material => {
      materials.add(material);
      Object.values(material).forEach(value => { if (value?.isTexture) textures.add(value); });
    });
    if (object.skeleton?.boneTexture) textures.add(object.skeleton.boneTexture);
    object.shadow?.map?.dispose();
    object.shadow?.mapPass?.dispose();
  });
  textures.forEach(texture => { texture.dispose(); texture.source?.data?.close?.(); });
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
}

function acquireAsset(id) {
  let entry = assets.get(id);
  if (!entry) {
    entry = {refs: 0, asset: null, abandoned: false};
    entry.promise = loader.loadAsync(new URL(MODELS[id].asset, import.meta.url).href).then(asset => {
      if (entry.abandoned) { disposeObject(asset.scene); throw new Error('Portrait closed.'); }
      entry.asset = asset;
      return asset;
    });
    assets.set(id, entry);
  }
  entry.refs++;
  return entry;
}

function releaseAsset(id, entry) {
  entry.refs--;
  // A card rebuilt in the same render can reuse its model and current angle.
  queueMicrotask(() => {
    if (entry.refs || assets.get(id) !== entry) return;
    assets.delete(id);
    entry.abandoned = true;
    if (entry.asset) disposeObject(entry.asset.scene);
  });
}

function failRenderer() {
  unavailable = true;
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  for (const view of views) {
    view.failed = true;
    view.canvas.dataset.motion = 'paused';
    if (!view.painted) view.image.dataset.portrait = 'fallback';
  }
  releaseRenderer();
}

function onContextLost(event) { event.preventDefault(); failRenderer(); }

function getRenderer() {
  if (unavailable) throw new Error('Static illustrations remain available.');
  if (renderer) return renderer;
  try {
    renderer = new THREE.WebGLRenderer({alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power'});
    renderer.setPixelRatio(1);
    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    return renderer;
  } catch (error) { failRenderer(); throw error; }
}

function releaseRenderer() {
  if (!renderer) return;
  renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
  renderer.renderLists.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  renderer.domElement.width = renderer.domElement.height = 1;
  renderer = null;
}

function armRadii(model, footHeight) {
  const point = new THREE.Vector3();
  let radius = 0, footRadius = 0;
  model.traverse(object => {
    const position = object.geometry?.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      const distance = Math.hypot(point.x, point.z);
      radius = Math.max(radius, distance);
      if (point.y <= footHeight) footRadius = Math.max(footRadius, distance);
    }
  });
  return {radius, footRadius};
}

function buildScene(view, asset) {
  const config = MODELS[view.id], scene = new THREE.Scene();
  const arm = view.id.startsWith('UR');
  const model = asset.scene.clone(true);
  model.rotation.y = config.rotation;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  model.scale.multiplyScalar(config.height / Math.max(.01, box.getSize(new THREE.Vector3()).y));
  model.updateMatrixWorld(true);
  box.setFromObject(model, true);
  // These arm models use the mount origin. Keep that origin under the plinth.
  const centre = arm ? new THREE.Vector3().applyMatrix4(model.matrixWorld) : box.getCenter(new THREE.Vector3());
  model.position.x -= centre.x;
  model.position.z -= centre.z;
  model.position.y += (arm ? .09 : .11) - box.min.y;
  model.traverse(object => {
    if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; }
  });
  const pivot = new THREE.Group();
  pivot.add(model);
  scene.add(pivot);
  pivot.updateMatrixWorld(true);
  const upright = new THREE.Box3().setFromObject(model, true);
  const size = upright.getSize(new THREE.Vector3());
  const armSize = arm ? armRadii(model, .09 + config.height * .025) : null;
  const radius = arm ? armSize.radius : Math.hypot(size.x / 2, size.z / 2);
  const platformSide = arm ? Math.max(.68, 2 * (armSize.footRadius + .07)) : 0;
  const platformRadius = .44;
  const platformGeometry = arm ? new THREE.BoxGeometry(platformSide, .09, platformSide) : new THREE.CylinderGeometry(platformRadius, platformRadius + .04, .09, 64);
  const platform = new THREE.Mesh(platformGeometry, new THREE.MeshStandardMaterial({color: 0x275f5b, metalness: .22, roughness: .46}));
  platform.position.y = .045;
  platform.receiveShadow = true;
  scene.add(platform);
  let ring;
  if (arm) {
    const half = platformSide / 2;
    const outline = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-half, .091, -half), new THREE.Vector3(half, .091, -half),
      new THREE.Vector3(half, .091, half), new THREE.Vector3(-half, .091, half)
    ]);
    ring = new THREE.LineLoop(outline, new THREE.LineBasicMaterial({color: 0x6ad9c8, toneMapped: false}));
  } else {
    ring = new THREE.Mesh(new THREE.TorusGeometry(platformRadius + .015, .012, 6, 64), new THREE.MeshBasicMaterial({color: 0x6ad9c8, toneMapped: false}));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = .085;
  }
  scene.add(ring);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({opacity: .17}));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -.005;
  shadow.receiveShadow = true;
  scene.add(shadow, new THREE.HemisphereLight(0xf4fcff, 0x6a8b81, 2.7));
  const key = new THREE.DirectionalLight(0xfff2df, 3.4);
  key.position.set(3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  Object.assign(key.shadow.camera, {left: -3, right: 3, top: 3, bottom: -3, near: .1, far: 12});
  key.shadow.normalBias = .02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9cdeed, 2.3);
  rim.position.set(-3, 2, -3);
  scene.add(rim);

  // A full-turn envelope keeps extended arms inside the same fixed camera view.
  const envelopeRadius = Math.max(radius, arm ? platformSide / Math.sqrt(2) : platformRadius + .04);
  const top = Math.max(upright.max.y, .1), bottom = -.03;
  const elevation = Math.atan2(.65, 5);
  const verticalSpan = (top - bottom) * Math.cos(elevation) + 2 * envelopeRadius * Math.sin(elevation);
  const height = Math.max(verticalSpan * 1.15, 2 * envelopeRadius * 1.15 / (WIDTH / HEIGHT), 1.8);
  const camera = new THREE.OrthographicCamera(-height * WIDTH / HEIGHT / 2, height * WIDTH / HEIGHT / 2, height / 2, -height / 2, .01, 30);
  const target = new THREE.Vector3(0, (top + bottom) / 2, 0);
  camera.position.copy(target).add(new THREE.Vector3(0, .65, 5));
  camera.lookAt(target);
  view.scene = scene;
  view.pivot = pivot;
  view.model = model;
  view.camera = camera;
  view.ready = true;
  view.dirty = true;
  pivot.rotation.y = angles.get(view.id) || 0;
}

function moving(view) {
  return view.robot && !view.failed && (view.selected || view.hovered) && !document.hidden && !motionQuery?.matches;
}

function wanted(view) { return view.ready && !view.failed && (view.dirty || moving(view)); }

function requestPaint() {
  if (!document.hidden && !unavailable && [...views].some(wanted)) {
    if (frame === null) frame = requestAnimationFrame(paint);
  } else if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
}

function paint(timestamp) {
  frame = null;
  if (document.hidden || unavailable) return;
  if (timestamp - lastPaint < FRAME_INTERVAL) { requestPaint(); return; }
  lastPaint = timestamp;
  try {
    for (const view of views) {
      const active = moving(view);
      view.canvas.dataset.motion = active ? 'running' : motionQuery?.matches ? 'reduced' : 'paused';
      if (!active) view.lastTime = null;
      if (!wanted(view)) continue;
      if (active && view.lastTime !== null) {
        const delta = Math.min(.1, Math.max(0, (timestamp - view.lastTime) / 1000));
        view.pivot.rotation.y = (view.pivot.rotation.y + delta * RADIANS_PER_SECOND) % (2 * Math.PI);
        angles.set(view.id, view.pivot.rotation.y);
      }
      if (active) view.lastTime = timestamp;
      const shared = getRenderer();
      shared.render(view.scene, view.camera);
      view.context.clearRect(0, 0, WIDTH, HEIGHT);
      view.context.drawImage(shared.domElement, 0, 0, WIDTH, HEIGHT);
      view.canvas.style.display = 'block';
      view.image.style.display = 'none';
      view.canvas.dataset.portrait = 'model';
      view.canvas.dataset.yaw = view.pivot.rotation.y.toFixed(5);
      view.painted = true;
      view.dirty = false;
    }
  } catch { failRenderer(); }
  requestPaint();
}

function environmentChanged() {
  for (const view of views) {
    view.lastTime = null;
    view.canvas.dataset.motion = moving(view) ? 'running' : motionQuery?.matches ? 'reduced' : 'paused';
  }
  requestPaint();
}

function listenEnvironment() {
  if (environmentListening) return;
  motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
  motionQuery?.addEventListener('change', environmentChanged);
  document.addEventListener('visibilitychange', environmentChanged);
  environmentListening = true;
}

function releaseEnvironment() {
  if (views.size) return;
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  motionQuery?.removeEventListener('change', environmentChanged);
  document.removeEventListener('visibilitychange', environmentChanged);
  environmentListening = false;
  motionQuery = null;
  releaseRenderer();
}

/** Show a resource model. Robot cards turn only while hovered or selected. */
export function mountPortrait(container, id, {interactionElement = container, selected = false} = {}) {
  const config = MODELS[id];
  if (!container || !config) return Object.assign(() => {}, {setSelected() {}});
  const image = document.createElement('img');
  image.className = 'resource-portrait-image';
  image.alt = `${config.label} illustration`;
  image.width = WIDTH;
  image.height = HEIGHT;
  image.decoding = 'async';
  image.draggable = false;
  image.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;pointer-events:none;user-select:none;';
  image.src = new URL(`./assets/resource-${id.toLowerCase()}.svg`, import.meta.url).href;
  image.dataset.portrait = 'illustration';
  const canvas = document.createElement('canvas');
  canvas.className = 'resource-portrait-image';
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.style.cssText = 'display:none;width:100%;height:100%;object-fit:contain;pointer-events:none;';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${config.label} illustration`);
  canvas.dataset.portrait = 'loading';
  canvas.dataset.motion = 'paused';
  const context = canvas.getContext('2d');
  container.append(image, canvas);
  if (!context || unavailable) {
    image.dataset.portrait = 'fallback';
    return Object.assign(() => { image.remove(); canvas.remove(); }, {setSelected() {}});
  }
  const view = {id, image, canvas, context, robot: !id.startsWith('H'), selected: Boolean(selected), hovered: false, ready: false, failed: false, dirty: false, painted: false, disposed: false, lastTime: null};
  views.add(view);
  listenEnvironment();
  const onEnter = () => { view.hovered = true; view.lastTime = null; requestPaint(); };
  const onLeave = () => { view.hovered = false; view.lastTime = null; canvas.dataset.motion = moving(view) ? 'running' : 'paused'; requestPaint(); };
  if (view.robot) {
    interactionElement?.addEventListener('pointerenter', onEnter);
    interactionElement?.addEventListener('pointerleave', onLeave);
    interactionElement?.addEventListener('pointercancel', onLeave);
  }
  const entry = acquireAsset(id);
  entry.promise.then(asset => {
    if (view.disposed) return;
    try { buildScene(view, asset); requestPaint(); }
    catch { view.failed = true; image.dataset.portrait = 'fallback'; }
  }).catch(() => { if (!view.disposed) { view.failed = true; image.dataset.portrait = 'fallback'; } });
  const cleanup = () => {
    if (view.disposed) return;
    view.disposed = true;
    views.delete(view);
    interactionElement?.removeEventListener('pointerenter', onEnter);
    interactionElement?.removeEventListener('pointerleave', onLeave);
    interactionElement?.removeEventListener('pointercancel', onLeave);
    if (view.model) view.pivot.remove(view.model);
    if (view.scene) disposeObject(view.scene);
    releaseAsset(id, entry);
    image.remove(); canvas.remove();
    requestPaint();
    queueMicrotask(releaseEnvironment);
  };
  cleanup.setSelected = value => {
    const next = Boolean(value);
    if (view.disposed || view.selected === next) return;
    const wasMoving = moving(view);
    view.selected = next;
    if (wasMoving !== moving(view)) view.lastTime = null;
    canvas.dataset.motion = moving(view) ? 'running' : motionQuery?.matches ? 'reduced' : 'paused';
    requestPaint();
  };
  return cleanup;
}
