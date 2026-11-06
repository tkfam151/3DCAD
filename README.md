# OpenCAD Studio

A **free, open-source parametric 3D CAD app for Mac (M chips) and Windows**, inspired by the Fusion 360 workflow:
sketch → extrude/revolve → modify, with every step recorded on an editable **timeline**.

![icon](build/icon.png)

## Features

| Area | What you get |
| --- | --- |
| **Start screen** | Create a new blank design, start from a template, open `.ocad` designs or `.stl` / `.obj` 3D models, reopen recent files (with thumbnails), drag & drop files, and recover unsaved work. Click the **⌂ OpenCAD** button (or **File → Home**, ⇧⌘H) to get back to it. |
| **Sketching** | Sketch on the XY / XZ / YZ planes **or on any flat face of a body**. Line/polyline, rectangle, center rectangle, circle, polygon and slot tools, grid and point snapping, typed exact dimensions, construction geometry. Shapes inside other shapes become holes. |
| **Solid features** | Extrude (one side, flipped or symmetric; rounded corners, taper, twist), Revolve, Box, Cylinder (both with edge fillets), Sphere, Cone, Torus, STL import. |
| **Operations** | New body / Join / Cut / Intersect on every feature. Extruding a face sketch automatically joins, or cuts when you extrude inward. |
| **Modify** | Move/Rotate with an on-screen gizmo, Scale, Combine (join/cut/intersect bodies), Mirror, Linear and Circular patterns, Hollow (shell). |
| **3D text** | Click **Text** in the toolbar, type your words and set letter height and thickness to get solid 3D letters. **Join** them onto a part for raised lettering or **Cut** to engrave; drag the arrows to resize. There's also a Text tool inside Sketch (**A**) for text on sketched profiles. |
| **Sign in & cloud save** | Create an account with email and password, click **Cloud** to save, and reopen your designs from the start screen on any computer, in the app or the website. Powered by Supabase. |
| **For students** | **Print check** (fits the printer? sits flat? needs supports? grams, time and cost), **Drop to bed**, a **Design journal** following the MYP design cycle, **Hand in** (one ZIP with design, STL, 4 screenshots, journal and print check) and step-by-step **Lessons** with Pip. |
| **School spaces** | Schools are added with a creation code from the admin and get a password-protected staff page and student page with the school's name and colour. Owners create teacher and student accounts (usernames); see **Schools and organisations** below. |
| **Classes & assignments** | On school pages: teachers create classes, add students or share a join code, and post assignments with due dates. Students hand in their design in one click; teachers give **feedback and a grade**. Students can share designs with their class. |
| **Share links** | Share a view-only link to any cloud design. Anyone can open it and save their own copy. |
| **Install & offline** | Install the website as an app (Chrome/Edge: *Install app*; iPad: *Add to Home Screen*). It keeps working offline. |
| **Drag to resize** | Double-click a shape (or click its timeline step) and drag the blue arrows to change its width, depth, height, radius or extrude distance live. Hold ⇧ for 0.1 mm steps or ⌥ for no snapping. |
| **Parametric** | Every feature stays editable on the timeline. Fields take expressions such as `width/2 + 3` or `1in`, using named **Parameters**. Suppress, reorder, rename or delete steps. |
| **Inspect** | Measure distances, see size, volume, surface area and estimated PLA mass. |
| **Files** | Save/open `.ocad` designs and open/import **STL** and **OBJ** models (double-click in Finder works), export **STL** and **OBJ** for 3D printing, save PNG images. Models that aren't watertight still open for reference. |
| **Pip, your helper** | A pixel critter in the bottom-left corner. Click Pip to **ask questions** (“how do I make a hole?”, “what's wrong?”, “how big is it?”) and get answers with buttons that do it for you. Pip cheers when a step works, warns about errors, gives tips and naps when you're idle. Press **H** to hide or bring back Pip. It works offline, with no account needed. |
| **View** | Orbit/pan/zoom (trackpad friendly), standard views, perspective/orthographic, wireframe, X-ray, edges, grid. |

Geometry comes from the [Manifold](https://github.com/elalish/manifold) kernel, which guarantees watertight solids, so your exports are always printable. Rendering uses [three.js](https://threejs.org).

## Use it in your browser

**https://tkfam151.github.io/3DCAD/** is the project website. Click **Open in browser** to use the full app
with nothing to install. It works in Chrome, Edge, Safari and Firefox, and saves designs and exports to your
Downloads folder.

## Install

Download the installer for your computer from the latest release:
**https://github.com/tkfam151/3DCAD/releases/latest**

- Mac (M chips): `OpenCAD.Studio-…-arm64.dmg`
- Windows 10/11: `OpenCAD.Studio.Setup.….exe`

Newer test builds are on the **Actions** tab: open the latest **Build apps** run and download the
artifact for your computer (you need to be signed in to GitHub).

### Mac

1. Download the `.dmg` from the release (or `OpenCAD-Studio-macOS` from Actions, then unzip it).
2. Open the `-arm64.dmg`. (Macs with Apple M chips only: M1/M2/M3/M4…; Intel Macs aren't supported.)
3. Drag **OpenCAD Studio** into **Applications**.
4. Open the app. The first time, macOS will probably block it, because it isn't notarized by Apple
   (that requires a paid Apple Developer account). Follow the steps below.

#### If the app is blocked, bounces in the Dock, or nothing happens

On newer macOS versions (including macOS 27), Gatekeeper silently stops apps that aren't notarized: the
icon bounces in the Dock and the app never opens. Try these in order.

**A. Allow it in System Settings**

1. Try to open OpenCAD Studio once and let it fail.
2. Open **System Settings → Privacy & Security** and scroll down to **Security**.
3. Click **Open Anyway** next to *"OpenCAD Studio" was blocked…* and confirm with your password or Touch ID.
4. Open the app again and click **Open**.

**B. Re-sign it on your Mac (if there is no Open Anyway button, or it still won't open)**

Open **Terminal** (press ⌘Space, type `Terminal`, press Enter), paste this whole line and press Enter:

```bash
pkill -9 -f "OpenCAD Studio"; mkdir -p ~/Applications; rm -rf ~/Applications/"OpenCAD Studio.app"; ditto --noextattr --noqtn "/Applications/OpenCAD Studio.app" ~/Applications/"OpenCAD Studio.app" && codesign --force --deep --sign - ~/Applications/"OpenCAD Studio.app" && open ~/Applications/"OpenCAD Studio.app"
```

This stops any stuck copy of the app, makes a fresh copy in your personal **Applications** folder
(`~/Applications`), signs that copy on your own Mac, and opens it. Afterwards:

- Use that copy from now on: in Finder press **⌘⇧H**, open **Applications**, and drag **OpenCAD Studio**
  to your Dock.
- Drag the old copy in the main **Applications** folder to the Trash.

If Terminal prints **Operation not permitted**, give Terminal permission to manage apps: open
**System Settings → Privacy & Security → App Management**, turn on **Terminal**, quit and reopen
Terminal, and paste the line again.

**C. Check what macOS is doing (to report a problem)**

```bash
spctl --assess -vv ~/Applications/"OpenCAD Studio.app"; log show --last 2m --style compact --predicate 'process == "kernel" OR process == "syspolicyd"' 2>/dev/null | grep -i opencad | tail -10; cat ~/Library/Logs/"OpenCAD Studio"/main.log 2>/dev/null | tail -20
```

A line saying `ASP: Security policy would not allow process` means Gatekeeper is still blocking the app,
so use step **A** or **B**. Messages from `main.log` come from the app itself. Please include them when
you open an issue.

### Windows 10/11 (64-bit)

1. Download the Setup `.exe` from the release (or `OpenCAD-Studio-Windows` from Actions, then unzip it) and run it.
2. The installer isn't code-signed, so Windows may say "Windows protected your PC".
   Click **More info → Run anyway**.
3. Start **OpenCAD Studio** from the Start menu or the desktop shortcut.

## Run or build from source

Requires [Node.js](https://nodejs.org) 20+.

```bash
npm install
npm start            # build and launch the desktop app
npm run dev          # or run it in your browser at http://localhost:5173
npm test             # geometry kernel tests
npm run dist:mac     # build the Apple Silicon .dmg into release/ (run on a Mac)
npm run dist:win     # build the Windows installer into release/ (run on Windows)
```

To publish a downloadable release, push a version tag (e.g. `git tag v1.0.0 && git push origin v1.0.0`);
the GitHub workflow attaches the Mac `.dmg` and Windows `.exe` to a draft GitHub Release.

## Quick start

1. On the start screen click **New design**, then press **S** (Sketch) and click the **XY** plane.
2. Choose **Rectangle**, click two corners (or click once and type `40,20` then Enter).
3. Add a **Circle** inside it to make a hole, then click **Finish Sketch**.
4. Press **E** (Extrude), type a distance, press **Enter**.
5. Press **S** again and click the **top face** to sketch on it. Extrude that sketch inward (a negative distance) to cut a pocket.
6. Click any step in the timeline to change its dimensions later. The model rebuilds automatically.
7. Use **Export → STL** to send it to your slicer.

The start screen also has templates: a parametric bracket, an electronics enclosure, a vase and a spoked wheel.

## Keyboard shortcuts

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| S | Sketch | E | Extrude |
| B | Box | Y | Cylinder |
| M | Move selected body | J | Combine selected bodies |
| I | Measure | F | Fit view |
| H | Hide / show Pip | ? | All shortcuts |
| 0 / 1 / 2 / 3 | Home / Front / Top / Right | Delete | Remove selected bodies |
| ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Shift+Z) | Undo / Redo | ⌘S (Ctrl+S) | Save |
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
electron/        desktop app shell: window, native menus, file dialogs
src/kernel/      parametric engine: features, expressions, regeneration (pure JS + Manifold WASM)
src/viewport.js  three.js 3D view, picking, gizmo, camera
src/sketcher.js  interactive 2D sketch editor
src/app.js       UI: toolbar, browser, timeline, property panels, files
src/landing.js   start screen: new design, open, recents, cloud designs, templates
src/cloud.js     sign-in and cloud saving (Supabase)
src/student.js   print check, design journal, lessons
src/org.js       school spaces (src/orgs.json + registered schools)
src/classes-ui.js classes, assignments, hand-ins and grading
src/org-ui.js    school password door, sign-in, People, School settings, My school
src/admin-ui.js  the admin panel
supabase/functions/org-admin  account manager (runs on Supabase)
tests/db/        migrations + permission tests on PostgreSQL
supabase/        database migrations (designs table + security rules)
tests/           kernel tests (node --test)
site/            project website (Jekyll); the web app is added at /app/ when it's published
```

## Schools and organisations

| Page | Who | What |
| --- | --- | --- |
| `/3DCAD/app/` | everyone | The normal app (dark). Guests can model and export; signed-in people save to the cloud. **My school** opens a school's page; **Add your school** needs the school creation code. No classes here. |
| `/3DCAD/org/<school>/` | owners & teachers | Staff page (white). Asks for the **school password**, then sign-in. Classes (teachers create their own; the owner sees all), **People** and **School settings** for the owner. |
| `/3DCAD/org/<school>/student/` | students | Student page (white). School password, then the **username** the owner made. Join or get assigned to classes, design, hand in, share with the class. Students can't create classes. |
| `/3DCAD/admin/` | the site admin only | Every school (verify, password, owner, delete), every account (add, reset password, delete) and the **school creation code**. |

Roles: **admin** (`tonklapc.toogle@gmail.com`, everything) · **owner** (made the school; manages its people) · **teacher** (own classes) · **student**.
Designs are private unless shared with a link or with a class. The desktop apps have an **Organisation** button that opens a school's page.

The rules live in the database (`supabase/migrations/`) and are tested on a real PostgreSQL with
`tests/db/run.sh` (40 checks of who can see and change what). Accounts are created and changed only by
the `org-admin` Edge Function, which keeps Supabase's secret key on the server.

Built-in schools are listed in `src/orgs.json`; schools added in the app work at `/3DCAD/org/<slug>/`
right away (GitHub Pages serves the app from `404.html` for those addresses).

## Cloud saving (Supabase) setup

**Easiest: let GitHub do it.** Add two repository secrets (**Settings → Secrets and variables → Actions → New repository secret**):

| Secret | Where to get it |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → **Access Tokens** → Generate new token |
| `SUPABASE_DB_PASSWORD` | your project's database password (reset it in **Project Settings → Database** if you've shared it anywhere) |

Then run the **Supabase (database + account manager)** workflow from the Actions tab (or push any change in
`supabase/`). It applies every file in `supabase/migrations/` and deploys the `org-admin` function.

**By hand instead:** paste each file in `supabase/migrations/` into **SQL Editor** in name order and click **Run**
(they're safe to run again), then deploy the function with the Supabase CLI:
`supabase functions deploy org-admin --project-ref lfplpizvmcgvvvvpgomv`.

Then, once:
1. **Authentication → Providers → Email:** keep **Confirm email** on. The admin is recognised by a confirmed email address.
2. **Authentication → URL Configuration:** Site URL `https://tkfam151.github.io/3DCAD/app/` (also add it to Redirect URLs).
3. Sign in at `https://tkfam151.github.io/3DCAD/admin/` as the admin and set the **school creation code** under Settings.

The app's public keys are in `src/cloud-config.js` (or the `SUPABASE_URL` / `SUPABASE_ANON_KEY` repository
variables). Never put the database password or the `service_role` key in the app.

## Credits

The Text tool uses the Droid Sans font (Apache License 2.0, see `src/assets/fonts/NOTICE`).


Pip's look is borrowed from the pixel-art mascot of [Claude Code](https://claude.com/claude-code).
OpenCAD Studio is an independent project and is not made by or affiliated with Anthropic.

## License

MIT
