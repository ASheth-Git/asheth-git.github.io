/* ================================================================
   VERCEL TELEMETRY ENDPOINT
   Logs visitor IP, fetches geolocation, increments country counter
   in a JSON file, and returns aggregated visitor data for the live map.

   Endpoint: /api/telemetry
   Method: GET
   Returns: {countries: [{code, count}, ...], current: {lon, lat}}
   ================================================================ */

import fs from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "data", "telemetry.json");

// Ensure data directory exists
function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Read telemetry data from JSON file
function readData() {
  try {
    ensureDataDir();
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn("Failed to read telemetry data:", e);
  }
  return {}; // empty data
}

// Write telemetry data to JSON file
function writeData(data) {
  try {
    ensureDataDir();
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.warn("Failed to write telemetry data:", e);
  }
}

export default async function handler(req, res) {
  try {
    // Get visitor IP from Vercel headers
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

    // Read current data
    const data = readData();

    // Increment counter for this country
    if (!data[countryCode]) {
      data[countryCode] = 0;
    }
    data[countryCode]++;

    // Write updated data back
    writeData(data);

    // Format countries array
    const allCountries = Object.entries(data)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count);

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
