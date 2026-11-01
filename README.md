# OpenCAD Studio

A **free, open-source parametric 3D CAD app for macOS**, inspired by the Fusion 360 workflow:
sketch → extrude/revolve → modify, with every step recorded on an editable **timeline**.

![icon](build/icon.png)

## Features

| Area | What you get |
| --- | --- |
| **Sketching** | Sketch on the XY / XZ / YZ planes **or on any flat face of a body**. Line/polyline, rectangle, center rectangle, circle, polygon and slot tools, grid and point snapping, typed exact dimensions, construction geometry. Shapes inside other shapes become holes. |
| **Solid features** | Extrude (one side, flipped or symmetric; rounded corners, taper, twist), Revolve, Box, Cylinder (both with edge fillets), Sphere, Cone, Torus, STL import. |
| **Operations** | New body / Join / Cut / Intersect on every feature. Extruding a face sketch automatically joins, or cuts when you extrude inward. |
| **Modify** | Move/Rotate with an on-screen gizmo, Scale, Combine (join/cut/intersect bodies), Mirror, Linear and Circular patterns, Hollow (shell). |
| **Parametric** | Every feature stays editable on the timeline. Fields take expressions such as `width/2 + 3` or `1in`, using named **Parameters**. Suppress, reorder, rename or delete steps. |
| **Inspect** | Measure distances, see size, volume, surface area and estimated PLA mass. |
| **Files** | Save/open `.ocad` designs (double-click in Finder works), export **STL** and **OBJ** for 3D printing, save PNG images. Autosave recovery after crashes. |
| **View** | Orbit/pan/zoom (trackpad friendly), standard views, perspective/orthographic, wireframe, X-ray, edges, grid. |

Geometry comes from the [Manifold](https://github.com/elalish/manifold) kernel, which guarantees watertight solids, so your exports are always printable. Rendering uses [three.js](https://threejs.org).

## Install on your Mac

1. Open the **Actions** tab of this repo, click the latest **Build macOS app** run, and download the
   `OpenCAD-Studio-macOS` artifact. (Or grab it from **Releases** if one has been published.)
2. Unzip it and open the `.dmg`:
   - `…-arm64.dmg` → Apple Silicon Macs (M1/M2/M3/M4…)
   - `…-x64.dmg` → Intel Macs
3. Drag **OpenCAD Studio** into **Applications**.
4. The first time you open it, macOS will warn that the app is from an unidentified developer (it is not
   notarized, since that requires a paid Apple developer account). Either:
   - **Right-click** the app → **Open** → **Open**, or
   - go to **System Settings → Privacy & Security** and click **Open Anyway**, or
   - run `xattr -cr "/Applications/OpenCAD Studio.app"` in Terminal.

## Run or build from source

Requires [Node.js](https://nodejs.org) 20+.

```bash
npm install
npm start            # build and launch the desktop app
npm run dev          # or run it in your browser at http://localhost:5173
npm test             # geometry kernel tests
npm run dist:mac     # build .dmg/.zip into release/ (run on a Mac)
```

To publish a downloadable release, push a version tag (e.g. `git tag v1.0.0 && git push origin v1.0.0`);
the GitHub workflow attaches the `.dmg` and `.zip` files to a GitHub Release.

## Quick start

1. Press **S** (Sketch) and click the **XY** plane.
2. Choose **Rectangle**, click two corners (or click once and type `40,20` then Enter).
3. Add a **Circle** inside it to make a hole, then click **Finish Sketch**.
4. Press **E** (Extrude), type a distance, press **Enter**.
5. Press **S** again and click the **top face** to sketch on it. Extrude that sketch inward (a negative distance) to cut a pocket.
6. Click any step in the timeline to change its dimensions later. The model rebuilds automatically.
7. Use **Export → STL** to send it to your slicer.

Also try **File → Examples…** for a parametric bracket, an electronics enclosure, a vase and a spoked wheel.

## Keyboard shortcuts

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| S | Sketch | E | Extrude |
| B | Box | Y | Cylinder |
| M | Move selected body | J | Combine selected bodies |
| I | Measure | F | Fit view |
| 0 / 1 / 2 / 3 | Home / Front / Top / Right | Delete | Remove selected bodies |
| ⌘Z / ⇧⌘Z | Undo / Redo | ⌘S | Save |
| Esc | Cancel / deselect | Enter | Accept dialog / finish sketch |

In a sketch: **L** line, **R** rectangle, **T** center rectangle, **C** circle, **P** polygon, **O** slot,
**V** select, **X** toggle construction, and type numbers while drawing for exact sizes.

## Limitations compared with Fusion 360

OpenCAD Studio is a mesh-based (not B-rep) modeler, so it doesn't have:
STEP/IGES import or export, fillets/chamfers on arbitrary selected edges (fillets are available on boxes,
cylinders and extruded profile corners), a sketch constraint solver, assemblies/joints, drawings, CAM or
simulation.

## Project layout

```
electron/        macOS app shell: window, native menus, file dialogs
src/kernel/      parametric engine: features, expressions, regeneration (pure JS + Manifold WASM)
src/viewport.js  three.js 3D view, picking, gizmo, camera
src/sketcher.js  interactive 2D sketch editor
src/app.js       UI: toolbar, browser, timeline, property panels, files
tests/           kernel tests (node --test)
```

## License

MIT
