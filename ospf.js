(function () {
  "use strict";

  const OSPFEngine = {
    computeDijkstra(net, startNodeId, destNodeId) {
      const distances = new Map();
      const previous = new Map();
      const unvisited = new Set();
      const linkUsed = new Map();

      net.devices.forEach(dev => {
        distances.set(dev.id, Infinity);
        unvisited.add(dev.id);
      });
      distances.set(startNodeId, 0);

      while (unvisited.size > 0) {
        let current = null;
        for (const node of unvisited) {
          if (current === null || distances.get(node) < distances.get(current)) {
            current = node;
          }
        }

        if (current === null || distances.get(current) === Infinity) break;
        if (current === destNodeId) break;

        unvisited.delete(current);

        const connectedLinks = net.links.filter(l => l.up && (l.a.device === current || l.b.device === current));

        for (const link of connectedLinks) {
          const neighbor = link.a.device === current ? link.b.device : link.a.device;
          if (!unvisited.has(neighbor)) continue;

          const alt = distances.get(current) + link.cost;
          if (alt < distances.get(neighbor)) {
            distances.set(neighbor, alt);
            previous.set(neighbor, current);
            linkUsed.set(neighbor, link.id);
          }
        }
      }

      const pathLinks = [];
      let curr = destNodeId;
      while (previous.has(curr)) {
        pathLinks.unshift(linkUsed.get(curr));
        curr = previous.get(curr);
      }

      const totalCost = distances.get(destNodeId);
      const isSuccess = totalCost !== Infinity;

      return {
        ok: isSuccess,
        path: pathLinks,
        totalCost: isSuccess ? totalCost : 0,
        hops: pathLinks.length,
        note: isSuccess 
          ? `OSPF (Dijkstra) hội tụ: Tổng Cost = ${totalCost}.`
          : "OSPF: Không tìm thấy tuyến định tuyến."
      };
    }
  };

  globalThis.TV4OSPF = OSPFEngine;
})();