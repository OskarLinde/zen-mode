// Test-only authored shell matching the current native achievement DOM contract:
// showAchievementPopup in tsumego.com's legacy-app asset.
// This module is bundled only with the demo, never the extension. It earns nothing.
function showFake(long = false) {
  const toast = document.createElement('div'); toast.className = 'toast toast--achievement green3';
  const banner = document.createElement('div'); banner.className = 'toast__banner';
  banner.append('TEST ONLY · Achievement preview ');
  const close = document.createElement('span'); close.className = 'toast__close'; close.textContent = 'x';
  close.onclick = () => { toast.style.opacity = '0'; setTimeout(() => { toast.style.display = 'none'; }, 500); };
  banner.append(close);
  const body = document.createElement('span'); body.className = 'toast__body';
  const icon = document.createElement('img'); icon.id = 'hpIcon1'; icon.alt = '';
  icon.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="#d8e4ce"/><path d="m12 20 6 6 11-13" fill="none" stroke="#285a43" stroke-width="3"/></svg>');
  const message = document.createElement('b');
  message.textContent = long ? 'Long test notification — ' + 'This is only a layout sample: no achievement, XP or account progress was earned. '.repeat(7) + 'LongUnbrokenAchievementLabelForWrapping1234567890' : 'First steps — Fake notification. No achievement or progress was earned.';
  const link = document.createElement('a'); link.href = '#test-achievement'; link.textContent = 'view';
  link.onclick = event => { event.preventDefault(); link.textContent = 'Test only · no account record'; };
  body.append(icon, message, ' (0 XP) ', link); toast.append(banner, body);
  toast.style.display = 'block'; document.body.append(toast); return toast;
}
window.zenFakeAchievement = kind => {
  document.querySelector('.zen-problem-sheet[open]')?.close();
  if (kind === 'repeated') {
    showFake(); setTimeout(() => showFake(true), 260); setTimeout(() => showFake(), 520);
  } else showFake(kind === 'long');
};
document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-fake-achievement]');
  if (!trigger) return;
  event.preventDefault(); event.stopPropagation(); window.zenFakeAchievement(trigger.dataset.fakeAchievement);
});
