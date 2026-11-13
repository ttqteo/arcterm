// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The hologram's pixels: the orbital HUD and the neural sphere of the 2026-09-11 avatar study
// (jarvis-avatar-comparison, "A presence, not a mascot"), ported at its corner size, in one canvas, with a crossfade
// between them. What shows and when is hologrammodel.ts's. Loaded lazily by hologramview.tsx, so three.js costs
// nothing while Jarvis is Sprout.

import {
    AdditiveBlending,
    BufferGeometry,
    Color,
    Float32BufferAttribute,
    Group,
    IcosahedronGeometry,
    Mesh,
    MeshBasicMaterial,
    NormalBlending,
    PerspectiveCamera,
    Points,
    Scene,
    ShaderMaterial,
    Vector2,
    Vector3,
    WebGLRenderer,
    type Material,
    type Object3D,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { assembleReveal, morphPose } from "./hologrammodel";

// the bloom pass's resting strength; the morph between the forms flares it (morphPose)
const BLOOM = 0.35;

const TAU = Math.PI * 2;
// past 1.5 the bloom's targets cost more than the softness they buy at this size (the study's cap)
const MAX_DPR = 1.5;
// the size every width and spark in the study was tuned at
const STUDY_PX = 132;

// Bloom replaces alpha; this hands it back from the light (the study's formula), so the glow has no rectangular edge on
// the app behind. It runs last, on display values (after OutputPass), and writes premultiplied colour into a
// premultiplied canvas. The study's straight-alpha canvas (premultipliedAlpha: false) looks right in Chromium, but
// WKWebView's live compositor shows its colour unweighted wherever alpha is above zero: the faint bloom haze, at
// near-zero alpha, came out as a solid milky disc in the installed app (a WKWebView snapshot does not show it; a
// screencapture of the window does). Premultiplied needs no conversion in either engine. The light cut drops that
// haze, which on the app's lighter backgrounds than the study's near-black read as a square, and the round fade keeps
// any rest of it off the square's edge.
const alphaFromLight = {
    uniforms: { tDiffuse: { value: null } },
    vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        float linear(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
        void main() {
            vec3 shown = min(texture2D(tDiffuse, vUv).rgb, vec3(1.0));
            float light = linear(max(max(shown.r, shown.g), shown.b));
            float edge = 1.0 - smoothstep(0.4, 0.49, distance(vUv, vec2(0.5)));
            float a = clamp((light - 0.008) / 0.992, 0.0, 1.0) * smoothstep(0.02, 0.06, light) * edge;
            gl_FragColor = vec4(shown * a, a);
        }`,
};

export interface HologramColours {
    blue: Color;
    blueHot: Color;
    gold: Color;
    goldHot: Color;
}

// The study's tokens. Read from the live custom properties, so a theme's own connection colours carry through.
export function readHologramColours(read: (name: string) => string): HologramColours {
    const token = (name: string, fallback: string) => new Color(read(`--color-${name}`) || fallback);
    return {
        blue: token("conn-1", "#53b4ea"),
        blueHot: token("accent-100", "#efc6b8"),
        gold: token("conn-6", "#ffa24e"),
        goldHot: token("warning-soft", "#f0d79f"),
    };
}

// Everything a form draws fades through one of these: a material's opacity, or a point shader's fade uniform.
type Fader = { material: LineMaterial | MeshBasicMaterial; base: number } | { points: ShaderMaterial };

interface Form {
    group: Group;
    faders: Fader[];
    update: (t: number, busy: boolean) => void;
}

function randomSequence(seed: number): () => number {
    return () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}

class Builder {
    faders: Fader[] = [];

    // scale: the size against the study's 132 px, so a smaller hologram draws thinner lines and smaller sparks
    // rather than the same pixels packed into less room, which blew the core out into a blob at S and M
    constructor(
        private dpr: number,
        private scale: number
    ) {}

    segments(parent: Object3D, positions: number[], colour: Color, width = 1, opacity = 0.7): LineSegments2 {
        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(positions);
        const material = new LineMaterial({
            color: colour,
            linewidth: width * this.scale,
            transparent: true,
            opacity,
            blending: AdditiveBlending,
            depthWrite: false,
        });
        const line = new LineSegments2(geometry, material);
        line.computeLineDistances();
        line.frustumCulled = false;
        parent.add(line);
        this.faders.push({ material, base: opacity });
        return line;
    }

    arc(
        parent: Object3D,
        radius: number,
        start: number,
        length: number,
        colour: Color,
        width: number,
        opacity: number
    ) {
        const positions: number[] = [];
        const count = Math.max(4, Math.ceil(Math.abs(length) * 42));
        for (let i = 0; i < count; i++) {
            for (const angle of [start + (length * i) / count, start + (length * (i + 1)) / count]) {
                positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
            }
        }
        return this.segments(parent, positions, colour, width, opacity);
    }

    points(parent: Object3D, positions: number[], colour: Color, size: number): Points<BufferGeometry, ShaderMaterial> {
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
        const material = new ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
            uniforms: {
                tint: { value: colour },
                diameter: { value: size * this.dpr * this.scale },
                time: { value: 0 },
                energy: { value: 1 },
                fade: { value: 1 },
            },
            vertexShader: `uniform float diameter; uniform float time; uniform float energy;
                varying float light;
                void main() {
                    vec4 p = modelViewMatrix * vec4(position, 1.0);
                    light = (0.55 + 0.45 * sin(position.x * 23.0 + position.y * 17.0 + time)) * energy;
                    gl_Position = projectionMatrix * p;
                    gl_PointSize = diameter * (0.8 + 0.35 * light);
                }`,
            fragmentShader: `uniform vec3 tint; uniform float fade; varying float light;
                void main() {
                    float r = length(gl_PointCoord - 0.5) * 2.0;
                    if (r > 1.0) discard;
                    float a = pow(1.0 - r, 1.5);
                    gl_FragColor = vec4(tint * (0.8 + light), a * fade);
                }`,
        });
        const cloud = new Points(geometry, material);
        parent.add(cloud);
        this.faders.push({ points: material });
        return cloud;
    }

    wire(parent: Object3D, radius: number, colour: Color, opacity: number, additive: boolean): Mesh {
        const material = new MeshBasicMaterial({
            color: colour,
            wireframe: true,
            transparent: true,
            opacity,
            blending: additive ? AdditiveBlending : NormalBlending,
        });
        const mesh = new Mesh(new IcosahedronGeometry(radius, 1), material);
        parent.add(mesh);
        this.faders.push({ material, base: opacity });
        return mesh;
    }
}

// Scales what a fader shows by `reveal`, after fade() has set it for the frame
function dim(faders: Fader[], reveal: number): void {
    for (const f of faders) {
        if ("points" in f) {
            f.points.uniforms.fade.value *= reveal;
        } else {
            f.material.opacity *= reveal;
        }
    }
}

// The orbital HUD: four tilted rings turning at their own pace around a lit core. Busy, the core beats. Assembling (the
// startup loader), the core lights first and the rings fade and grow in from the inside out (assembleReveal).
function hud(c: HologramColours, dpr: number, scale: number, assemble: boolean): Form {
    const b = new Builder(dpr, scale);
    const group = new Group();
    group.rotation.x = 0.18;
    group.rotation.y = -0.16;
    const rings: Group[] = [];
    // what each part draws, so it can enter on its own: [0] the core, [1..4] the rings from the inside out
    const parts: Fader[][] = [];
    for (let layer = 0; layer < 4; layer++) {
        const firstFader = b.faders.length;
        const ring = new Group();
        ring.position.z = (layer - 1.5) * 0.12;
        group.add(ring);
        rings.push(ring);
        const radius = 0.59 + layer * 0.3;
        const count = layer === 3 ? 8 : 3;
        for (let sector = 0; sector < count; sector++) {
            const start = (sector * TAU) / count + layer * 0.31;
            b.arc(
                ring,
                radius,
                start,
                (TAU / count) * (layer === 3 ? 0.68 : 0.82),
                c.blue,
                layer === 1 ? 1.9 : 1.05,
                0.85
            );
            if (layer === 1 || layer === 3) {
                b.arc(ring, radius - 0.05, start, (TAU / count) * 0.42, c.blueHot, 0.8, 0.4);
            }
        }
        if (layer === 2 || layer === 3) {
            const ticks: number[] = [];
            const tickCount = 48;
            for (let i = 0; i < tickCount; i++) {
                const angle = (TAU * i) / tickCount;
                const major = i % 4 === 0;
                for (const r of [radius + 0.05, radius + (major ? 0.12 : 0.085)]) {
                    ticks.push(Math.cos(angle) * r, Math.sin(angle) * r, 0);
                }
            }
            b.segments(ring, ticks, c.blue, 0.8, 0.55);
        }
        parts[layer + 1] = b.faders.slice(firstFader);
    }
    const coreFirstFader = b.faders.length;
    const core = new Group();
    group.add(core);
    b.arc(core, 0.33, 0, TAU, c.blueHot, 1.8, 0.9);
    b.arc(core, 0.39, 0.2, Math.PI * 1.6, c.blue, 0.8, 0.8);
    const paths: number[] = [];
    const p = (r: number, a: number) => [Math.cos(a) * r, Math.sin(a) * r, 0];
    for (let i = 0; i < 6; i++) {
        const angle = (TAU * i) / 6;
        paths.push(...p(0.13, angle), ...p(0.26, angle), ...p(0.43, angle), ...p(0.49, angle));
        paths.push(...p(0.94, angle), ...p(1.03, angle), ...p(1.03, angle), ...p(1.1, angle + 0.05));
    }
    b.segments(core, paths, c.blueHot, 1, 0.65);
    const sparks = b.points(core, [0, 0, 0.08], c.blueHot, 8);
    const nucleus = b.wire(core, 0.11, c.blueHot, 0.65, false);
    parts[0] = b.faders.slice(coreFirstFader);
    const speeds = [0.075, -0.12, 0.045, -0.03];
    return {
        group,
        faders: b.faders,
        update: (t, busy) => {
            const reveal = (part: number) => (assemble ? assembleReveal(t, part) : 1);
            rings.forEach((ring, i) => {
                ring.rotation.z = t * speeds[i];
                ring.scale.setScalar(0.7 + 0.3 * reveal(i + 1));
            });
            core.scale.setScalar((busy ? 1.05 + Math.sin(t * 4) * 0.06 : 1) * (0.6 + 0.4 * reveal(0)));
            if (assemble) {
                parts.forEach((faders, part) => dim(faders, reveal(part)));
            }
            nucleus.rotation.set(t * 0.15, t * 0.22, 0);
            sparks.material.uniforms.time.value = t;
            sparks.material.uniforms.energy.value = busy ? 1.8 : 1;
        },
    };
}

// The neural sphere: amber filaments branching out of a wireframe nucleus, a pulse running out along them. It is the
// form for "something waits on you", so its pulse always runs.
function neural(c: HologramColours, dpr: number, scale: number): Form {
    const b = new Builder(dpr, scale);
    const group = new Group();
    const random = randomSequence(731);
    const filaments: number[] = [];
    const inner: number[] = [];
    const nodes: number[] = [];
    const terminals: Vector3[] = [];
    const branches = 48;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const up = new Vector3(0, 1, 0);
    for (let i = 0; i < branches; i++) {
        const y = 1 - (2 * (i + 0.5)) / branches;
        const radius = Math.sqrt(1 - y * y);
        const direction = new Vector3(Math.cos(i * goldenAngle) * radius, y, Math.sin(i * goldenAngle) * radius);
        const side = new Vector3().crossVectors(direction, up).normalize();
        const chain: Vector3[] = [];
        for (let step = 0; step <= 9; step++) {
            const distance = 0.38 + (step / 9) * (1.0 + random() * 0.1);
            const wobble = (random() - 0.5) * 0.16 * Math.sin((step / 9) * Math.PI);
            const point = direction.clone().multiplyScalar(distance).addScaledVector(side, wobble);
            chain.push(point);
            if (step > 0) {
                (step < 4 ? inner : filaments).push(...chain[step - 1].toArray(), ...point.toArray());
            }
            if (step % 2 === 0) {
                nodes.push(...point.toArray());
            }
            if (step > 4 && step < 9) {
                const fork = point
                    .clone()
                    .addScaledVector(side, (random() > 0.5 ? 1 : -1) * (0.1 + random() * 0.16))
                    .addScaledVector(direction, 0.13);
                filaments.push(...point.toArray(), ...fork.toArray());
                nodes.push(...fork.toArray());
            }
        }
        terminals.push(chain[9]);
    }
    const shell: number[] = [];
    terminals.forEach((point, i) => {
        terminals
            .map((other, j) => ({ j, distance: point.distanceTo(other) }))
            .filter((v) => v.j > i && v.distance < 0.65)
            .sort((x, y) => x.distance - y.distance)
            .slice(0, 2)
            .forEach(({ j }) => shell.push(...point.toArray(), ...terminals[j].toArray()));
    });
    b.segments(group, inner, c.goldHot, 0.85, 0.25);
    b.segments(group, filaments, c.gold, 0.75, 0.47);
    b.segments(group, shell, c.gold, 0.65, 0.23);
    const cloud = b.points(group, nodes, c.gold, 2);
    const centre = b.points(group, [0, 0, 0], c.goldHot, 7);
    b.wire(group, 0.3, c.goldHot, 0.32, true);
    const pulse = b.points(
        group,
        terminals.flatMap((v) => v.toArray()),
        c.goldHot,
        3
    );
    pulse.material.uniforms.energy.value = 1.5;
    centre.material.uniforms.energy.value = 1.7;
    return {
        group,
        faders: b.faders,
        update: (t) => {
            group.rotation.set(0.18 + Math.sin(t * 0.12) * 0.06, t * 0.065, -0.12);
            cloud.material.uniforms.time.value = t * 0.65;
            centre.material.uniforms.time.value = t;
            pulse.scale.setScalar(0.2 + ((t * 0.36) % 1) * 0.8);
        },
    };
}

function fade(form: Form, weight: number): void {
    form.group.visible = weight > 0.002;
    for (const f of form.faders) {
        if ("points" in f) {
            f.points.uniforms.fade.value = weight;
        } else {
            f.material.opacity = f.base * weight;
        }
    }
}

export class HologramScene {
    private constructor(
        private canvas: HTMLCanvasElement,
        private renderer: WebGLRenderer,
        private composer: EffectComposer,
        private scene: Scene,
        private hudForm: Form,
        private neuralForm: Form,
        private bloom: UnrealBloomPass,
        private onLost: (ev: Event) => void
    ) {}

    /** null when the GL context cannot be had: the caller shows Sprout instead of a blank corner. `assemble` builds the
     * HUD part by part from the scene's first frame (the startup loader) instead of showing it whole. */
    static create(
        canvas: HTMLCanvasElement,
        sizePx: number,
        colours: HologramColours,
        onLost: () => void,
        assemble = false
    ): HologramScene | null {
        let renderer: WebGLRenderer;
        try {
            renderer = new WebGLRenderer({
                canvas,
                antialias: true,
                alpha: true,
                // premultiplied: alphaFromLight writes it, and WKWebView composites a straight-alpha canvas wrongly
                premultipliedAlpha: true,
                powerPreference: "low-power",
            });
        } catch {
            return null;
        }
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        renderer.setPixelRatio(dpr);
        renderer.setSize(sizePx, sizePx, false);
        const scene = new Scene();
        const camera = new PerspectiveCamera(36, 1, 0.1, 50);
        camera.position.z = 6.3;
        const composer = new EffectComposer(renderer);
        composer.setPixelRatio(dpr);
        composer.setSize(sizePx, sizePx);
        composer.addPass(new RenderPass(scene, camera));
        const bloom = new UnrealBloomPass(new Vector2(sizePx, sizePx), BLOOM, 0.2, 0.4);
        composer.addPass(bloom);
        composer.addPass(new OutputPass());
        composer.addPass(new ShaderPass(alphaFromLight));
        const scale = sizePx / STUDY_PX;
        const hudForm = hud(colours, dpr, scale, assemble);
        const neuralForm = neural(colours, dpr, scale);
        scene.add(hudForm.group, neuralForm.group);
        const lost = (ev: Event) => {
            ev.preventDefault();
            onLost();
        };
        canvas.addEventListener("webglcontextlost", lost);
        return new HologramScene(canvas, renderer, composer, scene, hudForm, neuralForm, bloom, lost);
    }

    /** t in seconds; sphere 0 is all HUD, 1 all neural sphere (already eased). */
    draw(t: number, busy: boolean, sphere: number): void {
        fade(this.hudForm, 1 - sphere);
        fade(this.neuralForm, sphere);
        this.hudForm.update(t, busy);
        this.neuralForm.update(t, busy);
        // the morph between the two (hologrammodel morphPose): the HUD's rings wind in and draw down into the core while
        // the sphere grows out of it, a touch past its size before it settles, with a flare of light at the crossing
        const m = morphPose(sphere);
        this.hudForm.group.scale.setScalar(m.hudScale);
        this.hudForm.group.rotation.z = m.hudTwist;
        this.neuralForm.group.scale.setScalar(m.sphereScale);
        this.bloom.strength = BLOOM * m.flare;
        this.composer.render();
    }

    dispose(): void {
        this.canvas.removeEventListener("webglcontextlost", this.onLost);
        this.scene.traverse((object) => {
            const o = object as Object3D & { geometry?: { dispose(): void }; material?: Material | Material[] };
            o.geometry?.dispose();
            const materials = Array.isArray(o.material) ? o.material : o.material != null ? [o.material] : [];
            materials.forEach((m) => m.dispose());
        });
        this.composer.passes.forEach((pass) => pass.dispose?.());
        this.composer.dispose();
        this.renderer.dispose();
    }
}
