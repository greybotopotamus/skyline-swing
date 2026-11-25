import * as THREE from 'three';

// Procedurally painted textures for people, drawn on canvases at startup (no files).
// They're near-white so per-person colours (skin tone, hair colour, clothes) can
// tint them through instance colours / material colour.

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(canvas, repeat) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

function addNoise(ctx, w, h, amount) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function blob(ctx, x, y, rx, ry, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function softSpot(ctx, x, y, r, rgba) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// Face for a SphereGeometry head. Sphere UVs wrap u around the head; u = 0.25 is
// the +Z side, so the face is painted there. v runs top (0) to bottom of the canvas.
export function faceTexture({ eyes = true, stubble = false } = {}) {
  const W = 512;
  const H = 256;
  const [c, x] = makeCanvas(W, H);
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, W, H);
  const cx = W * 0.25;

  // Features are drawn ~20% larger than life so they read from a distance.
  x.save();
  x.translate(cx, 135);
  x.scale(1.22, 1.18);
  x.translate(-cx, -135);

  // Soft shading: cheeks, nose bridge, under the chin.
  softSpot(x, cx - 40, 143, 24, 'rgba(235,150,140,0.32)');
  softSpot(x, cx + 40, 143, 24, 'rgba(235,150,140,0.32)');
  softSpot(x, cx - 9, 134, 8, 'rgba(160,110,90,0.25)');
  softSpot(x, cx + 9, 134, 8, 'rgba(160,110,90,0.25)');
  softSpot(x, cx, 198, 40, 'rgba(150,110,95,0.25)');
  softSpot(x, cx - 24, 128, 10, 'rgba(150,100,90,0.18)'); // eye sockets
  softSpot(x, cx + 24, 128, 10, 'rgba(150,100,90,0.18)');

  if (eyes) {
    // Brows.
    x.strokeStyle = 'rgba(45,30,22,0.85)';
    x.lineWidth = 3.5;
    x.lineCap = 'round';
    for (const s of [-1, 1]) {
      x.beginPath();
      x.moveTo(cx + s * 16, 107);
      x.quadraticCurveTo(cx + s * 26, 101, cx + s * 37, 106);
      x.stroke();
    }
    // Eyes: lid line, iris, highlight.
    for (const s of [-1, 1]) {
      const ex = cx + s * 26;
      blob(x, ex, 121, 8, 4, 'rgba(250,250,250,1)');
      blob(x, ex, 121, 3.6, 3.6, 'rgba(45,32,25,1)');
      blob(x, ex + 1, 120, 1, 1, 'rgba(255,255,255,0.9)');
      x.strokeStyle = 'rgba(40,25,20,0.9)';
      x.lineWidth = 1.6;
      x.beginPath();
      x.ellipse(ex, 122, 8.5, 4.5, 0, Math.PI * 1.05, Math.PI * 1.95);
      x.stroke();
    }
  }

  // Nose tip and nostrils.
  softSpot(x, cx, 142, 6, 'rgba(170,110,95,0.35)');
  blob(x, cx - 3.5, 145, 1.6, 1.1, 'rgba(90,50,40,0.6)');
  blob(x, cx + 3.5, 145, 1.6, 1.1, 'rgba(90,50,40,0.6)');

  // Lips and mouth line.
  blob(x, cx, 163, 13, 3.2, 'rgba(185,95,90,0.55)');
  blob(x, cx, 167, 10, 2.6, 'rgba(195,110,100,0.45)');
  x.strokeStyle = 'rgba(90,40,38,0.85)';
  x.lineWidth = 1.4;
  x.beginPath();
  x.moveTo(cx - 12, 164.5);
  x.quadraticCurveTo(cx, 166.5, cx + 12, 164.5);
  x.stroke();

  if (stubble) {
    for (let i = 0; i < 1400; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random());
      const px = cx + Math.cos(a) * r * 52;
      const py = 175 + Math.sin(a) * r * 26 - 6;
      if (py < 150) continue;
      x.fillStyle = `rgba(60,45,35,${0.12 + Math.random() * 0.12})`;
      x.fillRect(px, py, 1.2, 1.2);
    }
  }

  x.restore();
  addNoise(x, W, H, 10); // skin grain
  return toTexture(c);
}

// Hair: strands running down the head (along v).
export function hairTexture() {
  const S = 256;
  const [c, x] = makeCanvas(S, S);
  x.fillStyle = '#d8d8d8';
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const g = 140 + Math.random() * 115;
    x.strokeStyle = `rgba(${g},${g},${g},0.55)`;
    x.lineWidth = 0.6 + Math.random() * 0.8;
    const px = Math.random() * S;
    const py = Math.random() * S;
    const len = 30 + Math.random() * 110;
    x.beginPath();
    x.moveTo(px, py);
    x.quadraticCurveTo(px + (Math.random() - 0.5) * 8, py + len / 2, px + (Math.random() - 0.5) * 6, py + len);
    x.stroke();
  }
  return toTexture(c, [3, 1]);
}

// Denim: diagonal twill weave with fading.
export function denimTexture() {
  const S = 256;
  const [c, x] = makeCanvas(S, S);
  x.fillStyle = '#e8eaf0';
  x.fillRect(0, 0, S, S);
  x.strokeStyle = 'rgba(150,155,170,0.45)';
  x.lineWidth = 1.2;
  for (let k = -S; k < S * 2; k += 3) {
    x.beginPath();
    x.moveTo(k, 0);
    x.lineTo(k + S, S);
    x.stroke();
  }
  for (let i = 0; i < 400; i++) {
    x.fillStyle = `rgba(255,255,255,${Math.random() * 0.25})`;
    x.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 6, 1);
  }
  addNoise(x, S, S, 18);
  return toTexture(c, [3, 3]);
}

// Knit/jersey: fine horizontal ribs.
export function knitTexture() {
  const S = 256;
  const [c, x] = makeCanvas(S, S);
  x.fillStyle = '#f4f4f4';
  x.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 4) {
    x.fillStyle = 'rgba(190,190,190,0.35)';
    x.fillRect(0, y, S, 1.4);
  }
  for (let xx = 0; xx < S; xx += 3) {
    x.fillStyle = 'rgba(210,210,210,0.25)';
    x.fillRect(xx, 0, 1, S);
  }
  addNoise(x, S, S, 12);
  return toTexture(c, [4, 4]);
}
