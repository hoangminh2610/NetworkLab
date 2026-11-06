(function () {
  "use strict";

  const events = [];
  let seq = 1;
  let filterDevice = "ALL";
  let filterType = "ALL";
  let filterStatus = "ALL";
  let activeEventId = "";

  const esc = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);

  const STATUS_META = {
    SUCCESS: { label: "Thành công", css: "yes" },
    SUSPICIOUS: { label: "Nghi vấn", css: "no" },
    FAILED: { label: "Thất bại", css: "no" }
  };

  function formatTime(stepIndex) {
    const ms = (stepIndex * 125) % 1000;
    const sec = Math.floor((stepIndex * 125) / 1000);
    return "00:" + String(sec).padStart(2, "0") + "." + String(ms).padStart(3, "0");
  }

  /**
   * Ghi nhận 1 sự kiện chuẩn hóa vào Timeline
   * @param {Object} item
   * @param {string} item.type - "ARP" | "ROUTING" | "LINK" | "BGP" | "ERROR"
   * @param {string} item.status - "SUCCESS" | "SUSPICIOUS" | "FAILED"
   * @param {string} item.device - ID hoặc tên thiết bị chính
   * @param {string} item.description - Mô tả kỹ thuật
   * @param {string} item.hypothesis - Nguyên nhân hoặc giả thuyết (bắt buộc ghi rõ nghi vấn nếu chưa đủ bằng chứng)
   * @param {Object} item.highlight - { path: [], backup: [], faults: [], faultNode: "" } chuẩn TV1TopologyUI
   */
  function record(item) {
    const entry = {
      id: "evt-" + seq,
      timestamp: item.timestamp || formatTime(seq),
      type: item.type || "ROUTING",
      status: STATUS_META[item.status] ? item.status : "SUCCESS",
      device: item.device || "Hệ thống",
      description: item.description || "",
      hypothesis: item.hypothesis || "Hoạt động theo cấu hình chuẩn.",
      highlight: {
        path: item.highlight?.path ?? [],
        backup: item.highlight?.backup ?? [],
        faults: item.highlight?.faults ?? [],
        faultNode: item.highlight?.faultNode ?? ""
      }
    };
    seq += 1;
    events.push(entry);
    render();
    return entry;
  }

  function clear() {
    events.length = 0;
    seq = 1;
    activeEventId = "";
    render();
  }

  function ensureContainer() {
    let host = document.getElementById("tv5-timeline-panel");
    if (host) return host;
    const main = document.querySelector("main.wrap");
    if (!main) return null;
    host = document.createElement("section");
    host.id = "tv5-timeline-panel";
    host.className = "panel checks";
    const footer = main.querySelector("footer");
    main.insertBefore(host, footer);
    return host;
  }

  function render() {
    const host = ensureContainer();
    if (!host) return;

    const devices = ["ALL", ...new Set(events.map(e => e.device))];
    const types = ["ALL", "ARP", "ROUTING", "LINK", "BGP", "ERROR"];
    const statuses = ["ALL", "SUCCESS", "SUSPICIOUS", "FAILED"];

    const filtered = events.filter(e =>
      (filterDevice === "ALL" || e.device === filterDevice) &&
      (filterType === "ALL" || e.type === filterType) &&
      (filterStatus === "ALL" || e.status === filterStatus)
    );

    const opt = (val, text, current) =>
      '<option value="' + esc(val) + '"' + (val === current ? " selected" : "") + ">" + esc(text) + "</option>";

    host.innerHTML =
      '<div class="panel-head">' +
        '<div><span class="eyebrow">NETWORK EVENT TIMELINE</span><h2>Bảng điều tra sự cố theo thời gian</h2></div>' +
        '<button type="button" id="tv5-clear-timeline" class="small secondary">Xóa nhật ký</button>' +
      '</div>' +
      '<p class="case-desc">Nhấp vào một sự kiện bất kỳ để làm nổi bật thiết bị, tuyến chính, tuyến dự phòng hoặc điểm lỗi trên sơ đồ.</p>' +
      '<div class="probe-controls" style="margin-bottom:12px">' +
        '<label>Thiết bị<select id="tv5-filter-device">' + devices.map(d => opt(d, d === "ALL" ? "Tất cả thiết bị" : d, filterDevice)).join("") + '</select></label>' +
        '<label>Loại sự kiện<select id="tv5-filter-type">' + types.map(t => opt(t, t === "ALL" ? "Tất cả loại" : t, filterType)).join("") + '</select></label>' +
        '<label>Trạng thái<select id="tv5-filter-status">' +
          statuses.map(s => opt(s, s === "ALL" ? "Tất cả trạng thái" : STATUS_META[s].label, filterStatus)).join("") +
        '</select></label>' +
      '</div>' +
      (filtered.length === 0
        ? '<p class="muted">Chưa có sự kiện nào khớp bộ lọc. Hãy thực hiện thao tác trên sơ đồ hoặc chạy mô phỏng.</p>'
        : '<div style="overflow:auto"><table><thead><tr>' +
            '<th scope="col">Thời điểm</th><th scope="col">Thiết bị</th><th scope="col">Loại</th>' +
            '<th scope="col">Trạng thái</th><th scope="col">Mô tả kỹ thuật</th><th scope="col">Nguyên nhân / Giả thuyết</th>' +
          '</tr></thead><tbody>' +
          filtered.map(e => {
            const meta = STATUS_META[e.status];
            const isSelected = e.id === activeEventId;
            return '<tr data-event-id="' + esc(e.id) + '" style="cursor:pointer;' + (isSelected ? "background:#e1f4ef;" : "") + '">' +
              '<td><code>' + esc(e.timestamp) + '</code></td>' +
              '<td><strong>' + esc(e.device) + '</strong></td>' +
              '<td><span class="pill" style="background:#ecf4f6;color:#142c3d;font-size:.73rem">' + esc(e.type) + '</span></td>' +
              '<td><span class="state ' + meta.css + '">' + esc(meta.label) + '</span></td>' +
              '<td>' + esc(e.description) + '</td>' +
              '<td>' + esc(e.hypothesis) + '</td>' +
            '</tr>';
          }).join("") +
          '</tbody></table></div>');

    host.querySelector("#tv5-filter-device")?.addEventListener("change", ev => { filterDevice = ev.target.value; render(); });
    host.querySelector("#tv5-filter-type")?.addEventListener("change", ev => { filterType = ev.target.value; render(); });
    host.querySelector("#tv5-filter-status")?.addEventListener("change", ev => { filterStatus = ev.target.value; render(); });
    host.querySelector("#tv5-clear-timeline")?.addEventListener("click", () => {
      clear();
      globalThis.TV1TopologyUI?.clearHighlight();
    });

    host.querySelectorAll("tr[data-event-id]").forEach(row => {
      row.addEventListener("click", () => {
        const found = events.find(item => item.id === row.dataset.eventId);
        if (!found) return;
        activeEventId = found.id;
        globalThis.TV1TopologyUI?.highlight(found.highlight);
        render();
      });
    });
  }

  // Tự động đồng bộ khi TV1 thay đổi topology hoặc người dùng bấm Ping/ARP
  document.addEventListener("tv1:topologychange", ev => {
    const net = globalThis.TV1TopologyUI?.getNetwork();
    if (!net) return;
    record({
      type: "LINK",
      status: "SUCCESS",
      device: "Topology",
      description: "Cập nhật trạng thái mạng kịch bản " + net.id.toUpperCase() + ".",
      hypothesis: "Người dùng vừa chuyển kịch bản hoặc thay đổi thông số liên kết/thiết bị."
    });
  });

  globalThis.TV5EventTimeline = Object.freeze({ record, clear, render });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();