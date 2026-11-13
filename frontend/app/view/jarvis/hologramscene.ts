// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The hologram's pixels: the HUD (hologramhud.ts's form, the kaeltran16 fork's avatar) and the neural sphere of the
// 2026-09-11 avatar study (jarvis-avatar-comparison, "A presence, not a mascot"), in one canvas, with a morph between
// them. What shows and when is hologrammodel.ts's. Loaded lazily by hologramview.tsx, so three.js costs nothing while
// Jarvis is Sprout.

import {
    AdditiveBlending,
    BufferAttribute,
    BufferGeometry,
    Color,
    DoubleSide,
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
    SRGBColorSpace,
    Vector2,
    Vector3,
    WebGLRenderer,
    type InterleavedBuffer,
    type InterleavedBufferAttribute,
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
import {
    breathFromPhase,
    buildHudScene,
    growCapacity,
    HUD_MOTION_START,
    HUD_PARTS,
    hudColours,
    hudFillTriangles,
    hudOrbit,
    packHudFills,
    packHudLines,
    stepHudMotion,
    STROKE_WIDTHS,
    STUDY_PX,
    utteranceEnvelope,
    type HudMotion,
    type HudPart,
    type Rgb,
} from "./hologramhud";
import { assembleReveal, morphPose } from "./hologrammodel";

// The bloom runs on display values, after OutputPass, as the fork's avatar does: in linear light its tail is lifted by
// the sRGB encode that follows, and every lit stroke wore a wide haze. The HUD takes the fork's numbers (only the lit
// core ring, the front arcs and the blades pass 0.4); the sphere was tuned in linear light, where its 0.4 is 0.665 in
// display values. The morph flares the strength (morphPose).
const BLOOM = 0.35;
const BLOOM_THRESHOLD_HUD = 0.4;
const BLOOM_THRESHOLD_SPHERE = 0.665;

// past 1.5 the bloom's targets cost more than the softness they buy at this size (the study's cap)
const MAX_DPR = 1.5;

// The camera, and how far it sees either side of the centre on the plane z = 0. The HUD comes as a flat [-1,1] box
// facing the camera, so scaling it to this half-width lands each stroke where an orthographic camera would.
const CAMERA_Z = 6.3;
const CAMERA_FOV = 36;
const HALF_VIEW = CAMERA_Z * Math.tan(((CAMERA_FOV / 2) * Math.PI) / 180);

// Bloom replaces alpha; this hands it back from the light (the study's formula), so the glow has no rectangular edge on
// the app behind. It runs last, on display values (OutputPass and the bloom are behind it), and writes premultiplied colour into a
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
    gold: Color;
    goldHot: Color;
}

// Read from the live custom properties, so a theme's own connection colours carry through. The HUD's lit tone is its
// blue lightened (hologramhud hudColours), not a token of its own: a near-white token there is what made the old core
// blow out.
export function readHologramColours(read: (name: string) => string): HologramColours {
    const token = (name: string, fallback: string) => new Color(read(`--color-${name}`) || fallback);
    return {
        blue: token("conn-1", "#53b4ea"),
        gold: token("conn-6", "#ffa24e"),
        goldHot: token("warning-soft", "#f0d79f"),
    };
}

/** What the HUD reads from the pose each frame. */
export interface HudFrame {
    // 0..1 load (hologramhud activityLevel): the breath quickens and pulses run in along the struts
    activity: number;
    // a bubble is up: the form turns square-on and sweeps as it comes up
    speaking: boolean;
    quiet: boolean;
    // reduced motion
    still: boolean;
}

// --- the HUD: hologramhud.ts's strokes and fills, rebuilt each frame into buffers that live across frames ---

interface LineBatch {
    material: LineMaterial;
    lines: LineSegments2;
    geometry: LineSegmentsGeometry;
    // segments the geometry's buffers hold
    capacity: number;
    width: number;
}

function lineGeometry(capacity: number): LineSegmentsGeometry {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(new Float32Array(capacity * 6));
    geometry.setColors(new Float32Array(capacity * 6));
    return geometry;
}

function fillGeometry(triangles: number): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(triangles * 9), 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(triangles * 9), 3));
    return geometry;
}

