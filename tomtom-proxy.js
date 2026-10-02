(() => {
  "use strict";

  const KEY_STORAGE = "nearbyEatsTomTomKey";
  const originalFetch = window.fetch.bind(window);

  function isOverpassUrl(url) {
    return /overpass-api\.de\/api\/interpreter|overpass\.private\.coffee\/api\/interpreter/i.test(url);
  }

  function isGeoapifyPlacesUrl(url) {
    return /api\.geoapify\.com\/v2\/places/i.test(url);
  }

  function isGeoapifyGeocodeUrl(url) {
    return /api\.geoapify\.com\/v1\/geocode\/search/i.test(url);
  }

  function parseOverpassLocation(url) {
    try {
      const parsed = new URL(url, window.location.href);
      const query = parsed.searchParams.get("data") || "";
      const match = query.match(/around:(\d+),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      if (!match) return null;
      return { radiusMeters: Number(match[1]), lat: Number(match[2]), lng: Number(match[3]) };
    } catch {
      return null;
    }
  }

  function parseGeoapifyCircle(url) {
    try {
      const parsed = new URL(url, window.location.href);
      const filter = parsed.searchParams.get("filter") || "";
      const match = filter.match(/circle:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+)/);
      if (!match) return null;
      return { lng: Number(match[1]), lat: Number(match[2]), radiusMeters: Number(match[3]) };
    } catch {
      return null;
    }
  }

  function titleCase(value) {
    return String(value || "").replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
  }

  function tomTomResultToTags(result) {
    const poi = result?.poi || {};
    const address = result?.address || {};
    const categoryNames = [];
    (poi.classifications || []).forEach(c => (c.names || []).forEach(n => {
      if (n?.name && !categoryNames.includes(n.name.toLowerCase())) categoryNames.push(n.name.toLowerCase());
    }));

    const categoryIds = (poi.categorySet || []).map(x => Number(x.id));
    const isCafePub = categoryIds.some(id => String(id).startsWith("9376"));
    const tags = {
      name: poi.name || "Unnamed food place",
      amenity: isCafePub ? (categoryNames.some(x => x.includes("pub")) ? "pub" : "cafe") : "restaurant"
    };

    if (address.streetNumber) tags["addr:housenumber"] = address.streetNumber;
    if (address.streetName) tags["addr:street"] = address.streetName;
    if (address.municipality) tags["addr:city"] = address.municipality;
    if (address.countrySubdivision) tags["addr:state"] = address.countrySubdivision;
    if (address.postalCode) tags["addr:postcode"] = address.postalCode;
    if (poi.phone) tags.phone = poi.phone;
    if (poi.url) tags.website = poi.url;

    const cuisineWords = categoryNames.filter(x => !["restaurant", "cafe", "café", "pub", "coffee shop", "tea house"].includes(x));
    if (cuisineWords.length) tags.cuisine = cuisineWords.slice(0, 4).join(";");

    return tags;
  }

  function tomTomToOverpass(result, index) {
    const lat = Number(result?.position?.lat);
    const lon = Number(result?.position?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      type: "node",
      id: `tomtom-${String(result.id || index).replace(/[^a-zA-Z0-9_-]/g, "")}`,
      lat,
      lon,
      tags: tomTomResultToTags(result)
    };
  }

  function tomTomToGeoFeature(result, index) {
    const lat = Number(result?.position?.lat);
    const lon = Number(result?.position?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const tags = tomTomResultToTags(result);
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        place_id: `tomtom-${result.id || index}`,
        name: tags.name,
        lon,
        lat,
        housenumber: tags["addr:housenumber"],
        street: tags["addr:street"],
        city: tags["addr:city"],
        state_code: tags["addr:state"],
        postcode: tags["addr:postcode"],
        categories: tags.amenity === "cafe" ? ["catering.cafe"] : tags.amenity === "pub" ? ["catering.pub"] : ["catering.restaurant"],
        datasource: { raw: tags }
      }
    };
  }

  async function fetchTomTomPois(location, key, signal) {
    const params = new URLSearchParams({
      key,
      limit: "100",
      countrySet: "US",
      lat: String(location.lat),
      lon: String(location.lng),
      radius: String(Math.max(1, Math.round(location.radiusMeters))),
      categorySet: "7315,9376",
      language: "en-US"
    });
    const url = `https://api.tomtom.com/search/2/categorySearch/restaurant.json?${params.toString()}`;
    const response = await originalFetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal });
    if (!response.ok) throw new Error(`TomTom returned HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.results)) throw new Error("Unexpected TomTom response");
    return data.results;
  }

  function dedupeOverpass(elements) {
    const map = new Map();
    for (const el of elements) {
      if (!el) continue;
      const name = String(el.tags?.name || "").toLowerCase().trim();
      const lat = Number(el.lat ?? el.center?.lat);
      const lon = Number(el.lon ?? el.center?.lon);
      const key = `${name}|${Number.isFinite(lat) ? lat.toFixed(4) : ""}|${Number.isFinite(lon) ? lon.toFixed(4) : ""}`;
      if (!map.has(key) || Object.keys(el.tags || {}).length > Object.keys(map.get(key).tags || {}).length) map.set(key, el);
    }
    return [...map.values()];
  }

  function dedupeFeatures(features) {
    const map = new Map();
    for (const feature of features) {
      if (!feature) continue;
      const p = feature.properties || {};
      const coords = feature.geometry?.coordinates || [];
      const name = String(p.name || "").toLowerCase().trim();
      const lon = Number(p.lon ?? coords[0]);
      const lat = Number(p.lat ?? coords[1]);
      const key = `${name}|${Number.isFinite(lat) ? lat.toFixed(4) : ""}|${Number.isFinite(lon) ? lon.toFixed(4) : ""}`;
      if (!map.has(key)) map.set(key, feature);
    }
    return [...map.values()];
  }

  function currentPositionForBias(timeout = 2500) {
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout, maximumAge: 300000 }
      );
    });
  }

  function queryLooksLocationComplete(text) {
    return /,/.test(text) || /\b[A-Z]{2}\b/i.test(text) || /\b\d{5}(?:-\d{4})?\b/.test(text);
  }

  async function fetchTomTomGeocode(text, key, signal) {
    const params = new URLSearchParams({ key, limit: "1", countrySet: "US" });
    if (!queryLooksLocationComplete(text)) {
      const bias = await currentPositionForBias();
      if (bias) {
        params.set("lat", String(bias.lat));
        params.set("lon", String(bias.lng));
      }
    }
    const url = `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(text)}.json?${params.toString()}`;
    const response = await originalFetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal });
    if (!response.ok) throw new Error(`TomTom geocode returned HTTP ${response.status}`);
    const data = await response.json();
    const hit = data?.results?.[0];
    if (!hit) throw new Error("No TomTom address match");
    const lat = Number(hit.position?.lat);
    const lon = Number(hit.position?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("TomTom returned no coordinates");
    return {
      lat,
      lon,
      formatted: hit.address?.freeformAddress || hit.address?.streetName || text
    };
  }

  window.fetch = async function(resource, init) {
    const url = typeof resource === "string" ? resource : resource?.url;
    const key = localStorage.getItem(KEY_STORAGE)?.trim();
    if (!url || !key) return originalFetch(resource, init);

    if (isOverpassUrl(url)) {
      const location = parseOverpassLocation(url);
      if (!location) return originalFetch(resource, init);
      const fallbackPromise = originalFetch(resource, init).then(async r => r.ok ? (await r.json()).elements || [] : []).catch(() => []);
      const tomtomPromise = fetchTomTomPois(location, key, init?.signal).then(results => results.map(tomTomToOverpass).filter(Boolean)).catch(err => {
        console.warn("TomTom POI search failed; keeping existing source.", err);
        return [];
      });
      const [fallbackElements, tomtomElements] = await Promise.all([fallbackPromise, tomtomPromise]);
      const elements = dedupeOverpass([...tomtomElements, ...fallbackElements]);
      return new Response(JSON.stringify({ elements }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (isGeoapifyPlacesUrl(url)) {
      const location = parseGeoapifyCircle(url);
      if (!location) return originalFetch(resource, init);
      const fallbackPromise = originalFetch(resource, init).then(async r => r.ok ? (await r.json()).features || [] : []).catch(() => []);
      const tomtomPromise = fetchTomTomPois(location, key, init?.signal).then(results => results.map(tomTomToGeoFeature).filter(Boolean)).catch(err => {
        console.warn("TomTom address-origin POI search failed; keeping Geoapify results.", err);
        return [];
      });
      const [fallbackFeatures, tomtomFeatures] = await Promise.all([fallbackPromise, tomtomPromise]);
      const features = dedupeFeatures([...tomtomFeatures, ...fallbackFeatures]);
      return new Response(JSON.stringify({ type: "FeatureCollection", features }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (isGeoapifyGeocodeUrl(url)) {
      try {
        const parsed = new URL(url, window.location.href);
        const text = parsed.searchParams.get("text") || "";
        if (!text) return originalFetch(resource, init);
        const found = await fetchTomTomGeocode(text, key, init?.signal);
        return new Response(JSON.stringify({ results: [found] }), { status: 200, headers: { "Content-Type": "application/json" } });
      } catch (err) {
        console.warn("TomTom address lookup failed; using Geoapify geocoding.", err);
        return originalFetch(resource, init);
      }
    }

    return originalFetch(resource, init);
  };

  function buildSetupUi() {
    if (document.getElementById("tomtomSetup")) return;
    const anchor = document.getElementById("fastSearchSetup") || document.querySelector(".location-row");
    if (!anchor) return;

    const section = document.createElement("section");
    section.id = "tomtomSetup";
    section.className = "install-tip";

    const dialog = document.createElement("dialog");
    dialog.innerHTML = `
      <form method="dialog" class="dialog-card" id="tomtomSetupForm">
        <div class="dialog-head">
          <h2>Better restaurant coverage</h2>
          <button class="icon-btn" value="cancel" aria-label="Close">×</button>
        </div>
        <p>TomTom's free Search API adds a much larger commercial POI database to Nearby Eats. No credit card is required.</p>
        <p><a href="https://developer.tomtom.com/" target="_blank" rel="noopener">Create a free TomTom developer account and API key</a>.</p>
        <label><span>TomTom API key</span><input id="tomtomKeyInput" type="text" autocomplete="off" spellcheck="false" placeholder="Paste your free key here"></label>
        <div class="filter-actions">
          <button class="text-btn" value="cancel" type="button" id="removeTomTomKey">Remove</button>
          <button class="primary-btn" value="ok" type="submit">Save key</button>
        </div>
      </form>`;

    document.body.appendChild(dialog);
    anchor.insertAdjacentElement("afterend", section);

    const refresh = () => {
      const hasKey = Boolean(localStorage.getItem(KEY_STORAGE)?.trim());
      section.innerHTML = hasKey
        ? `<strong>Expanded restaurant coverage connected.</strong> TomTom + Geoapify results are being merged. <button id="changeTomTomKey" class="text-btn" type="button">Change key</button>`
        : `<strong>Fix missing nearby restaurants:</strong> connect a free TomTom Search key for much better POI coverage. <button id="setupTomTomKey" class="text-btn" type="button">Set up</button>`;
      section.querySelector("#setupTomTomKey")?.addEventListener("click", openDialog);
      section.querySelector("#changeTomTomKey")?.addEventListener("click", openDialog);
    };

    function openDialog() {
      dialog.querySelector("#tomtomKeyInput").value = localStorage.getItem(KEY_STORAGE) || "";
      dialog.showModal();
    }

    dialog.querySelector("#tomtomSetupForm").addEventListener("submit", event => {
      event.preventDefault();
      const value = dialog.querySelector("#tomtomKeyInput").value.trim();
      if (value) localStorage.setItem(KEY_STORAGE, value);
      dialog.close();
      refresh();
    });

    dialog.querySelector("#removeTomTomKey").addEventListener("click", () => {
      localStorage.removeItem(KEY_STORAGE);
      dialog.close();
      refresh();
    });

    refresh();
  }

  document.addEventListener("DOMContentLoaded", buildSetupUi);
})();