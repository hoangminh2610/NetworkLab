(function () {
  "use strict";

  const esc = value => String(value ?? "—").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);

  function renderPacketInspector(step, index, total) {
    const box = document.getElementById("packet-inspector");
    const counter = document.getElementById("step-counter");
    if (!box) return;

    if (!step) {
      if (counter) {
        counter.textContent = "Chưa chạy";
        counter.className = "state yes";
      }
      box.innerHTML =
        '<div class="cache-head">' +
          '<h3>Packet Inspector · Chi tiết gói tin tại từng chặng</h3>' +
        '</div>' +
        '<p class="muted">Chọn kịch bản và bấm “Chạy ping” hoặc “Kiểm tra ARP”. Bạn có thể bấm vào từng bước hoặc dùng nút Tiến / Lùi / Chạy tự động để quan sát IP nguồn/đích giữ nguyên trong khi MAC nguồn/đích và TTL thay đổi qua router.</p>';
      return;
    }

    const p = step.packet || {};
    const stateClass = p.state === "ERROR" ? "no" : p.state === "SUSPICIOUS" ? "warn" : "yes";
    const stateLabel = p.state === "ERROR" ? "THẤT BẠI / LỖI" : p.state === "SUSPICIOUS" ? "NGHI VẤN" : "THÀNH CÔNG";

    if (counter) {
      counter.textContent = "Bước " + (index + 1) + " / " + total;
      counter.className = "state " + stateClass;
    }

    box.innerHTML =
      '<div class="cache-head">' +
        '<h3>Packet Inspector · Bước ' + (index + 1) + '/' + total + ': ' + esc(step.title) + '</h3>' +
        '<span class="state ' + stateClass + '">' + esc(stateLabel) + '</span>' +
      '</div>' +
      '<p class="muted">' + esc(step.note) + '</p>' +
      '<div class="inspector-grid">' +
        '<div class="inspector-card">' +
          '<h4>Lớp 3 · IP Header &amp; TTL</h4>' +
          '<div><b>IP nguồn:</b> ' + esc(p.srcIp) + '</div>' +
          '<div><b>IP đích:</b> ' + esc(p.dstIp) + '</div>' +
          '<div><b>TTL (Trước → Sau):</b> <strong>' + esc(p.ttl) + '</strong></div>' +
        '</div>' +
        '<div class="inspector-card">' +
          '<h4>Lớp 2 · Ethernet Frame</h4>' +
          '<div><b>MAC nguồn:</b> ' + esc(p.srcMac) + '</div>' +
          '<div><b>MAC đích:</b> ' + esc(p.dstMac) + '</div>' +
          '<div><b>Giao thức / Khung:</b> ' + esc(p.protocol) + '</div>' +
        '</div>' +
        '<div class="inspector-card">' +
          '<h4>Thiết bị &amp; Quyết định chuyển tiếp</h4>' +
          '<div><b>Đang xử lý:</b> ' + esc(p.deviceIface) + '</div>' +
          '<div><b>Prefix khớp / Next hop:</b> ' + esc(p.prefixNextHop) + '</div>' +
          '<div><b>Interface đầu ra:</b> ' + esc(p.outIface) + '</div>' +
        '</div>' +
      '</div>' +
      (p.hypothesis ? '<div class="' + (p.state === "SUSPICIOUS" ? "warn-note" : "error-note") + '" style="margin-top:10px;"><strong>Chẩn đoán / Giả thuyết kỹ thuật:</strong> ' + esc(p.hypothesis) + '</div>' : '');
  }

  globalThis.TV2PacketInspector = Object.freeze({
    render: renderPacketInspector
  });
})();