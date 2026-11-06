(function () {
  "use strict";
  const esc = value => String(value ?? "—").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  function ensure() {
    let panel = document.getElementById("group-module-panel");
    if (panel) return panel;
    panel = document.createElement("section"); panel.id = "group-module-panel"; panel.className = "panel checks";
    const main = document.querySelector("main.wrap"); main.insertBefore(panel, main.querySelector("footer")); return panel;
  }
  function render() {
    const net = globalThis.TV1TopologyUI?.getNetwork(); if (!net) return;
    const panel = ensure(), targetId = net.target.split("/")[0]; let body = "";
    if (net.id === "case2") {
      const anomaly = globalThis.TV2Arp?.evaluateGatewayArp(net, net.arpAnomaly?.gatewayIp, net.arpAnomaly?.suspiciousMac);
      body = '<p class="case-desc"><span class="state no">CẦN XÁC MINH</span> ' + esc(anomaly?.hypothesis || "Theo dõi ARP gateway.") + '</p>';
    } else if (["case5","case6","case7"].includes(net.id)) {
      const table = globalThis.TV3RouteData?.routeData?.case5?.router_main || [];
      const hit = globalThis.TV3RouteLookup?.longestPrefixMatch("192.168.1.25", table);
      body = '<p class="case-desc">Route Lookup đang hoạt động. Longest Prefix Match cho 192.168.1.25: <strong>' + esc(hit?.prefix || "Tuyến trực tiếp") + '</strong> → ' + esc(hit?.nextHop || "Direct") + '.</p>';
    } else if (net.id === "case8") {
      const r = globalThis.TV4Static?.findRoute(net, net.source, "has_backup");
      body = '<p class="case-desc"><strong>' + esc(r?.title) + '</strong> — ' + esc(r?.note) + '</p><div id="baseline-compare-container"></div>';
    } else if (net.id === "case9") {
      const r = globalThis.TV4RIP?.findShortestHopPath(net, net.source, targetId);
      body = '<p class="case-desc"><strong>RIP:</strong> ' + esc(r?.note) + '</p>';
    } else if (net.id === "case10") {
      const r = globalThis.TV4OSPF?.computeDijkstra(net, net.source, targetId);
      body = '<p class="case-desc"><strong>OSPF / Dijkstra:</strong> ' + esc(r?.note) + '</p><div id="baseline-compare-container"></div>';
    } else {
      body = '<p class="case-desc">Bộ công cụ Nhóm 4 đang sẵn sàng: ARP, Packet Inspector, Static Routing, RIP, OSPF, BGP và Event Timeline.</p>';
    }
    panel.innerHTML = '<div class="panel-head"><div><p class="eyebrow">NHÓM 4 · PHÂN TÍCH ĐỊNH TUYẾN</p><h2>Công cụ theo kịch bản</h2></div></div>' + body;
    if (net.id === "case10") globalThis.TV4Baseline?.captureBaseline(net, net.source, targetId, "OSPF");
    if (net.id === "case8") globalThis.TV4Baseline?.captureBaseline(net, net.source, targetId, "STATIC");
  }
  document.addEventListener("tv1:topologychange", render);
  document.addEventListener("DOMContentLoaded", render);
})();
