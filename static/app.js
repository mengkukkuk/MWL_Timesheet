// Frontend bootstrap shim.
//
// Modules are loaded via `<script defer>` tags in templates/index.html in
// strict dependency order — the browser downloads them in parallel but
// executes them sequentially after HTML parse. This file fires the
// `modulesLoaded` event that some modules await before doing work that
// depends on cross-module globals (see static/app/core.js).
(function () {
    function dispatchLoaded() {
        document.dispatchEvent(new Event('modulesLoaded'));
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', dispatchLoaded);
    } else {
        // `defer` guarantees this script runs after DOM parse; safe to fire now.
        dispatchLoaded();
    }
})();
