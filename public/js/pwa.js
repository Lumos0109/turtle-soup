(function () {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async function () {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        updateViaCache: 'none',
      });

      registration.update().catch(function () {});
    } catch (error) {
      // PWA is optional. Ignore registration failures.
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    const reloadKey = 'hgt-sw-reloaded-v3';
    if (sessionStorage.getItem(reloadKey)) return;
    sessionStorage.setItem(reloadKey, '1');
    window.location.reload();
  });
})();
