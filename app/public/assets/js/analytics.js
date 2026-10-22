// Google Analytics (GA4) page views, only when a measurement ID is set at deploy time.
// The deploy workflow reads GA_MEASUREMENT_ID from the Netlify project's environment variables and writes it
// in place of the placeholder below. Local runs and deploys without that variable load nothing.
// It's a plain script rather than a module so it starts before the app, as Google recommends.
(function () {
  var ID = "__GA_MEASUREMENT_ID__";
  if (!/^G-[A-Z0-9]+$/.test(ID)) return;

  window.dataLayer = window.dataLayer || [];
  // gtag must push the `arguments` object itself, not an array copy.
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", ID);

  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + ID;
  document.head.appendChild(s);
})();
