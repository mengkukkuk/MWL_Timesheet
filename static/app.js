(function loadFrontendModules() {
    const scripts = [
        '/static/app/i18n.js',
        '/static/app/core.js',
        '/static/app/dashboard.js',
        '/static/app/projects-summary.js',
        '/static/app/worklogs.js',
        '/static/app/calendar.js',
        '/static/app/export.js',
        '/static/app/settings.js',
        '/static/app/files.js',
        '/static/app/draft.js'
    ];

    const loadScript = (index) => {
        if (index >= scripts.length) return;

        const script = document.createElement('script');
        script.src = scripts[index];
        script.defer = false;
        script.onload = () => loadScript(index + 1);
        script.onerror = () => console.error('Failed to load frontend module:', scripts[index]);
        document.head.appendChild(script);
    };

    loadScript(0);
    // Dispatch an event when all modules have been requested/loaded.
    // We detect completion by polling for when the last script element exists and is loaded.
    (function whenModulesLoaded() {
        const lastSrc = scripts[scripts.length - 1];
        const check = () => {
            const el = Array.from(document.getElementsByTagName('script')).find(s => s.src && s.src.endsWith(lastSrc));
            if (el && (el.readyState === 'complete' || el.readyState === 'loaded' || el.loaded)) {
                document.dispatchEvent(new Event('modulesLoaded'));
            } else if (el && el.onload) {
                // onload will have been wired to loadScript; let that continue; still fire modulesLoaded after short delay
                setTimeout(() => document.dispatchEvent(new Event('modulesLoaded')), 50);
            } else {
                // keep checking briefly
                setTimeout(check, 50);
            }
        };
        setTimeout(check, 50);
    })();
})();
