import * as THREE from "three";

import { FIELD, PIXEL_RENDERER } from "../core/constants.js";
import { clamp } from "../core/utils.js";
import { resolvePlayerSpriteMeta } from "./CanvasRenderer.js";

const WORLD = Object.freeze({
  playerWidth: 58,
  playerHeight: 86,
  playerLift: 50,
  ballRadius: 13,
  lineWidth: 12,
  cameraFov: 44,
  cameraHeight: 720,
  cameraSideOffset: 820,
  cameraTargetClampX: FIELD.width / 2 - 360,
  cameraStiffness: 3.8,
  shakeFrames: 15,
  shakeStrength: 12,
  crowdBaseHeight: 150,
  crowdBaseY: 75
});
export const MAX_RENDER_DELTA_SECONDS = 0.08;

const DIGIT_BITMAPS = Object.freeze({
  0: ["111", "101", "101", "101", "111"],
  1: ["010", "110", "010", "010", "111"],
  2: ["111", "001", "111", "100", "111"],
  3: ["111", "001", "111", "001", "111"],
  4: ["101", "101", "111", "001", "001"],
  5: ["111", "100", "111", "001", "111"],
  6: ["111", "100", "111", "101", "111"],
  7: ["111", "001", "010", "010", "010"],
  8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "111"]
});

function engineToWorld(x, y, height = 0) {
  return new THREE.Vector3(x - FIELD.width / 2, height, y - FIELD.height / 2);
}

function hexToRgb(hex) {
  const value = String(hex ?? "#ffffff").replace("#", "");
  const full = value.length === 3 ? value.split("").map((char) => char + char).join("") : value.padEnd(6, "f");
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  };
}

function shadeHex(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const shift = (value) => Math.max(0, Math.min(255, Math.round(value + amount)));
  return `rgb(${shift(r)}, ${shift(g)}, ${shift(b)})`;
}

function readableTextColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? PIXEL_RENDERER.colors.black : "#ffffff";
}

function createNearestCanvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function makeSkillTextTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '12px "Press Start 2P", monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#080808";
  ctx.fillText("SKILL!", 66, 18);
  ctx.fillStyle = "#f7d51d";
  ctx.fillText("SKILL!", 64, 16);
  return createNearestCanvasTexture(canvas);
}

function makeDustTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 24;
  canvas.height = 24;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f8fff2";
  ctx.fillRect(6, 10, 4, 4);
  ctx.fillRect(14, 7, 3, 3);
  ctx.fillRect(12, 15, 5, 3);
  ctx.fillStyle = "#c9d2c8";
  ctx.fillRect(8, 15, 3, 3);
  ctx.fillRect(17, 12, 3, 3);
  return createNearestCanvasTexture(canvas);
}

function drawBitmapDigit(ctx, digit, x, y, color, scale = 1) {
  const rows = DIGIT_BITMAPS[digit];
  if (!rows) return;
  ctx.fillStyle = color;
  rows.forEach((row, rowIndex) => {
    [...row].forEach((pixel, columnIndex) => {
      if (pixel === "1") ctx.fillRect(x + columnIndex * scale, y + rowIndex * scale, scale, scale);
    });
  });
}

function drawKitNumber(ctx, number, x, y, color) {
  const digits = String(Number.isFinite(Number(number)) ? Number(number) : 0)
    .slice(-2)
    .padStart(1, "0");
  const scale = 2;
  const digitWidth = 3 * scale;
  const gap = 2;
  const totalWidth = digits.length * digitWidth + (digits.length - 1) * gap;
  let cursor = Math.round(x - totalWidth / 2);
  for (const digit of digits) {
    drawBitmapDigit(ctx, digit, cursor, y, color, scale);
    cursor += digitWidth + gap;
  }
}

function playerSourceFor(player) {
  return player?.source ?? player ?? {};
}

