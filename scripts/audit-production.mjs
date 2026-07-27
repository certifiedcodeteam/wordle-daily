import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const allowedAdvisories = new Set([1124282]);

let stdout;
try {
  ({ stdout } = await execFileAsync("npm", ["audit", "--omit=dev", "--json"], { maxBuffer: 10 * 1024 * 1024 }));
} catch (error) {
  stdout = error.stdout;
}

const report = JSON.parse(stdout);
const unexpected = [];
for (const vulnerability of Object.values(report.vulnerabilities || {})) {
  for (const advisory of vulnerability.via || []) {
    if (typeof advisory === "string") continue;
    if (!allowedAdvisories.has(advisory.source)) unexpected.push(`${vulnerability.name}: ${advisory.title}`);
  }
}

if (unexpected.length) {
  console.error(`Unexpected production advisories:\n${unexpected.join("\n")}`);
  process.exit(1);
}

console.log("Production dependency audit passed; the only allowlisted advisory affects React Router RSC server actions, which this Vite SPA does not use.");