// LineSegmentsGeometry keeps a segment's start and end in one interleaved buffer
function interleaved(geometry: LineSegmentsGeometry, name: string): InterleavedBuffer {
    return (geometry.getAttribute(name) as InterleavedBufferAttribute).data;
}

// uploads only the floats this frame wrote, not the buffer's whole capacity
function upload(buffer: InterleavedBuffer | BufferAttribute, floats: number): void {
    buffer.clearUpdateRanges();
    buffer.addUpdateRange(0, floats);
    buffer.needsUpdate = true;
}

class HudLayer {
    readonly group = new Group();
    private batches: LineBatch[];
    private fillCapacity = growCapacity(0, 0);
    private fillGeometry = fillGeometry(this.fillCapacity);
    private fillMaterial: MeshBasicMaterial;
    private fillMesh: Mesh;
    private colours: { body: Rgb; hot: Rgb };
    private motion: HudMotion = HUD_MOTION_START;
    private lastNow: number | null = null;

    // `scale`: the size against the study's 132 px, so a smaller hologram draws thinner strokes rather than the same
    // pixels packed into less room
    constructor(
        private sizePx: number,
        dpr: number,
        body: Color,
        private assemble: boolean
    ) {
        const scale = sizePx / STUDY_PX;
        const srgb = body.getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);
        this.colours = hudColours([srgb.r, srgb.g, srgb.b]);
        // one batch per stroke weight: a fat line's width is a material uniform
        this.batches = STROKE_WIDTHS.map((width) => {
            const material = new LineMaterial({
                vertexColors: true,
                // pixels, not world units; the resolution is the drawing buffer's, hence the dpr
                worldUnits: false,
                linewidth: width * scale * dpr,
                transparent: true,
                blending: AdditiveBlending,
                // additive summing is order-independent, so depth would only drop overlaps
                depthTest: false,
                depthWrite: false,
            });
            const capacity = growCapacity(0, 0);
            const geometry = lineGeometry(capacity);
            const lines = new LineSegments2(geometry, material);
            // rebuilt every frame inside the camera's box: culling could only drop it on stale bounds
            lines.frustumCulled = false;
            this.group.add(lines);
            return { material, lines, geometry, capacity, width };
        });
        this.fillMaterial = new MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            blending: AdditiveBlending,
            depthTest: false,
            depthWrite: false,
            // a quad tipped past edge-on winds the other way
            side: DoubleSide,
        });
        this.fillMesh = new Mesh(this.fillGeometry, this.fillMaterial);
        this.fillMesh.frustumCulled = false;
        // the fills are what the strokes sit on
        this.fillMesh.renderOrder = -1;
        this.group.add(this.fillMesh);
    }

    fade(weight: number): void {
        this.group.visible = weight > 0.002;
        for (const batch of this.batches) {
            batch.material.opacity = weight;
        }
        this.fillMaterial.opacity = weight;
    }

    update(t: number, frame: HudFrame): void {
        const now = t * 1000;
        const dt = this.lastNow == null ? 0 : now - this.lastNow;
        this.lastNow = now;
        this.motion = stepHudMotion(this.motion, now, dt, frame.activity, frame.speaking);
        const orbit = hudOrbit(now);
        let reveal: Partial<Record<HudPart, number>> | undefined;
        if (this.assemble) {
            reveal = {};
            HUD_PARTS.forEach((part, i) => (reveal![part] = assembleReveal(t, i)));
        }
        const scene = buildHudScene({
            size: this.sizePx,
            now,
            yaw: orbit.yaw,
            pitch: orbit.pitch,
            breath: breathFromPhase(this.motion.breathPhase),
            utterance: utteranceEnvelope(now, this.motion.spokeAt),
            quiet: frame.quiet,
            still: frame.still,
            activity: frame.activity,
            pulseClock: this.motion.pulseClock,
            reveal,
        });

        for (const batch of this.batches) {
            const slice = scene.segments.filter((s) => s.width === batch.width);
            batch.lines.visible = slice.length > 0;
            if (slice.length === 0) {
                continue;
            }
            const capacity = growCapacity(slice.length, batch.capacity);
            if (capacity !== batch.capacity) {
                const next = lineGeometry(capacity);
                batch.geometry.dispose();
                batch.geometry = next;
                batch.lines.geometry = next;
                batch.capacity = capacity;
            }
            const positions = interleaved(batch.geometry, "instanceStart");
            const colors = interleaved(batch.geometry, "instanceColorStart");
            const count = packHudLines(
                slice,
                this.sizePx,
                this.colours,
                positions.array as Float32Array,
                colors.array as Float32Array
            );
            upload(positions, count * 6);
            upload(colors, count * 6);
            batch.geometry.instanceCount = count;
        }

        const triangles = hudFillTriangles(scene.fills);
        this.fillMesh.visible = triangles > 0;
        if (triangles > 0) {
            const capacity = growCapacity(triangles, this.fillCapacity);
            if (capacity !== this.fillCapacity) {
                const next = fillGeometry(capacity);
                this.fillGeometry.dispose();
                this.fillGeometry = next;
                this.fillMesh.geometry = next;
                this.fillCapacity = capacity;
            }
            const positions = this.fillGeometry.getAttribute("position") as BufferAttribute;
            const colors = this.fillGeometry.getAttribute("color") as BufferAttribute;
            packHudFills(
                scene.fills,
                this.sizePx,
                this.colours,
                positions.array as Float32Array,
                colors.array as Float32Array
            );
            upload(positions, triangles * 9);
            upload(colors, triangles * 9);
            this.fillGeometry.setDrawRange(0, triangles * 3);
        }
    }
}

