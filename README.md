# Skyline Swing

A browser-based 3D traversal game. Swing through a procedurally generated city with a grappling hook, boost around with a jetpack, and (soon) more inventions. Play in first or third person.

**▶ Play: https://greybotopotamus.github.io/skyline-swing/**

Built with [three.js](https://threejs.org/) and [Vite](https://vite.dev/).

## Getting started

Requires Node.js 20+.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Controls

| Input | Action |
| --- | --- |
| W A S D | Move / steer while swinging |
| Mouse / arrow keys | Look |
| Left click (hold) | Fire grappling hook and swing; release to let go |
| Right click (hold) | Reel in the rope |
| Space | Jump; hold in the air for the jetpack |
| Shift | Sprint |
| V | Toggle 1st / 3rd person |
| R | Respawn |
| Esc | Pause (release the mouse) |

## Project layout

```
src/
  main.js               Bootstrap, game loop (fixed 120 Hz physics step)
  core/                 Input (pointer lock), seeded RNG
  physics/collision.js  AABB spatial grid + ray vs box tests
  player/               Player physics body, placeholder model, camera rig (1st/3rd person)
  gadgets/              Inventions: grapple.js, jetpack.js
  world/                Environments: procedural city, building window shader, sky + lighting
  ui/hud.js             HUD (fuel, speed, view, crosshair)
```

### Adding a gadget
A gadget is an object with `handleInput(input, player, aim)` (once per frame) and `physics(dt, player)` (every physics step, before the player moves). Add it to the `gadgets` array in `main.js`; order matters (forces first, constraints such as the rope last).

### Adding an environment
An environment is a function like `createCity(scene, options)` that returns `{ buildings, grid, spawn, spawnYaw, raycast(), dispose() }`. Anything in `buildings` (axis-aligned boxes) is solid and grappleable.

## Roadmap ideas
- More inventions: glider wings, wall-run boots, zip-line launcher, magnet gloves
- More environments: canyon, docks/harbour, forest canopy, floating sky islands
- Hand-authored animation polish (landing, wall contact) or a rigged glTF character
- Time trials, collectibles, checkpoint races
- Day/night cycle and lit windows at night
- Gamepad and touch controls
