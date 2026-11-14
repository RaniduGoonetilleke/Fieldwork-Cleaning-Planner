import * as THREE from './lib/three.module.js';
import { GLTFLoader } from './lib/GLTFLoader.js';
import { clone as cloneSkeleton } from './lib/SkeletonUtils.js';

// Imported display models show team membership and authored availability.
// Their poses, proportions and materials never provide evidence to the planner.
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const MEMBERS = {
  UR3: { position: [-2.6, 0, 0], pedestal: 0.14, radius: 0.48, type: 'Hardware record', asset: 'ur3' },
  UR5: { position: [-1.3, 0, 0], pedestal: 0.14, radius: 0.49, type: 'Hardware record', asset: 'ur5' },
  G1:  { position: [0, 0, 0], pedestal: 0.07, radius: 0.42, type: 'Supported simulation', asset: 'g1' },
  H1:  { position: [1.3, 0, 0], pedestal: 0.05, radius: 0.38, type: 'Person · example role', asset: 'human_man' },
  H2:  { position: [2.6, 0, 0], pedestal: 0.05, radius: 0.38, type: 'Person · example role', asset: 'human_woman' }
};
const STATUS = {
  available: { color: 0x39bfa0, label: 'Free' },
  booked: { color: 0xe7ad53, label: 'Booked in plan' },
  busy: { color: 0xe88778, label: 'Busy' },
  excluded: { color: 0x84909a, label: 'Not in team' },
  unknown: { color: 0x8aa8bd, label: 'Unknown' }
};
const THEMES = {
  dark: { background: 0x0a2029, floor: 0x17333c, platform: 0x28464e, grid: 0x294b55, text: '#e7f5ef', badge: '#17323c', line: '#496771' },
  light: { background: 0xe7ece8, floor: 0xd5dfd9, platform: 0xc2d0c9, grid: 0xb8cbc2, text: '#123330', badge: '#f5f8f4', line: '#c0d1c8' }
};