function poseForPlayer(player, snapshot) {
  const speed = Math.hypot(player.vx, player.vy);
  if (player.state === "FROZEN" || player.frozenTimer > 0) return "frozen";
  if (player.state === "SKILL_MOVE" || player.visualBurstTimer > 0 || player.skillFlashTimer > 0) return "skill";
  if (player.tackleCooldown > 0 && speed > 18 && player.id !== snapshot?.possessionPlayerId) return "tackle";
  if (player.hasPossession || player.id === snapshot?.possessionPlayerId || player.state === "DRIBBLING") return speed > 58 ? "kick" : "dribble";
  if (speed > 14) return "run";
  if (player.state === "DEFEND") return "brace";
  return "idle";
}

function spriteCacheKey(player, pose, frame) {
  const primary = player.team.primary ?? player.team.primaryColor;
  const secondary = player.team.secondary ?? player.team.secondaryColor;
  const source = playerSourceFor(player);
  const meta = resolvePlayerSpriteMeta(source);
  const identity = source.id ?? player.id ?? source.name ?? "player";
  return `${identity}:${primary}:${secondary}:${meta.skinTone}:${meta.hairStyle}:${meta.hairColor}:${pose}:${frame}`;
}

function drawPixelPlayerCanvas(player, pose, frame) {
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const primary = player.team.primary ?? player.team.primaryColor ?? "#e11d48";
  const secondary = player.team.secondary ?? player.team.secondaryColor ?? "#ffffff";
  const spriteMeta = resolvePlayerSpriteMeta(playerSourceFor(player));
  const outline = "#060606";
  const skin = spriteMeta.skinTone;
  const hair = spriteMeta.hairColor;
  const shade = shadeHex(primary, -46);
  const highlight = shadeHex(primary, 38);
  const kitText = readableTextColor(primary);
  const boot = "#111111";
  const sock = "#f8fff2";
  const lift = pose === "run" || pose === "dribble" || pose === "skill" ? (frame === 1 || frame === 3 ? -1 : 0) : 0;
  const lean = pose === "dribble" || pose === "kick" || pose === "skill" ? 2 : pose === "frozen" ? -2 : 0;
  const crouch = pose === "brace" || pose === "tackle" || pose === "frozen" ? 3 : 0;
  const leftLegX = pose === "tackle" ? 11 : frame === 1 ? 12 : frame === 2 ? 16 : frame === 3 ? 19 : 14;
  const rightLegX = pose === "kick" || pose === "tackle" ? 28 : frame === 1 ? 30 : frame === 2 ? 25 : frame === 3 ? 21 : 27;
  const leftFootY = pose === "tackle" ? 56 : frame === 1 ? 57 : frame === 2 ? 54 : 56;
  const rightFootY = pose === "kick" ? 50 : frame === 3 ? 57 : frame === 2 ? 54 : 56;

  const rect = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x + lean), Math.round(y + lift + crouch), w, h);
  };
  const flat = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };

  const aura = pose === "skill" ? "#f8fff2" : outline;
  flat(15 + lean, 1 + crouch, 18, 16, aura);
  flat(18 + lean, 4 + crouch, 12, 14, skin);
  if (spriteMeta.hairStyle === "bald") {
    flat(17 + lean, 3 + crouch, 14, 3, skin);
  } else if (spriteMeta.hairStyle === "crop") {
    flat(15 + lean, 1 + crouch, 18, 6, hair);
    flat(15 + lean, 7 + crouch, 4, 4, hair);
  } else if (spriteMeta.hairStyle === "sidePart") {
    flat(15 + lean, 1 + crouch, 18, 6, hair);
    flat(29 + lean, 6 + crouch, 5, 7, hair);
  } else {
    flat(15 + lean, 1 + crouch, 18, 6, hair);
    flat(13 + lean, 5 + crouch, 4, 5, hair);
    flat(31 + lean, 5 + crouch, 4, 5, hair);
  }
  flat(19 + lean, 10 + crouch, 2, 2, outline);
  flat(27 + lean, 10 + crouch, 2, 2, outline);

  rect(10, 19, 28, 23, outline);
  rect(14, 20, 20, 17, primary);
  rect(14, 37, 20, 5, shade);
  rect(12, 22, 5, 9, secondary);
  rect(31, 22, 5, 9, secondary);
  rect(16, 22, 16, 3, highlight);
  drawKitNumber(ctx, player.number ?? playerSourceFor(player).number ?? 0, 24 + lean, 27 + lift + crouch, kitText);

  if (pose === "tackle") {
    flat(6, 31 + crouch, 11, 5, skin);
    flat(31, 31 + crouch, 11, 5, skin);
  } else if (pose === "brace" || pose === "frozen") {
    flat(7, 28 + crouch, 8, 5, skin);
    flat(33, 28 + crouch, 8, 5, skin);
  } else {
    flat(8 + lean, 25 + crouch, 7, 5, skin);
    flat(33 + lean, 25 + crouch, 7, 5, skin);
  }

  flat(15 + lean, 42 + crouch, 18, 7, secondary);
  flat(leftLegX + lean, 48 + crouch, 6, 8, outline);
  flat(rightLegX + lean, 48 + crouch, 6, 8, outline);
  flat(leftLegX + 1 + lean, 48 + crouch, 4, 4, primary);
  flat(rightLegX + 1 + lean, 48 + crouch, 4, 4, primary);
  flat(leftLegX + 1 + lean, 52 + crouch, 4, 5, sock);
  flat(rightLegX + 1 + lean, 52 + crouch, 4, 5, sock);
  flat(leftLegX - 2 + lean, leftFootY + crouch, 10, 4, boot);
  flat(rightLegX - 2 + lean, rightFootY + crouch, 10, 4, boot);

  return canvas;
}

function makeChunkyCrowdTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#0b1118";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const rows = [
    ["#141c28", "#1f2937"],
    ["#f7d51d", "#ef4444"],
    ["#2563eb", "#f8fff2"],
    ["#16a34a", "#f97316"],
    ["#6d28d9", "#38bdf8"],
    ["#111827", "#374151"]
  ];
  rows.forEach((pair, index) => {
    const y = index * 10;
    ctx.fillStyle = pair[0];
    ctx.fillRect(0, y, canvas.width, 8);
    ctx.fillStyle = pair[1];
    for (let x = (index % 2) * 8; x < canvas.width; x += 24) {
      ctx.fillRect(x, y + 2, 12, 4);
    }
  });
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  for (let y = 0; y < canvas.height; y += 10) ctx.fillRect(0, y + 8, canvas.width, 2);
  return createNearestCanvasTexture(canvas);
}

function makeTopDownPitchTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const sx = canvas.width / FIELD.width;
  const sy = canvas.height / FIELD.height;
  const x = (worldX) => (worldX + FIELD.width / 2) * sx;
  const y = (worldZ) => (worldZ + FIELD.height / 2) * sy;
  const w = (worldWidth) => worldWidth * sx;
  const h = (worldHeight) => worldHeight * sy;

  const stripeWidth = Math.max(24, Math.round(canvas.width / 14));
  for (let px = 0; px < canvas.width; px += stripeWidth) {
    ctx.fillStyle = Math.floor(px / stripeWidth) % 2 === 0 ? PIXEL_RENDERER.colors.grassLight : PIXEL_RENDERER.colors.grassDark;
    ctx.fillRect(px, 0, stripeWidth, canvas.height);
  }

  ctx.strokeStyle = PIXEL_RENDERER.colors.chalk;
  ctx.lineWidth = 8;
  ctx.lineJoin = "miter";
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2, 8);
  ctx.lineTo(canvas.width / 2, canvas.height - 8);
  ctx.stroke();

  const left = -FIELD.width / 2;
  const right = FIELD.width / 2;
  const penaltyTop = -FIELD.penaltyBoxHeight / 2;
  const goalTop = -FIELD.goalBoxHeight / 2;
  ctx.strokeRect(x(left), y(penaltyTop), w(FIELD.penaltyBoxWidth), h(FIELD.penaltyBoxHeight));
  ctx.strokeRect(x(right - FIELD.penaltyBoxWidth), y(penaltyTop), w(FIELD.penaltyBoxWidth), h(FIELD.penaltyBoxHeight));
  ctx.strokeRect(x(left), y(goalTop), w(FIELD.goalBoxWidth), h(FIELD.goalBoxHeight));
  ctx.strokeRect(x(right - FIELD.goalBoxWidth), y(goalTop), w(FIELD.goalBoxWidth), h(FIELD.goalBoxHeight));

  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, FIELD.centerCircleRadius * sx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = PIXEL_RENDERER.colors.chalk;
  ctx.fillRect(canvas.width / 2 - 5, canvas.height / 2 - 5, 10, 10);
  ctx.fillRect(x(left + FIELD.penaltyBoxWidth - 55) - 5, canvas.height / 2 - 5, 10, 10);
  ctx.fillRect(x(right - FIELD.penaltyBoxWidth + 55) - 5, canvas.height / 2 - 5, 10, 10);

  return createNearestCanvasTexture(canvas);
}

