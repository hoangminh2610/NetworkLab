(function () {
  "use strict";

  const StaticRouting = {
    findRoute(net, sourceId, mode = "has_backup") {
      const activeLinks = net.links.filter(l => l.up);
      const isMain1Up = activeLinks.some(l => l.id === "link_main_1");
      const isMain2Up = activeLinks.some(l => l.id === "link_main_2");

      if (isMain1Up && isMain2Up) {
        return {
          ok: true,
          path: ["link_main_1", "link_main_2", "link_dc_srv"],
          backup: ["link_bk_1", "link_bk_2"],
          title: "Static Route (Chính)",
          note: "Gói tin đi theo tuyến tĩnh chính qua Bình Dương (AD = 1)."
        };
      }

      if (mode === "no_backup") {
        return {
          ok: false,
          path: [],
          backup: [],
          faults: ["link_main_1"],
          faultNode: sourceId,
          title: "No Route to Host",
          note: "Tuyến chính bị ngắt và không có tuyến dự phòng được cấu hình."
        };
      }

      const isBk1Up = activeLinks.some(l => l.id === "link_bk_1");
      const isBk2Up = activeLinks.some(l => l.id === "link_bk_2");

      if (isBk1Up && isBk2Up) {
        return {
          ok: true,
          path: ["link_bk_1", "link_bk_2", "link_dc_srv"],
          backup: [],
          faults: ["link_main_1"],
          title: "Floating Static Route",
          note: "Tuyến chính ngắt. Tự động chuyển sang tuyến tĩnh dự phòng qua Hà Nội (AD = 10)."
        };
      }

      return {
        ok: false,
        path: [],
        backup: [],
        faults: ["link_main_1", "link_bk_1"],
        faultNode: sourceId,
        title: "Tất cả các tuyến đều mất kết nối",
        note: "Tuyến chính và tuyến dự phòng đều bị ngắt."
      };
    }
  };

  const RIPRouting = {
    findShortestHopPath(net, sourceId, targetId) {
      const activeLinks = net.links.filter(l => l.up);
      const graph = new Map();

      net.devices.forEach(d => graph.set(d.id, []));
      activeLinks.forEach(l => {
        graph.get(l.a.device)?.push({ neighbor: l.b.device, linkId: l.id, latency: l.latency || 10 });
        graph.get(l.b.device)?.push({ neighbor: l.a.device, linkId: l.id, latency: l.latency || 10 });
      });

      const queue = [[sourceId, [], 0]];
      const visited = new Set([sourceId]);

      while (queue.length > 0) {
        const [curr, path, totalLat] = queue.shift();

        if (curr === targetId) {
          return {
            ok: true,
            path,
            hops: path.length,
            totalLatency: totalLat,
            note: `RIP ưu tiên Hop Count: Chọn đường ${path.length} chặng (Độ trễ ${totalLat}ms).`
          };
        }

        for (const edge of (graph.get(curr) || [])) {
          if (!visited.has(edge.neighbor)) {
            visited.add(edge.neighbor);
            queue.push([edge.neighbor, [...path, edge.linkId], totalLat + edge.latency]);
          }
        }
      }

      return { ok: false, path: [], hops: Infinity, totalLatency: 0, note: "RIP: Mất kết nối." };
    }
  };

  globalThis.TV4Static = StaticRouting;
  globalThis.TV4RIP = RIPRouting;
})();