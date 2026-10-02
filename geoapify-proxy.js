(() => {
  "use strict";

  const KEY_STORAGE = "nearbyEatsGeoapifyKey";
  const originalFetch = window.fetch.bind(window);

  function isOverpassUrl(url) {
    return /overpass-api\.de\/api\/interpreter|overpass\.private\.coffee\/api\/interpreter/i.test(url);
  }

  function parseOverpassLocation(url) {
    try {
      const parsed = new URL(url, window.location.href);
      const query = parsed.searchParams.get("data") || "";
      const match = query.match(/around:(\d+),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      if (!match) return null;
      return {
        radiusMeters: Number(match[1]),
        lat: Number(match[2]),
        lng: Number(match[3])
      };
    } catch {
      return null;
    }
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

  function featureToOverpass(feature, index) {
    const p = feature?.properties || {};
    const categories = Array.isArray(p.categories) ? p.categories : [];
    const raw = p.datasource?.raw && typeof p.datasource.raw === "object" ? p.datasource.raw : {};
    const coords = feature?.geometry?.coordinates || [];
    const lng = Number(p.lon ?? coords[0]);
    const lat = Number(p.lat ?? coords[1]);

    const tags = { ...raw, ...categoryToAmenity(categories) };
    if (!tags.name && p.name) tags.name = p.name;
    if (!tags["addr:housenumber"] && p.housenumber) tags["addr:housenumber"] = p.housenumber;
    if (!tags["addr:street"] && p.street) tags["addr:street"] = p.street;
    if (!tags["addr:city"] && p.city) tags["addr:city"] = p.city;
    if (!tags["addr:state"] && p.state_code) tags["addr:state"] = p.state_code;
    if (!tags["addr:state"] && p.state) tags["addr:state"] = p.state;
    if (!tags["addr:postcode"] && p.postcode) tags["addr:postcode"] = p.postcode;
    if (!tags.cuisine) {
      const cuisine = cuisineFromCategories(categories);
      if (cuisine) tags.cuisine = cuisine;
    }
    if (!tags.opening_hours && p.opening_hours) tags.opening_hours = p.opening_hours;
    if (categories.includes("wheelchair.yes")) tags.wheelchair = "yes";

    return {
      type: "node",
      id: p.place_id || `geoapify-${index}`,
      lat,
      lon: lng,
      tags
    };
  }

  async function fetchGeoapify(location, key, signal) {
    const params = new URLSearchParams({
      categories: "catering,commercial.food_and_drink.bakery",
      filter: `circle:${location.lng},${location.lat},${location.radiusMeters}`,
      bias: `proximity:${location.lng},${location.lat}`,
      limit: "100",
      lang: "en",
      apiKey: key
    });

    const response = await originalFetch(`https://api.geoapify.com/v2/places?${params.toString()}`, {
      method: "GET",
      headers: { "Accept": "application/json" },
      cache: "no-store",
      signal
    });

    if (!response.ok) throw new Error(`Geoapify returned HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.features)) throw new Error("Unexpected Geoapify response");

    const elements = data.features
      .map(featureToOverpass)
      .filter(el => Number.isFinite(el.lat) && Number.isFinite(el.lon));

    return new Response(JSON.stringify({ elements }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  window.fetch = async function(resource, init) {
    const url = typeof resource === "string" ? resource : resource?.url;
    const key = localStorage.getItem(KEY_STORAGE)?.trim();

    if (!url || !key || !isOverpassUrl(url)) {
      return originalFetch(resource, init);
    }

    const location = parseOverpassLocation(url);
    if (!location) return originalFetch(resource, init);

    try {
      return await fetchGeoapify(location, key, init?.signal);
    } catch (error) {
      console.warn("Geoapify fast search failed; falling back to Overpass.", error);
      return originalFetch(resource, init);
    }
  };

  function buildSetupUi() {
    const locationRow = document.querySelector(".location-row");
    if (!locationRow || document.getElementById("fastSearchSetup")) return;

    const section = document.createElement("section");
    section.id = "fastSearchSetup";
    section.className = "install-tip";

    const refresh = () => {
      const hasKey = Boolean(localStorage.getItem(KEY_STORAGE)?.trim());
      section.innerHTML = hasKey
        ? `<strong>Fast search connected.</strong> Geoapify is being used first; OpenStreetMap Overpass is only the fallback. <button id="changeFastSearchKey" class="text-btn" type="button">Change key</button>`
        : `<strong>Make search fast and reliable:</strong> connect a free Geoapify key. No credit card is required. <button id="setupFastSearchKey" class="text-btn" type="button">Set up</button>`;

      section.querySelector("#setupFastSearchKey")?.addEventListener("click", openDialog);
      section.querySelector("#changeFastSearchKey")?.addEventListener("click", openDialog);
    };

    const dialog = document.createElement("dialog");
    dialog.id = "geoapifySetupDialog";
    dialog.innerHTML = `
      <form method="dialog" class="dialog-card" id="geoapifySetupForm">
        <div class="dialog-head">
          <h2>Fast free search</h2>
          <button class="icon-btn" value="cancel" aria-label="Close">×</button>
        </div>
        <p>Geoapify's free plan provides the nearby-place search. It requires an API key, but no credit card or paid plan.</p>
        <p><a href="https://myprojects.geoapify.com/" target="_blank" rel="noopener">Create a free Geoapify project and copy its API key</a>.</p>
        <label>
          <span>Geoapify API key</span>
          <input id="geoapifyKeyInput" type="text" autocomplete="off" spellcheck="false" placeholder="Paste your free key here">
        </label>
        <div class="filter-actions">
          <button class="text-btn" value="cancel" type="button" id="removeGeoapifyKey">Use fallback only</button>
          <button class="primary-btn" value="ok" type="submit">Save key</button>
        </div>
      </form>`;

    document.body.appendChild(dialog);
    locationRow.insertAdjacentElement("afterend", section);

    function openDialog() {
      dialog.querySelector("#geoapifyKeyInput").value = localStorage.getItem(KEY_STORAGE) || "";
      dialog.showModal();
    }

    dialog.querySelector("#geoapifySetupForm").addEventListener("submit", event => {
      event.preventDefault();
      const value = dialog.querySelector("#geoapifyKeyInput").value.trim();
      if (value) localStorage.setItem(KEY_STORAGE, value);
      dialog.close();
      refresh();
    });

    dialog.querySelector("#removeGeoapifyKey").addEventListener("click", () => {
      localStorage.removeItem(KEY_STORAGE);
      dialog.close();
      refresh();
    });

    refresh();

    const attribution = document.querySelector(".osm-attribution");
    if (attribution && !document.getElementById("geoapifyAttribution")) {
      const geo = document.createElement("a");
      geo.id = "geoapifyAttribution";
      geo.className = "osm-attribution";
      geo.href = "https://www.geoapify.com/";
      geo.target = "_blank";
      geo.rel = "noopener";
      geo.textContent = "Powered by Geoapify";
      attribution.insertAdjacentElement("beforebegin", geo);
      attribution.insertAdjacentText("beforebegin", " ");
    }
  }

  document.addEventListener("DOMContentLoaded", buildSetupUi);
})();