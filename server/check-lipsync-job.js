#!/usr/bin/env node
/**
 * Quick script to check lip-sync job status
 * Usage: node check-lipsync-job.js <job-id>
 */

require("dotenv").config();
const https = require("https");

const jobId = process.argv[2] || "c29ca555-b348-43e3-862c-9d89cdea9c2b";
const apiKey = process.env.SYNCLABS_API_KEY;

if (!apiKey) {
  console.error("SYNCLABS_API_KEY not set in .env");
  process.exit(1);
}

console.log(`Checking job: ${jobId}`);
console.log(`API Key: ${apiKey.substring(0, 10)}...`);

https.get({
  hostname: "api.sync.so",
  path: `/v2/generate/${jobId}`,
  headers: { "x-api-key": apiKey }
}, (res) => {
  let data = "";
  res.on("data", chunk => data += chunk);
  res.on("end", () => {
    try {
      const result = JSON.parse(data);
      console.log("\n📋 Job Status:");
      console.log(`   Status: ${result.status}`);
      console.log(`   Output URL: ${result.outputUrl || result.output_url || "Not ready yet"}`);
      if (result.error) console.log(`   Error: ${result.error}`);
      if (result.progress) console.log(`   Progress: ${(result.progress * 100).toFixed(0)}%`);
      console.log("\n📦 Full response:");
      console.log(JSON.stringify(result, null, 2));
    } catch (e) {
      console.log("Raw response:", data);
    }
  });
}).on("error", e => console.error("Request error:", e.message));
