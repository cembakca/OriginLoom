import { runAutocannon } from "./autocannon-run.mjs";
import { sleep } from "./util.mjs";

/**
 * @param {object} input
 * @param {string} input.appUrl
 * @param {import("../stress-scenarios.mjs").StressScenario} input.scenario
 */
export async function runStressScenario({ appUrl, scenario }) {
  /** @type {object[]} */
  const results = [];

  if (scenario.phases?.length) {
    for (const phase of scenario.phases) {
      const phaseScenario = {
        ...scenario,
        id: `${scenario.id}-${phase.suffix ?? phase.connections}`,
        path: phase.path ?? scenario.path,
        connections: phase.connections,
        durationSec: phase.durationSec,
      };
      results.push(
        await runSingleScenario({
          appUrl,
          scenario: phaseScenario,
          urls: resolveUrls(appUrl, phaseScenario),
        }),
      );
      await sleep(5_000);
    }
    return results;
  }

  results.push(
    await runSingleScenario({
      appUrl,
      scenario,
      urls: resolveUrls(appUrl, scenario),
    }),
  );
  return results;
}

/**
 * @param {object} input
 * @param {string} input.appUrl
 * @param {import("../stress-scenarios.mjs").StressScenario} input.scenario
 * @param {string[]} [input.urls]
 */
async function runSingleScenario({ appUrl, scenario, urls }) {
  const targetUrl = `${appUrl}${scenario.path}`;
  return runAutocannon({
    url: targetUrl,
    scenario,
    urls,
    workers: scenario.workers,
  });
}

/**
 * @param {string} appUrl
 * @param {import("../stress-scenarios.mjs").StressScenario} scenario
 */
function resolveUrls(appUrl, scenario) {
  if (scenario.urlFactory) return scenario.urlFactory(appUrl);
  return undefined;
}
