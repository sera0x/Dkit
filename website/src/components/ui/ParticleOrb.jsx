import { Geometry, Mesh, Program, Renderer, Vec3 } from 'ogl';
import { useEffect, useRef } from 'react';
import './ParticleOrb.css';

const COUNT = 2600;

const VERT = `
  precision highp float;

  attribute vec3 position;
  attribute float aSeed;
  attribute float aMix;

  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uRadius;
  uniform vec2 uStretch;
  uniform float uDpr;
  uniform float uSize;

  varying float vMix;
  varying float vAlpha;

  const float TAU = 6.28318530718;

  void main() {
    vec3 p = position;

    float t = uTime * 0.16;

    p *= 1.0 + 0.035 * sin(t * 1.6 + aSeed * TAU);

    float a = t * 0.32 + aSeed * 0.14;
    float c = cos(a);
    float s = sin(a);
    p.xz = mat2(c, -s, s, c) * p.xz;

    p += 0.05 * vec3(
      sin(t * 1.3 + aSeed * 11.0),
      cos(t * 1.1 + aSeed * 7.0),
      sin(t * 0.9 + aSeed * 13.0)
    );

    vec3 scaled = vec3(p.x * uStretch.x, p.y * uStretch.y, p.z) * uRadius;

    float depth = 1.0 / (1.0 - scaled.z / (uRadius * 2.4));
    vec2 screen = scaled.xy * depth;
    gl_Position = vec4(screen / (uResolution * 0.5), 0.0, 1.0);

    float size = uSize * uDpr * depth * (0.55 + 0.9 * fract(aSeed * 7.31));
    gl_PointSize = clamp(size, 1.0, 16.0 * uDpr);

    vMix = clamp(aMix + 0.22 * sin(t * 0.8 + p.y * 2.0), 0.0, 1.0);
    vAlpha = mix(0.16, 1.0, smoothstep(-1.0, 1.0, p.z));
  }
`;

const FRAG = `
  precision highp float;

  varying float vMix;
  varying float vAlpha;

  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;

  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;

    float falloff = pow(1.0 - r, 2.4);
    vec3 col = mix(uColorA, uColorB, vMix);
    col += vec3(0.42) * pow(1.0 - r, 6.0);

    float alpha = falloff * vAlpha * uOpacity;
    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

function buildGeometry(gl) {
  const position = new Float32Array(COUNT * 3);
  const seed = new Float32Array(COUNT);
  const mix = new Float32Array(COUNT);

  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < COUNT; i += 1) {
    const y = 1 - (i / (COUNT - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;

    // Most points sit on the shell; every seventh drops inside for depth.
    const shell = i % 7 === 0 ? 0.55 + Math.random() * 0.28 : 0.92 + Math.random() * 0.1;

    position[i * 3] = Math.cos(theta) * ring * shell;
    position[i * 3 + 1] = y * shell;
    position[i * 3 + 2] = Math.sin(theta) * ring * shell;

    seed[i] = Math.random();
    mix[i] = 0.5 + 0.5 * Math.sin(theta * 0.5 + y * 1.6);
  }

  return new Geometry(gl, {
    position: { size: 3, data: position },
    aSeed: { size: 1, data: seed },
    aMix: { size: 1, data: mix },
  });
}

function hexToVec3(hex) {
  const value = hex.replace('#', '');
  return new Vec3(
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255
  );
}

export default function ParticleOrb({ theme = 'dark' }) {
  const host = useRef(null);
  const themeRef = useRef(theme);
  const uniformsRef = useRef(null);

  useEffect(() => {
    themeRef.current = theme;
    const uniforms = uniformsRef.current;
    if (!uniforms) return;
    const palette = paletteFor(theme);
    uniforms.uColorA.value = hexToVec3(palette.a);
    uniforms.uColorB.value = hexToVec3(palette.b);
    uniforms.uOpacity.value = palette.opacity;
  }, [theme]);

  useEffect(() => {
    const container = host.current;
    if (!container) return undefined;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let renderer;
    try {
      renderer = new Renderer({
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      });
    } catch {
      return undefined;
    }
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    container.appendChild(gl.canvas);

    const palette = paletteFor(themeRef.current);
    const uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new Vec3(1, 1, 1) },
      uRadius: { value: 1 },
      uStretch: { value: new Vec3(1.45, 1.0, 1) },
      uDpr: { value: renderer.dpr || 1 },
      uSize: { value: 2.1 },
      uColorA: { value: hexToVec3(palette.a) },
      uColorB: { value: hexToVec3(palette.b) },
      uOpacity: { value: palette.opacity },
    };
    uniformsRef.current = uniforms;

    const program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    let mesh;
    try {
      mesh = new Mesh(gl, {
        geometry: buildGeometry(gl),
        program,
        mode: gl.POINTS,
        frustumCulled: false,
      });
    } catch {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return undefined;
    }

    function resize() {
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      renderer.setSize(width, height);
      gl.canvas.style.width = `${width}px`;
      gl.canvas.style.height = `${height}px`;

      const dpr = renderer.dpr || 1;
      uniforms.uDpr.value = dpr;
      uniforms.uResolution.value.set(width, height, width / height);
      // Radius is derived from the shorter side so the cloud stays round and
      // bleeds past the container instead of shrinking inside it.
      uniforms.uRadius.value = Math.min(width, height) * 0.58;
    }

    let visible = true;
    const onVisibility = () => { visible = !document.hidden; };
    const observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0 })
      : null;
    observer?.observe(container);
    document.addEventListener('visibilitychange', onVisibility);

    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(resize)
      : null;
    resizeObserver?.observe(container);

    window.addEventListener('resize', resize);
    resize();

    let rafId = 0;
    let elapsed = 0;
    let last = 0;

    const frame = (now) => {
      rafId = requestAnimationFrame(frame);
      if (!visible) { last = now; return; }

      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      elapsed += reduced ? 0 : dt;

      uniforms.uTime.value = elapsed;
      renderer.render({ scene: mesh });
    };
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      observer?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      if (gl.canvas.parentNode === container) container.removeChild(gl.canvas);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      uniformsRef.current = null;
    };
  }, []);

  return <div ref={host} className="particle-orb" aria-hidden="true" />;
}

function paletteFor(theme) {
  if (theme === 'light') {
    return { a: '#0f8a4d', b: '#3155a6', opacity: 0.62 };
  }
  return { a: '#3ddc84', b: '#7aa2f7', opacity: 0.9 };
}
