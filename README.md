# FROG TOWER 🐸

Multiplayer trivia race. Frogs climb the evil businessman's 15-floor skyscraper —
correct answer climbs 1 floor, fastest correct climbs 2, wrong or too slow gets
the boot: kicked down 1 floor. First frog to the roof party wins.

## Run locally

```
npm install
node server.js
```

Open http://localhost:8791 — create a room, friends join with the 4-letter code.

## Test

```
node test/bots.js            # full simulated match, asserts rules
node test/livebots.js CODE   # joins 2 bots to a live room
```

## Deploy (Render)

The repo includes `render.yaml`. On render.com: New → Blueprint → pick this repo.
Free plan works (spins down when idle; first visit after a nap takes ~1 min).
