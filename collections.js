/* JB Collections: compatibility for old public product deep links. */
(function () {
  var hash = window.location.hash || "";
  var query = window.location.search || "";
  var base = new URL("./", window.location.href);

  if (hash.indexOf("#producto=") === 0) {
    window.location.replace(new URL("tecnologia/" + query + hash, base).href);
    return;
  }
  if (hash.indexOf("#fragancia=") === 0) {
    window.location.replace(new URL("perfumeria/" + query + hash, base).href);
  }
})();
