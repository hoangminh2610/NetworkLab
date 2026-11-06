(function () {
  "use strict";

  const ipv4 = ip => {
    if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(ip || "")) return null;
    const bytes = ip.split(".").map(Number);
    return bytes.every(n => n < 256) ? bytes.reduce((n, b) => n * 256 + b, 0) : null;
  };
  const ipText = n => [24, 16, 8, 0].map(shift => (n >>> shift) & 255).join(".");
  const mask = prefix => prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const inSubnet = (address, iface) => {
    const a = ipv4(address), b = ipv4(iface?.ip);
    return a !== null && b !== null && (a & mask(iface.prefix)) === (b & mask(iface.prefix));
  };
  const subnet = iface => ipv4(iface?.ip) === null ? "—" :
    ipText((ipv4(iface.ip) & mask(iface.prefix)) >>> 0) + "/" + iface.prefix;

  function cacheKey(dev, iface) {
    return dev.id + "/" + (iface ? iface.id : dev.ports[0]?.id);
  }

  function getCache(net, dev, iface) {
    const k = cacheKey(dev, iface);
    net.cache[k] ??= Object.create(null);
    return net.cache[k];
  }

  function clearCache(net, dev, iface) {
    if (!dev) return;
    delete net.cache[cacheKey(dev, iface)];
  }

  /**
   * Kiểm tra cấu hình Default Gateway trên máy nguồn (Phục vụ Case 1 & Case 4)
   */
  function checkGatewayConfig(sourceNode, sourcePort) {
    const gw = (sourceNode.gateway || "").trim();
    if (!gw) {
      return {
        ok: false,
        errorType: "EMPTY_GATEWAY",
        title: "Lỗi cấu hình máy trạm: Thiếu Default Gateway",
        note: "Default gateway đang để trống nên máy trạm không biết chuyển tiếp gói tin ra ngoài subnet " + subnet(sourcePort) + " qua thiết bị nào."
      };
    }
    if (!inSubnet(gw, sourcePort)) {
      return {
        ok: false,
        errorType: "GW_OUT_OF_SUBNET",
        title: "Lỗi cấu hình máy trạm: Gateway khác subnet",
        note: "Default gateway " + gw + " không thuộc cùng subnet " + subnet(sourcePort) + " của máy nguồn. Máy trạm từ chối đóng gói ngay trước bước ARP."
      };
    }
    return {
      ok: true,
      gatewayIp: gw,
      note: "Default gateway " + gw + " hợp lệ (cùng subnet " + subnet(sourcePort) + ")."
    };
  }

  /**
   * Kiểm tra ánh xạ MAC của Gateway có dấu hiệu bất thường hay không (Phục vụ Case 2)
   */
  function evaluateGatewayArp(net, targetIp, resolvedMac) {
    const anomaly = net.arpAnomaly;
    if (anomaly && anomaly.active && targetIp === anomaly.gatewayIp && resolvedMac === anomaly.suspiciousMac) {
      return {
        isSuspicious: true,
        expectedMac: anomaly.expectedMac,
        suspiciousMac: anomaly.suspiciousMac,
        suspectDeviceId: anomaly.suspectDeviceId,
        hypothesis: "NGHI VẤN (Suspicious): IP gateway " + targetIp + " đang ánh xạ sang MAC " + resolvedMac +
          " khác với MAC quản trị ghi nhận (" + anomaly.expectedMac + "). Không được kết luận có tấn công ARP spoofing chỉ từ một khác biệt MAC; cần xác minh: (1) quản trị viên có vừa thay thế thiết bị/cổng router hợp lệ không, (2) bảng ARP cache lưu thông tin cũ, hay (3) có thiết bị phát ARP giả mạo trong LAN."
      };
    }
    return {
      isSuspicious: false,
      expectedMac: anomaly?.expectedMac || resolvedMac,
      hypothesis: ""
    };
  }

  /**
   * Định dạng bảng hiển thị ARP cache có kèm cột Trạng thái cho Case 2
   */
  function formatCacheEntries(net, sourceNode) {
    if (!sourceNode || !sourceNode.ports[0]) return [];
    const raw = net.cache[cacheKey(sourceNode, sourceNode.ports[0])] ?? {};
    return Object.entries(raw).map(([ip, mac]) => {
      const check = evaluateGatewayArp(net, ip, mac);
      return {
        ip,
        mac,
        status: check.isSuspicious ? "Nghi vấn (Khác MAC quản trị)" : "Hợp lệ",
        isSuspicious: check.isSuspicious
      };
    });
  }

  globalThis.TV2Arp = Object.freeze({
    ipv4,
    ipText,
    mask,
    inSubnet,
    subnet,
    getCache,
    clearCache,
    checkGatewayConfig,
    evaluateGatewayArp,
    formatCacheEntries
  });
})();