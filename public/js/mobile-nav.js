(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    const toggleButton = document.querySelector('.mobile-nav-toggle');
    const menu = document.getElementById('site-menu');
    const header = document.querySelector('.site-header');

    if (!toggleButton || !menu || !header) {
      return;
    }

    header.classList.add('mobile-nav-ready');

    const mobileMediaQuery = window.matchMedia('(max-width: 960px)');

    function isMobileViewport() {
      return mobileMediaQuery.matches;
    }

    function setMenuOpen(isOpen, options = {}) {
      const shouldFocusFirst = Boolean(options.focusFirst);
      const shouldRestoreFocus = Boolean(options.restoreFocus);

      menu.classList.toggle('is-open', isOpen);
      toggleButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

      if (isOpen && shouldFocusFirst) {
        const firstFocusable = menu.querySelector('a, button, [tabindex]:not([tabindex="-1"])');
        if (firstFocusable) {
          firstFocusable.focus();
        }
      }

      if (!isOpen && shouldRestoreFocus) {
        toggleButton.focus();
      }
    }

    function closeMenu(restoreFocus = false) {
      setMenuOpen(false, { restoreFocus });
    }

    toggleButton.addEventListener('click', function () {
      const isOpen = menu.classList.contains('is-open');
      setMenuOpen(!isOpen, { focusFirst: !isOpen });
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && menu.classList.contains('is-open')) {
        closeMenu(true);
      }
    });

    menu.addEventListener('click', function (event) {
      if (!isMobileViewport()) {
        return;
      }

      const clickedLink = event.target.closest('a');
      if (clickedLink) {
        closeMenu(false);
      }
    });

    document.addEventListener('click', function (event) {
      if (!isMobileViewport() || !menu.classList.contains('is-open')) {
        return;
      }

      if (!header.contains(event.target)) {
        closeMenu(false);
      }
    });

    window.addEventListener('resize', function () {
      if (!isMobileViewport()) {
        closeMenu(false);
      }
    });
  });
})();
