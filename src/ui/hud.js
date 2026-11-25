export class Hud {
  constructor() {
    this.fuel = document.getElementById('fuel');
    this.speed = document.getElementById('speed');
    this.view = document.getElementById('view');
    this.crosshair = document.getElementById('crosshair');
  }

  update({ player, jetpack, rig, canGrapple }) {
    this.fuel.style.width = `${Math.round(jetpack.fuel * 100)}%`;
    this.speed.textContent = player.vel.length().toFixed(0);
    this.view.textContent = rig.mode === 'third' ? '3rd person' : '1st person';
    this.crosshair.classList.toggle('can-grapple', canGrapple);
  }
}
