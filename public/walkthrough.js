const dialog = document.getElementById('walkthrough-dialog');
const video = document.getElementById('walkthrough-video');
const openButton = document.getElementById('watch-walkthrough');
const closeButton = document.getElementById('walkthrough-close');
const error = document.getElementById('walkthrough-error');

openButton.addEventListener('click', () => {
  if (!dialog.open) dialog.showModal();
  closeButton.focus();
});
closeButton.addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  video.pause();
  openButton.focus();
});
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
video.addEventListener('error', () => { error.hidden = false; });
video.querySelector('source').addEventListener('error', () => { error.hidden = false; });
