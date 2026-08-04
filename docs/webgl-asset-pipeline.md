# Blender to WebGL Asset Pipeline

Working doc for taking blockout geometry to shippable GLB assets. Written for hard-surface subjects (ships, buildings, stations) rendered in a Three.js client.

## The one rule that governs everything else

The render target is WebGL, not Cycles. A path tracer forgives bad materials and bad topology because global illumination does the heavy lifting. Three.js does not. So the look is developed in **EEVEE**, which is the same class of renderer as the target, and Cycles is used only for baking. If a ship looks right in Cycles and wrong in the browser, the Cycles version was never real.

The corollary: roughly half the final quality lives in the Three.js scene setup (environment map, tone mapping, bloom), not in the .blend file. Stage 9 is not optional polish.

---

## Stage 0. Scene setup

Do this once and save it as a startup file or an empty template .blend.

- Render engine: EEVEE. Enable raytracing if your Blender version has it (4.2+).
- Color Management: View Transform **AgX**. Standard will make every render look blown out and plastic.
- Scene units: metric, unit scale 1.0. Model at real-world size. A 40m corvette is 40m in Blender. This matters because bevel widths, texture scale and the physical camera all assume real units, and because glTF is metres.
- Apply scale (Ctrl+A) on every object before you bevel anything. Non-uniform object scale makes bevel widths inconsistent and is the single most common cause of "why does this edge look wrong".

---

## Stage 1. Silhouette

Judge only the outline. Squint, or set the viewport to a flat matcap, or drop the render to a black-on-white shadeless pass.

- Gather reference first: naval vessels, industrial plant, aircraft undercarriage, anything with the mass distribution you want. Working from imagination produces symmetric, evenly-detailed shapes that read as toys.
- Big shapes, then secondary forms, then detail. Do not add a single greeble until the primary masses are locked.
- Use a Mirror modifier on the symmetry axis, but break symmetry deliberately in one or two places (asymmetric sensor mast, offset hangar) because perfect symmetry reads as CAD.
- Test at thumbnail size. If it does not read at 128px, more detail will not save it.

Deliverable: a blockout of primitives with correct proportion, no bevels, no materials.

## Stage 2. Edge treatment

This is the highest ratio of improvement to effort in the whole pipeline, and it takes minutes on geometry you already have. Perfectly sharp 90 degree edges do not exist physically, so their absence is what makes untouched primitives look synthetic. A bevel catches a highlight along every edge and the shape starts reading as a manufactured object.

Modifier stack, in this order:

1. (geometry modifiers: Mirror, Array, Boolean, Solidify)
2. **Bevel**
   - Width Type: Offset
   - Amount: start at 0.5 to 2 cm on a 40m hull, i.e. small enough to read as a machined edge rather than a rounded-off corner. Scale-dependent, so tune by eye at final camera distance.
   - Segments: 2 for background assets, 3 for hero
   - Limit Method: Angle, around 30 to 60 degrees
   - Miter Outer: Arc (cleans up corner pinching)
   - Harden Normals: on
3. **Weighted Normal**, last in the stack
   - Keep Sharp: on
   - This is what stops the bevel from smearing shading across large flat faces.

Shading: use Shade Auto Smooth. In Blender 4.1 and later this adds a Smooth by Angle modifier rather than the old Auto Smooth checkbox; both Harden Normals and Weighted Normal depend on this being present.

Sanity check: render a grey clay pass with one hard light. Every silhouette edge should show a thin bright line. If it does not, the bevel width is too small for the camera distance.

## Stage 3. Detail

Detail density is what gives hard-surface subjects scale. A hull with no small features could be 4m or 400m; the same hull with door-sized panels and human-scale ladders reads instantly as huge.

Techniques, cheapest first:

- **Panel lines**: inset faces then extrude inward a few millimetres. Or a Boolean cut with a thin box. Panel lines want to follow structural logic, so they run along stress lines and around access points, not as a decorative grid.
- **Raised plates**: inset, extrude outward, bevel. Break large flat areas into two or three plate levels.
- **Greeble library**: build six to ten small parts once (vent, pipe cluster, hatch, antenna, bolt strip, radiator fin) in a separate collection. Everything else is instancing.
- **Scatter**: Geometry Nodes distribute-on-faces with the greeble collection as instances, masked to specific surfaces with a vertex group. Or an Array modifier along a curve for repeating runs.

Detail should be uneven. Clusters of density next to large calm areas reads as real engineering; uniform coverage reads as noise.

This stage is the best candidate for automation (see Stage 10), because scattering, arraying and boolean-cutting are exactly the repetitive precise operations that a script does better than a mouse.

## Stage 4. Materials

