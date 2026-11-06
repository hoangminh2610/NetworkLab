(function () {
  "use strict";
  const scenarios = globalThis.TV1TopologyData?.scenarios;
  if (Array.isArray(scenarios)) scenarios.sort((a, b) => Number(a.number) - Number(b.number));
})();
