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

## Tests

Run with Node.js 18 or newer:

```sh
node --test tests/game-logic.test.js
```

## Deploy to Vercel

Import the repository into Vercel with the repository root as the project root. The included `vercel.json` selects the **Other** framework preset, disables the install and build commands, and serves the static files from the root. When you change a cached app file after release, update the cache version in `sw.js` in the same commit.
