(() => {
  "use strict";

  const KEY_STORAGE = "nearbyEatsGoogleMapsKey";
  const INSTALL_DISMISSED = "nearbyEatsInstallTipDismissed";

  const els = {};
  let userLocation = null;
  let googleReady = false;
  let placesLib = null;

  const categoryLabels = {
    "": "restaurants",
    restaurant: "restaurants",
    fast_food_restaurant: "fast food",
    american_restaurant: "American restaurants",
    barbecue_restaurant: "BBQ",
    breakfast_restaurant: "breakfast",
    brunch_restaurant: "brunch",
    hamburger_restaurant: "burgers",
    chicken_wings_restaurant: "wings",
    mexican_restaurant: "Mexican food",
    taco_restaurant: "tacos",
    pizza_restaurant: "pizza",
    chinese_restaurant: "Chinese food",
    japanese_restaurant: "Japanese food",
    sushi_restaurant: "sushi",
    thai_restaurant: "Thai food",
    indian_restaurant: "Indian food",
    italian_restaurant: "Italian food",
    seafood_restaurant: "seafood",
    steak_house: "steakhouse",
    cajun_restaurant: "Cajun food",
    cafe: "cafes",
    coffee_shop: "coffee",
    bakery: "bakeries",
    bar_and_grill: "bar and grill",
    pub: "pub food",
    sports_bar: "sports bars"
  };

  const serviceFieldMap = {
    takeout: { field: "hasTakeout", label: "Takeout" },
    delivery: { field: "hasDelivery", label: "Delivery" },
    dinein: { field: "hasDineIn", label: "Dine-in" },
    outdoor: { field: "hasOutdoorSeating", label: "Outdoor seating" },
    reservable: { field: "isReservable", label: "Reservations" }
  };

  function cacheEls() {
    [
      "settingsBtn","locateBtn","locationStatus","queryInput","searchBtn","categorySelect",
      "filtersBtn","filterCount","filtersPanel","sortSelect","radiusSelect","ratingSelect",
      "openNowCheck","priceChips","serviceChips","clearFiltersBtn","applyFiltersBtn",
      "resultsTitle","resultsMeta","results","emptyState","settingsDialog","settingsForm",
      "apiKeyInput","removeKeyBtn","saveKeyBtn","aboutResultsBtn","aboutResultsDialog",
      "installTip","dismissInstallTip","resultTemplate"
    ].forEach(id => els[id] = document.getElementById(id));
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function maybeShowInstallTip() {
    if (isIOS() && !isStandalone() && !localStorage.getItem(INSTALL_DISMISSED)) {
      els.installTip.hidden = false;
    }
  }

  function bindEvents() {
    els.settingsBtn.addEventListener("click", openSettings);
    els.locateBtn.addEventListener("click", locateUser);
    els.searchBtn.addEventListener("click", runSearch);
    els.queryInput.addEventListener("keydown", e => {
      if (e.key === "Enter") runSearch();
    });
    els.filtersBtn.addEventListener("click", () => {
      els.filtersPanel.hidden = !els.filtersPanel.hidden;
    });
    els.applyFiltersBtn.addEventListener("click", () => {
      els.filtersPanel.hidden = true;
      updateFilterCount();
      runSearch();
    });
    els.clearFiltersBtn.addEventListener("click", clearFilters);
    els.saveKeyBtn.addEventListener("click", saveApiKey);
    els.removeKeyBtn.addEventListener("click", removeApiKey);
    els.aboutResultsBtn.addEventListener("click", () => els.aboutResultsDialog.showModal());
    els.dismissInstallTip.addEventListener("click", () => {
      localStorage.setItem(INSTALL_DISMISSED, "1");
      els.installTip.hidden = true;
    });

    document.querySelectorAll("#priceChips input, #serviceChips input").forEach(el => {
      el.addEventListener("change", updateFilterCount);
    });
    [els.sortSelect, els.radiusSelect, els.ratingSelect, els.openNowCheck].forEach(el => {
      el.addEventListener("change", updateFilterCount);
    });
  }

  function clearFilters() {
    els.sortSelect.value = "distance";
    els.radiusSelect.value = "5";
    els.ratingSelect.value = "0";
    els.openNowCheck.checked = false;
    document.querySelectorAll("#priceChips input, #serviceChips input").forEach(el => el.checked = false);
    updateFilterCount();
  }

  function updateFilterCount() {
    let count = 0;
    if (els.sortSelect.value !== "distance") count++;
    if (els.radiusSelect.value !== "5") count++;
    if (els.ratingSelect.value !== "0") count++;
    if (els.openNowCheck.checked) count++;
    count += document.querySelectorAll("#priceChips input:checked").length;
    count += document.querySelectorAll("#serviceChips input:checked").length;
    els.filterCount.textContent = String(count);
    els.filterCount.hidden = count === 0;
  }

  function openSettings() {
    els.apiKeyInput.value = localStorage.getItem(KEY_STORAGE) || "";
    els.settingsDialog.showModal();
  }

  function saveApiKey() {
    const key = els.apiKeyInput.value.trim();
    if (!key) return;
    localStorage.setItem(KEY_STORAGE, key);
    els.settingsDialog.close();
    if (!googleReady) {
      loadGoogleMaps(key)
        .then(() => {
          setMeta("Google Places is ready.");
          if (userLocation) runSearch();
        })
        .catch(showGoogleLoadError);
    }
  }

  function removeApiKey() {
    localStorage.removeItem(KEY_STORAGE);
    els.apiKeyInput.value = "";
    alert("API key removed from this browser. Reload the app before entering a different key.");
  }

  function loadGoogleMaps(key) {
    if (googleReady && window.google?.maps) return Promise.resolve();

    return new Promise((resolve, reject) => {
      if (window.google?.maps) {
        googleReady = true;
        resolve();
        return;
      }

      const existing = document.querySelector('script[data-nearby-eats-google]');
      if (existing) {
        existing.addEventListener("load", () => {
          googleReady = true;
          resolve();
        }, { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }

      window.__nearbyEatsGoogleLoaded = async () => {
        try {
          placesLib = await google.maps.importLibrary("places");
          googleReady = true;
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      const script = document.createElement("script");
      script.dataset.nearbyEatsGoogle = "1";
      script.async = true;
      script.defer = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__nearbyEatsGoogleLoaded`;
      script.onerror = () => reject(new Error("Google Maps JavaScript API failed to load."));
      document.head.appendChild(script);
    });
  }

  function showGoogleLoadError(err) {
    console.error(err);
    els.results.innerHTML = `<div class="error-card">
      Google Maps could not load. Check that the API key is valid, billing is enabled,
      and the key allows this website under its HTTP referrer restrictions.
    </div>`;
    els.emptyState.hidden = true;
  }

  function locateUser() {
    if (!navigator.geolocation) {
      els.locationStatus.textContent = "Location is not supported by this browser.";
      return;
    }

    els.locationStatus.textContent = "Getting your location…";
    navigator.geolocation.getCurrentPosition(
      pos => {
        userLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
        const accuracyMeters = pos.coords.accuracy;
        const accuracyText = accuracyMeters < 161
          ? `±${Math.round(accuracyMeters * 3.28084)} ft`
          : `±${(accuracyMeters / 1609.344).toFixed(1)} mi`;
        els.locationStatus.textContent = `Location ready • ${accuracyText}`;
        if (localStorage.getItem(KEY_STORAGE)) runSearch();
      },
      err => {
        const messages = {
          1: "Location permission was denied. Enable Location for this site in Safari settings.",
          2: "Your location could not be determined.",
          3: "Location request timed out. Try again."
        };
        els.locationStatus.textContent = messages[err.code] || "Could not get location.";
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  function selectedPriceLevels() {
    return [...document.querySelectorAll("#priceChips input:checked")].map(x => x.value);
  }

  function selectedServices() {
    return [...document.querySelectorAll("#serviceChips input:checked")].map(x => x.value);
  }

  function getBoundsForRadius(lat, lng, miles) {
    const earthRadiusMiles = 3958.7613;
    const latDelta = (miles / earthRadiusMiles) * (180 / Math.PI);
    const lngDelta = latDelta / Math.max(Math.cos(lat * Math.PI / 180), 0.01);
    return {
      north: Math.min(90, lat + latDelta),
      south: Math.max(-90, lat - latDelta),
      east: Math.min(180, lng + lngDelta),
      west: Math.max(-180, lng - lngDelta)
    };
  }

  function haversineMiles(a, b) {
    const R = 3958.7613;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function placeLatLng(place) {
    if (!place.location) return null;
    const lat = typeof place.location.lat === "function" ? place.location.lat() : place.location.lat;
    const lng = typeof place.location.lng === "function" ? place.location.lng() : place.location.lng;
    return { lat, lng };
  }

  function buildTextQuery() {
    const typed = els.queryInput.value.trim();
    if (typed) return typed;
    return categoryLabels[els.categorySelect.value] || "restaurants";
  }

  async function runSearch() {
    if (!userLocation) {
      locateUser();
      return;
    }

    const key = localStorage.getItem(KEY_STORAGE);
    if (!key) {
      openSettings();
      return;
    }

    try {
      if (!googleReady) await loadGoogleMaps(key);
      if (!placesLib) placesLib = await google.maps.importLibrary("places");

      const { Place, SearchByTextRankPreference, PriceLevel } = placesLib;
      const radiusMiles = Number(els.radiusSelect.value);
      const minRating = Number(els.ratingSelect.value);
      const serviceFilters = selectedServices();
      const requestedPriceLevels = selectedPriceLevels();

      const fields = [
        "displayName",
        "formattedAddress",
        "location",
        "googleMapsURI",
        "rating",
        "userRatingCount",
        "priceLevel",
        "primaryTypeDisplayName",
        "businessStatus"
      ];

      for (const service of serviceFilters) {
        const f = serviceFieldMap[service]?.field;
        if (f && !fields.includes(f)) fields.push(f);
      }

      const request = {
        textQuery: buildTextQuery(),
        fields,
        locationRestriction: getBoundsForRadius(userLocation.lat, userLocation.lng, radiusMiles),
        isOpenNow: els.openNowCheck.checked,
        language: "en-US",
        region: "us",
        maxResultCount: 20,
        rankPreference: els.sortSelect.value === "relevance"
          ? SearchByTextRankPreference.RELEVANCE
          : SearchByTextRankPreference.DISTANCE
      };

      if (els.categorySelect.value) {
        request.includedType = els.categorySelect.value;
        request.useStrictTypeFiltering = false;
      }

      if (minRating > 0) request.minRating = minRating;
      if (requestedPriceLevels.length) {
        request.priceLevels = requestedPriceLevels
          .map(level => PriceLevel[level])
          .filter(Boolean);
      }

      setLoading();
      const { places } = await Place.searchByText(request);

      let rows = (places || []).map(place => {
        const ll = placeLatLng(place);
        return {
          place,
          distance: ll ? haversineMiles(userLocation, ll) : Infinity
        };
      });

      // Exact circular radius filter. Google receives a bounding rectangle.
      rows = rows.filter(row => row.distance <= radiusMiles + 0.001);

      // Optional service filters are client-side because SearchByText does not
      // expose request parameters for these service attributes.
      if (serviceFilters.length) {
        rows = rows.filter(({ place }) =>
          serviceFilters.every(service => place[serviceFieldMap[service].field] === true)
        );
      }

      if (els.sortSelect.value === "distance") {
        rows.sort((a, b) => a.distance - b.distance);
      } else if (els.sortSelect.value === "rating") {
        rows.sort((a, b) =>
          (b.place.rating || 0) - (a.place.rating || 0) ||
          (b.place.userRatingCount || 0) - (a.place.userRatingCount || 0) ||
          a.distance - b.distance
        );
      }

      renderResults(rows, radiusMiles, serviceFilters.length > 0);
    } catch (err) {
      console.error(err);
      let msg = err?.message || String(err);
      if (/referer|referrer|ApiTargetBlockedMapError|REQUEST_DENIED/i.test(msg)) {
        msg += " Check the API key's Website/HTTP referrer restriction and enabled APIs.";
      }
      els.results.innerHTML = `<div class="error-card"><strong>Search failed.</strong><br>${escapeHtml(msg)}</div>`;
      els.emptyState.hidden = true;
      setMeta("Search error.");
    }
  }

  function setLoading() {
    els.emptyState.hidden = true;
    els.results.innerHTML = `<div class="loading-card"><span class="spinner"></span>Searching nearby places…</div>`;
    setMeta("Searching Google Maps…");
  }

  function setMeta(text) {
    els.resultsMeta.textContent = text;
  }

  function renderResults(rows, radiusMiles, serviceFiltered) {
    els.results.innerHTML = "";
    els.emptyState.hidden = true;

    if (!rows.length) {
      els.results.innerHTML = `<div class="error-card">
        No matching places were returned within ${radiusMiles} mile${radiusMiles === 1 ? "" : "s"}.
        Try increasing the distance or loosening a filter.
      </div>`;
      setMeta("No matches.");
      return;
    }

    rows.forEach((row, i) => {
      const { place, distance } = row;
      const frag = els.resultTemplate.content.cloneNode(true);
      const card = frag.querySelector(".place-card");

      frag.querySelector(".place-rank").textContent = i + 1;
      frag.querySelector(".place-name").textContent = place.displayName || "Unnamed place";
      frag.querySelector(".distance-badge").textContent = formatDistance(distance);

      const details = [];
      if (place.rating) {
        const count = place.userRatingCount ? ` (${Number(place.userRatingCount).toLocaleString()})` : "";
        details.push(`★ ${place.rating.toFixed(1)}${count}`);
      }
      const price = priceSymbols(place.priceLevel);
      if (price) details.push(price);
      if (place.primaryTypeDisplayName) details.push(place.primaryTypeDisplayName);
      frag.querySelector(".place-details").textContent = details.join(" • ");

      const tags = frag.querySelector(".place-tags");
      if (els.openNowCheck.checked) tags.appendChild(makeTag("Open now", "open"));
      for (const service of selectedServices()) {
        const cfg = serviceFieldMap[service];
        if (place[cfg.field] === true) tags.appendChild(makeTag(cfg.label));
      }
      if (!tags.children.length) tags.remove();

      const providers = frag.querySelector(".provider-attributions");
      if (place.attributions?.length) {
        place.attributions.forEach(attr => {
          if (!attr?.provider) return;
          const prefix = document.createTextNode("Data: ");
          providers.appendChild(prefix);
          if (attr.providerURI) {
            const a = document.createElement("a");
            a.href = attr.providerURI;
            a.target = "_blank";
            a.rel = "noopener";
            a.textContent = attr.provider;
            providers.appendChild(a);
          } else {
            providers.appendChild(document.createTextNode(attr.provider));
          }
          providers.appendChild(document.createTextNode(" "));
        });
      } else {
        providers.remove();
      }

      const mapsBtn = frag.querySelector(".maps-btn");
      mapsBtn.href = place.googleMapsURI || buildFallbackMapsUrl(place.displayName, place.formattedAddress);
      mapsBtn.setAttribute("aria-label", `Open ${place.displayName || "place"} in Google Maps`);

      if (place.formattedAddress) {
        const addr = document.createElement("div");
        addr.className = "place-details";
        addr.textContent = place.formattedAddress;
        frag.querySelector(".place-info").insertBefore(addr, frag.querySelector(".place-tags"));
      }

      els.results.appendChild(frag);
    });

    const extra = serviceFiltered ? " • service filters applied after search" : "";
    setMeta(`${rows.length} result${rows.length === 1 ? "" : "s"} • within ${radiusMiles} mi${extra}`);
  }

  function makeTag(text, className = "") {
    const tag = document.createElement("span");
    tag.className = `tag ${className}`.trim();
    tag.textContent = text;
    return tag;
  }

  function priceSymbols(level) {
    const lookup = {
      INEXPENSIVE: "$",
      MODERATE: "$$",
      EXPENSIVE: "$$$",
      VERY_EXPENSIVE: "$$$$"
    };
    return lookup[level] || "";
  }

  function formatDistance(mi) {
    if (!Number.isFinite(mi)) return "—";
    if (mi < 0.1) return `${Math.round(mi * 5280)} ft`;
    if (mi < 10) return `${mi.toFixed(1)} mi`;
    return `${Math.round(mi)} mi`;
  }

  function buildFallbackMapsUrl(name, address) {
    const q = [name, address].filter(Boolean).join(" ");
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function boot() {
    cacheEls();
    bindEvents();
    updateFilterCount();
    maybeShowInstallTip();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
    }

    const key = localStorage.getItem(KEY_STORAGE);
    if (key) {
      loadGoogleMaps(key).catch(showGoogleLoadError);
    } else {
      setTimeout(openSettings, 300);
    }

    locateUser();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
