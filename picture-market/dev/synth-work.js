export function synthCore() {
  const clock = typeof performance === 'object' && performance && typeof performance.now === 'function' ? () => performance.now() : () => Date.now();
  const BIG = 2147483647;
  const EXPN = 768;
  const EXPRES = 64;
  const PENMAX = 255;
  const DTCAP = 60;

  function start(job) {
    const W = job.w | 0;
    const H = job.h | 0;
    const N = W * H;
    let w = W;
    let h = H;
    let n = N;
    let rx0 = 0;
    let ry0 = 0;
    let wimg = null;
    const tune = job.tune || {};
    const opt = (k, d) => (tune[k] === undefined ? d : tune[k]);
    const maxMs = job.maxMs > 0 ? job.maxMs : 20000;
    const hasInit = !!job.init;
    const out = new Uint8ClampedArray(N * 4);
    const levels = [];
    const stats = {
      w: W, h: H, roi: null, target: 0, known: 0, patch: 0, levels: 0, coarsest: 0, stopLevel: -1, iters: [], sparse: [], msLevel: [], sourcesLevel: [],
      sources: 0, fallback: 'none', meanDist: 0, budgetCut: false, topShare: 0, coherent: 0, seamCycles: 0, seamMs: 0, setupMs: 0, totalMs: 0, steps: 0, longestStep: 0, longestPhase: ''
    };
    const expTab = new Float64Array(EXPN + 1);
    for (let i = 0; i < EXPN; i++) expTab[i] = Math.exp(-i / EXPRES);
    const invCnt = new Float64Array(64);
    for (let i = 1; i < 64; i++) invCnt[i] = 1 / i;
    const vd = new Float64Array(64);
    const vc = new Float64Array(64);
    const vq = new Int32Array(64);
    const penTab = new Int32Array(PENMAX + 2);
    const confTab = new Float32Array(DTCAP + 1);
    const gamma = opt('gamma', 1.3);
    for (let i = 0; i <= DTCAP; i++) confTab[i] = Math.pow(gamma, -i / 3);

    let rs = ((job.seed | 0) ^ 0x9e3779b9) | 0;
    if (rs === 0) rs = 0x1234567;
    let deadline = 0;
    let done = false;
    let frac = 0;
    let doneU = 0;
    let totalU = 1;
    let t0 = 0;
    let nT = 0;
    let nK = 0;
    let P = 7;
    let half = 3;
    let scratchA = null;
    let scratchB = null;
    let sm = null;
    let searchMs = 0;
    let searchUnits = 0;
    let voteChange = 0;

    let im = null;
    let ft = null;
    let df = null;
    let cl = null;
    let srcA = null;
    let nnf = null;
    let cost = null;
    let cen = null;
    let cnt = null;
    let conf = null;
    let use = null;
    let lw = 0;
    let lh = 0;
    let ln = 0;
    let lw4 = 0;
    let lw2 = 0;
    let po = 0;
    let P4 = 28;
    let P2 = 14;
    let lam = 0;
    const fcap = opt('featCap', 200);
    let nearK = 0;
    let nearR = 1;
    let thickPx = 1;
    let bx0 = 0;
    let by0 = 0;
    let bw = 0;
    let bh = 0;
    let sx0 = 0;
    let sy0 = 0;
    let sx1 = 0;
    let sy1 = 0;
    let cq = 0;
    let cd = 0;
    let ceff = 0;
    let voteK = 0.5;
    let cohR = 1;
    let cohP = 1;
    let soft = 3;
    let peelBudget = 1e6;
    let unitMs = 1e-4;
    let phase = 'setup';
    let srcList = null;
    let actA = null;
    let bl = null;
    let pri = null;
    let pw = null;
    let bs = null;
    let pk = 0;
    let cbi = 0;
    const pdz = opt('priorDz', 6);
    const pcap = opt('priorCap', 80);

    const late = () => clock() >= deadline;
    const adv = (u) => {
      doneU += u;
      const f = doneU / totalU;
      if (f > frac) frac = f < 0.999 ? f : 0.999;
    };
    const rnd = () => {
      rs ^= rs << 13;
      rs ^= rs >>> 17;
      rs ^= rs << 5;
      return rs >>> 0;
    };

    function bind(lev) {
      im = lev.img;
      ft = lev.feat;
      cl = lev.cls;
      df = lev.def || lev.cls;
      srcA = lev.src;
      nnf = lev.nnf;
      cost = lev.cost;
      cen = lev.cen;
      cnt = lev.cnt;
      conf = lev.conf;
      use = lev.use;
      lw = lev.w;
      lh = lev.h;
      ln = lev.n;
      lw4 = lw * 4;
      lw2 = lw * 2;
      po = half * lw + half;
      P4 = P * 4;
      P2 = P * 2;
      lam = lev.lam;
      nearR = Math.max(3, (opt('nearR', 4) * thickPx * lev.w) / w);
      bx0 = lev.bx0;
      by0 = lev.by0;
      bw = lev.bw;
      bh = lev.bh;
      sx0 = lev.sx0;
      sy0 = lev.sy0;
      sx1 = lev.sx1;
      sy1 = lev.sy1;
      pri = lev.pri || null;
      pw = lev.pw || null;
      bs = lev.bs || null;
      pk = pri !== null && bs !== null ? lev.pk : 0;
    }

    function distFast(pi, qi, thr) {
      let a = (pi - po) << 2;
      let b = (qi - po) << 2;
      let d = 0;
      for (let r = 0; r < P; r++) {
        for (let k = 0; k < P4; k += 4) {
          const d0 = im[a + k] - im[b + k];
          const d1 = im[a + k + 1] - im[b + k + 1];
          const d2 = im[a + k + 2] - im[b + k + 2];
          d += d0 * d0 + d1 * d1 + d2 * d2;
        }
        if (d >= thr) return d;
        a += lw4;
        b += lw4;
      }
      if (lam > 0) {
        a = (pi - po) << 1;
        b = (qi - po) << 1;
        let f = 0;
        for (let r = 0; r < P; r++) {
          for (let k = 0; k < P2; k += 2) {
            const e0 = ft[a + k] - ft[b + k];
            const e1 = ft[a + k + 1] - ft[b + k + 1];
            const ee = e0 * e0 + e1 * e1;
            f += ee > fcap ? fcap : ee;
          }
          a += lw2;
          b += lw2;
        }
        d += (f * lam) >> 4;
      }
      return d;
    }

    function distSlow(px, py, qi, thr) {
      const dl = qi - (py * lw + px);
      const y0 = py - half < 0 ? 0 : py - half;
      const y1 = py + half >= lh ? lh - 1 : py + half;
      const x0 = px - half < 0 ? 0 : px - half;
      const x1 = px + half >= lw ? lw - 1 : px + half;
      let d = 0;
      let f = 0;
      for (let y = y0; y <= y1; y++) {
        let i = y * lw + x0;
        const e = y * lw + x1;
        for (; i <= e; i++) {
          const dv = df[i];
          if (dv !== 0) {
            const a = i << 2;
            const b = (i + dl) << 2;
            const d0 = im[a] - im[b];
            const d1 = im[a + 1] - im[b + 1];
            const d2 = im[a + 2] - im[b + 2];
            if (dv === 3) {
              if (bl !== null) {
                const e0 = im[a] - bl[b];
                const e1 = im[a + 1] - bl[b + 1];
                const e2 = im[a + 2] - bl[b + 2];
                d += (e0 * e0 + e1 * e1 + e2 * e2) >> soft;
              } else d += (d0 * d0 + d1 * d1 + d2 * d2) >> soft;
              continue;
            }
            d += d0 * d0 + d1 * d1 + d2 * d2;
            if (lam > 0) {
              const e0 = ft[i << 1] - ft[(i + dl) << 1];
              const e1 = ft[(i << 1) + 1] - ft[((i + dl) << 1) + 1];
              const ee = e0 * e0 + e1 * e1;
              f += ee > fcap ? fcap : ee;
            }
          }
        }
        if (d >= thr) return d;
      }
      if (lam > 0) d += (f * lam) >> 4;
      return d;
    }

    function nearPen(px, py, q) {
      if (nearK === 0) return 0;
      const dx = (q % lw) - px;
      const dy = ((q / lw) | 0) - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      return ((nearK * d) / (d + nearR)) | 0;
    }

    function priorPen(q) {
      const wt = pw[cbi];
      if (wt === 0) return 0;
      const o = cbi * 3;
      const b = q * 3;
      let a = pri[o] - bs[b];
      if (a < 0) a = -a;
      a -= pdz;
      let sum = 0;
      if (a > 0) sum = a > pcap ? pcap * pcap : a * a;
      a = pri[o + 1] - bs[b + 1];
      if (a < 0) a = -a;
      a -= pdz;
      if (a > 0) sum += a > pcap ? pcap * pcap : a * a;
      a = pri[o + 2] - bs[b + 2];
      if (a < 0) a = -a;
      a -= pdz;
      if (a > 0) sum += a > pcap ? pcap * pcap : a * a;
      return wt * pk * sum;
    }

    function consider(qc, fast, pi, px, py, bias) {
      const u = use[qc];
      const pc = penTab[u < PENMAX ? u + 1 : PENMAX] + nearPen(px, py, qc) + (pk > 0 ? priorPen(qc) : 0);
      const thr = (ceff - pc) * bias;
      if (thr <= 0) return false;
      const dc = fast ? distFast(pi, qc, thr) : distSlow(px, py, qc, thr);
      if (dc >= thr) return false;
      if (cq >= 0 && use[cq] > 0) use[cq]--;
      if (u < 65535) use[qc] = u + 1;
      cq = qc;
      cd = dc;
      ceff = dc / bias + pc;
      return true;
    }

    function searchSpan(y, xa, xb, fwd, r0) {
      const row = y * bw;
      const py = by0 + y;
      const sx = fwd ? 1 : -1;
      let x = fwd ? xa : xb - 1;
      for (let c = xb - xa; c > 0; c--, x += sx) {
        const bi = row + x;
        const cf = cen[bi];
        if (cf === 0 || (actA !== null && actA[bi] === 0)) continue;
        const px = bx0 + x;
        const pi = py * lw + px;
        const fast = (cf & 2) !== 0;
        cq = nnf[bi];
        cbi = bi;
        const was = cq;
        cd = fast ? distFast(pi, cq, BIG) : distSlow(px, py, cq, BIG);
        const u0 = use[cq];
        ceff = cd + penTab[u0 < PENMAX ? u0 : PENMAX] + nearPen(px, py, cq) + (pk > 0 ? priorPen(cq) : 0);
        const nx = x - sx;
        if (nx >= 0 && nx < bw && cen[row + nx] !== 0) {
          const qc = nnf[row + nx] + sx;
          if (qc !== cq && qc >= 0 && qc < ln && srcA[qc] !== 0) consider(qc, fast, pi, px, py, 1);
        }
        const ny = y - sx;
        if (ny >= 0 && ny < bh && cen[bi - sx * bw] !== 0) {
          const qc = nnf[bi - sx * bw] + sx * lw;
          if (qc !== cq && qc >= 0 && qc < ln && srcA[qc] !== 0) consider(qc, fast, pi, px, py, 1);
        }
        let rr = r0;
        let qx = cq % lw;
        let qy = (cq / lw) | 0;
        while (rr >= 1) {
          const span = 2 * rr + 1;
          let cx = qx - rr + (rnd() % span);
          let cy = qy - rr + (rnd() % span);
          if (cx < sx0) cx = sx0;
          else if (cx > sx1) cx = sx1;
          if (cy < sy0) cy = sy0;
          else if (cy > sy1) cy = sy1;
          const qc = cy * lw + cx;
          if (qc !== cq && srcA[qc] !== 0 && consider(qc, fast, pi, px, py, cohR)) {
            qx = cx;
            qy = cy;
          }
          rr >>= 1;
        }
        nnf[bi] = cq;
        cost[bi] = cd;
        if (actA !== null && cq !== was && cl[pi] === 2) {
          const o = pi << 2;
          const q4 = cq << 2;
          im[o] = im[q4];
          im[o + 1] = im[q4 + 1];
          im[o + 2] = im[q4 + 2];
        }
      }
    }

    function voteSpan(y, xa, xb, feats) {
      const py = by0 + y;
      const oy0 = py - half < 0 ? -py : -half;
      const oy1 = py + half >= lh ? lh - 1 - py : half;
      let ch = 0;
      for (let x = xa; x < xb; x++) {
        const px = bx0 + x;
        const pi = py * lw + px;
        if (cl[pi] !== 2) continue;
        const bi = y * bw + x;
        const ox0 = px - half < 0 ? -px : -half;
        const ox1 = px + half >= lw ? lw - 1 - px : half;
        let m = 0;
        let dmin = 1e30;
        let dsum = 0;
        for (let oy = oy0; oy <= oy1; oy++) {
          for (let ox = ox0; ox <= ox1; ox++) {
            const cb = bi + oy * bw + ox;
            const dn = cost[cb] * invCnt[cnt[cb]];
            vd[m] = dn;
            vq[m] = nnf[cb] - oy * lw - ox;
            vc[m] = conf[cb];
            m++;
            dsum += dn;
            if (dn < dmin) dmin = dn;
          }
        }
        const sc = voteK * (dsum / m - dmin) + 1e-6 * (1 + dmin);
        const inv = EXPRES / sc;
        let wr = 0;
        let wg = 0;
        let wb = 0;
        let ws = 0;
        let f0 = 0;
        let f1 = 0;
        for (let j = 0; j < m; j++) {
          const t = (vd[j] - dmin) * inv;
          if (t >= EXPN) continue;
          const wj = vc[j] * expTab[t | 0];
          const s = vq[j] << 2;
          wr += wj * im[s];
          wg += wj * im[s + 1];
          wb += wj * im[s + 2];
          ws += wj;
          if (feats) {
            const s2 = vq[j] << 1;
            f0 += wj * ft[s2];
            f1 += wj * ft[s2 + 1];
          }
        }
        const o = pi << 2;
        const nr = (wr / ws + 0.5) | 0;
        const ng = (wg / ws + 0.5) | 0;
        const nb = (wb / ws + 0.5) | 0;
        ch += (nr > im[o] ? nr - im[o] : im[o] - nr) + (ng > im[o + 1] ? ng - im[o + 1] : im[o + 1] - ng) + (nb > im[o + 2] ? nb - im[o + 2] : im[o + 2] - nb);
        im[o] = nr;
        im[o + 1] = ng;
        im[o + 2] = nb;
        if (feats) {
          ft[pi << 1] = (f0 / ws + 0.5) | 0;
          ft[(pi << 1) + 1] = (f1 / ws + 0.5) | 0;
        }
      }
      return ch;
    }

    function* classify() {
      const src = job.rgba;
      const tg = job.target;
      const kn = job.known;
      const init = job.init;
      for (let o = 0; o < N * 4; o += 1 << 22) {
        out.set(src.subarray(o, Math.min(N * 4, o + (1 << 22))), o);
        if (late()) yield;
      }
      let x0 = W;
      let x1 = -1;
      let y0 = H;
      let y1 = -1;
      for (let y = 0; y < H; y++) {
        let i = y * W;
        let any = false;
        for (let x = 0; x < W; x++, i++) {
          if (tg[i]) {
            nT++;
            any = true;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
          } else if (kn && kn[i]) nK++;
        }
        if (any) {
          if (y < y0) y0 = y;
          y1 = y;
        }
        if ((y & 15) === 15 && late()) yield;
      }
      stats.target = nT;
      stats.known = nK;
      if (nT === 0) return;
      let m = Math.max(opt('roiMin', 128), Math.round(opt('roi', 1.5) * Math.max(x1 - x0 + 1, y1 - y0 + 1)));
      const need = Math.min(nK, opt('roiFill', 3) * nT);
      let ax = 0;
      let ay = 0;
      let bx = W - 1;
      let by = H - 1;
      for (;;) {
        ax = Math.max(0, x0 - m);
        ay = Math.max(0, y0 - m);
        bx = Math.min(W - 1, x1 + m);
        by = Math.min(H - 1, y1 + m);
        if (ax === 0 && ay === 0 && bx === W - 1 && by === H - 1) break;
        let c = 0;
        for (let y = ay; y <= by && c < need; y++) {
          let i = y * W + ax;
          for (let x = ax; x <= bx; x++, i++) if (!tg[i] && kn && kn[i]) c++;
        }
        if (late()) yield;
        if (c >= need) break;
        m *= 2;
      }
      rx0 = ax;
      ry0 = ay;
      w = bx - ax + 1;
      h = by - ay + 1;
      n = w * h;
      stats.roi = { x: ax, y: ay, w, h };
      const full = w === W && h === H;
      wimg = full ? out : new Uint8ClampedArray(n * 4);
      const cls = new Uint8Array(n);
      for (let y = 0; y < h; y++) {
        let i = (y + ry0) * W + rx0;
        let j = y * w;
        if (!full) wimg.set(src.subarray(i * 4, (i + w) * 4), j * 4);
        for (let x = 0; x < w; x++, i++, j++) {
          if (tg[i]) {
            cls[j] = 2;
            if (init) {
              wimg[j << 2] = init[i << 2];
              wimg[(j << 2) + 1] = init[(i << 2) + 1];
              wimg[(j << 2) + 2] = init[(i << 2) + 2];
            }
          } else if (kn && kn[i]) cls[j] = 1;
        }
        if ((y & 15) === 15 && late()) yield;
      }
      levels.push({ w, h, n, cls, img: wimg, feat: null, src: null, nSrc: 0, lam: 0 });
    }

    function* buildMasks() {
      for (let l = 0; l < 16; l++) {
        const a = levels[l];
        if (a.w <= 1 && a.h <= 1) break;
        const cw = (a.w + 1) >> 1;
        const chh = (a.h + 1) >> 1;
        const cls = new Uint8Array(cw * chh);
        const ac = a.cls;
        const every = Math.max(1, (40000 / cw) | 0);
        for (let y = 0; y < chh; y++) {
          const r0 = 2 * y * a.w;
          const two = 2 * y + 1 < a.h;
          for (let x = 0; x < cw; x++) {
            const i = r0 + 2 * x;
            const wide = 2 * x + 1 < a.w;
            let lo = ac[i];
            let hi = lo;
            if (wide) {
              const v = ac[i + 1];
              if (v < lo) lo = v;
              if (v > hi) hi = v;
            }
            if (two) {
              const v = ac[i + a.w];
              if (v < lo) lo = v;
              if (v > hi) hi = v;
              if (wide) {
                const v2 = ac[i + a.w + 1];
                if (v2 < lo) lo = v2;
                if (v2 > hi) hi = v2;
              }
            }
            cls[y * cw + x] = hi === 2 ? 2 : lo === 1 ? 1 : 0;
          }
          if (y % every === 0 && late()) yield;
        }
        levels.push({ w: cw, h: chh, n: cw * chh, cls, img: null, feat: null, src: null, nSrc: 0, lam: 0 });
      }
    }

    function* boxCount(lev, kind, dst) {
      const bwid = lev.w;
      const bhei = lev.h;
      const cls = lev.cls;
      const t1 = kind === 2 ? 0 : 1;
      const t2 = kind === 1 ? 0 : 1;
      const ring = new Uint8Array(P * bwid);
      const col = new Uint16Array(bwid);
      const every = Math.max(1, (30000 / bwid) | 0);
      for (let yy = 0; yy < bhei + half; yy++) {
        const slot = (yy % P) * bwid;
        if (yy >= P) for (let x = 0; x < bwid; x++) col[x] -= ring[slot + x];
        if (yy < bhei) {
          const r = yy * bwid;
          let run = 0;
          for (let x = 0; x < half && x < bwid; x++) {
            const v = cls[r + x];
            run += v === 1 ? t1 : v === 2 ? t2 : 0;
          }
          for (let x = 0; x < bwid; x++) {
            if (x + half < bwid) {
              const v = cls[r + x + half];
              run += v === 1 ? t1 : v === 2 ? t2 : 0;
            }
            if (x - half - 1 >= 0) {
              const v = cls[r + x - half - 1];
              run -= v === 1 ? t1 : v === 2 ? t2 : 0;
            }
            ring[slot + x] = run;
            col[x] += run;
          }
        } else {
          for (let x = 0; x < bwid; x++) ring[slot + x] = 0;
        }
        const y = yy - half;
        if (y >= 0) {
          const r = y * bwid;
          for (let x = 0; x < bwid; x++) dst[r + x] = col[x];
        }
        if (yy % every === 0 && late()) yield;
      }
    }

    function* countSources() {
      const full = P * P;
      let top = -1;
      for (let l = 0; l < levels.length; l++) {
        const lev = levels[l];
        lev.src = null;
        lev.nSrc = 0;
        if (lev.w < P || lev.h < P) break;
        const s = new Uint8Array(lev.n);
        yield* boxCount(lev, 1, s);
        let c = 0;
        let x0 = lev.w;
        let x1 = -1;
        let y0 = lev.h;
        let y1 = -1;
        for (let y = 0; y < lev.h; y++) {
          const r = y * lev.w;
          for (let x = 0; x < lev.w; x++) {
            if (s[r + x] === full) {
              s[r + x] = 1;
              c++;
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              y1 = y;
            } else s[r + x] = 0;
          }
          if ((y & 31) === 31 && late()) yield;
        }
        if (c === 0) break;
        lev.src = s;
        lev.nSrc = c;
        lev.sx0 = x0;
        lev.sx1 = x1;
        lev.sy0 = y0;
        lev.sy1 = y1;
        top = l;
      }
      return top;
    }

    function* thickness() {
      let l = 0;
      while (l < levels.length - 1 && levels[l].n > 250000) l++;
      const lev = levels[l];
      const tw = lev.w;
      const th = lev.h;
      const d = new Uint16Array(lev.n);
      const cls = lev.cls;
      let any = false;
      for (let i = 0; i < lev.n; i++) {
        if (cls[i] === 1) {
          d[i] = 0;
          any = true;
        } else d[i] = 60000;
      }
      if (!any) return 1e9;
      if (late()) yield;
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const i = y * tw + x;
          let v = d[i];
          if (v === 0) continue;
          if (x > 0 && d[i - 1] + 3 < v) v = d[i - 1] + 3;
          if (y > 0) {
            if (d[i - tw] + 3 < v) v = d[i - tw] + 3;
            if (x > 0 && d[i - tw - 1] + 4 < v) v = d[i - tw - 1] + 4;
            if (x < tw - 1 && d[i - tw + 1] + 4 < v) v = d[i - tw + 1] + 4;
          }
          d[i] = v;
        }
      }
      if (late()) yield;
      let worst = 0;
      for (let y = th - 1; y >= 0; y--) {
        for (let x = tw - 1; x >= 0; x--) {
          const i = y * tw + x;
          let v = d[i];
          if (v !== 0) {
            if (x < tw - 1 && d[i + 1] + 3 < v) v = d[i + 1] + 3;
            if (y < th - 1) {
              if (d[i + tw] + 3 < v) v = d[i + tw] + 3;
              if (x < tw - 1 && d[i + tw + 1] + 4 < v) v = d[i + tw + 1] + 4;
              if (x > 0 && d[i + tw - 1] + 4 < v) v = d[i + tw - 1] + 4;
            }
            d[i] = v;
          }
          if (cls[i] === 2 && v > worst) worst = v;
        }
      }
      return (worst / 3) * (1 << l);
    }

    function* features() {
      const feat = new Uint8Array(n * 2);
      const cls = levels[0].cls;
      const lim = hasInit ? 2 : 1;
      const every = Math.max(1, (20000 / w) | 0);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const c = cls[i];
          if (c === 0 || c > lim) continue;
          const o = i << 2;
          const l0 = (77 * wimg[o] + 150 * wimg[o + 1] + 29 * wimg[o + 2]) >> 8;
          let la = -1;
          let lb = -1;
          if (x > 0 && cls[i - 1] !== 0 && cls[i - 1] <= lim) la = (77 * wimg[o - 4] + 150 * wimg[o - 3] + 29 * wimg[o - 2]) >> 8;
          if (x < w - 1 && cls[i + 1] !== 0 && cls[i + 1] <= lim) lb = (77 * wimg[o + 4] + 150 * wimg[o + 5] + 29 * wimg[o + 6]) >> 8;
          let g = la >= 0 && lb >= 0 ? 2 * (la > lb ? la - lb : lb - la) : la >= 0 ? 4 * (la > l0 ? la - l0 : l0 - la) : lb >= 0 ? 4 * (lb > l0 ? lb - l0 : l0 - lb) : 0;
          feat[i << 1] = g > 255 ? 255 : g;
          la = -1;
          lb = -1;
          if (y > 0 && cls[i - w] !== 0 && cls[i - w] <= lim) {
            const u = o - w * 4;
            la = (77 * wimg[u] + 150 * wimg[u + 1] + 29 * wimg[u + 2]) >> 8;
          }
          if (y < h - 1 && cls[i + w] !== 0 && cls[i + w] <= lim) {
            const u = o + w * 4;
            lb = (77 * wimg[u] + 150 * wimg[u + 1] + 29 * wimg[u + 2]) >> 8;
          }
          g = la >= 0 && lb >= 0 ? 2 * (la > lb ? la - lb : lb - la) : la >= 0 ? 4 * (la > l0 ? la - l0 : l0 - la) : lb >= 0 ? 4 * (lb > l0 ? lb - l0 : l0 - lb) : 0;
          feat[(i << 1) + 1] = g > 255 ? 255 : g;
        }
        if (y % every === 0 && late()) yield;
      }
      levels[0].feat = feat;
    }

    function* buildColour(top) {
      yield* features();
      const lim = hasInit ? 2 : 1;
      for (let l = 1; l <= top; l++) {
        const a = levels[l - 1];
        const b = levels[l];
        const img = new Uint8Array(b.n * 4);
        const feat = new Uint8Array(b.n * 2);
        const every = Math.max(1, (20000 / b.w) | 0);
        for (let y = 0; y < b.h; y++) {
          for (let x = 0; x < b.w; x++) {
            const j = y * b.w + x;
            const c = b.cls[j];
            if (c === 0 || c > lim) continue;
            let sr = 0;
            let sg = 0;
            let sb = 0;
            let s0 = 0;
            let s1 = 0;
            let m = 0;
            for (let dy = 0; dy < 2; dy++) {
              const yy = 2 * y + dy;
              if (yy >= a.h) break;
              for (let dx = 0; dx < 2; dx++) {
                const xx = 2 * x + dx;
                if (xx >= a.w) break;
                const i = yy * a.w + xx;
                const ca = a.cls[i];
                if (ca === 0 || ca > lim) continue;
                sr += a.img[i << 2];
                sg += a.img[(i << 2) + 1];
                sb += a.img[(i << 2) + 2];
                s0 += a.feat[i << 1];
                s1 += a.feat[(i << 1) + 1];
                m++;
              }
            }
            if (m === 0) continue;
            const hm = m >> 1;
            img[j << 2] = ((sr + hm) / m) | 0;
            img[(j << 2) + 1] = ((sg + hm) / m) | 0;
            img[(j << 2) + 2] = ((sb + hm) / m) | 0;
            img[(j << 2) + 3] = 255;
            feat[j << 1] = ((s0 + hm) / m) | 0;
            feat[(j << 1) + 1] = ((s1 + hm) / m) | 0;
          }
          if (y % every === 0 && late()) yield;
        }
        b.img = img;
        b.feat = feat;
      }
      const from = opt('featFrom', 2);
      const lamv = opt('lam', 160);
      for (let l = 0; l <= top; l++) levels[l].lam = l >= from ? lamv : 0;
      if (from > 0) levels[0].feat = null;
    }

    function* prepLevel(lev) {
      const fw = lev.w;
      const fh = lev.h;
      const cls = lev.cls;
      const tc = scratchA.subarray(0, lev.n);
      const dc = scratchB.subarray(0, lev.n);
      yield* boxCount(lev, 2, tc);
      yield* boxCount(lev, 3, dc);
      let x0 = fw;
      let x1 = -1;
      let y0 = fh;
      let y1 = -1;
      for (let y = 0; y < fh; y++) {
        const r = y * fw;
        for (let x = 0; x < fw; x++) {
          if (tc[r + x] !== 0) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            y1 = y;
          }
        }
        if ((y & 63) === 63 && late()) yield;
      }
      const cw = x1 - x0 + 1;
      const chh = y1 - y0 + 1;
      const c = new Uint8Array(cw * chh);
      const k = new Uint8Array(cw * chh);
      const full = P * P;
      let nc = 0;
      let nt = 0;
      for (let y = 0; y < chh; y++) {
        const r = (y + y0) * fw + x0;
        for (let x = 0; x < cw; x++) {
          if (tc[r + x] !== 0) {
            c[y * cw + x] = dc[r + x] === full ? 3 : 1;
            k[y * cw + x] = dc[r + x];
            nc++;
            if (cls[r + x] === 2) nt++;
          }
        }
        if ((y & 63) === 63 && late()) yield;
      }
      lev.bx0 = x0;
      lev.by0 = y0;
      lev.bw = cw;
      lev.bh = chh;
      lev.cen = c;
      lev.cnt = k;
      lev.nCen = nc;
      lev.nTar = nt;
      const pad = 21;
      const rx0 = x0 - pad < 0 ? 0 : x0 - pad;
      const ry0 = y0 - pad < 0 ? 0 : y0 - pad;
      const rx1 = x1 + pad >= fw ? fw - 1 : x1 + pad;
      const ry1 = y1 + pad >= fh ? fh - 1 : y1 + pad;
      const rw = rx1 - rx0 + 1;
      const rh = ry1 - ry0 + 1;
      const d = scratchA.subarray(0, rw * rh);
      const every = Math.max(1, (30000 / rw) | 0);
      for (let y = 0; y < rh; y++) {
        const r = (y + ry0) * fw + rx0;
        const o = y * rw;
        for (let x = 0; x < rw; x++) {
          let v = cls[r + x] === 1 ? 0 : DTCAP;
          if (v !== 0) {
            if (x > 0 && d[o + x - 1] + 3 < v) v = d[o + x - 1] + 3;
            if (y > 0) {
              if (d[o + x - rw] + 3 < v) v = d[o + x - rw] + 3;
              if (x > 0 && d[o + x - rw - 1] + 4 < v) v = d[o + x - rw - 1] + 4;
              if (x < rw - 1 && d[o + x - rw + 1] + 4 < v) v = d[o + x - rw + 1] + 4;
            }
          }
          d[o + x] = v;
        }
        if (y % every === 0 && late()) yield;
      }
      for (let y = rh - 1; y >= 0; y--) {
        const o = y * rw;
        for (let x = rw - 1; x >= 0; x--) {
          let v = d[o + x];
          if (v !== 0) {
            if (x < rw - 1 && d[o + x + 1] + 3 < v) v = d[o + x + 1] + 3;
            if (y < rh - 1) {
              if (d[o + x + rw] + 3 < v) v = d[o + x + rw] + 3;
              if (x < rw - 1 && d[o + x + rw + 1] + 4 < v) v = d[o + x + rw + 1] + 4;
              if (x > 0 && d[o + x + rw - 1] + 4 < v) v = d[o + x + rw - 1] + 4;
            }
            d[o + x] = v;
          }
        }
        if (y % every === 0 && late()) yield;
      }
      const cf = new Float32Array(cw * chh);
      for (let y = 0; y < chh; y++) {
        const o = (y + y0 - ry0) * rw + (x0 - rx0);
        for (let x = 0; x < cw; x++) cf[y * cw + x] = confTab[d[o + x]];
        if ((y & 63) === 63 && late()) yield;
      }
      lev.conf = cf;
      lev.nnf = new Int32Array(cw * chh);
      yield* fillAll(lev.nnf, -1);
      lev.cost = new Int32Array(cw * chh);
      lev.use = null;
      adv(lev.n * 2);
    }

    function setPenalty(lev) {
      const avg = Math.max(1, lev.nCen / Math.max(1, lev.nSrc));
      const kap = opt('occ', 30) * P * P * 3;
      const tau = opt('tau', 2);
      for (let u = 0; u <= PENMAX + 1; u++) {
        const ex = u / avg - tau;
        const v = ex > 0 ? kap * ex : 0;
        penTab[u] = v > 1e9 ? 1e9 : v;
      }
    }

    function* countUse(lev) {
      const u = new Uint16Array(lev.n);
      const f = lev.nnf;
      const c = lev.cen;
      for (let i = 0; i < f.length; i++) {
        if (c[i] !== 0 && f[i] >= 0 && u[f[i]] < 65535) u[f[i]]++;
        if ((i & 131071) === 131071 && late()) yield;
      }
      lev.use = u;
    }

    function* fillAll(arr, v) {
      for (let o = 0; o < arr.length; o += 1 << 20) {
        arr.fill(v, o, Math.min(arr.length, o + (1 << 20)));
        if (late()) yield;
      }
    }

    function iterCost(lev) {
      const per = searchUnits > 20000 ? (searchMs / searchUnits) * 1.3 : unitMs * 30;
      return lev.nCen * per * 1.2;
    }

    function mustCost(l) {
      return unitMs * nT * (6 + 5 * seamCycles()) * (l > 0 ? 1.7 : 1);
    }

    function seamCycles() {
      return opt('cycles', nT > 3e6 ? 1 : nT > 8e5 ? 2 : 3);
    }

    function randomSource(lev) {
      const sw = lev.sx1 - lev.sx0 + 1;
      const sh = lev.sy1 - lev.sy0 + 1;
      for (let t = 0; t < 400; t++) {
        const q = (lev.sy0 + (rnd() % sh)) * lev.w + lev.sx0 + (rnd() % sw);
        if (lev.src[q] !== 0) return q;
      }
      let q = (lev.sy0 + (rnd() % sh)) * lev.w + lev.sx0 + (rnd() % sw);
      for (let t = 0; t < lev.n; t++) {
        if (lev.src[q] !== 0) return q;
        q++;
        if (q >= lev.n) q = 0;
      }
      return 0;
    }

    function nearSource(lev, x, y) {
      const fw = lev.w;
      const fh = lev.h;
      const s = lev.src;
      for (let r = 0; r <= 8; r++) {
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= fh) continue;
          const edge = dy === -r || dy === r;
          for (let dx = -r; dx <= r; dx += edge ? 1 : 2 * r || 1) {
            const xx = x + dx;
            if (xx < 0 || xx >= fw) continue;
            if (s[yy * fw + xx] !== 0) return yy * fw + xx;
          }
        }
      }
      return randomSource(lev);
    }

    function nearestSource(lev, x, y) {
      const fw = lev.w;
      const s = lev.src;
      let best = -1;
      let bd = 1e30;
      for (let yy = lev.sy0; yy <= lev.sy1; yy++) {
        const dy = (yy - y) * (yy - y);
        if (dy >= bd) continue;
        for (let xx = lev.sx0; xx <= lev.sx1; xx++) {
          if (s[yy * fw + xx] === 0) continue;
          const d = dy + (xx - x) * (xx - x);
          if (d < bd) {
            bd = d;
            best = yy * fw + xx;
          }
        }
      }
      return best < 0 ? randomSource(lev) : best;
    }

    function peelPixel(i, scan, K) {
      const px = i % lw;
      const py = (i / lw) | 0;
      const bi = (py - by0) * bw + (px - bx0);
      cq = nnf[bi];
      cbi = bi;
      if (cq >= 0) {
        cd = cost[bi];
        const u0 = use[cq];
        ceff = cd + penTab[u0 < PENMAX ? u0 : PENMAX] + nearPen(px, py, cq) + (pk > 0 ? priorPen(cq) : 0);
      } else {
        cd = BIG;
        ceff = BIG;
      }
      for (let dy = -1; dy <= 1; dy++) {
        const yy = py + dy - by0;
        if (yy < 0 || yy >= bh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = px + dx - bx0;
          if ((dx === 0 && dy === 0) || xx < 0 || xx >= bw) continue;
          const qn = nnf[yy * bw + xx];
          if (qn < 0) continue;
          const qc = qn - dy * lw - dx;
          if (qc !== cq && qc >= 0 && qc < ln && srcA[qc] !== 0) consider(qc, false, i, px, py, 1);
        }
      }
      if (scan) {
        const m = srcList.length;
        let pos = rnd() % m;
        if (K >= m) {
          for (let k = 0; k < m; k++) {
            const qc = srcList[pos];
            if (++pos === m) pos = 0;
            if (qc !== cq) consider(qc, false, i, px, py, cohP);
          }
        } else {
          const st = m / K;
          let acc = pos;
          for (let k = 0; k < K; k++) {
            const qc = srcList[(acc | 0) % m];
            acc += st;
            if (qc !== cq) consider(qc, false, i, px, py, cohP);
          }
          if (cq >= 0) {
            let rr = (Math.sqrt(st) * 2) | 0;
            let qx = cq % lw;
            let qy = (cq / lw) | 0;
            while (rr >= 1) {
              for (let t = 0; t < 3; t++) {
                const span = 2 * rr + 1;
                const cx = qx - rr + (rnd() % span);
                const cy = qy - rr + (rnd() % span);
                if (cx < sx0 || cx > sx1 || cy < sy0 || cy > sy1) continue;
                const qc = cy * lw + cx;
                if (qc !== cq && srcA[qc] !== 0 && consider(qc, false, i, px, py, cohP)) {
                  qx = cx;
                  qy = cy;
                }
              }
              rr >>= 1;
            }
          }
        }
      }
      nnf[bi] = cq;
      cost[bi] = cd;
    }

    function* ringPrior(lev) {
      const fw = lev.w;
      const fh = lev.h;
      const cls = lev.cls;
      const img = lev.img;
      const done2 = new Uint8Array(lev.n);
      const queue = new Int32Array(lev.nTar + 1);
      const col = new Uint8Array((lev.nTar + 1) * 3);
      let qa = 0;
      let qb = 0;
      for (let i = 0; i < lev.n; i++) if (cls[i] === 1) done2[i] = 1;
      const touch = (i) => {
        const x = i % fw;
        const y = (i / fw) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= fh) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= fw) continue;
            const j = yy * fw + xx;
            if (cls[j] === 2 && done2[j] === 0) {
              done2[j] = 2;
              queue[qb++] = j;
            }
          }
        }
      };
      for (let i = 0; i < lev.n; i++) if (cls[i] === 1) touch(i);
      if (late()) yield;
      while (qa < qb) {
        const ra = qa;
        const rb = qb;
        for (let k = ra; k < rb; k++) {
          const i = queue[k];
          const x = i % fw;
          const y = (i / fw) | 0;
          let r = 0;
          let g = 0;
          let b2 = 0;
          let m = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= fh) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= fw) continue;
              const j = yy * fw + xx;
              if (done2[j] !== 1) continue;
              const wt = dx === 0 || dy === 0 ? 2 : 1;
              r += wt * img[j << 2];
              g += wt * img[(j << 2) + 1];
              b2 += wt * img[(j << 2) + 2];
              m += wt;
            }
          }
          col[k * 3] = (r + (m >> 1)) / m;
          col[k * 3 + 1] = (g + (m >> 1)) / m;
          col[k * 3 + 2] = (b2 + (m >> 1)) / m;
        }
        for (let k = ra; k < rb; k++) {
          const i = queue[k];
          img[i << 2] = col[k * 3];
          img[(i << 2) + 1] = col[k * 3 + 1];
          img[(i << 2) + 2] = col[k * 3 + 2];
        }
        for (let k = ra; k < rb; k++) done2[queue[k]] = 1;
        for (let k = ra; k < rb; k++) touch(queue[k]);
        qa = rb;
        if (late()) yield;
      }
    }

    function* structurePeel(lev, def) {
      const cls = lev.cls;
      const cmap = new Float32Array(lev.n);
      const front = new Int32Array(lev.nTar + 8);
      const inF = new Uint8Array(lev.n);
      const fresh = new Int32Array(P * P);
      let fn = 0;
      for (let i = 0; i < lev.n; i++) if (cls[i] === 1) cmap[i] = 1;
      const addNb = (i) => {
        const x = i % lw;
        const y = (i / lw) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= lh) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= lw) continue;
            const j = yy * lw + xx;
            if (cls[j] === 2 && def[j] !== 1 && inF[j] === 0) {
              inF[j] = 1;
              front[fn++] = j;
            }
          }
        }
      };
      for (let i = 0; i < lev.n; i++) {
        if (cls[i] === 1) addNb(i);
        if ((i & 16383) === 16383 && late()) yield;
      }
      const K = Math.max(64, Math.min(lev.nSrc, (peelBudget / Math.max(1, lev.nTar / 6)) | 0));
      const lum = (j) => (77 * im[j << 2] + 150 * im[(j << 2) + 1] + 29 * im[(j << 2) + 2]) >> 8;
      const base = opt('prioBase', 0.2);
      let left = lev.nTar;
      while (left > 0) {
        let m = 0;
        for (let k = 0; k < fn; k++) {
          const i = front[k];
          if (def[i] !== 1) front[m++] = i;
          else inF[i] = 0;
        }
        fn = m;
        if (fn === 0) {
          let bestI = -1;
          let bc = -1;
          for (let y = 0; y < bh; y++) {
            for (let x = 0; x < bw; x++) {
              const i = (y + by0) * lw + x + bx0;
              if (cls[i] === 2 && def[i] !== 1 && conf[y * bw + x] > bc) {
                bc = conf[y * bw + x];
                bestI = i;
              }
            }
          }
          if (bestI < 0) break;
          inF[bestI] = 1;
          front[fn++] = bestI;
        }
        let best = -1;
        let bp = -1;
        let bcf = 0;
        for (let k = 0; k < fn; k++) {
          const i = front[k];
          const x = i % lw;
          const y = (i / lw) | 0;
          const ya = y - half < 0 ? 0 : y - half;
          const yb = y + half >= lh ? lh - 1 : y + half;
          const xa = x - half < 0 ? 0 : x - half;
          const xb = x + half >= lw ? lw - 1 : x + half;
          let cs = 0;
          let gm = 0;
          let gx = 0;
          let gy = 0;
          for (let yy = ya; yy <= yb; yy++) {
            for (let xx = xa; xx <= xb; xx++) {
              const j = yy * lw + xx;
              if (def[j] !== 1) continue;
              cs += cmap[j];
              if (xx > 0 && xx < lw - 1 && yy > 0 && yy < lh - 1 && xx - x >= -2 && xx - x <= 2 && yy - y >= -2 && yy - y <= 2 && def[j - 1] === 1 && def[j + 1] === 1 && def[j - lw] === 1 && def[j + lw] === 1) {
                const ax = lum(j + 1) - lum(j - 1);
                const ay = lum(j + lw) - lum(j - lw);
                const mg = ax * ax + ay * ay;
                if (mg > gm) {
                  gm = mg;
                  gx = ax;
                  gy = ay;
                }
              }
            }
          }
          const cb = cs / (P * P);
          const nx = (x < lw - 1 && def[i + 1] === 1 ? 1 : 0) - (x > 0 && def[i - 1] === 1 ? 1 : 0);
          const ny = (y < lh - 1 && def[i + lw] === 1 ? 1 : 0) - (y > 0 && def[i - lw] === 1 ? 1 : 0);
          const nl = Math.sqrt(nx * nx + ny * ny);
          const dterm = nl > 0 ? Math.abs(gx * ny - gy * nx) / (nl * 510) : 0;
          const pr = cb * (dterm + base);
          if (pr > bp) {
            bp = pr;
            best = i;
            bcf = cb;
          }
        }
        peelPixel(best, true, K);
        const bx = best % lw;
        const by = (best / lw) | 0;
        const bbi = (by - by0) * bw + (bx - bx0);
        let q = nnf[bbi];
        if (q < 0) {
          q = randomSource(lev);
          nnf[bbi] = q;
          cost[bbi] = 0;
          use[q]++;
        }
        let nf = 0;
        for (let dy = -half; dy <= half; dy++) {
          const yy = by + dy;
          if (yy < 0 || yy >= lh) continue;
          for (let dx = -half; dx <= half; dx++) {
            const xx = bx + dx;
            if (xx < 0 || xx >= lw) continue;
            const j = yy * lw + xx;
            if (cls[j] !== 2 || def[j] === 1) continue;
            const sq = q + dy * lw + dx;
            im[j << 2] = im[sq << 2];
            im[(j << 2) + 1] = im[(sq << 2) + 1];
            im[(j << 2) + 2] = im[(sq << 2) + 2];
            im[(j << 2) + 3] = 255;
            if (ft) {
              ft[j << 1] = ft[sq << 1];
              ft[(j << 1) + 1] = ft[(sq << 1) + 1];
            }
            def[j] = 1;
            cmap[j] = bcf > 0.02 ? bcf : 0.02;
            if (j !== best) {
              const qq = srcA[sq] !== 0 ? sq : nearSource(lev, sq % lw, (sq / lw) | 0);
              const bj = (yy - by0) * bw + (xx - bx0);
              nnf[bj] = qq;
              cost[bj] = 0;
              if (use[qq] < 65535) use[qq]++;
            }
            fresh[nf++] = j;
          }
        }
        for (let k = 0; k < nf; k++) addNb(fresh[k]);
        left -= nf;
        adv(nf * 60);
        if (late()) yield;
      }
    }

    function* blurKnown(lev) {
      const fw = lev.w;
      const fh = lev.h;
      const cls = lev.cls;
      const img = lev.img;
      const o = new Uint8Array(lev.n * 4);
      const r = opt('priorBlur', 2);
      const every = Math.max(1, (4000 / fw) | 0);
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const i = y * fw + x;
          if (cls[i] !== 1) continue;
          let sr = 0;
          let sg = 0;
          let sb = 0;
          let m = 0;
          for (let yy = y - r < 0 ? 0 : y - r; yy <= y + r && yy < fh; yy++) {
            for (let xx = x - r < 0 ? 0 : x - r; xx <= x + r && xx < fw; xx++) {
              const j = yy * fw + xx;
              if (cls[j] !== 1) continue;
              sr += img[j << 2];
              sg += img[(j << 2) + 1];
              sb += img[(j << 2) + 2];
              m++;
            }
          }
          o[i << 2] = (sr + (m >> 1)) / m;
          o[(i << 2) + 1] = (sg + (m >> 1)) / m;
          o[(i << 2) + 2] = (sb + (m >> 1)) / m;
        }
        if (y % every === 0 && late()) yield;
      }
      return o;
    }

    function* blurSource(lev, R) {
      const fw = lev.w;
      const fh = lev.h;
      const cls = lev.cls;
      const img = lev.img;
      const o = new Uint8Array(lev.n * 3);
      const hc = new Uint16Array(lev.n);
      const every = Math.max(1, (20000 / fw) | 0);
      for (let y = 0; y < fh; y++) {
        const r = y * fw;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let m = 0;
        for (let x = -R; x < fw; x++) {
          const a = x + R;
          if (a < fw && cls[r + a] === 1) {
            const j = (r + a) << 2;
            sr += img[j];
            sg += img[j + 1];
            sb += img[j + 2];
            m++;
          }
          const b = x - R - 1;
          if (b >= 0 && cls[r + b] === 1) {
            const j = (r + b) << 2;
            sr -= img[j];
            sg -= img[j + 1];
            sb -= img[j + 2];
            m--;
          }
          if (x >= 0) {
            const k = (r + x) * 3;
            hc[r + x] = m > 65535 ? 65535 : m;
            if (m > 0) {
              o[k] = (sr / m + 0.5) | 0;
              o[k + 1] = (sg / m + 0.5) | 0;
              o[k + 2] = (sb / m + 0.5) | 0;
            }
          }
        }
        if (y % every === 0 && late()) yield;
      }
      const acc = new Float64Array(fw * 4);
      const res = new Uint8Array(lev.n * 3);
      for (let y = -R; y < fh; y++) {
        const a = y + R;
        const b = y - R - 1;
        if (a < fh) {
          const r = a * fw;
          for (let x = 0; x < fw; x++) {
            const c = hc[r + x];
            if (c === 0) continue;
            const k = (r + x) * 3;
            acc[x * 4] += c * o[k];
            acc[x * 4 + 1] += c * o[k + 1];
            acc[x * 4 + 2] += c * o[k + 2];
            acc[x * 4 + 3] += c;
          }
        }
        if (b >= 0) {
          const r = b * fw;
          for (let x = 0; x < fw; x++) {
            const c = hc[r + x];
            if (c === 0) continue;
            const k = (r + x) * 3;
            acc[x * 4] -= c * o[k];
            acc[x * 4 + 1] -= c * o[k + 1];
            acc[x * 4 + 2] -= c * o[k + 2];
            acc[x * 4 + 3] -= c;
          }
        }
        if (y >= 0) {
          const r = y * fw;
          for (let x = 0; x < fw; x++) {
            const c = acc[x * 4 + 3];
            if (c < 0.5) continue;
            const k = (r + x) * 3;
            res[k] = (acc[x * 4] / c + 0.5) | 0;
            res[k + 1] = (acc[x * 4 + 1] / c + 0.5) | 0;
            res[k + 2] = (acc[x * 4 + 2] / c + 0.5) | 0;
          }
        }
        if (y % every === 0 && late()) yield;
      }
      return res;
    }

    function* chamfer(lev) {
      const tw = lev.w;
      const th = lev.h;
      const cls = lev.cls;
      const d = new Uint16Array(lev.n);
      for (let i = 0; i < lev.n; i++) d[i] = cls[i] === 1 ? 0 : 60000;
      if (late()) yield;
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const i = y * tw + x;
          let v = d[i];
          if (v === 0) continue;
          if (x > 0 && d[i - 1] + 3 < v) v = d[i - 1] + 3;
          if (y > 0) {
            if (d[i - tw] + 3 < v) v = d[i - tw] + 3;
            if (x > 0 && d[i - tw - 1] + 4 < v) v = d[i - tw - 1] + 4;
            if (x < tw - 1 && d[i - tw + 1] + 4 < v) v = d[i - tw + 1] + 4;
          }
          d[i] = v;
        }
        if ((y & 63) === 63 && late()) yield;
      }
      for (let y = th - 1; y >= 0; y--) {
        for (let x = tw - 1; x >= 0; x--) {
          const i = y * tw + x;
          let v = d[i];
          if (v === 0) continue;
          if (x < tw - 1 && d[i + 1] + 3 < v) v = d[i + 1] + 3;
          if (y < th - 1) {
            if (d[i + tw] + 3 < v) v = d[i + tw] + 3;
            if (x < tw - 1 && d[i + tw + 1] + 4 < v) v = d[i + tw + 1] + 4;
            if (x > 0 && d[i + tw - 1] + 4 < v) v = d[i + tw - 1] + 4;
          }
          d[i] = v;
        }
        if ((y & 63) === 63 && late()) yield;
      }
      return d;
    }

    function priorGain(l) {
      const fade = opt('priorFade', [0, 0.5, 1]);
      return (opt('priorK', 1) * fade[Math.min(l, fade.length - 1)] * P * P) / 255;
    }

    function priorRadius(l) {
      return Math.max(1, Math.round((opt('priorR', 0.35) * thickPx) / (1 << l)));
    }

    function* capturePrior(lev, l) {
      if (opt('priorK', 1) <= 0) return;
      const cls = lev.cls;
      const img = lev.img;
      const d = yield* chamfer(lev);
      let deep = 1;
      for (let i = 0; i < lev.n; i++) if (cls[i] === 2 && d[i] < 60000 && d[i] > deep) deep = d[i];
      const a = opt('priorA', 0.15);
      const b = opt('priorB', 0.7);
      const cw = lev.bw;
      const chh = lev.bh;
      const pr = new Uint8Array(cw * chh * 3);
      const wt = new Uint8Array(cw * chh);
      for (let y = 0; y < chh; y++) {
        for (let x = 0; x < cw; x++) {
          const i = (y + lev.by0) * lev.w + x + lev.bx0;
          if (cls[i] !== 2) continue;
          const bi = y * cw + x;
          pr[bi * 3] = img[i << 2];
          pr[bi * 3 + 1] = img[(i << 2) + 1];
          pr[bi * 3 + 2] = img[(i << 2) + 2];
          const t = (d[i] / deep - a) / (b - a);
          wt[bi] = t <= 0 ? 0 : t >= 1 ? 255 : (t * 255 + 0.5) | 0;
        }
        if ((y & 63) === 63 && late()) yield;
      }
      lev.pri = pr;
      lev.pw = wt;
      lev.pk = priorGain(l);
      lev.bs = lev.pk > 0 ? yield* blurSource(lev, priorRadius(l)) : null;
    }

    function* upPrior(c, f, l) {
      if (!c.pri) return;
      const cw = c.bw;
      const chh = c.bh;
      const fw = f.bw;
      const pr = new Uint8Array(fw * f.bh * 3);
      const wt = new Uint8Array(fw * f.bh);
      const cp = c.pri;
      const cwt = c.pw;
      const ccl = c.cls;
      const every = Math.max(1, (20000 / fw) | 0);
      for (let y = 0; y < f.bh; y++) {
        const py = f.by0 + y;
        const gy = (py - 0.5) / 2 - c.by0;
        let y0 = Math.floor(gy);
        const ty = gy - y0;
        let y1 = y0 + 1;
        if (y0 < 0) y0 = 0;
        if (y1 < 0) y1 = 0;
        if (y0 >= chh) y0 = chh - 1;
        if (y1 >= chh) y1 = chh - 1;
        for (let x = 0; x < fw; x++) {
          const px = f.bx0 + x;
          if (f.cls[py * f.w + px] !== 2) continue;
          const gx = (px - 0.5) / 2 - c.bx0;
          let x0 = Math.floor(gx);
          const tx = gx - x0;
          let x1 = x0 + 1;
          if (x0 < 0) x0 = 0;
          if (x1 < 0) x1 = 0;
          if (x0 >= cw) x0 = cw - 1;
          if (x1 >= cw) x1 = cw - 1;
          let sr = 0;
          let sg = 0;
          let sb = 0;
          let sw = 0;
          let ws = 0;
          for (let k = 0; k < 4; k++) {
            const xx = k & 1 ? x1 : x0;
            const yy = k & 2 ? y1 : y0;
            const bw2 = (k & 1 ? tx : 1 - tx) * (k & 2 ? ty : 1 - ty);
            const ci = yy * cw + xx;
            if (ccl[(yy + c.by0) * c.w + xx + c.bx0] !== 2) continue;
            sr += bw2 * cp[ci * 3];
            sg += bw2 * cp[ci * 3 + 1];
            sb += bw2 * cp[ci * 3 + 2];
            sw += bw2;
            ws += bw2 * cwt[ci];
          }
          if (sw <= 0) continue;
          const bi = y * fw + x;
          pr[bi * 3] = (sr / sw + 0.5) | 0;
          pr[bi * 3 + 1] = (sg / sw + 0.5) | 0;
          pr[bi * 3 + 2] = (sb / sw + 0.5) | 0;
          wt[bi] = (ws + 0.5) | 0;
        }
        if (y % every === 0 && late()) yield;
      }
      f.pri = pr;
      f.pw = wt;
      f.pk = priorGain(l);
      f.bs = f.pk > 0 ? yield* blurSource(f, priorRadius(l)) : null;
      c.pri = null;
      c.pw = null;
      c.bs = null;
    }

    function* peel(lev) {
      const def = new Uint8Array(lev.n);
      const cls = lev.cls;
      soft = opt('soft', 3);
      if (soft < 8) {
        yield* membrane(lev);
        if (opt('priorKind', 'ring') === 'membrane') yield* capturePrior(lev, stats.coarsest);
        if (opt('prior', 'ring') === 'ring') yield* ringPrior(lev);
        if (opt('priorKind', 'ring') !== 'membrane') yield* capturePrior(lev, stats.coarsest);
      }
      for (let i = 0; i < lev.n; i++) def[i] = cls[i] === 1 ? 1 : cls[i] === 2 && soft < 8 ? 3 : 0;
      lev.def = def;
      lev.use = new Uint16Array(lev.n);
      setPenalty(lev);
      bind(lev);
      bl = soft < 8 && opt('priorBlur', 2) > 0 && lev.n <= 1500000 ? yield* blurKnown(lev) : null;
      const queue = new Int32Array(lev.nTar + 1);
      const mark = new Uint8Array(lev.n);
      srcList = new Int32Array(lev.nSrc);
      for (let i = 0, k = 0; i < lev.n; i++) if (lev.src[i] !== 0) srcList[k++] = i;
      cohP = 1 / (1 + opt('peelCoh', 0.6));
      if (opt('order', 'structure') === 'structure') {
        yield* structurePeel(lev, def);
        lev.def = null;
        df = cls;
        srcList = null;
        bl = null;
        return;
      }
      const K = Math.max(64, Math.min(lev.nSrc, (peelBudget / Math.max(1, lev.nTar)) | 0));
      let qa = 0;
      let qb = 0;
      const push = (i) => {
        const x = i % lw;
        const y = (i / lw) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= lh) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= lw) continue;
            const j = yy * lw + xx;
            if (cls[j] === 2 && def[j] !== 1 && mark[j] === 0) {
              mark[j] = 1;
              queue[qb++] = j;
            }
          }
        }
      };
      for (let y = by0; y < by0 + bh; y++) {
        for (let x = bx0; x < bx0 + bw; x++) {
          const i = y * lw + x;
          if (cls[i] !== 2) continue;
          let near = false;
          for (let dy = -1; dy <= 1 && !near; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= lh) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx >= 0 && xx < lw && def[yy * lw + xx] === 1) {
                near = true;
                break;
              }
            }
          }
          if (near) {
            mark[i] = 1;
            queue[qb++] = i;
          }
        }
        if ((y & 15) === 15 && late()) yield;
      }
      let left = lev.nTar;
      let tick = 0;
      while (left > 0) {
        if (qa === qb) {
          let bestI = -1;
          let bc = -1;
          for (let y = 0; y < bh; y++) {
            for (let x = 0; x < bw; x++) {
              const i = (y + by0) * lw + x + bx0;
              if (cls[i] === 2 && def[i] !== 1 && conf[y * bw + x] > bc) {
                bc = conf[y * bw + x];
                bestI = i;
              }
            }
          }
          if (bestI < 0) break;
          mark[bestI] = 1;
          queue[qb++] = bestI;
          if (soft >= 8) {
            const sx = bestI % lw;
            const sy = (bestI / lw) | 0;
            const q = nearestSource(lev, sx, sy);
            const bi = (sy - by0) * bw + (sx - bx0);
            nnf[bi] = q;
            cost[bi] = 0;
            use[q]++;
          }
          if (late()) yield;
        }
        const ra = qa;
        const rb = qb;
        for (let pass = 0; pass < 2; pass++) {
          for (let k = 0; k < rb - ra; k++) {
            peelPixel(queue[pass === 0 ? ra + k : rb - 1 - k], pass === 0, K);
            if ((++tick & 3) === 0 && late()) yield;
          }
        }
        for (let k = ra; k < rb; k++) {
          const i = queue[k];
          const bi = (((i / lw) | 0) - by0) * bw + ((i % lw) - bx0);
          let q = nnf[bi];
          if (q < 0) {
            q = randomSource(lev);
            nnf[bi] = q;
            cost[bi] = 0;
            use[q]++;
          }
          im[i << 2] = im[q << 2];
          im[(i << 2) + 1] = im[(q << 2) + 1];
          im[(i << 2) + 2] = im[(q << 2) + 2];
          im[(i << 2) + 3] = 255;
          if (ft) {
            ft[i << 1] = ft[q << 1];
            ft[(i << 1) + 1] = ft[(q << 1) + 1];
          }
        }
        for (let k = ra; k < rb; k++) def[queue[k]] = 1;
        for (let k = ra; k < rb; k++) push(queue[k]);
        qa = rb;
        left -= rb - ra;
        adv((rb - ra) * 60);
      }
      lev.def = null;
      df = cls;
      srcList = null;
      bl = null;
    }

    function seedField(lev) {
      bind(lev);
      if (!lev.use) lev.use = new Uint16Array(lev.n);
      use = lev.use;
      for (let i = 0; i < nnf.length; i++) {
        if (cen[i] !== 0 && nnf[i] < 0) {
          const q = randomSource(lev);
          nnf[i] = q;
          if (use[q] < 65535) use[q]++;
        }
      }
    }

    function* iterate(lev, l, iters) {
      if (iters <= 0) return 0;
      if (clock() - t0 + iterCost(lev) + mustCost(l) > maxMs * 0.9) {
        stats.budgetCut = true;
        return 0;
      }
      phase = 'search';
      if (!lev.use) yield* countUse(lev);
      setPenalty(lev);
      bind(lev);
      voteK = opt('voteK', 0.5);
      cohR = 1 / (1 + opt('coh', 0));
      const srcMax = Math.max(sx1 - sx0 + 1, sy1 - sy0 + 1);
      const caps = opt('r0', [12, 48]);
      const r0 = l < caps.length ? Math.min(srcMax, caps[l]) : srcMax;
      const tol = opt('tol', 0.2) * 3 * Math.max(1, lev.nTar);
      const span = 384;
      let itn = 0;
      for (let it = 0; it < iters; it++) {
        if (clock() - t0 + iterCost(lev) + mustCost(l) > maxMs * 0.9) {
          stats.budgetCut = true;
          break;
        }
        const fwd = (it & 1) === 0;
        const ts = clock();
        for (let k = 0; k < bh; k++) {
          const y = fwd ? k : bh - 1 - k;
          for (let s = 0; s < bw; s += span) {
            const a = fwd ? s : Math.max(0, bw - s - span);
            const b = fwd ? Math.min(bw, s + span) : bw - s;
            searchSpan(y, a, b, fwd, r0);
            if (late()) {
              const tp = clock();
              yield;
              searchMs -= clock() - tp;
            }
          }
          adv(bw * 12);
        }
        searchMs += clock() - ts;
        searchUnits += lev.nCen;
        itn++;
        voteChange = 0;
        yield* vote(lev);
        if (voteChange < tol) break;
      }
      return itn;
    }

    function* sparse(lev, l) {
      bind(lev);
      phase = 'sparse';
      const act = scratchA.subarray(0, bw * bh);
      const tmp = scratchB.subarray(0, bw * bh);
      const near = confTab[Math.min(DTCAP, 3 * opt('rim', 12))];
      const every = Math.max(1, (20000 / bw) | 0);
      for (let y = 0; y < bh; y++) {
        const r = y * bw;
        const pr = (by0 + y) * lw + bx0;
        for (let x = 0; x < bw; x++) {
          const bi = r + x;
          tmp[bi] = 0;
          if (cen[bi] === 0) {
            act[bi] = 0;
            continue;
          }
          const q = nnf[bi];
          if (cl[pr + x] === 2) {
            const o = (pr + x) << 2;
            const q4 = q << 2;
            im[o] = im[q4];
            im[o + 1] = im[q4 + 1];
            im[o + 2] = im[q4 + 2];
          }
          let a = conf[bi] >= near ? 1 : 0;
          if (x + 1 < bw && cen[bi + 1] !== 0 && nnf[bi + 1] !== q + 1) a = 1;
          if (y + 1 < bh && cen[bi + bw] !== 0 && nnf[bi + bw] !== q + lw) a = 1;
          if (x > 0 && cen[bi - 1] !== 0 && nnf[bi - 1] !== q - 1) a = 1;
          if (y > 0 && cen[bi - bw] !== 0 && nnf[bi - bw] !== q - lw) a = 1;
          act[bi] = a;
        }
        if (y % every === 0 && late()) yield;
      }
      const grow = opt('grow', 2);
      for (let y = 0; y < bh; y++) {
        const r = y * bw;
        let run = 0;
        for (let x = 0; x < grow && x < bw; x++) run += act[r + x];
        for (let x = 0; x < bw; x++) {
          if (x + grow < bw) run += act[r + x + grow];
          if (x - grow - 1 >= 0) run -= act[r + x - grow - 1];
          tmp[r + x] = run > 0 ? 1 : 0;
        }
        if (y % every === 0 && late()) yield;
      }
      const col = new Uint16Array(bw);
      let count = 0;
      for (let yy = 0; yy < bh + grow; yy++) {
        if (yy < bh) {
          const r = yy * bw;
          for (let x = 0; x < bw; x++) col[x] += tmp[r + x];
        }
        const out2 = yy - grow;
        if (out2 >= 0) {
          const r = out2 * bw;
          for (let x = 0; x < bw; x++) {
            const a = col[x] > 0 && cen[r + x] !== 0 ? 1 : 0;
            act[r + x] = a;
            count += a;
          }
          const drop = out2 - grow;
          if (drop >= 0) {
            const r2 = drop * bw;
            for (let x = 0; x < bw; x++) col[x] -= tmp[r2 + x];
          }
        }
        if (yy % every === 0 && late()) yield;
      }
      stats.sparse[l] = count;
      if (!lev.use) lev.use = new Uint16Array(lev.n);
      use = lev.use;
      penTab.fill(0);
      cohR = 1 / (1 + opt('coh', 0));
      actA = act;
      const passes = opt('sparsePasses', 2);
      const r0 = opt('sparseR', 6);
      const span = 512;
      for (let it = 0; it < passes; it++) {
        if (clock() - t0 + count * iterCost(lev) / Math.max(1, lev.nCen) + mustCost(0) > maxMs) {
          stats.budgetCut = true;
          break;
        }
        const fwd = (it & 1) === 0;
        for (let k = 0; k < bh; k++) {
          const y = fwd ? k : bh - 1 - k;
          for (let s2 = 0; s2 < bw; s2 += span) {
            const a = fwd ? s2 : Math.max(0, bw - s2 - span);
            const b = fwd ? Math.min(bw, s2 + span) : bw - s2;
            searchSpan(y, a, b, fwd, r0);
            if (late()) yield;
          }
        }
        adv(count * 12);
      }
      actA = null;
      lev.use = null;
      use = null;
    }

    function* copyVote(lev) {
      bind(lev);
      sm = new Int32Array(bw * bh);
      yield* fillAll(sm, -1);
      const every = Math.max(1, (20000 / bw) | 0);
      let sum = 0;
      let m = 0;
      for (let y = 0; y < bh; y++) {
        const r = y * bw;
        const pr = (by0 + y) * lw + bx0;
        for (let x = 0; x < bw; x++) {
          const bi = r + x;
          if (cen[bi] === 0) continue;
          sum += cost[bi] * invCnt[cnt[bi]];
          m++;
          if (cl[pr + x] !== 2) continue;
          const q = nnf[bi];
          sm[bi] = q;
          const o = (pr + x) << 2;
          const q4 = q << 2;
          im[o] = im[q4];
          im[o + 1] = im[q4 + 1];
          im[o + 2] = im[q4 + 2];
        }
        if (y % every === 0 && late()) yield;
      }
      stats.meanDist = m ? Math.round((sum / m / 3) * 100) / 100 : 0;
      adv(bw * bh * 3);
    }

    function* vote(lev) {
      bind(lev);
      const feats = lev.lam > 0;
      const span = 512;
      for (let y = 0; y < bh; y++) {
        for (let s = 0; s < bw; s += span) {
          voteChange += voteSpan(y, s, Math.min(bw, s + span), feats);
          if (late()) yield;
        }
        adv(bw * 3);
      }
    }

    function* upsample(c, f) {
      const cw = c.w;
      const fw = f.w;
      const every = Math.max(1, (20000 / f.bw) | 0);
      for (let y = 0; y < f.bh; y++) {
        const py = f.by0 + y;
        const cy = (py >> 1) - c.by0;
        for (let x = 0; x < f.bw; x++) {
          const bi = y * f.bw + x;
          if (f.cen[bi] === 0) continue;
          const px = f.bx0 + x;
          const cx = (px >> 1) - c.bx0;
          let q = -1;
          let cs = 0;
          if (cx >= 0 && cx < c.bw && cy >= 0 && cy < c.bh && c.cen[cy * c.bw + cx] !== 0) {
            const cb = cy * c.bw + cx;
            const qc = c.nnf[cb];
            const qx = 2 * (qc % cw) + (px & 1);
            const qy = 2 * ((qc / cw) | 0) + (py & 1);
            q = qy < f.h && qx < fw && f.src[qy * fw + qx] !== 0 ? qy * fw + qx : nearSource(f, qx, qy);
            cs = (c.cost[cb] * invCnt[c.cnt[cb]] * f.cnt[bi]) | 0;
          } else {
            q = nearSource(f, px, py);
            cs = 1000 * f.cnt[bi];
          }
          f.nnf[bi] = q;
          f.cost[bi] = cs;
        }
        if (y % every === 0 && late()) yield;
      }
      c.nnf = null;
      c.cost = null;
      c.use = null;
      c.conf = null;
      c.cen = null;
      c.cnt = null;
    }

    function* seamFix() {
      const lev = levels[0];
      const cls = lev.cls;
      const gw = lev.bw;
      const gh = lev.bh;
      const gx0 = lev.bx0;
      const gy0 = lev.by0;
      const tB = opt('seamHi', 30);
      const tC = opt('seamCalm', 100);
      const calm = opt('calm', 10);
      const busy = opt('busy', 40);
      const as = Math.min(2, stats.coarsest);
      const af = as > 0 ? levels[as].feat : null;
      const aw = levels[as].w;
      const spent = clock() - t0;
      const cycles = spent > maxMs * 1.5 ? 0 : spent > maxMs * 1.1 ? Math.min(1, seamCycles()) : seamCycles();
      stats.seamCycles = cycles;
      if (cycles < seamCycles()) stats.budgetCut = true;
      if (cycles <= 0) return;
      lev.nnf = null;
      lev.cost = null;
      lev.conf = null;
      lev.cen = null;
      lev.cnt = null;
      lev.use = null;
      nnf = null;
      cost = null;
      conf = null;
      cen = null;
      cnt = null;
      use = null;
      const rhs = new Int16Array(gw * gh * 3);
      const dirs = [1, 0, 0, 1, -1, 0, 0, -1];
      let seams = 0;
      let pairs = 0;
      const every = Math.max(1, (8000 / gw) | 0);
      for (let y = 0; y < gh; y++) {
        const py = gy0 + y;
        for (let x = 0; x < gw; x++) {
          const px = gx0 + x;
          const pi = py * w + px;
          if (cls[pi] !== 2) continue;
          const bi = y * gw + x;
          const a = sm[bi];
          const ax = a % w;
          const ay = (a / w) | 0;
          for (let k = 0; k < 4; k++) {
            const ex = dirs[k * 2];
            const ey = dirs[k * 2 + 1];
            const nx = px + ex;
            const ny = py + ey;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const yi = ny * w + nx;
            const cy = cls[yi];
            if (cy === 0 || (cy === 2 && k >= 2)) continue;
            pairs++;
            const e = ey * w + ex;
            const yb = bi + ey * gw + ex;
            const b = cy === 2 ? sm[yb] : yi;
            if (b === a + e) continue;
            seams++;
            let m = 0;
            let s0 = 0;
            let s1 = 0;
            let s2 = 0;
            const a2x = ax + ex;
            const a2y = ay + ey;
            if (a2x >= 0 && a2y >= 0 && a2x < w && a2y < h && cls[a + e] === 1) {
              const u = (a + e) << 2;
              const v = b << 2;
              s0 += wimg[u] - wimg[v];
              s1 += wimg[u + 1] - wimg[v + 1];
              s2 += wimg[u + 2] - wimg[v + 2];
              m++;
            }
            if (cy === 2) {
              const b2x = (b % w) - ex;
              const b2y = ((b / w) | 0) - ey;
              if (b2x >= 0 && b2y >= 0 && b2x < w && b2y < h && cls[b - e] === 1) {
                const u = a << 2;
                const v = (b - e) << 2;
                s0 += wimg[u] - wimg[v];
                s1 += wimg[u + 1] - wimg[v + 1];
                s2 += wimg[u + 2] - wimg[v + 2];
                m++;
              }
            }
            if (m === 0) continue;
            if (m === 2) {
              s0 *= 0.5;
              s1 *= 0.5;
              s2 *= 0.5;
            }
            const a0 = s0 < 0 ? -s0 : s0;
            const a1 = s1 < 0 ? -s1 : s1;
            const a2 = s2 < 0 ? -s2 : s2;
            const mx = a0 > a1 ? (a0 > a2 ? a0 : a2) : a1 > a2 ? a1 : a2;
            let hi = tB;
            if (af !== null) {
              const ia = (((ay >> as) * aw + (ax >> as)) << 1);
              const ib = ((((b / w) | 0) >> as) * aw + ((b % w) >> as)) << 1;
              let act = af[ia] > af[ia + 1] ? af[ia] : af[ia + 1];
              if (af[ib] > act) act = af[ib];
              if (af[ib + 1] > act) act = af[ib + 1];
              hi = act <= calm ? tC : act >= busy ? tB : tC + ((tB - tC) * (act - calm)) / (busy - calm);
            }
            if (mx >= hi) continue;
            const lo = hi * 0.4;
            const g = mx <= lo ? 8 : (8 * (hi - mx)) / (hi - lo);
            const r0 = Math.round(s0 * g);
            const r1 = Math.round(s1 * g);
            const r2 = Math.round(s2 * g);
            rhs[bi * 3] -= r0;
            rhs[bi * 3 + 1] -= r1;
            rhs[bi * 3 + 2] -= r2;
            if (cy === 2) {
              rhs[yb * 3] += r0;
              rhs[yb * 3 + 1] += r1;
              rhs[yb * 3 + 2] += r2;
            }
          }
        }
        if (y % every === 0 && late()) yield;
      }
      stats.coherent = pairs ? Math.round((1 - seams / pairs) * 1000) / 1000 : 1;
      adv(gw * gh);
      const pl = [];
      let lx0 = gx0;
      let ly0 = gy0;
      let lx1 = gx0 + gw - 1;
      let ly1 = gy0 + gh - 1;
      for (let l = 0; l < levels.length; l++) {
        const L = levels[l];
        const pw = lx1 - lx0 + 1;
        const ph = ly1 - ly0 + 1;
        const fl = new Uint8Array(pw * ph);
        let cells = 0;
        let links = 0;
        let tx0 = pw;
        let tx1 = -1;
        let ty0 = ph;
        let ty1 = -1;
        for (let y = 0; y < ph; y++) {
          const yy = y + ly0;
          for (let x = 0; x < pw; x++) {
            const xx = x + lx0;
            const i = yy * L.w + xx;
            if (L.cls[i] !== 2) continue;
            let f = 128;
            let deg = 0;
            if (xx > 0 && L.cls[i - 1] !== 0) {
              deg++;
              if (L.cls[i - 1] === 2) f |= 1;
            }
            if (xx < L.w - 1 && L.cls[i + 1] !== 0) {
              deg++;
              if (L.cls[i + 1] === 2) f |= 2;
            }
            if (yy > 0 && L.cls[i - L.w] !== 0) {
              deg++;
              if (L.cls[i - L.w] === 2) f |= 4;
            }
            if (yy < L.h - 1 && L.cls[i + L.w] !== 0) {
              deg++;
              if (L.cls[i + L.w] === 2) f |= 8;
            }
            fl[y * pw + x] = f | (deg << 4);
            cells++;
            links += deg - (f & 1) - ((f >> 1) & 1) - ((f >> 2) & 1) - ((f >> 3) & 1);
            if (x < tx0) tx0 = x;
            if (x > tx1) tx1 = x;
            if (y < ty0) ty0 = y;
            ty1 = y;
          }
          if ((y & 31) === 31 && late()) yield;
        }
        if (l > 0 && ((links === 0 && pl[0].links > 0) || Math.min(tx1 - tx0, ty1 - ty0) < 3)) break;
        pl.push({ x0: lx0, y0: ly0, w: pw, h: ph, fl, c: new Float32Array(pw * ph), r: new Float32Array(pw * ph), cells, links, cls: L.cls, lw: L.w, lh: L.h });
        if (cells <= 24 || l === levels.length - 1 || pl.length >= opt('mgLevels', 99)) break;
        lx0 >>= 1;
        ly0 >>= 1;
        lx1 >>= 1;
        ly1 >>= 1;
      }
      const eps = opt('screen', pl[0].links > 0 ? 0 : 1e-4);
      const last = pl[pl.length - 1];
      const deep = Math.min(240, 16 + 3 * Math.max(last.w, last.h));
      const invDeg = new Float64Array(8);
      for (let d = 1; d < 8; d++) invDeg[d] = 1 / (d + eps);
      const sweepRow = (g, y, fwd) => {
        const fl = g.fl;
        const c = g.c;
        const r = g.r;
        const pw = g.w;
        let i = y * pw + (fwd ? 0 : pw - 1);
        const st = fwd ? 1 : -1;
        for (let x = 0; x < pw; x++, i += st) {
          const f = fl[i];
          if (f === 0) continue;
          let s = r[i];
          if (f & 1) s += c[i - 1];
          if (f & 2) s += c[i + 1];
          if (f & 4) s += c[i - pw];
          if (f & 8) s += c[i + pw];
          c[i] = s * invDeg[(f >> 4) & 7];
        }
      };
      function* sweeps(g, count) {
        const every2 = Math.max(1, (30000 / g.w) | 0);
        for (let k = 0; k < count; k++) {
          const fwd = (k & 1) === 0;
          for (let j = 0; j < g.h; j++) {
            sweepRow(g, fwd ? j : g.h - 1 - j, fwd);
            if (j % every2 === 0 && late()) yield;
          }
        }
      }
      function* restrict(g, cg) {
        const fl = g.fl;
        const c = g.c;
        const r = g.r;
        const pw = g.w;
        yield* fillAll(cg.r, 0);
        yield* fillAll(cg.c, 0);
        const every2 = Math.max(1, (30000 / pw) | 0);
        for (let y = 0; y < g.h; y++) {
          const cyy = ((y + g.y0) >> 1) - cg.y0;
          for (let x = 0; x < pw; x++) {
            const i = y * pw + x;
            const f = fl[i];
            if (f === 0) continue;
            let s = r[i] - (((f >> 4) & 7) + eps) * c[i];
            if (f & 1) s += c[i - 1];
            if (f & 2) s += c[i + 1];
            if (f & 4) s += c[i - pw];
            if (f & 8) s += c[i + pw];
            cg.r[cyy * cg.w + (((x + g.x0) >> 1) - cg.x0)] += 0.8 * s;
          }
          if (y % every2 === 0 && late()) yield;
        }
      }
      const cval = (cg, x, y) => {
        if (x < 0 || y < 0 || x >= cg.lw || y >= cg.lh) return NaN;
        const c = cg.cls[y * cg.lw + x];
        if (c === 0) return NaN;
        if (c === 1) return 0;
        const xx = x - cg.x0;
        const yy = y - cg.y0;
        if (xx < 0 || yy < 0 || xx >= cg.w || yy >= cg.h) return 0;
        return cg.c[yy * cg.w + xx];
      };
      function* prolong(g, cg) {
        const fl = g.fl;
        const c = g.c;
        const pw = g.w;
        const every2 = Math.max(1, (12000 / pw) | 0);
        for (let y = 0; y < g.h; y++) {
          const ay = y + g.y0;
          const cy = ay >> 1;
          const sy = ay & 1 ? 1 : -1;
          for (let x = 0; x < pw; x++) {
            const i = y * pw + x;
            if (fl[i] === 0) continue;
            const ax = x + g.x0;
            const cx = ax >> 1;
            const sx = ax & 1 ? 1 : -1;
            let acc = 9 * cg.c[(cy - cg.y0) * cg.w + (cx - cg.x0)];
            let ws = 9;
            let v = cval(cg, cx + sx, cy);
            if (v === v) {
              acc += 3 * v;
              ws += 3;
            }
            v = cval(cg, cx, cy + sy);
            if (v === v) {
              acc += 3 * v;
              ws += 3;
            }
            v = cval(cg, cx + sx, cy + sy);
            if (v === v) {
              acc += v;
              ws += 1;
            }
            c[i] += acc / ws;
          }
          if (y % every2 === 0 && late()) yield;
        }
      }
      function* cycle(k) {
        const g = pl[k];
        if (k === pl.length - 1) {
          yield* sweeps(g, deep);
          return;
        }
        yield* sweeps(g, 2);
        yield* restrict(g, pl[k + 1]);
        yield* cycle(k + 1);
        if (k + 2 < pl.length) yield* cycle(k + 1);
        yield* prolong(g, pl[k + 1]);
        yield* sweeps(g, 2);
      }
      const g0 = pl[0];
      for (let chn = 0; chn < 3; chn++) {
        for (let i = 0; i < g0.r.length; i++) {
          g0.r[i] = rhs[i * 3 + chn] * 0.125;
          if ((i & 262143) === 262143 && late()) yield;
        }
        yield* fillAll(g0.c, 0);
        for (let k = 0; k < cycles; k++) {
          yield* cycle(0);
          adv(gw * gh);
        }
        const every3 = Math.max(1, (30000 / gw) | 0);
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            const bi = y * gw + x;
            if (g0.fl[bi] === 0) continue;
            const o = (((gy0 + y) * w + gx0 + x) << 2) + chn;
            const cv = g0.c[bi];
            wimg[o] = wimg[o] + (cv > 80 ? 80 : cv < -80 ? -80 : cv);
          }
          if (y % every3 === 0 && late()) yield;
        }
      }
    }

    function* share() {
      const lev = levels[0];
      const gridN = 8;
      const hist = new Float64Array(gridN * gridN);
      const sw = lev.sx1 - lev.sx0 + 1 + 2 * half;
      const sh = lev.sy1 - lev.sy0 + 1 + 2 * half;
      const ox = lev.sx0 - half;
      const oy = lev.sy0 - half;
      let m = 0;
      for (let i = 0; i < sm.length; i++) {
        const q = sm[i];
        if (q >= 0) {
          const gx = Math.min(gridN - 1, Math.max(0, (((q % w) - ox) * gridN / sw) | 0));
          const gy = Math.min(gridN - 1, Math.max(0, ((((q / w) | 0) - oy) * gridN / sh) | 0));
          hist[gy * gridN + gx]++;
          m++;
        }
        if ((i & 65535) === 65535 && late()) yield;
      }
      let top = 0;
      for (let i = 0; i < hist.length; i++) if (hist[i] > top) top = hist[i];
      stats.topShare = m ? Math.round((top / m) * 1000) / 1000 : 0;
    }

    function* writeBack() {
      const cls = levels[0].cls;
      const same = wimg === out;
      for (let y = 0; y < h; y++) {
        let i = (y + ry0) * W + rx0;
        let j = y * w;
        for (let x = 0; x < w; x++, i++, j++) {
          if (cls[j] !== 2) continue;
          const o = i << 2;
          if (!same) {
            out[o] = wimg[j << 2];
            out[o + 1] = wimg[(j << 2) + 1];
            out[o + 2] = wimg[(j << 2) + 2];
          }
          out[o + 3] = 255;
        }
        if ((y & 31) === 31 && late()) yield;
      }
    }

    function* greyFill() {
      const tg = job.target;
      for (let y = 0; y < H; y++) {
        let i = y * W;
        for (const e = i + W; i < e; i++) {
          if (tg[i]) {
            const o = i << 2;
            out[o] = 128;
            out[o + 1] = 128;
            out[o + 2] = 128;
            out[o + 3] = 255;
          }
        }
        if ((y & 31) === 31 && late()) yield;
      }
    }

    function* membrane(lev) {
      const cls = lev.cls;
      const fw = lev.w;
      const fh = lev.h;
      const fimg = lev.img;
      let x0 = fw;
      let x1 = -1;
      let y0 = fh;
      let y1 = -1;
      let mr = 0;
      let mg = 0;
      let mb = 0;
      let kc = 0;
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const c = cls[y * fw + x];
          if (c === 2) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            y1 = y;
          } else if (c === 1) {
            const o = (y * fw + x) << 2;
            mr += fimg[o];
            mg += fimg[o + 1];
            mb += fimg[o + 2];
            kc++;
          }
        }
        if ((y & 31) === 31 && late()) yield;
      }
      kc = kc || 1;
      mr /= kc;
      mg /= kc;
      mb /= kc;
      const pad = Math.max(48, (Math.max(x1 - x0, y1 - y0) >> 1) + 8);
      x0 = Math.max(0, x0 - pad);
      y0 = Math.max(0, y0 - pad);
      x1 = Math.min(fw - 1, x1 + pad);
      y1 = Math.min(fh - 1, y1 + pad);
      const pyr = [];
      let pw = x1 - x0 + 1;
      let ph = y1 - y0 + 1;
      let a = new Float32Array(pw * ph * 4);
      for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
          const i = (y + y0) * fw + x + x0;
          if (cls[i] === 1) {
            const o = (y * pw + x) * 4;
            a[o] = fimg[i << 2];
            a[o + 1] = fimg[(i << 2) + 1];
            a[o + 2] = fimg[(i << 2) + 2];
            a[o + 3] = 1;
          }
        }
        if ((y & 31) === 31 && late()) yield;
      }
      pyr.push({ w: pw, h: ph, a });
      while (pw > 1 || ph > 1) {
        const cw = (pw + 1) >> 1;
        const chh = (ph + 1) >> 1;
        const b = new Float32Array(cw * chh * 4);
        for (let y = 0; y < chh; y++) {
          for (let x = 0; x < cw; x++) {
            let sr = 0;
            let sg = 0;
            let sb = 0;
            let sw = 0;
            for (let dy = 0; dy < 2; dy++) {
              const yy = 2 * y + dy;
              if (yy >= ph) break;
              for (let dx = 0; dx < 2; dx++) {
                const xx = 2 * x + dx;
                if (xx >= pw) break;
                const o = (yy * pw + xx) * 4;
                const wt = a[o + 3];
                sr += a[o] * wt;
                sg += a[o + 1] * wt;
                sb += a[o + 2] * wt;
                sw += wt;
              }
            }
            if (sw > 0) {
              const o = (y * cw + x) * 4;
              b[o] = sr / sw;
              b[o + 1] = sg / sw;
              b[o + 2] = sb / sw;
              b[o + 3] = sw > 1 ? 1 : sw;
            }
          }
          if ((y & 31) === 31 && late()) yield;
        }
        pyr.push({ w: cw, h: chh, a: b });
        a = b;
        pw = cw;
        ph = chh;
      }
      const top = pyr[pyr.length - 1];
      if (top.a[3] < 1) {
        const wt = top.a[3];
        top.a[0] = top.a[0] * wt + mr * (1 - wt);
        top.a[1] = top.a[1] * wt + mg * (1 - wt);
        top.a[2] = top.a[2] * wt + mb * (1 - wt);
        top.a[3] = 1;
      }
      for (let l = pyr.length - 2; l >= 0; l--) {
        const f = pyr[l];
        const c = pyr[l + 1];
        for (let y = 0; y < f.h; y++) {
          const cy = y >> 1;
          const cy2 = Math.min(c.h - 1, Math.max(0, cy + (y & 1 ? 1 : -1)));
          for (let x = 0; x < f.w; x++) {
            const o = (y * f.w + x) * 4;
            const wt = f.a[o + 3];
            if (wt >= 1) continue;
            const cx = x >> 1;
            const cx2 = Math.min(c.w - 1, Math.max(0, cx + (x & 1 ? 1 : -1)));
            const p00 = (cy * c.w + cx) * 4;
            const p01 = (cy * c.w + cx2) * 4;
            const p10 = (cy2 * c.w + cx) * 4;
            const p11 = (cy2 * c.w + cx2) * 4;
            for (let k = 0; k < 3; k++) {
              const v = (9 * c.a[p00 + k] + 3 * c.a[p01 + k] + 3 * c.a[p10 + k] + c.a[p11 + k]) / 16;
              f.a[o + k] = f.a[o + k] * wt + v * (1 - wt);
            }
            f.a[o + 3] = 1;
          }
          if ((y & 31) === 31 && late()) yield;
        }
      }
      const base = pyr[0];
      for (let y = 0; y < base.h; y++) {
        for (let x = 0; x < base.w; x++) {
          const i = (y + y0) * fw + x + x0;
          if (cls[i] !== 2) continue;
          const o = (y * base.w + x) * 4;
          fimg[i << 2] = Math.round(base.a[o]);
          fimg[(i << 2) + 1] = Math.round(base.a[o + 1]);
          fimg[(i << 2) + 2] = Math.round(base.a[o + 2]);
          fimg[(i << 2) + 3] = 255;
        }
        if ((y & 31) === 31 && late()) yield;
      }
    }

    function planIters(top) {
      const base = opt('work', 900000);
      const caps = opt('caps', [2, 3, 4, 5, 6, 8]);
      const plan = [];
      for (let l = 0; l <= top; l++) {
        const nl = Math.max(1, nT / Math.pow(4, l));
        const cap = l === top ? opt('topIters', 12) : caps[Math.min(l, caps.length - 1)];
        plan.push(Math.max(0, Math.min(cap, Math.floor(base / nl + 0.25))));
      }
      const forced = opt('iters', null);
      if (forced) for (let l = 0; l <= top; l++) plan[l] = forced[Math.min(l, forced.length - 1)];
      return plan;
    }

    function* main() {
      t0 = clock();
      totalU = N * 4 + 1;
      yield* classify();
      adv(n);
      if (nT === 0) return;
      if (nK === 0) {
        stats.fallback = 'grey';
        yield* greyFill();
        return;
      }
      yield* buildMasks();
      adv(n);
      let top = -1;
      for (const size of [opt('patch', 7), 5, 3]) {
        P = size;
        half = size >> 1;
        top = yield* countSources();
        if (top >= 0 && levels[0].nSrc >= opt('minSrc0', 24)) break;
        top = -1;
      }
      if (top < 0) {
        stats.fallback = 'smooth';
        yield* membrane(levels[0]);
        yield* writeBack();
        return;
      }
      stats.patch = P;
      stats.sources = levels[0].nSrc;
      const thick = yield* thickness();
      thickPx = thick < 1e8 ? thick : 1;
      nearK = Math.round(opt('near', 30) * opt('near', 30) * 3 * P * P);
      const minSrc = opt('minSrc', 400);
      let ls = 0;
      while (ls < top && levels[ls + 1].nSrc >= minSrc) ls++;
      let L = 0;
      while (L < ls && thick / (1 << L) > opt('thick', 16)) L++;
      let lhi = L;
      while (lhi < ls && thick / (1 << lhi) > opt('thickMin', 6)) lhi++;
      peelBudget = Math.min(opt('peelMax', 4e6), opt('peelEvals', 1200) * Math.pow(nT, 0.635));
      while (L < lhi && (nT / Math.pow(4, L)) * levels[L].nSrc > 2 * peelBudget) L++;
      L = Math.min(L, opt('maxLevel', 12));
      stats.levels = L + 1;
      stats.coarsest = L;
      for (let l = 0; l <= L; l++) {
        stats.sourcesLevel.push(levels[l].nSrc);
        stats.msLevel.push(0);
        stats.iters.push(0);
        stats.sparse.push(0);
      }
      scratchA = new Uint8Array(n);
      scratchB = new Uint8Array(n);
      yield* buildColour(L);
      adv(n * 2);
      const plan = planIters(L);
      let est = 0;
      for (let l = 0; l <= L; l++) est += (plan[l] * 15 + 6) * Math.max(1, nT / Math.pow(4, l)) + levels[l].n * 2;
      totalU = doneU + est + nT * 12;
      stats.setupMs = Math.round(clock() - t0);
      unitMs = Math.max(2e-6, (clock() - t0) / n);
      let tl = clock();
      phase = 'prep';
      yield* prepLevel(levels[L]);
      phase = 'peel';
      if (hasInit) seedField(levels[L]);
      else {
        yield* peel(levels[L]);
        seedField(levels[L]);
      }
      for (let l = L; l >= 0; l--) {
        const lev = levels[l];
        const did = yield* iterate(lev, l, plan[l]);
        stats.iters[l] = did;
        if (did > 0) stats.stopLevel = l;
        else if (l < L && opt('sparsePasses', 2) > 0) yield* sparse(lev, l);
        stats.msLevel[l] = Math.round(clock() - tl);
        tl = clock();
        if (l > 0) {
          const f = levels[l - 1];
          phase = 'prep';
          yield* prepLevel(f);
          phase = 'upsample';
          yield* upPrior(lev, f, l - 1);
          yield* upsample(lev, f);
          if (plan[l - 1] > 0 && clock() - t0 + iterCost(f) + mustCost(l - 1) <= maxMs * 0.9) {
            voteK = opt('voteK', 0.5);
            yield* vote(f);
          }
        }
      }
      scratchA = null;
      scratchB = null;
      phase = 'final';
      yield* copyVote(levels[0]);
      const ts = clock();
      phase = 'seam';
      yield* seamFix();
      stats.seamMs = Math.round(clock() - ts);
      phase = 'finish';
      yield* share();
      yield* writeBack();
    }

    const gen = main();

    function step(ms) {
      if (done) return true;
      const ts = clock();
      deadline = ts + (ms > 0 ? ms : 0);
      const r = gen.next();
      const took = clock() - ts;
      stats.steps++;
      if (took > stats.longestStep) {
        stats.longestStep = Math.round(took * 10) / 10;
        stats.longestPhase = phase;
      }
      if (r.done) {
        done = true;
        frac = 1;
        stats.totalMs = Math.round(clock() - t0);
      }
      return done;
    }

    function result() {
      while (!done) step(50);
      const res = { rgba: out, stats };
      if (job.debug) res.field = sm ? { map: sm, x: levels[0].bx0, y: levels[0].by0, w: levels[0].bw, h: levels[0].bh, rx: rx0, ry: ry0, rw: w } : null;
      return res;
    }

    return { step, progress: () => frac, result };
  }

  return { start };
}
