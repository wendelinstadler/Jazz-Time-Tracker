/*
 * Jazz Time Tracker – runs before the Jazz page is drawn.
 * Only job: switch on dark mode right away, so the page does not flash white first.
 * main.js takes the style over afterwards.
 */
(() => {
  "use strict";
  if (!window.location.href.includes("stempel")) return;
  try {
    chrome.storage.local.get({ theme: "light" }, (items) => {
      if (items.theme !== "dark" || document.querySelector("style[data-jazz-extension-dark]")) return;
      const style = document.createElement("style");
      style.setAttribute("data-jazz-extension-dark", "");
      style.textContent = `
        html { background: #ffffff !important; filter: invert(0.92) hue-rotate(180deg); }
        html img, html video, html picture { filter: invert(1) hue-rotate(180deg); }
      `;
      document.documentElement.appendChild(style);
    });
  } catch (err) {
    /* storage not available */
  }
})();