Base colour matters far less than you would expect. **Roughness variation is what sells a surface as real.** A hull is usually one metal with a roughness map full of streaks, wear and dirt, not five different colours.

Fast route, before committing to UV unwrapping:

- Tileable PBR metal from Poly Haven, applied with Box projection on the Texture Coordinate node (Generated coordinates, Mapping node for scale). No unwrap needed at this stage.
- **Edge wear mask**: Geometry node > Pointiness into a ColorRamp with a tight range, driving a mix between the base metal and a brighter, lower-roughness scratched metal. Convex edges get worn, which is where wear actually happens.
- **Grime mask**: bake an AO map (Stage 6) or use an AO node, into a ColorRamp, driving a darker, higher-roughness dirt layer in the crevices.
- **Large-scale variation**: a low-frequency noise texture at large scale, mixed subtly into roughness only. Even 10 percent variation kills the plastic look.

Metallic is binary in reality. A surface is metal (1.0) or it is not (0.0), and the in-between values are only for transition areas in a texture. Painted metal is metallic 0.0 with the paint's roughness.

Keep the node graph to what glTF can carry: Principled BSDF with base colour, metallic, roughness, normal, occlusion, emission. Anything else (procedural noise, complex mixes) has to be baked in Stage 6 or it will not survive the export.

## Stage 5. Lighting

An HDRI is the largest single realism lever available. Even in space, an environment texture gives you the subtle reflected detail that a bare sun lamp cannot.

Space scene starting point:

- **Key**: one Sun lamp, angle set small (0.5 to 2 degrees) for hard shadows. High strength.
- **Fill**: near-black, but not zero. A very dim area light or a dark HDRI, so shadow-side surfaces are not pure black.
- **Rim**: an area light or emissive plane from behind and off-axis, coloured from the nearest planet or nebula. This is what separates the silhouette from a black background.
- **Emissive**: engine bells, running lights, window strips. Emission strength well above 1.0 so they clip and bloom.

Do the same three-light logic for buildings, with the HDRI providing the sky and bounce.

## Stage 6. Bake to a game mesh

You now have a high-detail mesh that is far too heavy to ship. The bake transfers its surface detail onto a light mesh as textures.

1. **Low-poly target**: duplicate the blockout from Stage 1, or decimate the high mesh and clean it. This is the mesh that ships. Keep the silhouette, drop the surface detail.
2. **UV unwrap the low mesh** (this one does need real UVs). Mark seams along panel breaks and hidden edges. Pack with a small margin (0.01 to 0.02).
3. **Bake in Cycles** (EEVEE cannot bake selected-to-active properly). Select high mesh, then shift-select low mesh, Bake with Selected to Active on.
   - **Normal**, space Tangent. Set Extrusion and Max Ray Distance so the cage encloses the high mesh without catching neighbouring parts. Use an explicit Cage object if parts overlap.
   - **Ambient Occlusion**, into its own image.
   - **Roughness** and **Base Color** if you used procedural node setups that need flattening.
4. **Green channel**: glTF uses the OpenGL convention (+Y up), which is what Blender bakes by default. No flip needed. (If you ever port to Unity, that is where the flip lives.)
5. **Pack ORM**: glTF expects one texture with Occlusion in R, Roughness in G, Metallic in B. Combine the three baked maps into a single image before export.

Texture sizes as a starting point, to be replaced by your measured budget: 2048 for a hero asset, 1024 for secondary, 512 for background props.

## Stage 7. Export

glTF 2.0 exporter, format **glTF Binary (.glb)**.

- Include: Selected Objects (do not export lights and cameras)
- Transform: +Y Up (default, matches Three.js)
- Geometry: Apply Modifiers on, UVs on, Normals on, Tangents on. Exporting tangents avoids relying on runtime mikktspace generation and keeps normal maps consistent.
- Materials: Export. Emissive above 1.0 is carried by the KHR_materials_emissive_strength extension, which Three.js reads.
- Compression: leave the exporter's Draco off. Compression is handled in Stage 8 where you get more control and can do textures at the same time.

## Stage 8. Optimise

All via gltf-transform CLI. The single-command version:

```bash
npx @gltf-transform/cli optimize in.glb out.glb \
  --compress meshopt \
  --texture-compress ktx2
```

The explicit version, when you want to control each step:

```bash
gltf-transform dedup in.glb tmp1.glb          # merge duplicate accessors/materials
gltf-transform weld tmp1.glb tmp2.glb          # merge coincident vertices
gltf-transform simplify tmp2.glb tmp3.glb --ratio 0.6 --error 0.001
gltf-transform resize tmp3.glb tmp4.glb --width 2048 --height 2048
gltf-transform etc1s tmp4.glb tmp5.glb         # colour + ORM maps
gltf-transform uastc tmp5.glb tmp6.glb --slots "normalTexture"
gltf-transform meshopt tmp6.glb out.glb
```

