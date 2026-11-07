// Keep a failed phone-view startup visible without obscuring the puzzle.
(() => {
  let problem = '', fallback = false;
  const root = document.documentElement;
  addEventListener('error', event => {
    const source = event.target?.src || event.target?.href;
    if (source) problem = `Could not load ${new URL(source).pathname}.`;
    else if (event.message) problem = event.message;
  }, true);
  addEventListener('unhandledrejection', event => { problem = String(event.reason?.message || event.reason); });
  addEventListener('securitypolicyviolation', event => {
    if (event.blockedURI) problem = `The browser blocked ${event.blockedURI}.`;
  });
  document.addEventListener('zen:ready', () => {
    document.querySelector('#demo-start-error')?.remove();
    if (fallback) root.dataset.zen = 'on';
  });
  addEventListener('DOMContentLoaded', () => setTimeout(() => {
    if (root.dataset.zenReady === 'on') return;
    fallback = true;
    root.removeAttribute('data-zen');
    const message = document.createElement('p');
    message.id = 'demo-start-error';
    message.setAttribute('role', 'alert');
    message.style.cssText = 'margin:12px;padding:12px;border:1px solid #b26422;background:#fff8ea;color:#632f12';
    message.textContent = `Phone view could not start. ${problem || 'The view script did not finish loading.'} `;
    const retry = document.createElement('button');
    retry.textContent = 'Reload';
    retry.onclick = () => location.reload();
    message.append(retry);
    document.body.prepend(message);
  }, 5000));
})();
