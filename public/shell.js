import {initRegistry} from './registry-ui.js';

function showWorkspace(name, focus = false) {
  const view = name === 'team' ? 'team' : 'customer';
  document.getElementById('view-customer').hidden = view !== 'customer';
  document.getElementById('view-team').hidden = view !== 'team';
  document.querySelectorAll('[data-workspace-view]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.workspaceView === view));
  });
  if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  document.dispatchEvent(new CustomEvent('fieldwork:view', {detail: view}));
  if (focus) document.querySelector('#view-' + view + ' h1')?.focus({preventScroll: true});
}
document.querySelectorAll('[data-workspace-view]').forEach(button => button.addEventListener('click', () => showWorkspace(button.dataset.workspaceView, true)));
document.getElementById('workspace-home').addEventListener('click', () => {
  showWorkspace('customer', true);
  document.dispatchEvent(new CustomEvent('fieldwork:customer-home'));
});
window.addEventListener('hashchange', () => {
  if (location.hash !== '#main') showWorkspace(location.hash === '#team' ? 'team' : 'customer');
});
document.addEventListener('fieldwork:open-tested', () => showWorkspace('team', true));
document.addEventListener('fieldwork:open-customer', () => showWorkspace('customer', true));
showWorkspace(location.hash === '#team' ? 'team' : 'customer');

initRegistry({dialogId:'registry-dialog'});

try {
  const response=await fetch('/api/health',{cache:'no-store'});
  if(!response.ok)throw new Error();
} catch {
  const message=document.getElementById('connection-error');
  message.textContent='The planning service cannot be reached, so no plan can be made right now. Your saved robots and results can still be viewed.';
  message.hidden=false;
}
