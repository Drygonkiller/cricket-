const VIEW = {
  Day: { sky: "#86bacb", skyLight: "#e0f6ff", ground: "#516645", key: "#fff1d2", fill: "#d1edff",
    ambient: 1.46, sunlight: 2.45, lamps: .52, glow: .7 },
  Dusk: { sky: "#526183", skyLight: "#b3c1fa", ground: "#3e4c49", key: "#ffc696", fill: "#dbe5ff",
    ambient: 1.14, sunlight: 1.65, lamps: 1.32, glow: 2.8 },
};
const CROWD_COLORS = ["#e2cab0", "#fc9365", "#6cd2cd", "#e3d36c", "#b4b3ff", "#f6e9dc"];
const FLAG_COUNT = 8;
const TRAIL_POINTS = 12;

export function lightStadium(THREE, renderer, scene) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0, 57, 110);
  const ambient = new THREE.HemisphereLight();
  const key = new THREE.DirectionalLight();
  const fill = new THREE.DirectionalLight();
  scene.add(ambient, key, fill);
  key.position.set(-12, 24, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -10, right: 10, top: 14, bottom: -14, near: 1, far: 52 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.normalBias = .025;
  key.shadow.bias = -.0003;
  key.shadow.radius = 2.3;
  fill.position.set(18, 14, -22);

  return (look, lensMaterial) => {
    const colors = VIEW[look];
    scene.background.set(colors.sky);
    scene.fog.color.set(colors.sky);
    ambient.color.set(colors.skyLight);
    ambient.groundColor.set(colors.ground);
    ambient.intensity = colors.ambient;
    key.color.set(colors.key);
    key.intensity = colors.sunlight;
    fill.color.set(colors.fill);
    fill.intensity = colors.lamps;
    if (lensMaterial) {
      lensMaterial.emissive.set(colors.fill);
      lensMaterial.emissiveIntensity = colors.glow;
    }
  };
}

// Blender batched the sleeve, forearm and hand into the bowler's material meshes.
// Reassign their complete connected pieces to a shoulder pivot without adding triangles.
export function pivotBowlerArm(THREE, bowler) {
  const body = bowler.getObjectByName("Player_Bowler_Mesh");
  const arm = new THREE.Group();
  arm.name = "Bowling_Arm";
  arm.position.set(.19, 1.39, 0);
  arm.rotation.order = "ZXY";
  bowler.add(arm);
  const hand = new THREE.Vector3(.20, 0, -.17);
  const meshes = [];
  body?.traverse(mesh => {
    if (["Mint Jersey", "Skin"].includes(mesh.material?.name)) meshes.push(mesh);
  });
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute("position");
    const index = geometry.index;
    if (!index) continue;
    const representatives = new Map();
    const parents = Array.from({ length: positions.count }, (_, i) => i);
    const root = i => {
      while (parents[i] !== i) {
        parents[i] = parents[parents[i]];
        i = parents[i];
      }
      return i;
    };
    for (let i = 0; i < positions.count; i++) {
      const key = [positions.getX(i), positions.getY(i), positions.getZ(i)].map(v => Math.round(v * 1e5)).join(",");
      if (representatives.has(key)) parents[i] = representatives.get(key);
      else representatives.set(key, i);
    }
    for (let i = 0; i < index.count; i += 3) {
      const first = root(index.getX(i));
      parents[root(index.getX(i + 1))] = first;
      parents[root(index.getX(i + 2))] = first;
    }
    const armPieces = new Set();
    for (let i = 0; i < positions.count; i++) {
      if (positions.getX(i) > .28) armPieces.add(root(i));
    }
    const still = [];
    const moving = [];
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const destination = armPieces.has(root(a)) ? moving : still;
      destination.push(a, index.getX(i + 1), index.getX(i + 2));
    }
    if (!moving.length || !still.length) continue;
    const limb = mesh.clone();
    limb.geometry = geometry.clone().setIndex(moving);
    mesh.geometry.setIndex(still);
    limb.castShadow = true;
    arm.add(limb);
    limb.position.copy(mesh.getWorldPosition(new THREE.Vector3()));
    arm.worldToLocal(limb.position);
  }
  return { arm, handPosition: target => arm.localToWorld(target.copy(hand)) };
}

