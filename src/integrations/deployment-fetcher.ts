import { Deployment } from "../types";

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

export async function getRecentDeployments(service: string, hours: number = 24): Promise<Deployment[]> {
  await new Promise(r => setTimeout(r, 150 + Math.random() * 250));

  const now = new Date();
  const deployments: Deployment[] = [];

  // 3 normalna deploymenta pre incidenta
  for (let i = 3; i > 0; i--) {
    deployments.push({
      version: `v1.${8 + (3 - i)}.${Math.floor(Math.random() * 5)}`,
      timestamp: new Date(now.getTime() - (hours - i * 6) * 3_600_000).toISOString(),
      author: AUTHORS[Math.floor(Math.random() * AUTHORS.length)],
      commit_message: NORMAL_COMMITS[Math.floor(Math.random() * NORMAL_COMMITS.length)],
      status: "success",
    });
  }

  // Sumnjivi deployment ~15min pre incidenta
  deployments.push({
    version: `v1.12.0`,
    timestamp: new Date(now.getTime() - 15 * 60_000).toISOString(),
    author: AUTHORS[Math.floor(Math.random() * AUTHORS.length)],
    commit_message: SUSPICIOUS_COMMITS[Math.floor(Math.random() * SUSPICIOUS_COMMITS.length)],
    status: "success",
  });

  // Sortiramo od najstarijeg ka najnovijem
  return deployments.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}