// --- the neural sphere ---

// Everything the sphere draws fades through one of these: a material's opacity, or a point shader's fade uniform.
type Fader = { material: LineMaterial | MeshBasicMaterial; base: number } | { points: ShaderMaterial };

interface Form {
    group: Group;
    faders: Fader[];
    update: (t: number) => void;
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
    // rather than the same pixels packed into less room
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
        private hud: HudLayer,
        private neuralForm: Form,
        private bloom: UnrealBloomPass,
        private onLost: (ev: Event) => void
    ) {}

    /** null when the GL context cannot be had: the caller shows Sprout instead of a blank corner. `assemble` builds the
     * HUD layer by layer from the scene's first frame (the startup loader) instead of showing it whole. */
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
        const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 50);
        camera.position.z = CAMERA_Z;
        const composer = new EffectComposer(renderer);
        composer.setPixelRatio(dpr);
        composer.setSize(sizePx, sizePx);
        composer.addPass(new RenderPass(scene, camera));
        composer.addPass(new OutputPass());
        const bloom = new UnrealBloomPass(new Vector2(sizePx, sizePx), BLOOM, 0.2, BLOOM_THRESHOLD_HUD);
        composer.addPass(bloom);
        composer.addPass(new ShaderPass(alphaFromLight));
        const hud = new HudLayer(sizePx, dpr, colours.blue, assemble);
        const neuralForm = neural(colours, dpr, sizePx / STUDY_PX);
        scene.add(hud.group, neuralForm.group);
        const lost = (ev: Event) => {
            ev.preventDefault();
            onLost();
        };
        canvas.addEventListener("webglcontextlost", lost);
        return new HologramScene(canvas, renderer, composer, scene, hud, neuralForm, bloom, lost);
    }

    /** t in seconds; sphere 0 is all HUD, 1 all neural sphere (already eased). */
    draw(t: number, frame: HudFrame, sphere: number): void {
        this.hud.fade(1 - sphere);
        fade(this.neuralForm, sphere);
        this.hud.update(t, frame);
        this.neuralForm.update(t);
        // the morph between the two (hologrammodel morphPose): the HUD winds in and draws down into its core while the
        // sphere grows out of it, a touch past its size before it settles, with a flare of light at the crossing
        const m = morphPose(sphere);
        this.hud.group.scale.setScalar(HALF_VIEW * m.hudScale);
        this.hud.group.rotation.z = m.hudTwist;
        this.neuralForm.group.scale.setScalar(m.sphereScale);
        this.bloom.strength = BLOOM * m.flare;
        this.bloom.threshold = BLOOM_THRESHOLD_HUD + (BLOOM_THRESHOLD_SPHERE - BLOOM_THRESHOLD_HUD) * sphere;
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
