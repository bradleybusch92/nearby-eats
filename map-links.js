(() => {
  "use strict";

  function getCoordinatesFromAppleHref(href) {
    try {
      const url = new URL(href);
      const daddr = url.searchParams.get("daddr");
      if (!daddr) return null;
      const [lat, lng] = daddr.split(",").map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    } catch {
      return null;
    }
  }

  function enhanceCard(card) {
    if (!card || card.dataset.mapLinksReady === "1") return;

    const name = card.querySelector(".place-name")?.textContent?.trim() || "Restaurant";
    const address = card.querySelector(".place-address")?.textContent?.trim() || "";
    const appleBtn = card.querySelector(".directions-btn");
    const googleBtn = card.querySelector(".osm-btn");

    if (!appleBtn || !googleBtn) return;

    const coords = getCoordinatesFromAppleHref(appleBtn.href);

    appleBtn.textContent = "Apple Maps";
    appleBtn.setAttribute("aria-label", `Open ${name} in Apple Maps`);
    if (coords) {
      appleBtn.href = `https://maps.apple.com/?q=${encodeURIComponent(name)}&ll=${coords.lat},${coords.lng}`;
    }

    const googleQuery = [name, address].filter(Boolean).join(" ");
    googleBtn.textContent = "Google Maps";
    googleBtn.title = "Open Google ratings, reviews, photos, hours, and place details";
    googleBtn.setAttribute("aria-label", `Open ${name} in Google Maps for reviews and details`);
    googleBtn.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(googleQuery || name)}`;

    card.dataset.mapLinksReady = "1";
  }

  function enhanceAll() {
    document.querySelectorAll(".place-card").forEach(enhanceCard);
  }

  const observer = new MutationObserver(() => enhanceAll());

  document.addEventListener("DOMContentLoaded", () => {
    const results = document.getElementById("results");
    if (results) observer.observe(results, { childList: true, subtree: true });
    enhanceAll();
  });
})();