export function addCrowd(THREE, scene) {
  let seed = 1975;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const palette = CROWD_COLORS.map(color => new THREE.Color(color));
  const positions = [];
  const colors = [];
  for (let row = 0; row < 12; row++) {
    for (let seat = 0; seat < 96; seat++) {
      const section = Math.floor(seat * 56 / 96);
      if (section % 9 < 1 || section % 9 === 8 || random() < .16) continue;
      const angle = (seat + .4 * random()) * Math.PI * 2 / 96;
      positions.push((28.25 + row * .55) * Math.cos(angle), .63 + row * .34 + random() * .23,
        (33.25 + row * .55) * Math.sin(angle));
      palette[Math.floor(random() * palette.length)].toArray(colors, colors.length);
    }
  }
  const seats = new THREE.BufferGeometry();
  seats.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  seats.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Points(seats, new THREE.PointsMaterial({ size: .22, vertexColors: true })));

  const cloth = new THREE.PlaneGeometry(.95, .57, 3, 1).translate(.475, 0, 0);
  const flags = new THREE.InstancedMesh(cloth, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), FLAG_COUNT);
  const poles = new THREE.InstancedMesh(new THREE.BoxGeometry(.04, 1.18, .04),
    new THREE.MeshBasicMaterial({ color: "#b8c6bd" }), FLAG_COUNT);
  const prop = new THREE.Object3D();
  for (let i = 0; i < FLAG_COUNT; i++) {
    const angle = (i + .57) * Math.PI * 2 / FLAG_COUNT;
    prop.position.set(32 * Math.cos(angle), 4.05, 37 * Math.sin(angle));
    prop.rotation.y = Math.PI / 2 - angle;
    prop.updateMatrix();
    flags.setMatrixAt(i, prop.matrix);
    flags.setColorAt(i, palette[i % palette.length]);
    prop.position.y -= .27;
    prop.updateMatrix();
    poles.setMatrixAt(i, prop.matrix);
  }
  flags.frustumCulled = false;
  const vertices = cloth.getAttribute("position").setUsage(THREE.DynamicDrawUsage);
  scene.add(flags, poles);
  return time => {
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i);
      vertices.setZ(i, x * .36 * Math.sin(x * 7 - time * .006));
    }
    vertices.needsUpdate = true;
  };
}

export function createBallTrail(THREE, scene, camera) {
  const path = Array.from({ length: TRAIL_POINTS }, () => new THREE.Vector3());
  const ribbon = new THREE.BufferGeometry();
  const vertices = new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 6), 3).setUsage(THREE.DynamicDrawUsage);
  const colors = [];
  const indices = [];
  for (let i = 0; i < TRAIL_POINTS; i++) {
    const alpha = .62 * (i / (TRAIL_POINTS - 1));
    colors.push(1, .82, .40, alpha, 1, .82, .40, alpha);
    const a = i * 2;
    if (i < TRAIL_POINTS - 1) indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  ribbon.setAttribute("position", vertices);
  ribbon.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  ribbon.setIndex(indices);
  const trail = new THREE.Mesh(ribbon, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
  }));
  trail.frustumCulled = false;
  trail.visible = false;
  scene.add(trail);
  const tangent = new THREE.Vector3();
  const offset = new THREE.Vector3();
  let cursor = 0;
  let count = 0;
  let lastSample = -Infinity;
  return {
    clear() { count = 0; lastSample = -Infinity; trail.visible = false; },
    update(ball, time) {
      if (!ball.visible) { trail.visible = false; return; }
      const sample = path[(cursor + TRAIL_POINTS - 1) % TRAIL_POINTS];
      if (time - lastSample >= 15 && (!count || sample.distanceToSquared(ball.position) > .008)) {
        path[cursor].copy(ball.position);
        cursor = (cursor + 1) % TRAIL_POINTS;
        count = Math.min(TRAIL_POINTS, count + 1);
        lastSample = time;
      }
      if (count < 2) return;
      trail.visible = true;
      for (let i = 0; i < TRAIL_POINTS; i++) {
        const j = Math.max(TRAIL_POINTS - count, i);
        const center = path[(cursor + j) % TRAIL_POINTS];
        const neighbor = path[(cursor + (j === TRAIL_POINTS - 1 ? j - 1 : j + 1)) % TRAIL_POINTS];
        tangent.subVectors(j === TRAIL_POINTS - 1 ? center : neighbor, j === TRAIL_POINTS - 1 ? neighbor : center);
        offset.subVectors(camera.position, center).cross(tangent).normalize().multiplyScalar(.11 * i / (TRAIL_POINTS - 1));
        vertices.setXYZ(i * 2, center.x + offset.x, center.y + offset.y, center.z + offset.z);
        vertices.setXYZ(i * 2 + 1, center.x - offset.x, center.y - offset.y, center.z - offset.z);
      }
      vertices.needsUpdate = true;
    },
  };
}
