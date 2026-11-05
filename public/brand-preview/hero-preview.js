const showcase = document.querySelector('.hero-showcase');
const scenes = [...showcase.querySelectorAll('[data-scene]')];
const controls = showcase.querySelector('.showcase-controls');
const stepButtons = [...controls.querySelectorAll('[data-show-scene]')];
const playButton = controls.querySelector('.showcase-play');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let active = 2;
let timer;

function show(index) {
  active = index;
  scenes.forEach((scene, i) => { scene.hidden = i !== index; });
  stepButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
}

function pause() {
  window.clearTimeout(timer);
  timer = undefined;
  playButton.textContent = 'Replay';
}

function advance() {
  if (active === scenes.length - 1) {
    pause();
    return;
  }
  timer = window.setTimeout(() => {
    show(active + 1);
    advance();
  }, 2800);
}

function replay() {
  pause();
  show(0);
  playButton.textContent = 'Pause';
  advance();
}

showcase.querySelector('.showcase-stage').addEventListener('pointerenter', pause);
controls.addEventListener('focusin', event => { if (event.target !== playButton) pause(); });
controls.addEventListener('pointerover', event => { if (event.target.closest('[data-show-scene]')) pause(); });

controls.hidden = false;
show(active);
if (!reducedMotion.matches) replay();
else pause();

stepButtons.forEach((button, index) => button.addEventListener('click', () => {
  pause();
  show(index);
}));
playButton.addEventListener('click', () => {
  if (timer !== undefined) pause();
  else if (reducedMotion.matches) show(0);
  else replay();
});
reducedMotion.addEventListener('change', event => { if (event.matches) pause(); });
