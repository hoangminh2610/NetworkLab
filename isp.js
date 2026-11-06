(function () {
  "use strict";

  const esc = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);

  function evaluateCase11(net) {
    const primaryIds = ["lan-hq", "wan-ispa-1", "wan-ispa-2", "lan-intl"];
    const backupIds = ["lan-hq", "wan-ispb-1", "wan-ispb-2", "lan-intl"];

    const getLinks = ids => ids.map(id => net.links.find(l => l.id === id)).filter(Boolean);
    const primaryLinks = getLinks(primaryIds);
    const backupLinks = getLinks(backupIds);

    // Một tuyến chỉ thông khi đủ 4 chặng và tất cả các chặng đều đang up
    const isRouteUp = links => links.length === 4 && links.every(l => l.up === true);
    
    const calcMetrics = links => ({
      cost: links.reduce((sum, l) => sum + (Number(l.cost) || 10), 0),
      latency: links.reduce((sum, l) => sum + (Number(l.latency) || 10), 0),
      bandwidth: Math.min(...links.map(l => Number(l.bandwidth) || 1000))
    });

    const baseline = calcMetrics(primaryLinks);
    const backupMetrics = calcMetrics(backupLinks);
    const primaryUp = isRouteUp(primaryLinks);
    const backupUp = isRouteUp(backupLinks);
    const faultLinks = net.links.filter(l => l.up === false).map(l => l.id);

    let activeRoute = null;
    let activeName = "Mất kết nối hoàn toàn";
    let activeMetrics = { cost: "—", latency: "—", bandwidth: 0 };
    let status = "FAILED";
    let explanation = "Cả tuyến chính (ISP-A) và tuyến dự phòng (ISP-B) đều đang ngắt. Gói tin bị huỷ tại router biên.";

    if (primaryUp && (!backupUp || baseline.cost <= backupMetrics.cost)) {
      activeRoute = primaryIds;
      activeName = "Tuyến chính qua ISP-A (Cáp quang biển)";
      activeMetrics = baseline;
      status = "SUCCESS";
      explanation = "Lưu lượng đi qua ISP-A với tổng cost thấp nhất (" + baseline.cost + "), độ trễ thấp (" + baseline.latency + " ms) và dung lượng " + (baseline.bandwidth / 1000) + " Gbps.";
    } else if (backupUp) {
      activeRoute = backupIds;
      activeName = "Tuyến dự phòng qua ISP-B (Đất liền)";
      activeMetrics = backupMetrics;
      status = "SUSPICIOUS";
      explanation = "Tuyến dự phòng ISP-B giúp duy trì kết nối tới dịch vụ quốc tế nhưng KHÔNG bảo đảm giữ nguyên hiệu năng: độ trễ tăng từ " +
        baseline.latency + " ms lên " + backupMetrics.latency + " ms và băng thông giảm từ 10 Gbps xuống 1 Gbps.";
    }

    return {
      primaryIds, backupIds, faultLinks,
      primaryUp, backupUp,
      baseline, backupMetrics,
      activeRoute, activeName, activeMetrics, status, explanation
    };
  }

  // Đường đi chỉ được tô sáng sau khi người dùng bấm "Mô phỏng & Tô sáng tuyến".
  // Chuyển/đặt lại kịch bản sẽ tắt cờ này nên Case 11 mở ra là sơ đồ sạch như các case khác.
  let armed = false;

  function applySimulation(triggerLog = true) {
    const net = globalThis.TV1TopologyUI?.getNetwork();
    if (!net || net.id !== "case11") return;

    const res = evaluateCase11(net);
    const highlightObj = {
      path: res.activeRoute ?? [],
      backup: res.activeRoute === res.primaryIds && res.backupUp ? res.backupIds : [],
      faults: res.faultLinks,
      faultNode: res.activeRoute ? "" : "r-ent"
    };

    // Tô sáng trên sơ đồ SVG của TV1
    globalThis.TV1TopologyUI.highlight(highlightObj);

    // Ghi nhận vào bảng nhật ký sự cố Timeline
    if (triggerLog) {
      globalThis.TV5EventTimeline?.record({
        type: "ROUTING",
        status: res.status,
        device: "r-ent",
        description: res.activeRoute
          ? "Chuyển tiếp gói tin qua [" + res.activeName + "] · Cost=" + res.activeMetrics.cost + ", Độ trễ=" + res.activeMetrics.latency + "ms."
          : "Mất toàn bộ kết nối ra Internet quốc tế.",
        hypothesis: res.explanation,
        highlight: highlightObj
      });
    }
  }

  function renderCase11Panel() {
    const net = globalThis.TV1TopologyUI?.getNetwork();
    let panel = document.getElementById("tv5-isp-panel");
    if (!net || net.id !== "case11") {
      if (panel) panel.hidden = true;
      return;
    }
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "tv5-isp-panel";
      panel.className = "panel checks";
      const main = document.querySelector("main.wrap");
      main.insertBefore(panel, document.getElementById("tv5-timeline-panel") || main.querySelector("footer"));
    }
    panel.hidden = false;

    const info = evaluateCase11(net);
    const ispaLink = net.links.find(l => l.id === "wan-ispa-1");
    const ispaUp = ispaLink ? ispaLink.up : true;

    panel.innerHTML =
      '<div class="panel-head">' +
        '<div><span class="eyebrow">TV5 · CASE 11 · MULTI-ISP &amp; PERFORMANCE</span><h2>So sánh Baseline vs. Failure (Đường truyền Quốc tế)</h2></div>' +
        '<div class="actions">' +
          '<button type="button" id="tv5-toggle-ispa" class="small ' + (ispaUp ? "secondary" : "primary") + '">' +
            (ispaUp ? "Giả lập ngắt cáp biển ISP-A" : "Khôi phục cáp biển ISP-A") +
          '</button>' +
          '<button type="button" id="tv5-isp-run" class="primary">Mô phỏng &amp; Tô sáng tuyến</button>' +
        '</div>' +
      '</div>' +
      '<p class="case-desc">' + esc(info.explanation) + '</p>' +
      '<table><thead><tr>' +
        '<th>Tiêu chí so sánh</th><th>Baseline (Tuyến chính ISP-A)</th><th>Sau sự cố / Dự phòng (ISP-B)</th><th>Trạng thái đang chọn</th>' +
      '</tr></thead><tbody>' +
        '<tr><td><strong>Đường đi (Path)</strong></td><td>PC → R-Ent → ISP-A → IXP → Server</td><td>PC → R-Ent → ISP-B → IXP → Server</td><td><strong>' + esc(info.activeName) + '</strong></td></tr>' +
        '<tr><td><strong>Tổng Cost định tuyến</strong></td><td>' + info.baseline.cost + '</td><td>' + info.backupMetrics.cost + '</td><td><strong>' + esc(info.activeMetrics.cost) + '</strong></td></tr>' +
        '<tr><td><strong>Độ trễ minh họa (Latency)</strong></td><td>' + info.baseline.latency + ' ms</td><td>' + info.backupMetrics.latency + ' ms</td><td><strong style="color:' + (info.activeMetrics.latency > 100 ? '#a62638' : '#087369') + '">' + esc(info.activeMetrics.latency) + ' ms</strong></td></tr>' +
        '<tr><td><strong>Dung lượng (Bandwidth)</strong></td><td>10,000 Mbps (10 Gbps)</td><td>1,000 Mbps (1 Gbps)</td><td><strong>' + (info.activeMetrics.bandwidth ? info.activeMetrics.bandwidth + ' Mbps' : '0 Mbps') + '</strong></td></tr>' +
      '</tbody></table>';

    // Nút kích hoạt nhanh mô phỏng đứt cáp
    panel.querySelector("#tv5-toggle-ispa")?.addEventListener("click", () => {
      // Tìm element link wan-ispa-1 trên SVG của TV1 để kích hoạt thao tác toggle chính thức
      const wire = document.querySelector('[data-link="wan-ispa-1"]');
      if (wire) {
        wire.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        const toggleBtn = document.querySelector('[data-action="toggle-link"]');
        if (toggleBtn) {
          toggleBtn.click();
          return;
        }
      }
    });

    panel.querySelector("#tv5-isp-run")?.addEventListener("click", () => {
      armed = true;
      applySimulation(true);
    });
  }

  // Khi TV1 phát sự kiện thay đổi topology (ngắt/khôi phục liên kết), tự render và cập nhật luôn đường đi
  document.addEventListener("tv1:scenarioload", () => { armed = false; });
  document.addEventListener("tv1:topologychange", () => {
    renderCase11Panel();
    if (armed) applySimulation(false); // Chỉ cập nhật tô sáng khi người dùng đã chạy mô phỏng
  });

  globalThis.TV5ISP = Object.freeze({ evaluateCase11, renderCase11Panel, applySimulation });
})();