Notes:
- **ETC1S** for colour and ORM (small, lossy). **UASTC** for normal maps, which fall apart badly under ETC1S.
- **meshopt** over Draco: comparable size, much faster decode, and the decoder is tiny. Draco is fine if you already have it wired up.
- Run this as a script in the repo, not by hand, so every asset gets identical treatment and the settings are diffable.

Budget starting points, to be reconciled against the perf budget already in your WebGL client pack rather than treated as fixed: hero ship 15k to 40k triangles, mid-distance 5k to 15k, background 1k to 5k. Watch draw calls as hard as triangles; twenty separate greeble meshes on one hull is twenty draw calls unless they are joined or instanced.

## Stage 9. Three.js setup

Half the quality. Do not skip this and then conclude the model is the problem.

```js
// Renderer
renderer.toneMapping = THREE.AgXToneMapping;   // ACESFilmicToneMapping if on an older three
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// Environment: the same HDRI used in Blender
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
new RGBELoader().load('/hdri/space.hdr', (hdr) => {
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  hdr.dispose();
  pmrem.dispose();
});
// scene.background stays null or a starfield; environment is for reflections

// Loaders
const ktx2 = new KTX2Loader()
  .setTranscoderPath('/basis/')
  .detectSupport(renderer);
const loader = new GLTFLoader()
  .setKTX2Loader(ktx2)
  .setMeshoptDecoder(MeshoptDecoder);
```

Then:

- **Anisotropy** on every texture: `tex.anisotropy = renderer.capabilities.getMaxAnisotropy();` Grazing-angle hull surfaces look blurred without it.
- **Bloom** via EffectComposer + UnrealBloomPass. Threshold high (around 0.9) so only emissive engine glow blooms rather than every lit surface. Selective bloom via a layer is better still if you have the budget.
- **Colour space**: base colour textures are SRGBColorSpace, normal and ORM are NoColorSpace. Getting this wrong makes normals look weak and roughness look flat.
- Match the Blender lighting rig: same HDRI, same key direction, same relative intensities. If it looks different, the difference is almost always tone mapping or colour space, not the mesh.

## Stage 10. What to hand to the agent

Split by whether the work is judgement or repetition.

**Keep manual**: silhouette, proportion, detail placement, anything aesthetic.

**Script it** (headless, committed to the repo, so it is reviewable and re-runnable):

```bash
blender --background --python scripts/build_ship.py
```

Good candidates:
- Greeble scatter and array setups
- Applying the standard Bevel + Weighted Normal stack across every object in a collection
- Batch bake setup (image creation, node wiring, bake invocation, ORM packing)
- Batch GLB export with fixed settings
- The whole of Stage 8 as a shell script

Prefer scripts over a live MCP session for anything that becomes part of the pipeline. A .py file can be diffed, reviewed and re-run on the next asset; a conversation that produced a .blend cannot.

---

## Per-asset checklist

- [ ] Scale applied, real-world size
- [ ] Silhouette reads at thumbnail size
- [ ] Bevel + Weighted Normal on all hard-surface geometry
- [ ] Detail density uneven, with human-scale reference features
- [ ] Roughness has visible variation (wear on edges, grime in crevices)
- [ ] Metallic is 0 or 1, not in between
- [ ] Looks right in **EEVEE**, not just Cycles
- [ ] Low mesh unwrapped, normal + ORM baked
- [ ] GLB exported with tangents, +Y up, modifiers applied
- [ ] Compressed: meshopt + KTX2 (UASTC for normals)
- [ ] Within triangle, texture and draw-call budget
- [ ] Verified in the actual Three.js scene with the real environment map

## Common failure modes

| Symptom | Usual cause |
|---|---|
| Looks like a plastic toy | No bevels, or uniform roughness |
| Great in Blender, flat in browser | Developed in Cycles; no environment map in Three.js |
| Normal map barely visible | Texture in SRGB instead of NoColorSpace, or tangents missing |
| Shading smears across flat faces | Weighted Normal missing or not last in the stack |
| Bevel inconsistent across parts | Object scale not applied |
| Blown out / washed out | View transform on Standard instead of AgX; tone mapping mismatch |
| Scale ambiguous | No human-scale reference features (doors, ladders, rails) |
| Frame rate tanks with low triangle count | Draw calls, not geometry. Join or instance |

---

## Suggested first run

One ship, end to end, all ten stages, before touching the rest of the fleet. The first pass tells you where your actual bottleneck sits, which is rarely where you expect, and the second asset takes roughly a fifth of the time.
