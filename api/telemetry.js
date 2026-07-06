/* ================================================================
   VERCEL TELEMETRY ENDPOINT
   Logs visitor IP, fetches geolocation, increments country counter,
   and returns aggregated visitor data for the live map.

   Endpoint: /api/telemetry
   Method: GET
   Returns: {countries: [{code, count}, ...], current: {lon, lat}}
   ================================================================ */

import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  try {
    // Get visitor IP from Vercel headers (most reliable)
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.headers["cf-connecting-ip"] ||
      req.socket.remoteAddress ||
      "0.0.0.0";

    // Fetch geolocation from geojs.io (free, reliable, no API key)
    const geoRes = await fetch(`https://get.geojs.io/v1/ip/geo.json?ip=${ip}`);
    const geo = await geoRes.json();
    const countryCode = (geo.country_code || "XX").toUpperCase();

    // Validate country code format
    if (!/^[A-Z]{2}$/.test(countryCode)) {
      return res.status(200).json({
        countries: [],
        current: null,
        error: "Invalid geolocation",
      });
    }

    // Increment counter for this country in Vercel KV
    // Key format: "telemetry:c-US", value: visit count
    const counterKey = `telemetry:c-${countryCode}`;
    const currentCount = (await kv.get(counterKey)) || 0;
    await kv.set(counterKey, currentCount + 1);

    // Fetch all country data from KV
    // This is fast because we only store ~195 countries
    const allCountries = [];
    const keys = await kv.keys("telemetry:c-*");

    for (const key of keys) {
      const code = key.replace("telemetry:c-", "");
      const count = await kv.get(key);
      if (count > 0) allCountries.push({ code, count });
    }

    // Sort by count descending (most visited first)
    allCountries.sort((a, b) => b.count - a.count);

    // Return aggregated data
    res.status(200).json({
      countries: allCountries,
      current: {
        lon: parseFloat(geo.longitude) || 0,
        lat: parseFloat(geo.latitude) || 0,
        country: countryCode,
      },
    });
  } catch (error) {
    console.error("Telemetry error:", error);
    res.status(200).json({
      countries: [],
      current: null,
      error: error.message,
    });
  }
}
