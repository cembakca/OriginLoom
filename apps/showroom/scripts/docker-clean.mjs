import { downDevStack, downLoadTestStack, removeLocalRedis } from "./docker-compose.mjs";

const args = new Set(process.argv.slice(2));

function usage() {
  console.error(`Usage: node scripts/docker-clean.mjs [options]

Options (default: --all without --volumes):
  --redis       Remove only the local Redis container (dev overlay)
  --stack       Remove base compose stack (app + mock-gw)
  --loadtest    Remove load-test compose project
  --all         --stack + --redis + --loadtest (default when no target flag)
  --volumes     Also remove named/anonymous volumes on \`down\`
  -h, --help    Show this help
`);
}

if (args.has("-h") || args.has("--help")) {
  usage();
  process.exit(0);
}

const volumes = args.has("--volumes");
const redisOnly = args.has("--redis");
const stack = args.has("--stack");
const loadtest = args.has("--loadtest");
const all = args.has("--all") || (!redisOnly && !stack && !loadtest);

async function main() {
  if (redisOnly) {
    console.log("Removing local Redis container…");
    await removeLocalRedis();
    console.log("Docker cleanup complete.");
    return;
  }

  if (stack) {
    console.log("Tearing down dev compose stack (L1-only)…");
    await downDevStack({ redis: false, volumes, removeOrphans: true });
  }

  if (all) {
    console.log("Tearing down dev compose stack (redis overlay)…");
    await downDevStack({ redis: true, volumes, removeOrphans: true });
  }

  if (loadtest || all) {
    console.log("Tearing down load-test compose project…");
    await downLoadTestStack({ volumes });
  }

  console.log("Docker cleanup complete.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
