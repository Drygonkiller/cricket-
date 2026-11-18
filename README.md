▶ Play live: https://super-over-smash.vercel.app

# Super Over Smash

A mobile-first cricket game with 1, 2, or 5 overs. In Chase, the AI sets a target for you to beat. In Defend, you bat first and then bowl while the AI chases your score.

## Play locally

From the repository root, start any static HTTP server. With Python 3 installed, run:

```sh
python -m http.server 8080 --bind 127.0.0.1
```

Open `http://localhost:8080`. The first load caches the app shell in a service worker. Once it takes control, you can reload and play offline. On HTTPS or localhost, supported browsers can install the app from their browser menu.

## Controls

| Action | Touch or mouse | Keyboard |
| --- | --- | --- |
| Cover | Left third of the pitch or **Cover** | Left arrow |
| Straight | Centre third or **Straight** | Down arrow |
| Leg | Right third or **Leg** | Right arrow |
| Swing | **HIT** | Space |
| Release the ball | **BOWL** | Space |

Hit when the ball reaches the gold line. The last selected direction is used for the shot. Each wide or no-ball adds one run and is rebowled. You win as soon as you reach the target. If your innings ends with the AI's score, the match is tied.

During bowling, choose Off, Straight, or Leg with the same buttons, arrow keys, or pitch zones. Release in the green zone for perfect timing or the yellow zone for good timing. Letting the meter expire bowls a loose delivery. You win a Defend match by keeping the AI below your score.

Quick halves the AI ticker and feedback pauses. Quick, sound, your high score, and your five most recent matches are stored on the current device.

## Play 3D or 2D

Choose a mode, overs, difficulty, team, and Quick at home. **Play** opens the 3D stadium. In Chase, bat to beat the AI's target. In Defend, bat first, then bowl while the AI chases. Use the direction buttons, arrow keys, or the left, centre, or right third of the pitch to aim. Tap **HIT** or press **Space** near the gold line. When bowling, tap **BOWL** or press **Space** as the meter reaches green.

**Play 2D (light version)** starts the same setup in 2D. Both versions share the sound setting, high score, and five-match history. Completed stadium matches are marked **3D** in the history.

The 3D page uses **Three.js 0.180.0** and its **GLTFLoader 0.180.0** from jsDelivr. It needs WebGL 2 and a network connection to load those modules. The 2D game keeps its existing offline cache and does not load Three.js.

### Build the stadium

Run with Blender 4.x from the repository root.

```sh
blender --background --factory-startup --python-exit-code 1 --python blender/build_stadium.py
```

The script saves the editable blend, Y-up GLB, and broadcast preview at `assets/cricket_stadium.blend`, `assets/cricket_stadium.glb`, and `renders/stadium_preview.png`. See [the build report](blender/stadium-build-report.txt) for triangle counts, material names, and file sizes.

## Tests

Run with Node.js 18 or newer:

```sh
node --test tests/game-logic.test.js tests/stadium-asset.test.js
```

## Deploy to Vercel

Import the repository into Vercel with the repository root as the project root. The included `vercel.json` selects the **Other** framework preset, disables the install and build commands, and serves the static files from the root. When you change a cached app file after release, update the cache version in `sw.js` in the same commit.
