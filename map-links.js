(() => {
  "use strict";

  function getCoordinatesFromAppleHref(href) {
    try {
      const url = new URL(href);
      const daddr = url.searchParams.get("daddr");
      const ll = url.searchParams.get("ll");
      const value = daddr || ll;
      if (!value) return null;
      const [lat, lng] = value.split(",").map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    } catch {
      return null;
    }
  }

  function makeActionButton(className, text, href, ariaLabel) {
    const link = document.createElement("a");
    link.className = `maps-btn ${className}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = text;
    link.href = href;
    link.setAttribute("aria-label", ariaLabel);
    return link;
  }

  function enhanceCard(card) {
    if (!card || card.dataset.mapLinksReady === "1") return;

    const name = card.querySelector(".place-name")?.textContent?.trim() || "Restaurant";
    const address = card.querySelector(".place-address")?.textContent?.trim() || "";
    const appleBtn = card.querySelector(".directions-btn");
    const googleBtn = card.querySelector(".osm-btn");
    const actions = card.querySelector(".result-actions");

    if (!appleBtn || !googleBtn || !actions) return;

    const coords = getCoordinatesFromAppleHref(appleBtn.href);
    const coordinateText = coords ? `${coords.lat},${coords.lng}` : "";
    const locationText = address || coordinateText;
    const detailedQuery = [name, address].filter(Boolean).join(" ") || name;

    appleBtn.textContent = "Apple Maps";
    appleBtn.setAttribute("aria-label", `Open ${name} in Apple Maps`);
    if (coords) {
      appleBtn.href = `https://maps.apple.com/?q=${encodeURIComponent(name)}&ll=${coords.lat},${coords.lng}`;
    }

    googleBtn.textContent = "Google Reviews";
    googleBtn.title = "Open Google ratings, reviews, photos, hours, and place details";
    googleBtn.setAttribute("aria-label", `Open ${name} in Google Maps for reviews and details`);
    googleBtn.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(detailedQuery)}`;

    const yelpUrl = `https://www.yelp.com/search?find_desc=${encodeURIComponent(name)}&find_loc=${encodeURIComponent(locationText)}`;
    actions.appendChild(makeActionButton(
      "yelp-btn",
      "Yelp Reviews",
      yelpUrl,
      `Find ${name} reviews on Yelp`
    ));

    const tripAdvisorUrl = `https://www.tripadvisor.com/Search?q=${encodeURIComponent(detailedQuery)}`;
    actions.appendChild(makeActionButton(
      "tripadvisor-btn",
      "TripAdvisor Reviews",
      tripAdvisorUrl,
      `Find ${name} reviews on TripAdvisor`
    ));

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
