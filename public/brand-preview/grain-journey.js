const layout = document.querySelector('.journey-layout');
const stages = [...layout.querySelectorAll('.journey-stages > li')];
const sticky = layout.querySelector('.journey-sticky');
const reel = sticky.querySelector('.journey-reel');
const label = sticky.querySelector('.journey-frame-label');
const progress = [...sticky.querySelectorAll('.journey-progress span')];
const desktopMotion = window.matchMedia('(min-width: 1001px) and (prefers-reduced-motion: no-preference)');
const frames = stages.map(stage => {
  const image = stage.querySelector('figure img').cloneNode();
  image.alt = '';
  image.removeAttribute('loading');
  image.classList.add('journey-frame');
  if (stage.id === 'journey-records') image.classList.add('journey-frame-records');
  return image;
});
let frameRequest = 0;
let current = -1;

function update() {
  frameRequest = 0;
  const readingLine = window.innerHeight * .48;
  let next = 0;
  stages.forEach((stage, index) => {
    if (stage.getBoundingClientRect().top <= readingLine) next = index;
  });
  if (current === next) return;
  current = next;
  frames.forEach((frame, index) => frame.classList.toggle('is-current', index === next));
  progress.forEach((segment, index) => segment.classList.toggle('is-current', index <= next));
  label.textContent = stages[next].querySelector('figcaption').textContent.trim();
}

function schedule() {
  if (desktopMotion.matches && !frameRequest) frameRequest = requestAnimationFrame(update);
}

function syncMode() {
  const enabled = desktopMotion.matches;
  if (enabled && !reel.childElementCount) reel.append(...frames);
  sticky.hidden = !enabled;
  layout.classList.toggle('has-sticky-journey', enabled);
  if (enabled) schedule();
  else if (frameRequest) {
    cancelAnimationFrame(frameRequest);
    frameRequest = 0;
  }
}

desktopMotion.addEventListener('change', syncMode);
window.addEventListener('scroll', schedule, { passive: true });
window.addEventListener('resize', schedule);
syncMode();