export class ThreeJsRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#07120d");
    this.camera = new THREE.PerspectiveCamera(58, 1, 1, 6000);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    this.nearestFilter = THREE.NearestFilter;
    this.lineWidth = WORLD.lineWidth;
    this.players = new Map();
    this.skillEffects = new Map();
    this.spriteTextures = new Map();
    this.runPhases = new Map();
    this.lookTarget = new THREE.Vector3(0, 0, 0);
    this.cameraTrackedX = 0;
    this.shakeFrames = 0;
    this.seenVisualEvents = new Set();
    this.crowdMeshes = [];
    this.crowdPulse = 0;
    this.lastTimestamp = 0;
    this.ballVisualHeight = 0;
    this.ballVerticalVelocity = 0;
    this.lastBallSpeed = 0;
    this.playerShadowGeometry = new THREE.CircleGeometry(1, 18);
    this.playerShadowMaterial = new THREE.MeshBasicMaterial({
      color: "#000000",
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.canvas.__threeJsRenderer = this;

    this.createLights();
    this.createPitch();
    this.createStadium();
    this.createBall();
    this.skillTextTexture = makeSkillTextTexture();
    this.dustTexture = makeDustTexture();
    this.resize();
    this.camera.fov = WORLD.cameraFov;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(0, WORLD.cameraHeight, WORLD.cameraSideOffset);
    this.camera.lookAt(0, 0, 0);
  }

  createLights() {
    this.scene.add(new THREE.AmbientLight("#f8fff2", 1.55));
    const light = new THREE.DirectionalLight("#ffffff", 0.85);
    light.position.set(-320, 760, 540);
    this.scene.add(light);
  }

  createPitch() {
    const pitchTexture = makeTopDownPitchTexture();
    const pitch = new THREE.Mesh(
      new THREE.PlaneGeometry(FIELD.width, FIELD.height),
      new THREE.MeshBasicMaterial({ map: pitchTexture, side: THREE.DoubleSide })
    );
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.y = 0;
    this.scene.add(pitch);
    this.pitchTexture = pitchTexture;
    const chalk = new THREE.MeshBasicMaterial({ color: "#f8fff2", side: THREE.DoubleSide });
    this.chalkMaterial = chalk;
    this.addFieldLines(chalk);
    this.addGoals();
  }

  createStadium() {
    this.crowdTexture = makeChunkyCrowdTexture();
    this.crowdTexture.wrapS = THREE.RepeatWrapping;
    this.crowdTexture.wrapT = THREE.RepeatWrapping;
    this.crowdTexture.repeat.set(3, 1);
    const material = new THREE.MeshBasicMaterial({ map: this.crowdTexture, color: "#ffffff" });
    this.crowdMaterial = material;
    const addStand = (x, z, width, depth) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, WORLD.crowdBaseHeight, depth), material);
      mesh.position.set(x, WORLD.crowdBaseY, z);
      mesh.userData.baseScaleY = 1;
      mesh.userData.basePositionY = WORLD.crowdBaseY;
      this.scene.add(mesh);
      this.crowdMeshes.push(mesh);
    };
    const standOffset = 145;
    addStand(0, -FIELD.height / 2 - standOffset, FIELD.width + 460, 150);
    addStand(0, FIELD.height / 2 + standOffset, FIELD.width + 460, 150);
    addStand(-FIELD.width / 2 - standOffset, 0, 150, FIELD.height + 460);
    addStand(FIELD.width / 2 + standOffset, 0, 150, FIELD.height + 460);
  }

  addFlatRect(cx, cz, width, depth, material, y = 1.2) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(cx, y, cz);
    this.scene.add(mesh);
    return mesh;
  }

  addLine(x1, z1, x2, z2, material = this.chalkMaterial) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const length = Math.hypot(dx, dz);
    const mesh = this.addFlatRect((x1 + x2) / 2, (z1 + z2) / 2, length, WORLD.lineWidth, material);
    mesh.rotation.z = -Math.atan2(dz, dx);
    return mesh;
  }

  addFieldLines(material) {
    const left = -FIELD.width / 2;
    const right = FIELD.width / 2;
    const top = -FIELD.height / 2;
    const bottom = FIELD.height / 2;
    this.addLine(left, top, right, top, material);
    this.addLine(right, top, right, bottom, material);
    this.addLine(right, bottom, left, bottom, material);
    this.addLine(left, bottom, left, top, material);
    this.addLine(0, top, 0, bottom, material);

    this.addBoxLines(left, -FIELD.penaltyBoxHeight / 2, FIELD.penaltyBoxWidth, FIELD.penaltyBoxHeight, material);
    this.addBoxLines(right - FIELD.penaltyBoxWidth, -FIELD.penaltyBoxHeight / 2, FIELD.penaltyBoxWidth, FIELD.penaltyBoxHeight, material);
    this.addBoxLines(left, -FIELD.goalBoxHeight / 2, FIELD.goalBoxWidth, FIELD.goalBoxHeight, material);
    this.addBoxLines(right - FIELD.goalBoxWidth, -FIELD.goalBoxHeight / 2, FIELD.goalBoxWidth, FIELD.goalBoxHeight, material);
    this.addCircle(0, 0, FIELD.centerCircleRadius, material);
    this.addFlatRect(0, 0, 12, 12, material, 1.4);
    this.addFlatRect(left + FIELD.penaltyBoxWidth - 55, 0, 10, 10, material, 1.4);
    this.addFlatRect(right - FIELD.penaltyBoxWidth + 55, 0, 10, 10, material, 1.4);
  }

  addBoxLines(x, z, width, depth, material) {
    this.addLine(x, z, x + width, z, material);
    this.addLine(x + width, z, x + width, z + depth, material);
    this.addLine(x + width, z + depth, x, z + depth, material);
  }

  addCircle(cx, cz, radius, material) {
    const segments = 48;
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      const b = ((i + 1) / segments) * Math.PI * 2;
      this.addLine(cx + Math.cos(a) * radius, cz + Math.sin(a) * radius, cx + Math.cos(b) * radius, cz + Math.sin(b) * radius, material);
    }
  }

  addGoals() {
    const postMaterial = new THREE.MeshBasicMaterial({ color: "#f8fff2" });
    const netMaterial = new THREE.MeshBasicMaterial({ color: "#24313c", transparent: true, opacity: 0.9 });
    const addGoal = (side) => {
      const x = side === "left" ? -FIELD.width / 2 - FIELD.goalDepth / 2 : FIELD.width / 2 + FIELD.goalDepth / 2;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(FIELD.goalDepth, 42, FIELD.goalWidth), netMaterial);
      frame.position.set(x, 22, 0);
      this.scene.add(frame);
      const lineX = side === "left" ? -FIELD.width / 2 - FIELD.goalDepth : FIELD.width / 2 + FIELD.goalDepth;
      this.addGoalPost(lineX, -FIELD.goalWidth / 2, postMaterial);
      this.addGoalPost(lineX, FIELD.goalWidth / 2, postMaterial);
    };
    addGoal("left");
    addGoal("right");
  }

  addGoalPost(x, z, material) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(8, 72, 8), material);
    post.position.set(x, 36, z);
    this.scene.add(post);
  }

  createBall() {
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(WORLD.ballRadius, 8, 8),
      new THREE.MeshLambertMaterial({ color: "#f8f8f0", flatShading: true })
    );
    this.scene.add(this.ball);

    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 18),
      new THREE.MeshBasicMaterial({
        color: "#000000",
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.position.y = 2.5;
    this.scene.add(this.ballShadow);
  }

  resize() {
    const rect = this.canvas.parentElement?.getBoundingClientRect() ?? this.canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(220, Math.floor(rect.height));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  render(snapshot) {
    const now = performance.now();
    const dt = this.lastTimestamp ? Math.min(MAX_RENDER_DELTA_SECONDS, (now - this.lastTimestamp) / 1000) : 1 / 60;
    this.lastTimestamp = now;
    this.processVisualEvents(snapshot);
    this.syncPlayers(snapshot, dt);
    this.syncBall(snapshot, dt);
    this.updateCrowdPulse(snapshot, dt);
    this.updateCamera(snapshot, dt);
    this.renderer.render(this.scene, this.camera);
  }

  processVisualEvents(snapshot) {
    for (const event of snapshot.visualEvents ?? []) {
      if (!Number.isFinite(event?.id)) continue;
      if (this.seenVisualEvents.has(event.id)) continue;
      this.seenVisualEvents.add(event.id);
      if (event.type === "goal" || event.type === "fiveStarSkill") this.shakeFrames = WORLD.shakeFrames;
    }
    if (this.seenVisualEvents.size > 96) {
      const recentIds = new Set((snapshot.visualEvents ?? []).map((event) => event.id));
      this.seenVisualEvents = new Set([...this.seenVisualEvents].filter((id) => recentIds.has(id)));
    }
  }

  syncPlayers(snapshot, dt) {
    const activeIds = new Set();
    for (const player of snapshot.players) {
      activeIds.add(player.id);
      const record = this.playerRecordFor(player);
      const { sprite, shadow } = record;
      const runFrame = this.runFrameForPlayer(player, dt);
      const pose = poseForPlayer(player, snapshot);
      const material = sprite.material;
      material.map = this.textureForPlayer(player, pose, runFrame);
      material.needsUpdate = true;
      const position = engineToWorld(player.x, player.y, WORLD.playerLift);
      sprite.position.copy(position);
      sprite.scale.set(WORLD.playerWidth, WORLD.playerHeight, 1);
      sprite.renderOrder = Math.round(player.y);
      this.syncPlayerShadow(player, shadow, pose);
      this.syncSkillEffect(player, position, pose, runFrame);
    }

    for (const [id, record] of this.players) {
      if (activeIds.has(id)) continue;
      this.scene.remove(record.sprite);
      this.scene.remove(record.shadow);
      record.sprite.material.dispose();
      this.players.delete(id);
      this.removeSkillEffect(id);
    }
  }

  playerRecordFor(player) {
    const existing = this.players.get(player.id);
    if (existing) return existing;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.textureForPlayer(player, "idle", 0),
        transparent: true,
        alphaTest: 0.1,
        depthWrite: true
      })
    );
    sprite.center.set(0.5, 0.16);
    sprite.userData.kind = "player-sprite";
    const shadow = this.createPlayerShadow();
    const record = { sprite, shadow };
    this.players.set(player.id, record);
    this.scene.add(shadow);
    this.scene.add(sprite);
    return record;
  }

  textureForPlayer(player, pose, frame) {
    const key = spriteCacheKey(player, pose, frame);
    const existing = this.spriteTextures.get(key);
    if (existing) return existing;
    const texture = createNearestCanvasTexture(drawPixelPlayerCanvas(player, pose, frame));
    this.spriteTextures.set(key, texture);
    return texture;
  }

  createPlayerShadow() {
    const shadow = new THREE.Mesh(this.playerShadowGeometry, this.playerShadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 2.4;
    shadow.renderOrder = -2;
    shadow.userData.kind = "player-shadow";
    return shadow;
  }

  syncPlayerShadow(player, shadow, pose) {
    const speed = Math.hypot(player.vx, player.vy);
    const position = engineToWorld(player.x, player.y, 2.4);
    shadow.position.copy(position);
    const poseScale = pose === "tackle" || pose === "frozen" ? 1.28 : pose === "skill" ? 1.12 : 1;
    const stretch = clamp(1 + speed / 360, 1, 1.38) * poseScale;
    shadow.scale.set(30 * stretch, 18 * poseScale, 1);
  }

  runFrameForPlayer(player, dt) {
    const speed = Math.hypot(player.vx, player.vy);
    if (speed < 8) return 0;
    const phase = this.runPhases.get(player.id) ?? 0;
    const cadence = Math.max(2.2, Math.min(12, speed / 18));
    const nextPhase = (phase + cadence * dt) % 4;
    this.runPhases.set(player.id, nextPhase);
    return Math.floor(nextPhase);
  }

  createSkillEffect(player, pose, runFrame) {
    const group = new THREE.Group();
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.skillTextTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false
      })
    );
    label.scale.set(128, 32, 1);
    label.position.y = 118;
    group.add(label);

    const flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.textureForPlayer(player, pose, runFrame),
        color: "#ffffff",
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    flash.center.set(0.5, 0.16);
    flash.scale.set(WORLD.playerWidth * 1.2, WORLD.playerHeight * 1.2, 1);
    group.add(flash);

    const dust = [];
    for (let i = 0; i < 4; i += 1) {
      const puff = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.dustTexture,
          transparent: true,
          opacity: 0.78,
          depthWrite: false
        })
      );
      puff.scale.set(20, 20, 1);
      group.add(puff);
      dust.push(puff);
    }

    this.scene.add(group);
    const effect = { group, label, flash, dust };
    this.skillEffects.set(player.id, effect);
    return effect;
  }

  syncSkillEffect(player, position, pose, runFrame) {
    const active = player.visualBurstTimer > 0 || player.skillFlashTimer > 0 || player.state === "SKILL_MOVE";
    if (!active) {
      this.removeSkillEffect(player.id);
      return;
    }

    const effect = this.skillEffects.get(player.id) ?? this.createSkillEffect(player, pose, runFrame);
    const life = clamp(player.visualBurstTimer / 0.72, 0, 1);
    effect.group.position.copy(position);
    effect.label.material.opacity = life;
    effect.label.position.y = 104 + (1 - life) * 34;
    effect.flash.material.map = this.textureForPlayer(player, pose, runFrame);
    effect.flash.material.opacity = player.skillFlashTimer > 0 ? 0.68 : 0;

    effect.dust.forEach((puff, index) => {
      const angle = (index / effect.dust.length) * Math.PI * 2 + 0.4;
      const spread = 18 + (1 - life) * 48;
      puff.position.set(Math.cos(angle) * spread, 10 + index * 2, Math.sin(angle) * spread);
      puff.material.opacity = life * 0.74;
      const size = 12 + life * 16;
      puff.scale.set(size, size, 1);
    });
  }

  removeSkillEffect(playerId) {
    const effect = this.skillEffects.get(playerId);
    if (!effect) return;
    this.scene.remove(effect.group);
    effect.group.traverse((object) => {
      if (object.material) object.material.dispose();
    });
    this.skillEffects.delete(playerId);
  }

  syncBall(snapshot, dt) {
    const speed = Math.hypot(snapshot.ball.vx, snapshot.ball.vy);
    if (speed > 300 && speed > this.lastBallSpeed + 60) {
      this.ballVerticalVelocity = clamp(speed * 0.22, 45, 175);
    }
    this.lastBallSpeed = speed;
    this.ballVerticalVelocity -= 340 * dt;
    this.ballVisualHeight += this.ballVerticalVelocity * dt;
    if (this.ballVisualHeight <= 0) {
      this.ballVisualHeight = 0;
      this.ballVerticalVelocity = Math.max(0, this.ballVerticalVelocity);
    }
    this.ballVisualHeight *= Math.max(0, 1 - dt * 0.8);

    const position = engineToWorld(snapshot.ball.x, snapshot.ball.y, WORLD.ballRadius + this.ballVisualHeight);
    this.ball.position.copy(position);
    this.ball.rotation.x += snapshot.ball.vy * dt * 0.012;
    this.ball.rotation.z -= snapshot.ball.vx * dt * 0.012;

    const shadowPosition = engineToWorld(snapshot.ball.x, snapshot.ball.y, 3);
    this.ballShadow.position.copy(shadowPosition);
    const shadowScale = clamp(54 - this.ballVisualHeight * 0.12, 26, 54);
    this.ballShadow.scale.set(shadowScale, shadowScale * 0.55, 1);
    this.ballShadow.material.opacity = clamp(0.42 - this.ballVisualHeight * 0.0017, 0.14, 0.42);
  }

  updateCrowdPulse(snapshot, dt) {
    const penaltyLaneDistance = Math.max(0, Math.abs(snapshot.ball.y - FIELD.height / 2) - FIELD.penaltyBoxHeight / 2);
    const lanePressure = clamp(1 - penaltyLaneDistance / 180, 0, 1);
    const leftPressure = clamp(1 - snapshot.ball.x / (FIELD.penaltyBoxWidth + 260), 0, 1);
    const rightPressure = clamp(1 - (FIELD.width - snapshot.ball.x) / (FIELD.penaltyBoxWidth + 260), 0, 1);
    const desiredPulse = lanePressure * Math.max(leftPressure, rightPressure);
    const alpha = 1 - Math.exp(-dt * 5);
    this.crowdPulse += (desiredPulse - this.crowdPulse) * alpha;
    const hop = Math.sin(performance.now() * 0.018) * this.crowdPulse;
    for (const mesh of this.crowdMeshes) {
      mesh.scale.y = mesh.userData.baseScaleY + this.crowdPulse * 0.1;
      mesh.position.y = mesh.userData.basePositionY + hop * 8;
    }
    if (this.crowdTexture) {
      this.crowdTexture.offset.y = hop * 0.012;
    }
  }

  updateCamera(snapshot, dt) {
    const ball = engineToWorld(snapshot.ball.x, snapshot.ball.y, 0);
    const desiredX = clamp(ball.x, -WORLD.cameraTargetClampX, WORLD.cameraTargetClampX);
    const alpha = 1 - Math.exp(-dt * WORLD.cameraStiffness);
    this.cameraTrackedX += (desiredX - this.cameraTrackedX) * clamp(alpha, 0, 1);
    this.lookTarget.set(this.cameraTrackedX, 0, 0);

    let shakeX = 0;
    let shakeY = 0;
    let shakeZ = 0;
    if (this.shakeFrames > 0) {
      const life = this.shakeFrames / WORLD.shakeFrames;
      const amount = WORLD.shakeStrength * life * life;
      shakeX = (Math.random() - 0.5) * amount;
      shakeY = (Math.random() - 0.5) * amount * 0.42;
      shakeZ = (Math.random() - 0.5) * amount;
      this.shakeFrames -= 1;
    }

    this.camera.position.set(
      this.cameraTrackedX + shakeX,
      WORLD.cameraHeight + shakeY,
      WORLD.cameraSideOffset + shakeZ
    );
    this.camera.lookAt(this.lookTarget);
  }

  dispose() {
    this.resizeObserver?.disconnect();
    this.players.clear();
    for (const playerId of [...this.skillEffects.keys()]) this.removeSkillEffect(playerId);
    for (const texture of this.spriteTextures.values()) texture.dispose();
    this.spriteTextures.clear();
    this.pitchTexture?.dispose();
    this.crowdTexture?.dispose();
    this.playerShadowGeometry?.dispose();
    this.playerShadowMaterial?.dispose();
    this.skillTextTexture?.dispose();
    this.dustTexture?.dispose();
    this.scene.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of materials) material.dispose();
    });
    if (this.canvas.__threeJsRenderer === this) delete this.canvas.__threeJsRenderer;
    this.renderer.dispose();
  }
}
