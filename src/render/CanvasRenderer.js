import { FIELD, PIXEL_RENDERER, PLAYER_STATES } from "../core/constants.js";
import { formatClock } from "../core/utils.js";

const FALLBACK_SKIN_TONES = Object.freeze(["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac", "#b06d42"]);
const FALLBACK_HAIR_COLORS = Object.freeze(["#171717", "#3b2416", "#704214", "#b55b2a", "#d8b36a", "#f0f0f0"]);
const FALLBACK_HAIR_STYLES = Object.freeze(["short", "crop", "sidePart", "bald"]);

export function hashStringToInt(value) {
  const input = String(value ?? "player");
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function resolvePlayerSpriteMeta(playerSource = {}) {
  const key = playerSource.name || playerSource.id || "player";
  const hash = hashStringToInt(key);
  return {
    skinTone: playerSource.skinTone ?? FALLBACK_SKIN_TONES[hash % FALLBACK_SKIN_TONES.length],
    hairColor: playerSource.hairColor ?? FALLBACK_HAIR_COLORS[Math.floor(hash / 7) % FALLBACK_HAIR_COLORS.length],
    hairStyle: playerSource.hairStyle ?? FALLBACK_HAIR_STYLES[Math.floor(hash / 13) % FALLBACK_HAIR_STYLES.length]
  };
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((char) => char + char).join("") : value;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  };
}

function readableTextColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? PIXEL_RENDERER.colors.black : "#ffffff";
}

function shadeHex(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const shift = (value) => Math.max(0, Math.min(255, Math.round(value + amount)));
  return `rgb(${shift(r)}, ${shift(g)}, ${shift(b)})`;
}

