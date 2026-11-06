(function () {
  "use strict";

  const BaselineComparison = {
    baselineState: null,

    captureBaseline(net, sourceId, targetId, protocol = "OSPF") {
      let res;
      if (protocol === "OSPF") res = globalThis.TV4OSPF.computeDijkstra(net, sourceId, targetId);
      else if (protocol === "RIP") res = globalThis.TV4RIP.findShortestHopPath(net, sourceId, targetId);
      else res = globalThis.TV4Static.findRoute(net, sourceId);

      this.baselineState = {
        path: res.path || [],
        cost: res.totalCost || 0,
        hops: res.hops || (res.path ? res.path.length : 0),
        status: res.ok !== false ? "ACTIVE" : "FAILED"
      };
      return this.baselineState;
    },

    compareWithFailure(net, sourceId, targetId, protocol = "OSPF") {
      if (!this.baselineState) this.captureBaseline(net, sourceId, targetId, protocol);

      let currentRes;
      if (protocol === "OSPF") currentRes = globalThis.TV4OSPF.computeDijkstra(net, sourceId, targetId);
      else if (protocol === "RIP") currentRes = globalThis.TV4RIP.findShortestHopPath(net, sourceId, targetId);
      else currentRes = globalThis.TV4Static.findRoute(net, sourceId);

      const currentState = {
        path: currentRes.path || [],
        cost: currentRes.totalCost || 0,
        hops: currentRes.hops || (currentRes.path ? currentRes.path.length : 0),
        status: currentRes.ok !== false ? "ACTIVE" : "FAILED"
      };

      if (globalThis.TV1TopologyUI && typeof globalThis.TV1TopologyUI.highlight === "function") {
        globalThis.TV1TopologyUI.highlight({
          path: currentState.path,
          backup: this.baselineState.path.filter(id => !currentState.path.includes(id)),
          faults: currentRes.faults || []
        });
      }

      this.renderUI(this.baselineState, currentState, protocol);
      return { baseline: this.baselineState, current: currentState };
    },

    renderUI(base, curr, protocol) {
      const container = document.getElementById("baseline-compare-container");
      if (!container) return;

      container.innerHTML = `
        <div class="panel" style="margin-top:14px;">
          <div class="panel-head">
            <h3>⚖️ So sánh Baseline vs Failure (${protocol})</h3>
          </div>
          <table>
            <thead>
              <tr>
                <th>Thông số</th>
                <th>Ban đầu (Baseline)</th>
                <th>Sau sự cố (Failure)</th>
                <th>Kết luận</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><b>Đường đi</b></td>
                <td><code>${base.path.join(" ➔ ") || "—"}</code></td>
                <td><code>${curr.path.join(" ➔ ") || "Mất kết nối"}</code></td>
                <td>${base.path.join() === curr.path.join() ? "Giữ nguyên" : "<b style='color:var(--rose);'>Đã thay đổi tuyến!</b>"}</td>
              </tr>
              <tr>
                <td><b>Tổng Metric / Cost</b></td>
                <td>${base.cost}</td>
                <td>${curr.cost}</td>
                <td>${curr.cost > base.cost ? `Tăng +${curr.cost - base.cost}` : "Không đổi"}</td>
              </tr>
              <tr>
                <td><b>Số chặng (Hop Count)</b></td>
                <td>${base.hops}</td>
                <td>${curr.hops}</td>
                <td>${curr.hops > base.hops ? `Tăng +${curr.hops - base.hops}` : "Không đổi"}</td>
              </tr>
              <tr>
                <td><b>Trạng thái kết nối</b></td>
                <td><span class="state yes">HOẠT ĐỘNG</span></td>
                <td>${curr.status === "ACTIVE" ? '<span class="state yes">HOẠT ĐỘNG</span>' : '<span class="state no">MẤT KẾT NỐI</span>'}</td>
                <td>${curr.status === "ACTIVE" ? "Kết nối bình thường" : "<b style='color:var(--rose);'>Gián đoạn mạng</b>"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
    }
  };

  globalThis.TV4Baseline = BaselineComparison;
})();