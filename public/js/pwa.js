(function () {
	if (!("serviceWorker" in navigator)) return;

	let refreshing = false;
	navigator.serviceWorker.addEventListener("controllerchange", function () {
		if (refreshing) return;
		refreshing = true;
		window.location.reload();
	});

	window.addEventListener("load", function () {
		navigator.serviceWorker.register("/sw.js").then(function (registration) {
			registration.update().catch(function () {});
		}).catch(function () {});
	});
})();