function isMoving(entity) {
  return Math.hypot(entity.vx, entity.vy) > 18;
}

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.pixelRatio = window.devicePixelRatio || 1;
    this.viewport = { scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 };
    this.frame = 0;
    this.lastTimestamp = 0;
    this.lastRenderTimestamp = 0;
    this.runPhases = new Map();
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(220, Math.floor(rect.height));
    this.canvas.width = Math.floor(width * this.pixelRatio);
    this.canvas.height = Math.floor(height * this.pixelRatio);
    this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    const scale = Math.min(width / (FIELD.width + FIELD.goalDepth * 2), height / FIELD.height);
    this.viewport = {
      width,
      height,
      scale,
      offsetX: Math.floor((width - (FIELD.width + FIELD.goalDepth * 2) * scale) / 2 + FIELD.goalDepth * scale),
      offsetY: Math.floor((height - FIELD.height * scale) / 2)
    };
  }

  worldX(x) {
    return Math.round(this.viewport.offsetX + x * this.viewport.scale);
  }

  worldY(y) {
    return Math.round(this.viewport.offsetY + y * this.viewport.scale);
  }

  worldSize(value) {
    return Math.max(1, Math.round(value * this.viewport.scale));
  }

  render(snapshot) {
    const now = performance.now();
    const dt = this.lastRenderTimestamp ? Math.min(0.08, (now - this.lastRenderTimestamp) / 1000) : 1 / 60;
    this.lastRenderTimestamp = now;
    if (now - this.lastTimestamp > PIXEL_RENDERER.wobbleIntervalMs) {
      this.frame += 1;
      this.lastTimestamp = now;
    }

    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.viewport.width, this.viewport.height);
    this.drawBackground(ctx);
    this.drawPitch(ctx);
    this.drawBallTrail(ctx, snapshot.ball);
    this.drawPlayers(ctx, snapshot, dt);
    this.drawBall(ctx, snapshot.ball);
    this.drawOverlay(ctx, snapshot);
  }

  pixelRect(ctx, x, y, width, height, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
  }

  drawBackground(ctx) {
    const colors = PIXEL_RENDERER.colors;
    this.pixelRect(ctx, 0, 0, this.viewport.width, this.viewport.height, colors.void);
    const block = 16;
    for (let y = 0; y < this.viewport.height; y += block) {
      for (let x = 0; x < this.viewport.width; x += block) {
        if ((x / block + y / block) % 2 === 0) {
          this.pixelRect(ctx, x, y, block, block, "rgba(255,255,255,0.015)");
        }
      }
    }
  }

  drawPitch(ctx) {
    const colors = PIXEL_RENDERER.colors;
    const x = this.worldX(0);
    const y = this.worldY(0);
    const w = this.worldSize(FIELD.width);
    const h = this.worldSize(FIELD.height);
    const stripe = this.worldSize(PIXEL_RENDERER.stripeWidth);
    const line = PIXEL_RENDERER.lineWidth;

    for (let sx = 0; sx < w; sx += stripe) {
      const color = Math.floor(sx / stripe) % 2 === 0 ? colors.grassLight : colors.grassDark;
      this.pixelRect(ctx, x + sx, y, Math.min(stripe, w - sx), h, color);
    }

    for (let sx = 0; sx < w; sx += stripe * 2) {
      this.pixelRect(ctx, x + sx, y + h - 12, Math.min(stripe, w - sx), 12, colors.grassShadow);
    }

    this.drawRectOutline(ctx, x, y, w, h, colors.chalk, line);
    this.drawLine(ctx, FIELD.width / 2, 0, FIELD.width / 2, FIELD.height);
    this.drawPixelCircle(ctx, FIELD.width / 2, FIELD.height / 2, FIELD.centerCircleRadius);
    this.drawPixelSpot(ctx, FIELD.width / 2, FIELD.height / 2, 5);

    this.drawWorldBox(ctx, 0, (FIELD.height - FIELD.penaltyBoxHeight) / 2, FIELD.penaltyBoxWidth, FIELD.penaltyBoxHeight);
    this.drawWorldBox(ctx, FIELD.width - FIELD.penaltyBoxWidth, (FIELD.height - FIELD.penaltyBoxHeight) / 2, FIELD.penaltyBoxWidth, FIELD.penaltyBoxHeight);
    this.drawWorldBox(ctx, 0, (FIELD.height - FIELD.goalBoxHeight) / 2, FIELD.goalBoxWidth, FIELD.goalBoxHeight);
    this.drawWorldBox(ctx, FIELD.width - FIELD.goalBoxWidth, (FIELD.height - FIELD.goalBoxHeight) / 2, FIELD.goalBoxWidth, FIELD.goalBoxHeight);
    this.drawPixelSpot(ctx, FIELD.penaltyBoxWidth - 55, FIELD.height / 2, 4);
    this.drawPixelSpot(ctx, FIELD.width - FIELD.penaltyBoxWidth + 55, FIELD.height / 2, 4);

    this.drawGoal(ctx, "left");
    this.drawGoal(ctx, "right");
  }

  drawRectOutline(ctx, x, y, width, height, color, thickness = PIXEL_RENDERER.lineWidth) {
    this.pixelRect(ctx, x, y, width, thickness, color);
    this.pixelRect(ctx, x, y + height - thickness, width, thickness, color);
    this.pixelRect(ctx, x, y, thickness, height, color);
    this.pixelRect(ctx, x + width - thickness, y, thickness, height, color);
  }

  drawLine(ctx, x1, y1, x2, y2, color = PIXEL_RENDERER.colors.chalk, thickness = PIXEL_RENDERER.lineWidth) {
    const sx1 = this.worldX(x1);
    const sy1 = this.worldY(y1);
    const sx2 = this.worldX(x2);
    const sy2 = this.worldY(y2);
    if (sx1 === sx2) {
      this.pixelRect(ctx, sx1 - Math.floor(thickness / 2), Math.min(sy1, sy2), thickness, Math.abs(sy2 - sy1), color);
      return;
    }
    if (sy1 === sy2) {
      this.pixelRect(ctx, Math.min(sx1, sx2), sy1 - Math.floor(thickness / 2), Math.abs(sx2 - sx1), thickness, color);
      return;
    }

    const steps = Math.max(Math.abs(sx2 - sx1), Math.abs(sy2 - sy1));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      this.pixelRect(ctx, sx1 + (sx2 - sx1) * t, sy1 + (sy2 - sy1) * t, thickness, thickness, color);
    }
  }

  drawWorldBox(ctx, x, y, width, height) {
    this.drawRectOutline(ctx, this.worldX(x), this.worldY(y), this.worldSize(width), this.worldSize(height), PIXEL_RENDERER.colors.chalk);
  }

  drawPixelCircle(ctx, x, y, radius) {
    const color = PIXEL_RENDERER.colors.chalk;
    const cx = this.worldX(x);
    const cy = this.worldY(y);
    const r = this.worldSize(radius);
    const px = PIXEL_RENDERER.lineWidth;
    let dx = r;
    let dy = 0;
    let err = 0;

    while (dx >= dy) {
      this.plotCirclePixels(ctx, cx, cy, dx, dy, px, color);
      dy += 1;
      if (err <= 0) {
        err += 2 * dy + 1;
      }
      if (err > 0) {
        dx -= 1;
        err -= 2 * dx + 1;
      }
    }
  }

  plotCirclePixels(ctx, cx, cy, x, y, size, color) {
    const points = [
      [cx + x, cy + y],
      [cx + y, cy + x],
      [cx - y, cy + x],
      [cx - x, cy + y],
      [cx - x, cy - y],
      [cx - y, cy - x],
      [cx + y, cy - x],
      [cx + x, cy - y]
    ];
    for (const [px, py] of points) {
      this.pixelRect(ctx, px, py, size, size, color);
    }
  }

  drawPixelSpot(ctx, x, y, radius) {
    const size = this.worldSize(radius);
    this.pixelRect(ctx, this.worldX(x) - Math.floor(size / 2), this.worldY(y) - Math.floor(size / 2), size, size, PIXEL_RENDERER.colors.chalk);
  }

  drawGoal(ctx, side) {
    const colors = PIXEL_RENDERER.colors;
    const depth = this.worldSize(FIELD.goalDepth);
    const goalHeight = this.worldSize(FIELD.goalWidth);
    const y = this.worldY((FIELD.height - FIELD.goalWidth) / 2);
    const x = side === "left" ? this.worldX(0) - depth : this.worldX(FIELD.width);
    this.pixelRect(ctx, x, y, depth, goalHeight, "#24313c");
    this.drawRectOutline(ctx, x, y, depth, goalHeight, colors.chalk, PIXEL_RENDERER.lineWidth);
    const netLine = "#627083";
    for (let i = 1; i < 4; i += 1) {
      this.pixelRect(ctx, x + Math.round((depth / 4) * i), y + PIXEL_RENDERER.lineWidth, 1, goalHeight - PIXEL_RENDERER.lineWidth * 2, netLine);
    }
    for (let i = 1; i < 4; i += 1) {
      this.pixelRect(ctx, x + PIXEL_RENDERER.lineWidth, y + Math.round((goalHeight / 4) * i), depth - PIXEL_RENDERER.lineWidth * 2, 1, netLine);
    }
  }

  drawPlayers(ctx, snapshot, dt) {
    const orderedPlayers = [...snapshot.players].sort((a, b) => a.y - b.y);
    for (const player of orderedPlayers) {
      const x = this.worldX(player.x);
      const y = this.worldY(player.y);
      const moving = isMoving(player);
      const runFrame = this.runFrameForPlayer(player, dt);

      if (player.state === PLAYER_STATES.SEEK_BALL || snapshot.possessionPlayerId === player.id) {
        this.drawPixelSelector(ctx, x, y, snapshot.possessionPlayerId === player.id);
      }

      this.drawPlayerSprite(ctx, x, y, player, runFrame);
      this.drawPlayerLabel(ctx, x, y, player);
    }
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

  drawPixelSelector(ctx, x, y, hasPossession) {
    const color = hasPossession ? PIXEL_RENDERER.colors.hudAccent : "#58d7ff";
    const size = Math.max(22, this.worldSize(28));
    const thickness = 2;
    this.pixelRect(ctx, x - size / 2, y - size / 2, 8, thickness, color);
    this.pixelRect(ctx, x + size / 2 - 8, y - size / 2, 8, thickness, color);
    this.pixelRect(ctx, x - size / 2, y + size / 2, 8, thickness, color);
    this.pixelRect(ctx, x + size / 2 - 8, y + size / 2, 8, thickness, color);
    this.pixelRect(ctx, x - size / 2, y - size / 2, thickness, 8, color);
    this.pixelRect(ctx, x + size / 2, y - size / 2, thickness, 8, color);
    this.pixelRect(ctx, x - size / 2, y + size / 2 - 8, thickness, 8, color);
    this.pixelRect(ctx, x + size / 2, y + size / 2 - 8, thickness, 8, color);
  }

  drawPlayerSprite(ctx, x, y, player, runFrame) {
    const unit = Math.max(3, this.worldSize(PIXEL_RENDERER.playerPixel));
    const primary = player.team.primary ?? player.team.primaryColor;
    const secondary = player.team.secondary ?? player.team.secondaryColor;
    const spriteMeta = resolvePlayerSpriteMeta(player.source);
    const shade = shadeHex(primary, -42);
    const outline = PIXEL_RENDERER.colors.black;
    const boot = "#161616";
    const skin = spriteMeta.skinTone;
    const hair = spriteMeta.hairColor;
    const kitText = readableTextColor(primary);
    const torsoLift = runFrame === 1 || runFrame === 3 ? -unit : 0;
    const legSwing = runFrame === 0 ? -unit : runFrame === 1 ? 0 : runFrame === 2 ? unit : 0;
    const ox = Math.round(x - unit * 2.5);
    const oy = Math.round(y - unit * 3.2);

    const cell = (cx, cy, color, w = 1, h = 1) => {
      this.pixelRect(ctx, ox + cx * unit, oy + cy * unit + torsoLift, unit * w, unit * h, color);
    };
    const flat = (cx, cy, color, w = 1, h = 1) => {
      this.pixelRect(ctx, ox + cx * unit, oy + cy * unit, unit * w, unit * h, color);
    };

    flat(1, 0, outline, 3, 1);
    flat(1, 1, outline, 3, 1);
    flat(2, -0.2, skin, 1, 2);
    if (spriteMeta.hairStyle === "short") {
      flat(1, 0, hair, 3, 1);
    } else if (spriteMeta.hairStyle === "crop") {
      flat(1, 0, hair, 3, 1);
      flat(1, 1, hair, 1, 1);
    } else if (spriteMeta.hairStyle === "sidePart") {
      flat(1, 0, hair, 3, 1);
      flat(3, 1, hair, 1, 1);
    }
    flat(1, 1, secondary, 1, 1);
    flat(3, 1, secondary, 1, 1);

    cell(0, 2, outline, 5, 3);
    cell(1, 2, primary, 3, 2);
    cell(1, 4, shade, 3, 1);
    cell(0, 3, secondary, 1, 1);
    cell(4, 3, secondary, 1, 1);
    cell(2, 3, kitText, 1, 1);

    flat(1, 5, outline, 1, 2);
    flat(3, 5, outline, 1, 2);
    flat(1, 5, secondary, 1, 1);
    flat(3, 5, secondary, 1, 1);
    flat(1, 7, boot, 1, 1);
    flat(3, 7, boot, 1, 1);
    if (runFrame === 1 || runFrame === 2) {
      flat(0, 7, boot, 1, 1);
      flat(4, 6, boot, 1, 1);
    } else if (isMoving(player)) {
      flat(0, 6, boot, 1, 1);
      flat(4, 7, boot, 1, 1);
    }

    if (isMoving(player)) {
      this.pixelRect(ctx, ox + 2 * unit + legSwing, oy + 8 * unit, unit, unit, "rgba(0,0,0,0.28)");
    }
  }

  drawPlayerLabel(ctx, x, y, player) {
    if (this.viewport.scale <= 0.45) return;
    const label = player.name.split(" ").at(-1).slice(0, 9).toUpperCase();
    const fontSize = Math.max(7, Math.round(this.worldSize(8)));
    ctx.imageSmoothingEnabled = false;
    ctx.font = `${fontSize}px "Press Start 2P", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = PIXEL_RENDERER.colors.black;
    ctx.fillText(label, Math.round(x + 1), Math.round(y + this.worldSize(24) + 1));
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, Math.round(x), Math.round(y + this.worldSize(24)));
  }

  drawBallTrail(ctx, ball) {
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed < PIXEL_RENDERER.trailSpeed) return;
    const dirX = ball.vx / speed;
    const dirY = ball.vy / speed;
    const unit = Math.max(2, this.worldSize(PIXEL_RENDERER.ballPixel));
    const startX = this.worldX(ball.x);
    const startY = this.worldY(ball.y);

    for (let i = 1; i <= PIXEL_RENDERER.trailParticles; i += 1) {
      const size = Math.max(2, unit - Math.floor(i / 2));
      const gap = i * unit * 2.4;
      const flicker = (this.frame + i) % 2 === 0 ? unit : 0;
      this.pixelRect(ctx, startX - dirX * gap + flicker, startY - dirY * gap, size, size, PIXEL_RENDERER.colors.trail);
    }
  }

  drawBall(ctx, ball) {
    const unit = Math.max(3, this.worldSize(PIXEL_RENDERER.ballPixel));
    const x = this.worldX(ball.x);
    const y = this.worldY(ball.y);
    const ox = Math.round(x - unit * 2);
    const oy = Math.round(y - unit * 2);
    const colors = PIXEL_RENDERER.colors;

    this.pixelRect(ctx, ox + unit, oy, unit * 2, unit, colors.black);
    this.pixelRect(ctx, ox, oy + unit, unit * 4, unit * 2, colors.black);
    this.pixelRect(ctx, ox + unit, oy + unit * 3, unit * 2, unit, colors.black);
    this.pixelRect(ctx, ox + unit, oy + unit, unit * 2, unit * 2, colors.ballWhite);
    this.pixelRect(ctx, ox + unit * 2, oy + unit * 2, unit, unit, colors.ballShade);
  }

  drawOverlay(ctx, snapshot) {
    const colors = PIXEL_RENDERER.colors;
    const label = `${snapshot.homeTeam.name.toUpperCase()} ${snapshot.score.home}-${snapshot.score.away} ${snapshot.awayTeam.name.toUpperCase()}  ${formatClock(snapshot.gameMinutes)}`;
    const fontSize = 10;
    ctx.font = `${fontSize}px "Press Start 2P", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const width = Math.min(this.viewport.width - 28, Math.round(ctx.measureText(label).width + 34));
    const height = 34;
    const x = Math.round((this.viewport.width - width) / 2);
    const y = 12;
    this.pixelRect(ctx, x + 4, y + 4, width, height, colors.black);
    this.pixelRect(ctx, x, y, width, height, colors.hud);
    this.drawRectOutline(ctx, x, y, width, height, colors.chalk, 3);
    ctx.fillStyle = colors.chalk;
    ctx.fillText(label, Math.round(this.viewport.width / 2), y + Math.round(height / 2) + 1);

    if (snapshot.complete) {
      const bannerHeight = 62;
      const bannerY = Math.round(this.viewport.height / 2 - bannerHeight / 2);
      this.pixelRect(ctx, 0, bannerY, this.viewport.width, bannerHeight, colors.black);
      this.pixelRect(ctx, 0, bannerY + 4, this.viewport.width, bannerHeight - 8, colors.hud);
      this.pixelRect(ctx, 0, bannerY, this.viewport.width, 4, colors.chalk);
      this.pixelRect(ctx, 0, bannerY + bannerHeight - 4, this.viewport.width, 4, colors.chalk);
      ctx.font = `18px "Press Start 2P", monospace`;
      ctx.fillStyle = colors.hudAccent;
      ctx.fillText("FULL TIME", Math.round(this.viewport.width / 2), Math.round(this.viewport.height / 2));
    }
  }
}
