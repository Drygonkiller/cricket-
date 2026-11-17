# Super Over Smash

A mobile-first cricket batting chase. Choose 1, 2, or 5 overs, watch the AI set a target, then take on the chase. The one-over mode is a quick match and longer chases can run for around two to three minutes.

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

Hit when the ball reaches the gold line. The last selected direction is used for the shot. Each wide or no-ball adds one run and is rebowled. You win as soon as you reach the target. If your innings ends with the AI's score, the match is tied.

## Tests

Run with Node.js 18 or newer:

```sh
node --test tests/game-logic.test.js
```

## Deploy to Vercel

Import the repository into Vercel with the repository root as the project root. The included `vercel.json` selects the **Other** framework preset, disables the install and build commands, and serves the static files from the root. When you change a cached app file after release, update the cache version in `sw.js` in the same commit.
