(() => {
  "use strict";

  const KEY_STORAGE = "nearbyEatsGeoapifyKey";
  const CACHE_PREFIX = "nearbyEatsAddressSearch:";
  const CACHE_TTL_MS = 5 * 60 * 1000;

  let manualOrigin = null;
  let manualPlaces = [];
  let lastRadiusMiles = 5;
  let requestController = null;

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

  function titleCaseTag(value) {
    return String(value || "").replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
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

  function formatDistance(mi) {
    if (!Number.isFinite(mi)) return "—";
    if (mi < 0.1) return `${Math.round(mi * 5280)} ft`;
    if (mi < 10) return `${mi.toFixed(1)} mi`;
    return `${Math.round(mi)} mi`;
  }

  function categoryToAmenity(categories) {
    if (categories.some(c => c === "commercial.food_and_drink.bakery")) return { shop: "bakery" };
    if (categories.some(c => c === "catering.fast_food" || c.startsWith("catering.fast_food."))) return { amenity: "fast_food" };
    if (categories.some(c => c === "catering.cafe" || c.startsWith("catering.cafe."))) return { amenity: "cafe" };
    if (categories.some(c => c === "catering.pub")) return { amenity: "pub" };
    if (categories.some(c => c === "catering.bar")) return { amenity: "bar" };
    if (categories.some(c => c === "catering.biergarten")) return { amenity: "biergarten" };
    if (categories.some(c => c === "catering.food_court")) return { amenity: "food_court" };
    if (categories.some(c => c === "catering.ice_cream")) return { amenity: "ice_cream" };
    if (categories.some(c => c === "catering.restaurant" || c.startsWith("catering.restaurant."))) return { amenity: "restaurant" };
    return { amenity: "restaurant" };
  }

  function cuisineFromCategories(categories) {
    const values = [];
    for (const category of categories) {
      const restaurant = category.match(/^catering\.restaurant\.(.+)$/);
      const fastFood = category.match(/^catering\.fast_food\.(.+)$/);
      const value = restaurant?.[1] || fastFood?.[1];
      if (value && !values.includes(value)) values.push(value);
    }
    return values.join(";");
  }

  function featureToPlace(feature, index) {
    const p = feature?.properties || {};
    const categories = Array.isArray(p.categories) ? p.categories : [];
    const raw = p.datasource?.raw && typeof p.datasource.raw === "object" ? p.datasource.raw : {};
    const coords = feature?.geometry?.coordinates || [];
    const lng = Number(p.lon ?? coords[0]);
    const lat = Number(p.lat ?? coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const tags = { ...raw, ...categoryToAmenity(categories) };
    if (!tags.name && p.name) tags.name = p.name;
    if (!tags["addr:housenumber"] && p.housenumber) tags["addr:housenumber"] = p.housenumber;
    if (!tags["addr:street"] && p.street) tags["addr:street"] = p.street;
    if (!tags["addr:city"] && p.city) tags["addr:city"] = p.city;
    if (!tags["addr:state"] && (p.state_code || p.state)) tags["addr:state"] = p.state_code || p.state;
    if (!tags["addr:postcode"] && p.postcode) tags["addr:postcode"] = p.postcode;
    if (!tags.cuisine) {
      const cuisine = cuisineFromCategories(categories);
      if (cuisine) tags.cuisine = cuisine;
    }
    if (!tags.opening_hours && p.opening_hours) tags.opening_hours = p.opening_hours;
    if (categories.includes("wheelchair.yes")) tags.wheelchair = "yes";

    const name = tags.name || p.name || "Unnamed food place";
    return {
      id: p.place_id || `manual-${index}`,
      lat,
      lng,
      tags,
      name,
      distance: haversineMiles(manualOrigin, { lat, lng })
    };
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
    if (typeof window.opening_hours !== "function") return { known: false, open: false, label: "Hours listed" };
    try {
      const oh = new window.opening_hours(raw, null, { tag_key: "opening_hours" });
      if (oh.getUnknown()) return { known: false, open: false, label: "Hours uncertain" };
      const open = oh.getState();
      return { known: true, open, label: open ? "Open now" : "Closed now" };
    } catch {
      return { known: false, open: false, label: "Hours listed" };
    }
  }

  function selectedServices() {
    return [...document.querySelectorAll("#serviceChips input:checked")].map(x => x.value);
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

  function formatAddress(tags) {
    const line1 = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
    const line2 = [tags["addr:city"], tags["addr:state"], tags["addr:postcode"]].filter(Boolean).join(" ");
    return [line1, line2].filter(Boolean).join(" • ");
  }

  function makeTag(text, className = "") {
    const el = document.createElement("span");
    el.className = `tag ${className}`.trim();
    el.textContent = text;
    return el;
  }

  function updateFilterCount() {
    const sortSelect = document.getElementById("sortSelect");
    const radiusSelect = document.getElementById("radiusSelect");
    const openNowCheck = document.getElementById("openNowCheck");
    const filterCount = document.getElementById("filterCount");
    if (!sortSelect || !radiusSelect || !openNowCheck || !filterCount) return;
    let count = 0;
    if (sortSelect.value !== "distance") count++;
    if (radiusSelect.value !== "5") count++;
    if (openNowCheck.checked) count++;
    count += document.querySelectorAll("#serviceChips input:checked").length;
    filterCount.textContent = String(count);
    filterCount.hidden = count === 0;
  }

  function cacheKey(radiusMiles) {
    return `${CACHE_PREFIX}${manualOrigin.lat.toFixed(4)},${manualOrigin.lng.toFixed(4)}:${radiusMiles}`;
  }

  function readCache(radiusMiles) {
    try {
      const raw = sessionStorage.getItem(cacheKey(radiusMiles));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.time || Date.now() - parsed.time > CACHE_TTL_MS) return null;
      return parsed.features || null;
    } catch {
      return null;
    }
  }

  function writeCache(radiusMiles, features) {
    try {
      sessionStorage.setItem(cacheKey(radiusMiles), JSON.stringify({ time: Date.now(), features }));
    } catch { }
  }

  async function fetchPlaces(radiusMiles, forceNetwork) {
    const key = localStorage.getItem(KEY_STORAGE)?.trim();
    if (!key) throw new Error("Set up the free Geoapify key first.");

    if (!forceNetwork) {
      const cached = readCache(radiusMiles);
      if (cached) return { features: cached, cached: true };
    }

    requestController?.abort();
    requestController = new AbortController();
    const radiusMeters = Math.round(radiusMiles * 1609.344);
    const params = new URLSearchParams({
      categories: "catering,commercial.food_and_drink.bakery",
      filter: `circle:${manualOrigin.lng},${manualOrigin.lat},${radiusMeters}`,
      bias: `proximity:${manualOrigin.lng},${manualOrigin.lat}`,
      limit: "100",
      lang: "en",
      apiKey: key
    });
    const response = await fetch(`https://api.geoapify.com/v2/places?${params.toString()}`, {
      headers: { "Accept": "application/json" },
      cache: "no-store",
      signal: requestController.signal
    });
    if (!response.ok) throw new Error(`Geoapify returned HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.features)) throw new Error("Unexpected Geoapify response");
    writeCache(radiusMiles, data.features);
    return { features: data.features, cached: false };
  }

  function renderManualResults(source = "live") {
    if (!manualOrigin) return;
    const results = document.getElementById("results");
    const emptyState = document.getElementById("emptyState");
    const resultsMeta = document.getElementById("resultsMeta");
    const template = document.getElementById("resultTemplate");
    const category = document.getElementById("categorySelect")?.value || "all";
    const query = document.getElementById("queryInput")?.value || "";
    const sort = document.getElementById("sortSelect")?.value || "distance";
    const requireOpen = Boolean(document.getElementById("openNowCheck")?.checked);
    const services = selectedServices();

    let rows = manualPlaces.filter(place => {
      if (!categoryMatches(place, category)) return false;
      if (!keywordMatches(place, query)) return false;
      if (!services.every(s => serviceTests[s]?.(place.tags))) return false;
      if (requireOpen) {
        const state = openingState(place);
        if (!state.known || !state.open) return false;
      }
      return true;
    });

    if (sort === "name") rows.sort((a, b) => a.name.localeCompare(b.name) || a.distance - b.distance);
    else rows.sort((a, b) => a.distance - b.distance);

    results.innerHTML = "";
    emptyState.hidden = true;

    if (!rows.length) {
      results.innerHTML = `<div class="error-card">No matching places were found around that address. Try increasing the radius, choosing All food, or loosening a filter.</div>`;
      resultsMeta.textContent = `No matches • searching from ${manualOrigin.label}`;
      return;
    }

    rows.forEach((place, i) => {
      const frag = template.content.cloneNode(true);
      frag.querySelector(".place-rank").textContent = i + 1;
      frag.querySelector(".place-name").textContent = place.name;
      frag.querySelector(".distance-badge").textContent = formatDistance(place.distance);
      frag.querySelector(".place-details").textContent = formatType(place) || "Food / drink";

      const address = formatAddress(place.tags);
      const addressEl = frag.querySelector(".place-address");
      if (address) addressEl.textContent = address;
      else addressEl.remove();

      const tagsEl = frag.querySelector(".place-tags");
      const state = openingState(place);
      tagsEl.appendChild(makeTag(state.label, state.known && state.open ? "open" : ""));
      if (place.tags.opening_hours && place.tags.opening_hours !== "24/7") tagsEl.appendChild(makeTag(place.tags.opening_hours));

      const showServices = new Set(services);
      for (const key of Object.keys(serviceTests)) if (serviceTests[key](place.tags)) showServices.add(key);
      [...showServices].slice(0, 4).forEach(key => tagsEl.appendChild(makeTag(serviceLabels[key])));

      const directions = frag.querySelector(".directions-btn");
      directions.href = `https://maps.apple.com/?daddr=${encodeURIComponent(`${place.lat},${place.lng}`)}&dirflg=d`;
      directions.setAttribute("aria-label", `Directions to ${place.name}`);

      const other = frag.querySelector(".osm-btn");
      other.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([place.name, address].filter(Boolean).join(" "))}`;
      other.setAttribute("aria-label", `Open ${place.name} in Google Maps`);

      results.appendChild(frag);
    });

    const cacheNote = source === "cached" ? " • cached 5 min" : "";
    resultsMeta.textContent = `${rows.length} result${rows.length === 1 ? "" : "s"} • within ${lastRadiusMiles} mi of ${manualOrigin.label}${cacheNote}`;
  }

  async function runManualSearch(forceNetwork = false) {
    if (!manualOrigin) return;
    const results = document.getElementById("results");
    const emptyState = document.getElementById("emptyState");
    const resultsMeta = document.getElementById("resultsMeta");
    const radiusMiles = Number(document.getElementById("radiusSelect")?.value || 5);
    lastRadiusMiles = radiusMiles;

    emptyState.hidden = true;
    results.innerHTML = `<div class="loading-card"><span class="spinner"></span>Searching near ${escapeHtml(manualOrigin.label)}…</div>`;
    resultsMeta.textContent = "Searching nearby food…";

    try {
      const { features, cached } = await fetchPlaces(radiusMiles, forceNetwork);
      manualPlaces = features
        .map(featureToPlace)
        .filter(Boolean)
        .filter(place => place.distance <= radiusMiles + 0.02);
      renderManualResults(cached ? "cached" : "live");
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.error(err);
      results.innerHTML = `<div class="error-card"><strong>Address search couldn't load.</strong><br>${escapeHtml(err?.message || String(err))}</div>`;
      resultsMeta.textContent = "Address search error.";
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function useAddress(input, status, button) {
    const key = localStorage.getItem(KEY_STORAGE)?.trim();
    const text = input.value.trim();
    if (!key) {
      status.textContent = "Set up your free Geoapify key first.";
      document.getElementById("setupFastSearchKey")?.click();
      return;
    }
    if (!text) {
      status.textContent = "Enter an address, city, ZIP code, hotel, or other place.";
      return;
    }

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Finding…";
    status.textContent = "Finding that location…";

    try {
      const params = new URLSearchParams({ text, format: "json", limit: "1", lang: "en", apiKey: key });
      const response = await fetch(`https://api.geoapify.com/v1/geocode/search?${params.toString()}`, {
        headers: { "Accept": "application/json" },
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Address lookup returned HTTP ${response.status}`);
      const data = await response.json();
      const found = data?.results?.[0];
      if (!found || !Number.isFinite(found.lat) || !Number.isFinite(found.lon)) {
        status.textContent = "I couldn't find that location. Add the city/state or ZIP and try again.";
        return;
      }

      manualOrigin = {
        lat: found.lat,
        lng: found.lon,
        label: found.formatted || text
      };
      manualPlaces = [];
      status.textContent = `Using: ${manualOrigin.label}`;
      const locationStatus = document.getElementById("locationStatus");
      if (locationStatus) locationStatus.textContent = `Search origin: ${manualOrigin.label}`;
      await runManualSearch(true);
    } catch (err) {
      console.error(err);
      status.textContent = `Couldn't find that location. ${err?.message || "Try again."}`;
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function installStyles() {
    if (document.getElementById("addressSearchStyles")) return;
    const style = document.createElement("style");
    style.id = "addressSearchStyles";
    style.textContent = `
      .address-origin-panel { margin: -6px 0 14px; padding: 12px; border: 1px solid var(--border); border-radius: 12px; background: rgba(255,255,255,.02); }
      .address-origin-label { display: block; margin-bottom: 7px; font-size: 12px; font-weight: 800; color: var(--muted); }
      .address-origin-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; }
      .address-origin-row input { min-width: 0; }
      .address-origin-status { margin-top: 7px; font-size: 11px; line-height: 1.35; color: var(--muted); }
      @media (max-width: 520px) { .address-origin-row { grid-template-columns: 1fr; } .address-origin-row .secondary-btn { width: 100%; } }
    `;
    document.head.appendChild(style);
  }

  function boot() {
    installStyles();
    const locationRow = document.querySelector(".location-row");
    const locateBtn = document.getElementById("locateBtn");
    if (!locationRow || !locateBtn || document.getElementById("addressOriginInput")) return;

    locateBtn.textContent = "Use current location";

    const section = document.createElement("section");
    section.className = "address-origin-panel";
    section.innerHTML = `
      <label for="addressOriginInput" class="address-origin-label">Or search from an address</label>
      <div class="address-origin-row">
        <input id="addressOriginInput" type="search" autocomplete="street-address" placeholder="Street address, city, ZIP, hotel…">
        <button id="addressOriginBtn" class="secondary-btn" type="button">Use address</button>
      </div>
      <div id="addressOriginStatus" class="address-origin-status">Use any address or place as the center of the restaurant search.</div>
    `;
    locationRow.insertAdjacentElement("afterend", section);

    const input = section.querySelector("#addressOriginInput");
    const button = section.querySelector("#addressOriginBtn");
    const status = section.querySelector("#addressOriginStatus");

    button.addEventListener("click", () => useAddress(input, status, button));
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        useAddress(input, status, button);
      }
    });

    locateBtn.addEventListener("click", () => {
      if (!manualOrigin) return;
      manualOrigin = null;
      manualPlaces = [];
      input.value = "";
      status.textContent = "Using your device location.";
    }, true);

    document.getElementById("searchBtn")?.addEventListener("click", event => {
      if (!manualOrigin) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      runManualSearch(true);
    }, true);

    document.getElementById("queryInput")?.addEventListener("keydown", event => {
      if (!manualOrigin || event.key !== "Enter") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      runManualSearch(true);
    }, true);

    document.getElementById("categorySelect")?.addEventListener("change", event => {
      if (!manualOrigin) return;
      event.stopImmediatePropagation();
      renderManualResults("filtered");
    }, true);

    document.getElementById("applyFiltersBtn")?.addEventListener("click", event => {
      if (!manualOrigin) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      document.getElementById("filtersPanel").hidden = true;
      updateFilterCount();
      const radius = Number(document.getElementById("radiusSelect")?.value || 5);
      if (radius !== lastRadiusMiles) runManualSearch(true);
      else renderManualResults("filtered");
    }, true);

    document.getElementById("clearFiltersBtn")?.addEventListener("click", event => {
      if (!manualOrigin) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      document.getElementById("sortSelect").value = "distance";
      document.getElementById("radiusSelect").value = "5";
      document.getElementById("openNowCheck").checked = false;
      document.querySelectorAll("#serviceChips input").forEach(el => el.checked = false);
      updateFilterCount();
      if (lastRadiusMiles !== 5) runManualSearch(true);
      else renderManualResults("filtered");
    }, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