export class TeamScene {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.theme = 'dark';
    this.members = new Map();
    this.selected = null;
    this.teamIds = new Set();
    this.teamLabel = 'NEEDED';
    this.disposed = false;
    this.dirty = true;
    this.assets = {};
    this.resources = { textures: new Set(), materials: new Set(), geometries: new Set() };
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    try { this.init(); }
    catch (error) { this.dispose(); this.callbacks.onError?.(error); }
  }

  init() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(THEMES.dark.background);
    this.scene.fog = new THREE.Fog(THEMES.dark.background, 18, 38);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.025, 50);
    this.camera.position.set(.3, 1.9, 6.4);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const canvas = this.renderer.domElement;
    canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y pinch-zoom;outline:none;';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '3D illustration of UR3, UR5, G1, a robot helper and a glass cleaner. Tap a team member to view its details. No robots are connected.');
    this.container.appendChild(canvas);
    this.scene.add(new THREE.HemisphereLight(0xf1f4ef, 0x57716d, 2.6));
    const key = new THREE.DirectionalLight(0xfff0de, 3.3); key.position.set(3, 7, 6); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -4.5, right: 4.5, top: 4, bottom: -4, near: .1, far: 20 }); key.shadow.normalBias = .02; key.shadow.bias = -.00015; this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9cd6de, 2.1); rim.position.set(-4, 4, -4); this.scene.add(rim);
    this.floorMaterial = this.material(THEMES.dark.floor, { roughness: .98, metalness: 0 });
    this.makeMesh(this.scene, new THREE.PlaneGeometry(200, 200), this.floorMaterial, V(0, -.025, 0), [-Math.PI / 2, 0, 0]).castShadow = false;
    this.grid = new THREE.GridHelper(20, 40, THEMES.dark.grid, THEMES.dark.grid); this.grid.position.y = -.02; this.grid.material.opacity = .05; this.grid.material.transparent = true; this.scene.add(this.grid);
    for (const [id, config] of Object.entries(MEMBERS)) this.makeMember(id, config);
    this.onPointerDown = event => { this.pointerDown = event.isPrimary && event.button === 0 ? [event.clientX, event.clientY] : null; };
    this.onPointerUp = event => {
      const start = this.pointerDown; this.pointerDown = null;
      if (!start || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 7) return;
      const id = this.pick(event); if (!id) return;
      this.setSelected(id); this.callbacks.onSelect?.(id);
    };
    this.onPointerMove = event => { canvas.style.cursor = this.pick(event) ? 'pointer' : 'default'; };
    this.onPointerCancel = () => { this.pointerDown = null; };
    this.onContextLost = event => { event.preventDefault(); this.dispose(); this.callbacks.onError?.(new Error('The 3D display was interrupted. The team controls remain available.')); };
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove, { passive: true });
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('pointerleave', this.onPointerCancel);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.onVisibility = () => { this.lastFrame = null; this.dirty = true; };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(this.container);
    this.resize(); this.animate(0);
    this.loadModels().catch(error => { if (!this.disposed) this.callbacks.onError?.(error); });
  }

  material(color, options = {}) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: .4, metalness: .25, ...options });
    this.resources.materials.add(material); return material;
  }

  makeMesh(parent, geometry, material, position = null, rotation = null) {
    const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true;
    if (position) mesh.position.copy(position); if (rotation) mesh.rotation.set(...rotation);
    this.resources.geometries.add(geometry); parent.add(mesh); return mesh;
  }

  makeMember(id, config) {
    const group = new THREE.Group(); group.position.fromArray(config.position); this.scene.add(group);
    const platformMaterial = this.material(THEMES[this.theme].platform, { roughness: .62, metalness: .18 });
    const platform = this.makeMesh(group, new THREE.CylinderGeometry(config.radius, config.radius + .045, config.pedestal, 64), platformMaterial, V(0, config.pedestal / 2, 0));
    const ringMaterial = this.material(STATUS.unknown.color, { emissive: STATUS.unknown.color, emissiveIntensity: .28, roughness: .4 });
    const ring = this.makeMesh(group, new THREE.TorusGeometry(config.radius + .02, .017, 8, 80), ringMaterial, V(0, .035, 0), [Math.PI / 2, 0, 0]); ring.castShadow = false;
    const haloMaterial = new THREE.MeshBasicMaterial({ color: 0x9676ff, transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }); this.resources.materials.add(haloMaterial);
    const halo = this.makeMesh(group, new THREE.RingGeometry(config.radius + .055, config.radius + .16, 80), haloMaterial, V(0, .018, 0), [-Math.PI / 2, 0, 0]); halo.visible = false; halo.castShadow = false;
    const discMaterial = new THREE.MeshBasicMaterial({ color: 0x7756d9, transparent: true, opacity: .30, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }); this.resources.materials.add(discMaterial);
    const selectionDisc = this.makeMesh(group, new THREE.CircleGeometry(config.radius + .12, 64), discMaterial, V(0, .012, 0), [-Math.PI / 2, 0, 0]); selectionDisc.castShadow = false; selectionDisc.visible = false;
    const jobBadge = this.makeJobBadge(this.teamLabel); jobBadge.position.set(0, 1.98, 0); jobBadge.visible = false; group.add(jobBadge);
    const hit = this.makeMesh(group, new THREE.CylinderGeometry(config.radius + .04, config.radius + .04, 1.9, 16), this.material(0xffffff, { transparent: true, opacity: 0, depthWrite: false }), V(0, .95, 0)); hit.castShadow = false; hit.receiveShadow = false; hit.userData.member = id;
    const badge = this.makeBadge(id, STATUS.unknown.label, STATUS.unknown.color); badge.position.set(0, -.04, config.radius + .24); badge.userData.member = id; group.add(badge);
    const member = { id, group, config, platform, platformMaterial, ring, ringMaterial, halo, selectionDisc, jobBadge, badge, hit, status: 'unknown', label: 'Unknown', model: null, loaded: false };
    this.members.set(id, member);
    // The G1 record is supported at the pelvis. This stand is a schematic cue.
    if (id === 'G1') {
      const stand = new THREE.Group(); group.add(stand);
      const material = this.material(0x607c83, { metalness: .65, roughness: .48 });
      this.makeMesh(stand, new THREE.BoxGeometry(.09, .82, .09), material, V(0, .50, -.27));
      this.makeMesh(stand, new THREE.BoxGeometry(.35, .075, .31), material, V(0, .90, -.14));
      this.makeMesh(stand, new THREE.BoxGeometry(.45, .045, .45), material, V(0, .12, -.15));
    }
  }

  makeBadge(id, label, color) {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 112;
    const context = canvas.getContext('2d'), theme = THEMES[this.theme];
    context.fillStyle = theme.badge; context.beginPath(); context.roundRect(5, 5, 246, 102, 18); context.fill();
    context.strokeStyle = id === this.selected ? (this.theme === 'light' ? '#425a55' : '#c7dbd6') : theme.line; context.lineWidth = id === this.selected ? 4 : 2; context.stroke();
    context.fillStyle = '#' + new THREE.Color(color).getHexString(); context.beginPath(); context.arc(31, 56, 10, 0, Math.PI * 2); context.fill();
    const nameLines = id === 'H1' ? ['Robot', 'helper'] : id === 'H2' ? ['Glass', 'cleaner'] : [id];
    let fontSize = nameLines.length > 1 ? 36 : 57;
    context.fillStyle = theme.text; context.font = `700 ${fontSize}px system-ui, sans-serif`; context.textAlign = 'left'; context.textBaseline = 'middle';
    while (nameLines.some(line => context.measureText(line).width > 178) && fontSize > 24) {
      fontSize--; context.font = `700 ${fontSize}px system-ui, sans-serif`;
    }
    nameLines.forEach((line, index) => context.fillText(line, 60, nameLines.length > 1 ? 35 + index * 42 : 59));
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; this.resources.textures.add(texture);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }); this.resources.materials.add(material);
    const sprite = new THREE.Sprite(material); sprite.scale.set(1.02, .446, 1); sprite.renderOrder = 10; return sprite;
  }

  makeJobBadge(label) {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 72;
    const context = canvas.getContext('2d');
    context.fillStyle = '#6335c6'; context.beginPath(); context.roundRect(2, 2, 252, 68, 18); context.fill();
    context.strokeStyle = '#eadfff'; context.lineWidth = 3; context.stroke();
    context.fillStyle = '#ffffff'; context.font = '700 35px system-ui, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(label, 128, 38);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; this.resources.textures.add(texture);
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true, toneMapped: false, fog: false }); this.resources.materials.add(material);
    const sprite = new THREE.Sprite(material); sprite.scale.set(1.02, .287, 1); sprite.renderOrder = 12; return sprite;
  }


  async loadModels() {
    const loader = new GLTFLoader(); let completed = 0;
    const urls = { ur3: './models/ur3.glb', ur5: './models/ur5.glb', g1: './models/g1.glb', human_man: './models/people/worker-man.glb', human_woman: './models/people/worker-woman.glb' };
    const total = Object.keys(urls).length;
    const results = await Promise.allSettled(Object.entries(urls).map(async ([id, path]) => {
      const asset = await loader.loadAsync(path);
      if (this.disposed) { this.disposeObject(asset.scene); return; }
      this.assets[id] = asset; completed++; this.callbacks.onProgress?.({ loaded: completed, total });
      for (const member of this.members.values()) if (member.config.asset === id) this.attachModel(member, asset);
      this.dirty = true;
    }));
    if (this.disposed) return;
    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length) this.callbacks.onError?.(new Error(`${failed.length} display model${failed.length === 1 ? '' : 's'} could not load. Team selection still works through the cards.`));
    this.callbacks.onReady?.({ imported: [...this.members.values()].filter(m => m.loaded).map(m => m.id), failed: failed.length, displayOnly: true });
    this.dirty = true;
  }

  attachModel(member, asset) {
    const isHuman = member.id === 'H1' || member.id === 'H2';
    const model = isHuman ? cloneSkeleton(asset.scene) : asset.scene.clone(true);
    if (isHuman && asset.animations.length) {
      const mixer = new THREE.AnimationMixer(model), action = mixer.clipAction(asset.animations[0]); action.play(); mixer.setTime(.18); action.paused = true;
      member.mixer = mixer;
    }
    // Clone each material so viewing one member never changes another's appearance.
    // Source colours and textures provide the person's face and clothing.
    model.traverse(object => {
      if (!object.isMesh) return;
      const source = Array.isArray(object.material) ? object.material : [object.material];
      const copies = source.map(material => {
        const copy = material.clone();
        copy.userData.displayOriginal = { transparent: material.transparent, opacity: material.opacity, depthWrite: material.depthWrite };
        return copy;
      });
      object.material = Array.isArray(object.material) ? copies : copies[0];
    });
    model.rotation.y = isHuman ? Math.PI + .10 : member.id === 'G1' ? -Math.PI / 2 : 1.1;
    model.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(model, true).getSize(new THREE.Vector3());
    const displayHeight = isHuman ? 1.68 : member.id === 'G1' ? 1.4 : 1.2;
    model.scale.multiplyScalar(displayHeight / Math.max(.01, size.y));
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true), centre = box.getCenter(new THREE.Vector3());
    model.position.x -= centre.x; model.position.z -= centre.z; model.position.y += member.config.pedestal - box.min.y;
    model.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = true; object.receiveShadow = true; object.userData.member = member.id;
      this.resources.geometries.add(object.geometry);
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        this.resources.materials.add(material);
        Object.values(material).forEach(value => { if (value?.isTexture) this.resources.textures.add(value); });
      });
    });
    member.group.add(model); member.model = model; member.loaded = true; this.updateAppearance(member);
  }

  setMembers(members = []) {
    if (this.disposed || !Array.isArray(members)) return;
    for (const input of members) {
      const member = this.members.get(input.id); if (!member) continue;
      member.status = Object.hasOwn(STATUS, input.status) ? input.status : 'unknown';
      member.label = typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, 64) : STATUS[member.status].label;
      this.updateAppearance(member); this.refreshBadge(member);
    }
    this.dirty = true;
  }

  updateAppearance(member) {
    const status = STATUS[member.status], excluded = member.status === 'excluded', viewing = member.id === this.selected, needed = this.teamIds.has(member.id);
    member.ringMaterial.color.setHex(status.color); member.ringMaterial.emissive.setHex(status.color);
    member.ringMaterial.emissiveIntensity = .22;
    member.halo.visible = needed; member.selectionDisc.visible = needed; member.jobBadge.visible = needed;
    member.platformMaterial.color.setHex(needed ? (this.theme === 'light' ? 0x835ada : 0x7752bd) : THEMES[this.theme].platform);
    if (member.model) member.model.traverse(object => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        const original = material.userData.displayOriginal || { transparent: false, opacity: 1, depthWrite: true };
        const dimmed = excluded && !viewing;
        material.transparent = dimmed || original.transparent; material.opacity = original.opacity * (dimmed ? .6 : 1); material.depthWrite = dimmed ? false : original.depthWrite;
      });
      object.castShadow = !excluded || viewing;
    });
  }

  refreshBadge(member) {
    const old = member.badge, badge = this.makeBadge(member.id, member.label, STATUS[member.status].color);
    badge.position.copy(old.position); badge.userData.member = member.id; member.group.remove(old); member.group.add(badge); member.badge = badge;
    this.resources.textures.delete(old.material.map); this.resources.materials.delete(old.material); old.material.map.dispose(); old.material.dispose();
  }

  // This group shows a job's requirements or possible helpers, never approval.
  // Availability and the one member being inspected remain separate states.
  setTeam(ids = [], label = 'NEEDED') {
    if (this.disposed) return;
    this.teamIds = new Set((Array.isArray(ids) ? ids : []).filter(id => this.members.has(id)));
    const nextLabel = label === 'CAN HELP' ? 'CAN HELP' : 'NEEDED';
    if (nextLabel !== this.teamLabel) {
      this.teamLabel = nextLabel;
      this.members.forEach(member => {
        const old = member.jobBadge, badge = this.makeJobBadge(nextLabel);
        badge.position.copy(old.position); member.group.remove(old); member.group.add(badge); member.jobBadge = badge;
        this.resources.textures.delete(old.material.map); this.resources.materials.delete(old.material); old.material.map.dispose(); old.material.dispose();
      });
    }
    this.members.forEach(member => this.updateAppearance(member));
    this.dirty = true;
  }

  setSelected(id) {
    if (this.disposed) return;
    this.selected = this.members.has(id) ? id : null;
    this.members.forEach(member => { this.updateAppearance(member); this.refreshBadge(member); }); this.dirty = true;
  }

  setTheme(theme) {
    if (this.disposed || !Object.hasOwn(THEMES, theme)) return;
    this.theme = theme; const colors = THEMES[theme];
    this.scene.background.setHex(colors.background); this.scene.fog.color.setHex(colors.background); this.floorMaterial.color.setHex(colors.floor); this.grid.material.color.setHex(colors.grid);
    this.members.forEach(member => { this.updateAppearance(member); this.refreshBadge(member); });
    this.dirty = true;
  }

  homeCamera() {
    const target = V(0, .84, 0);
    const tangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    // Include the two outer badges and platform fronts, even on a narrow screen.
    const distance = Math.max(4.8, 3.48 / (tangent * Math.max(.3, this.camera.aspect)) + .75);
    return { target, position: target.clone().add(V(.08, 1, 7).normalize().multiplyScalar(distance)) };
  }

  resetCamera() {
    if (this.disposed) return;
    const { position, target } = this.homeCamera();
    this.camera.position.copy(position); this.camera.lookAt(target); this.camera.updateMatrixWorld(); this.dirty = true;
  }

  pick(event) {
    if (this.disposed) return null;
    const rect = this.renderer.domElement.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.members.values()].flatMap(member => [member.hit, member.badge]), false);
    return hits[0]?.object.userData.member || null;
  }

  resize() {
    if (this.disposed || !this.renderer) return;
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height, false);
    this.resetCamera();
    this.dirty = true;
  }

  animate(time) {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(t => this.animate(t));
    if (document.hidden || this.container.clientWidth < 2 || this.container.clientHeight < 2) { this.lastFrame = null; return; }
    if (this.dirty) { this.renderer.render(this.scene, this.camera); this.dirty = false; }
  }

  disposeObject(object) {
    object?.traverse(item => {
      item.geometry?.dispose();
      if (item.material) (Array.isArray(item.material) ? item.material : [item.material]).forEach(material => { material.map?.dispose(); material.dispose(); });
    });
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame); this.resizeObserver?.disconnect();
    if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility);
    const canvas = this.renderer?.domElement;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.onPointerDown); canvas.removeEventListener('pointerup', this.onPointerUp); canvas.removeEventListener('pointermove', this.onPointerMove); canvas.removeEventListener('webglcontextlost', this.onContextLost); canvas.removeEventListener('pointercancel', this.onPointerCancel); canvas.removeEventListener('pointerleave', this.onPointerCancel);
    }
    this.members.forEach(member => { member.mixer?.stopAllAction(); member.mixer?.uncacheRoot(member.model); });
    this.resources.geometries.forEach(g => g.dispose()); this.resources.materials.forEach(m => m.dispose()); this.resources.textures.forEach(t => t.dispose());
    Object.values(this.assets).forEach(asset => this.disposeObject(asset.scene));
    this.renderer?.dispose(); canvas?.remove();
  }
}
