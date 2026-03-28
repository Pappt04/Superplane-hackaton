import https from "https";
import { Deployment } from "../types";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_ORG = process.env.GITHUB_ORG || "Pappt04";
const GITHUB_REPO = process.env.GITHUB_REPO || "Superplane-hackaton";

const AUTHORS = ["marko.nikolic", "ana.petrovic", "stefan.jovic", "lena.kovac", "rade.milic"];

const SUSPICIOUS_COMMITS = [
  "feat: upgrade payment library from v2.0.1 to v2.1.3 - new async processing",
  "refactor: increase DB connection pool size from 20 to 50",
  "perf: disable query cache for real-time transactions",
  "fix: remove memory limit cap for payment processor (was causing OOM)",
  "feat: migrate from Redis 6 to Redis 7 - breaking change in AUTH",
];

const NORMAL_COMMITS = [
  "fix: update copyright headers",
  "docs: update API documentation",
  "chore: bump minor dependency versions",
  "test: add unit tests for edge cases",
  "style: fix linting warnings",
];

function fetchGitHubCommits(org: string, repo: string, since: string): Promise<Deployment[]> {
  return new Promise((resolve) => {
    const path = `/repos/${org}/${repo}/commits?per_page=10&since=${since}`;
    const headers: Record<string, string> = {
      "User-Agent": "superplane-agent/1.0",
      "Accept": "application/vnd.github.v3+json",
    };
    if (GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
    }

    const req = https.request(
      { hostname: "api.github.com", path, method: "GET", headers },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            console.warn(`[GitHub API] Status ${res.statusCode} — falling back to simulated data`);
            resolve([]);
            return;
          }
          try {
            const commits = JSON.parse(data) as Array<{
              sha: string;
              commit: { message: string; author: { name: string; date: string } };
            }>;
            const deployments: Deployment[] = commits.map((c, i) => ({
              version: `${c.sha.slice(0, 7)}`,
              timestamp: c.commit.author.date,
              author: c.commit.author.name,
              commit_message: c.commit.message.split("\n")[0].slice(0, 120),
              status: "success",
            }));
            resolve(deployments);
          } catch {
            console.warn("[GitHub API] Parse error — falling back to simulated data");
            resolve([]);
          }
        });
      }
    );
    req.on("error", (e) => {
      console.warn(`[GitHub API] Request error: ${e.message} — falling back to simulated data`);
      resolve([]);
    });
    req.end();
  });
}

export async function getRecentDeployments(service: string, hours: number = 24): Promise<Deployment[]> {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  // Try real GitHub commits first
  const real = await fetchGitHubCommits(GITHUB_ORG, GITHUB_REPO, since);
  if (real.length > 0) {
    console.log(`[GitHub API] Fetched ${real.length} real commits for ${service}`);
    return real.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  // Fallback: simulated deployment history (realistic for demo)
  console.log(`[GitHub API] Using simulated deployment history for ${service}`);
  await new Promise(r => setTimeout(r, 150 + Math.random() * 250));

  const now = new Date();
  const deployments: Deployment[] = [];

  for (let i = 3; i > 0; i--) {
    deployments.push({
      version: `v1.${8 + (3 - i)}.${Math.floor(Math.random() * 5)}`,
      timestamp: new Date(now.getTime() - (hours - i * 6) * 3_600_000).toISOString(),
      author: AUTHORS[Math.floor(Math.random() * AUTHORS.length)],
      commit_message: NORMAL_COMMITS[Math.floor(Math.random() * NORMAL_COMMITS.length)],
      status: "success",
    });
  }

  deployments.push({
    version: `v1.12.0`,
    timestamp: new Date(now.getTime() - 15 * 60_000).toISOString(),
    author: AUTHORS[Math.floor(Math.random() * AUTHORS.length)],
    commit_message: SUSPICIOUS_COMMITS[Math.floor(Math.random() * SUSPICIOUS_COMMITS.length)],
    status: "success",
  });

  return deployments.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}
