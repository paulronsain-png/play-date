// Organic flowing gradient background — dark mode only
(function () {
  const canvas = document.createElement('canvas');
  canvas.id = 'fluid-bg';
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    zIndex: '0',
    pointerEvents: 'none',
    display: 'block',
    transition: 'opacity 0.8s ease',
  });
  document.body.prepend(canvas);

  const ctx = canvas.getContext('2d');

  function isDark() {
    const cl = document.body.classList;
    return !cl.contains('light-mode') && !cl.contains('cream-mode') && !cl.contains('og-mode');
  }

  function syncVisibility() {
    canvas.style.opacity = isDark() ? '1' : '0';
  }

  new MutationObserver(syncVisibility).observe(document.body, {
    attributes: true, attributeFilter: ['class']
  });
  syncVisibility();

  // Subtle night haze layers (no neon gradients)
  const orbs = [
    { bx: 0.16, by: 0.18, dr: 0.05, sp: 0.65, r: 0.62, c: [112, 140, 178], a0: 0.14, a1: 0.03 },
    { bx: 0.84, by: 0.12, dr: 0.04, sp: 0.52, r: 0.58, c: [96, 126, 164],  a0: 0.10, a1: 0.02 },
    { bx: 0.78, by: 0.78, dr: 0.06, sp: 0.58, r: 0.56, c: [88, 116, 150],  a0: 0.09, a1: 0.015 },
    { bx: 0.22, by: 0.76, dr: 0.04, sp: 0.47, r: 0.50, c: [74, 102, 136],  a0: 0.08, a1: 0.012 },
    { bx: 0.52, by: 0.40, dr: 0.03, sp: 0.72, r: 0.40, c: [128, 154, 186], a0: 0.08, a1: 0.015 },
  ];

  let mouse   = { x: 0.5, y: 0.5 };
  let mTarget = { x: 0.5, y: 0.5 };

  window.addEventListener('mousemove', e => {
    mTarget.x = e.clientX / window.innerWidth;
    mTarget.y = e.clientY / window.innerHeight;
  });
  window.addEventListener('touchmove', e => {
    if (e.touches[0]) {
      mTarget.x = e.touches[0].clientX / window.innerWidth;
      mTarget.y = e.touches[0].clientY / window.innerHeight;
    }
  }, { passive: true });

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  let t = 0;

  function draw() {
    requestAnimationFrame(draw);
    const now = performance.now();
    t += 0.0035;

    // Smoothly track cursor/finger
    mouse.x += (mTarget.x - mouse.x) * 0.028;
    mouse.y += (mTarget.y - mouse.y) * 0.028;

    const W = canvas.width;
    const H = canvas.height;

    ctx.globalCompositeOperation = 'source-over';
    const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
    skyGrad.addColorStop(0, '#040910');
    skyGrad.addColorStop(0.48, '#070f1b');
    skyGrad.addColorStop(1, '#03070f');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);

    // very subtle moonlight mist
    const moonHaze = ctx.createRadialGradient(W * 0.72, H * 0.12, 0, W * 0.72, H * 0.12, Math.max(W, H) * 0.55);
    moonHaze.addColorStop(0, 'rgba(196, 214, 236, 0.12)');
    moonHaze.addColorStop(0.42, 'rgba(155, 180, 214, 0.06)');
    moonHaze.addColorStop(1, 'rgba(120, 146, 186, 0)');
    ctx.fillStyle = moonHaze;
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < orbs.length; i++) {
      const o = orbs[i];

      // Lissajous-style organic drift
      let ox = o.bx + Math.sin(t * o.sp       + i * 1.31) * o.dr
                    + Math.sin(t * o.sp * 0.43 + i * 0.77) * o.dr * 0.4;
      let oy = o.by + Math.cos(t * o.sp * 0.73 + i * 0.93) * o.dr
                    + Math.cos(t * o.sp * 0.31 + i * 1.57) * o.dr * 0.35;

      // Cursor pulls each orb slightly toward the pointer
      ox += (mouse.x - ox) * 0.055;
      oy += (mouse.y - oy) * 0.055;

      const cx = ox * W;
      const cy = oy * H;
      const radius = o.r * Math.max(W, H) * 0.68;

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0,    `rgba(${o.c[0]}, ${o.c[1]}, ${o.c[2]}, ${o.a0})`);
      grad.addColorStop(0.38, `rgba(${o.c[0]}, ${o.c[1]}, ${o.c[2]}, ${o.a1})`);
      grad.addColorStop(1,    `rgba(${o.c[0]}, ${o.c[1]}, ${o.c[2]}, 0)`);

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  draw();
})();
