(() => {
  "use strict";

  const INSTALL_DISMISSED = "nearbyEatsInstallTipDismissed";
  const OLD_GOOGLE_KEY = "nearbyEatsGoogleMapsKey";
  const CACHE_PREFIX = "nearbyEatsOSM:";
  const CACHE_TTL_MS = 5 * 60 * 1000;

  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
  ];

  const els = {};
  let userLocation = null;
  let lastRawPlaces = [];
  let lastRadiusMiles = 5;

  const serviceTests = {
    takeaway: tags => ["yes", "only"].includes((tags.takeaway || "").toLowerCase()),
    delivery: tags => ["yes", "only"].includes((tags.delivery || "").toLowerCase()),
    outdoor: tags => (tags.outdoor_seating || "").toLowerCase() === "yes",
    drive_through: tags => (tags.drive_through || "").toLowerCase() === "yes",
    reservations: tags => ["yes", "required", "recommended"].includes((tags.reservation || "").toLowerCase()),
    wheelchair: tags => (tags.wheelchair || "").toLowerCase() === "yes"
  };

  const serviceLabels = {
    takeaway: "Takeout",
    delivery: "Delivery",
    outdoor: "Outdoor seating",
    drive_through: "Drive-through",
    reservations: "Reservations",
    wheelchair: "Wheelchair access"
  };

  const categoryCuisineMatchers = {
    american: ["american", "southern", "regional"],
    barbecue: ["barbecue", "bbq"],
    breakfast: ["breakfast", "brunch"],
    burger: ["burger", "hamburger"],
    chicken: ["chicken", "wings", "chicken_wings"],
    mexican: ["mexican", "tex-mex", "tex_mex"],
    tacos: ["tacos", "taco"],
    pizza: ["pizza"],
    chinese: ["chinese"],
    japanese: ["japanese"],
    sushi: ["sushi"],
    thai: ["thai"],
    indian: ["indian"],
    italian: ["italian"],
    seafood: ["seafood", "fish"],
    steak: ["steak", "steak_house", "steakhouse"],
    cajun: ["cajun", "creole"]
  };

  function cacheEls() {
    [
      "locateBtn", "locationStatus", "queryInput", "searchBtn", "categorySelect",
      "filtersBtn", "filterCount", "filtersPanel", "sortSelect", "radiusSelect",
      "openNowCheck", "serviceChips", "clearFiltersBtn", "applyFiltersBtn",
      "resultsMeta", "results", "emptyState", "aboutResultsBtn", "aboutResultsDialog",
      "installTip", "dismissInstallTip", "resultTemplate"
    ].forEach(id => els[id] = document.getElementById(id));
  }

  function bindEvents() {
    els.locateBtn.addEventListener("click", () => locateUser(true));
    els.searchBtn.addEventListener("click", () => runSearch(true));
    els.queryInput.addEventListener("keydown", e => {
      if (e.key === "Enter") runSearch(true);
    });
    els.categorySelect.addEventListener("change", () => {
      if (lastRawPlaces.length) applyAndRender();
    });
    els.filtersBtn.addEventListener("click", () => {
      els.filtersPanel.hidden = !els.filtersPanel.hidden;
    });
    els.applyFiltersBtn.addEventListener("click", async () => {
      els.filtersPanel.hidden = true;
      updateFilterCount();
      const radiusChanged = Number(els.radiusSelect.value) !== lastRadiusMiles;
      if (radiusChanged) await runSearch(true);
      else applyAndRender();
    });
    els.clearFiltersBtn.addEventListener("click", clearFilters);
    els.aboutResultsBtn.addEventListener("click", () => els.aboutResultsDialog.showModal());
    els.dismissInstallTip.addEventListener("click", () => {
      localStorage.setItem(INSTALL_DISMISSED, "1");
      els.installTip.hidden = true;
    });

    document.querySelectorAll("#serviceChips input").forEach(el => {
      el.addEventListener("change", updateFilterCount);
    });
    [els.sortSelect, els.radiusSelect, els.openNowCheck].forEach(el => {
      el.addEventListener("change", updateFilterCount);
    });
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

  function clearFilters() {
    els.sortSelect.value = "distance";
    els.radiusSelect.value = "5";
    els.openNowCheck.checked = false;
    document.querySelectorAll("#serviceChips input").forEach(el => el.checked = false);
    updateFilterCount();
    if (lastRawPlaces.length) {
      if (lastRadiusMiles !== 5) runSearch(true);
      else applyAndRender();
    }
  }

  function updateFilterCount() {
    let count = 0;
    if (els.sortSelect.value !== "distance") count++;
    if (els.radiusSelect.value !== "5") count++;
    if (els.openNowCheck.checked) count++;
    count += document.querySelectorAll("#serviceChips input:checked").length;
    els.filterCount.textContent = String(count);
    els.filterCount.hidden = count === 0;
  }

  function selectedServices() {
    return [...document.querySelectorAll("#serviceChips input:checked")].map(x => x.value);
  }

  function locateUser(searchAfter = false) {
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
        if (searchAfter || !lastRawPlaces.length) runSearch(false);
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

  function buildOverpassQuery(lat, lng, radiusMeters) {
    const a = `${radiusMeters},${lat.toFixed(6)},${lng.toFixed(6)}`;
    return `[out:json][timeout:20];\n(` +
      `nwr["amenity"~"^(restaurant|fast_food|cafe|food_court|pub|bar|biergarten|ice_cream)$"](around:${a});` +
      `nwr["shop"="bakery"](around:${a});` +
      `);\nout center tags qt;`;
  }

  function cacheKey(radiusMiles) {
    const lat = userLocation.lat.toFixed(3);
    const lng = userLocation.lng.toFixed(3);
    return `${CACHE_PREFIX}${lat},${lng}:${radiusMiles}`;
  }

  function readCache(radiusMiles) {
    try {
      const raw = sessionStorage.getItem(cacheKey(radiusMiles));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.time || Date.now() - parsed.time > CACHE_TTL_MS) return null;
      return parsed.elements || null;
    } catch {
      return null;
    }
  }

  function writeCache(radiusMiles, elements) {
    try {
      sessionStorage.setItem(cacheKey(radiusMiles), JSON.stringify({ time: Date.now(), elements }));
    } catch { }
  }

  async function fetchOverpass(query) {
    let lastError = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 18000);
        const url = `${endpoint}?data=${encodeURIComponent(query)}`;
        const response = await fetch(url, {
          method: "GET",
          headers: { "Accept": "application/json" },
          cache: "no-store",
          signal: controller.signal
        });
        clearTimeout(timer);
        if (!response.ok) throw new Error(`Overpass returned HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.elements)) throw new Error("Unexpected Overpass response");
        return data.elements;
      } catch (err) {
        lastError = err;
        console.warn("Overpass endpoint failed:", endpoint, err);
      }
    }
    throw lastError || new Error("The free OpenStreetMap search servers are temporarily unavailable.");
  }

  function elementLatLng(el) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
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

  function normalizeElement(el) {
    const ll = elementLatLng(el);
    if (!ll) return null;
    const tags = el.tags || {};
    const name = tags.name || tags.brand || tags.operator || "Unnamed food place";
    return {
      id: `${el.type}/${el.id}`,
      osmType: el.type,
      osmId: el.id,
      lat: ll.lat,
      lng: ll.lng,
      tags,
      name,
      distance: haversineMiles(userLocation, ll)
    };
  }

  function uniquePlaces(elements) {
    const map = new Map();
    for (const el of elements) {
      const p = normalizeElement(el);
      if (!p) continue;
      const coarse = `${p.name.toLowerCase()}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`;
      const existing = map.get(coarse);
      if (!existing || Object.keys(p.tags).length > Object.keys(existing.tags).length) map.set(coarse, p);
    }
    return [...map.values()];
  }

  async function runSearch(forceNetwork = false) {
    if (!userLocation) {
      locateUser(true);
      return;
    }

    const radiusMiles = Number(els.radiusSelect.value);
    const radiusMeters = Math.round(radiusMiles * 1609.344);
    lastRadiusMiles = radiusMiles;
    setLoading();

    try {
      let elements = forceNetwork ? null : readCache(radiusMiles);
      let source = "live";
      if (!elements) {
        const query = buildOverpassQuery(userLocation.lat, userLocation.lng, radiusMeters);
        elements = await fetchOverpass(query);
        writeCache(radiusMiles, elements);
      } else {
        source = "cached";
      }

      lastRawPlaces = uniquePlaces(elements)
        .filter(p => p.distance <= radiusMiles + 0.02);
      applyAndRender(source);
    } catch (err) {
      console.error(err);
      els.emptyState.hidden = true;
      els.results.innerHTML = `<div class="error-card"><strong>Free map search is temporarily unavailable.</strong><br>${escapeHtml(err?.message || String(err))}<br><br>Try Search again in a moment.</div>`;
      setMeta("Search error.");
    }
  }

  function parseCuisine(tags) {
    return (tags.cuisine || "")
      .toLowerCase()
      .split(/[;,]/)
      .map(x => x.trim())
      .filter(Boolean);
  }

  function categoryMatches(place, category) {
    if (category === "all") return true;
    const tags = place.tags;
    const amenity = (tags.amenity || "").toLowerCase();
    const shop = (tags.shop || "").toLowerCase();
    const cuisines = parseCuisine(tags);
    const haystack = [place.name.toLowerCase(), ...cuisines].join(" ");

    if (category === "restaurant") return amenity === "restaurant";
    if (category === "fast_food") return amenity === "fast_food";
    if (category === "cafe") return amenity === "cafe" || cuisines.includes("coffee_shop") || haystack.includes("coffee");
    if (category === "bar_pub") return ["bar", "pub", "biergarten"].includes(amenity);
    if (category === "bakery") return shop === "bakery" || cuisines.includes("bakery");

    const matchers = categoryCuisineMatchers[category] || [];
    return matchers.some(term => haystack.includes(term.replaceAll("_", " ")) || cuisines.includes(term));
  }

  function keywordMatches(place, query) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const t = place.tags;
    const fields = [
      place.name, t.brand, t.operator, t.cuisine, t.amenity, t.shop,
      t["addr:street"], t["addr:city"], t.description
    ].filter(Boolean).join(" ").toLowerCase();
    return q.split(/\s+/).every(word => fields.includes(word));
  }

  function openingState(place) {
    const raw = place.tags.opening_hours;
    if (!raw) return { known: false, open: false, label: "Hours unknown" };

    if (raw.trim() === "24/7") return { known: true, open: true, label: "Open 24/7" };

    if (typeof window.opening_hours !== "function") {
      return { known: false, open: false, label: "Hours listed" };
    }

    try {
      const oh = new window.opening_hours(raw, null, { tag_key: "opening_hours" });
      const unknown = oh.getUnknown();
      if (unknown) return { known: false, open: false, label: "Hours uncertain" };
      const open = oh.getState();
      return { known: true, open, label: open ? "Open now" : "Closed now" };
    } catch {
      return { known: false, open: false, label: "Hours listed" };
    }
  }

  function applyAndRender(source = "filtered") {
    const category = els.categorySelect.value;
    const query = els.queryInput.value;
    const services = selectedServices();
    const requireOpen = els.openNowCheck.checked;

    let rows = lastRawPlaces.filter(place => {
      if (!categoryMatches(place, category)) return false;
      if (!keywordMatches(place, query)) return false;
      if (!services.every(s => serviceTests[s]?.(place.tags))) return false;
      if (requireOpen) {
        const state = openingState(place);
        if (!state.known || !state.open) return false;
      }
      return true;
    });

    if (els.sortSelect.value === "name") {
      rows.sort((a, b) => a.name.localeCompare(b.name) || a.distance - b.distance);
    } else {
      rows.sort((a, b) => a.distance - b.distance);
    }

    renderResults(rows, source);
  }

  function formatType(place) {
    const t = place.tags;
    const items = [];
    if (t.cuisine) {
      const readable = t.cuisine.split(/[;,]/).slice(0, 3).map(titleCaseTag).join(", ");
      if (readable) items.push(readable);
    }
    if (!items.length && t.shop === "bakery") items.push("Bakery");
    if (!items.length && t.amenity) items.push(titleCaseTag(t.amenity));
    return items.join(" • ");
  }

  function titleCaseTag(v) {
    return String(v).replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
  }

  function formatAddress(tags) {
    const line1 = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
    const line2 = [tags["addr:city"], tags["addr:state"], tags["addr:postcode"]].filter(Boolean).join(" ");
    return [line1, line2].filter(Boolean).join(" • ");
  }

  function renderResults(rows, source) {
    els.results.innerHTML = "";
    els.emptyState.hidden = true;

    if (!rows.length) {
      els.results.innerHTML = `<div class="error-card">No matching places were found. Try increasing the radius, choosing All food, or loosening a filter. Open Now only includes places with usable hours in OpenStreetMap.</div>`;
      setMeta("No matches.");
      return;
    }

    const services = selectedServices();

    rows.forEach((place, i) => {
      const frag = els.resultTemplate.content.cloneNode(true);
      frag.querySelector(".place-rank").textContent = i + 1;
      frag.querySelector(".place-name").textContent = place.name;
      frag.querySelector(".distance-badge").textContent = formatDistance(place.distance);

      const details = frag.querySelector(".place-details");
      details.textContent = formatType(place) || "Food / drink";

      const address = formatAddress(place.tags);
      const addressEl = frag.querySelector(".place-address");
      if (address) addressEl.textContent = address;
      else addressEl.remove();

      const tagsEl = frag.querySelector(".place-tags");
      const state = openingState(place);
      tagsEl.appendChild(makeTag(state.label, state.known && state.open ? "open" : ""));

      if (place.tags.opening_hours && place.tags.opening_hours !== "24/7") {
        tagsEl.appendChild(makeTag(place.tags.opening_hours));
      }

      const showServices = new Set(services);
      for (const key of Object.keys(serviceTests)) {
        if (serviceTests[key](place.tags)) showServices.add(key);
      }
      [...showServices].slice(0, 4).forEach(key => tagsEl.appendChild(makeTag(serviceLabels[key])));

      const directions = frag.querySelector(".directions-btn");
      directions.href = `https://maps.apple.com/?daddr=${encodeURIComponent(`${place.lat},${place.lng}`)}&dirflg=d`;
      directions.setAttribute("aria-label", `Directions to ${place.name}`);

      const osmBtn = frag.querySelector(".osm-btn");
      osmBtn.href = `https://www.openstreetmap.org/${place.osmType}/${place.osmId}`;
      osmBtn.setAttribute("aria-label", `Open ${place.name} in OpenStreetMap`);

      els.results.appendChild(frag);
    });

    const within = Number(els.radiusSelect.value);
    const cacheNote = source === "cached" ? " • cached 5 min" : "";
    setMeta(`${rows.length} result${rows.length === 1 ? "" : "s"} • within ${within} mi${cacheNote}`);
  }

  function makeTag(text, className = "") {
    const el = document.createElement("span");
    el.className = `tag ${className}`.trim();
    el.textContent = text;
    return el;
  }

  function formatDistance(mi) {
    if (!Number.isFinite(mi)) return "—";
    if (mi < 0.1) return `${Math.round(mi * 5280)} ft`;
    if (mi < 10) return `${mi.toFixed(1)} mi`;
    return `${Math.round(mi)} mi`;
  }

  function setLoading() {
    els.emptyState.hidden = true;
    els.results.innerHTML = `<div class="loading-card"><span class="spinner"></span>Searching free OpenStreetMap data…</div>`;
    setMeta("Searching nearby food…");
  }

  function setMeta(text) {
    els.resultsMeta.textContent = text;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function boot() {
    cacheEls();
    bindEvents();
    updateFilterCount();
    maybeShowInstallTip();
    localStorage.removeItem(OLD_GOOGLE_KEY);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
    }

    locateUser(false);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
