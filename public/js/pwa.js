(function () {
  if (!('serviceWorker' in navigator)) return;

  let hasReloadedForUpdate = false;

  function reloadOnceAfterUpdate() {
    if (hasReloadedForUpdate) return;
    hasReloadedForUpdate = true;

    const key = 'hgt_sw_refresh_' + Date.now().toString().slice(0, 8);
    if (sessionStorage.getItem(key) === '1') return;
    sessionStorage.setItem(key, '1');

    window.location.reload();
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register('/sw.js')
      .then(function (registration) {
        registration.update().catch(function () {});

        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        registration.addEventListener('updatefound', function () {
          const worker = registration.installing;
          if (!worker) return;

          worker.addEventListener('statechange', function () {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              worker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch(function () {});
  });

  navigator.serviceWorker.addEventListener('controllerchange', reloadOnceAfterUpdate);
  navigator.serviceWorker.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'HGT_SW_UPDATED') {
      reloadOnceAfterUpdate();
    }
  });
})();
