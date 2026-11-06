(function () {
  "use strict";
  const port = (id, vlan, ip = "", prefix = 24, mac = "") => ({ id, vlan, ip, prefix, mac });
  const pc = (id, name, x, y, vlan, ip, mac, gateway = "", type = "pc") => ({
    id, name, type, x, y, gateway, ports: [port("eth0", vlan, ip, 24, mac)]
  });
  const link = (id, a, aPort, b, bPort, cost = 10, extra = {}) => ({
    id, a: { device: a, port: aPort }, b: { device: b, port: bPort }, up: true, cost, ...extra
  });

  const scenarios = [
    {
      id: "case11",
      number: "11",
      title: "Truy cập dịch vụ quốc tế chậm khi tuyến gặp sự cố",
      description: "Ngắt liên kết cáp biển ISP-A (wan-ispa-1) hoặc đổi cost trên sơ đồ, sau đó bấm 'Mô phỏng & Tô sáng tuyến' để so sánh Baseline vs. Failure.",
      source: "hq-pc",
      target: "intl-srv/eth0",
      devices: [
        pc("hq-pc", "PC Doanh nghiệp", 95, 200, 10, "10.10.10.10", "02:00:00:11:00:10", "10.10.10.1"),
        {
          id: "r-ent", name: "Router Biên DN", type: "router", x: 265, y: 200, gateway: "", asn: 65001,
          ports: [
            port("g0/0", 10, "10.10.10.1", 24, "02:00:00:11:01:00"),
            port("g0/1", 101, "203.0.113.2", 30, "02:00:00:11:01:01"),
            port("g0/2", 102, "198.51.100.2", 30, "02:00:00:11:01:02")
          ]
        },
        {
          id: "isp-a", name: "ISP-A (Cáp biển)", type: "router", x: 485, y: 115, gateway: "", asn: 65100,
          ports: [
            port("g0/0", 101, "203.0.113.1", 30, "02:00:00:11:02:00"),
            port("g0/1", 103, "203.0.113.5", 30, "02:00:00:11:02:01")
          ]
        },
        {
          id: "isp-b", name: "ISP-B (Dự phòng)", type: "router", x: 485, y: 285, gateway: "", asn: 65200,
          ports: [
            port("g0/0", 102, "198.51.100.1", 30, "02:00:00:11:03:00"),
            port("g0/1", 104, "198.51.100.5", 30, "02:00:00:11:03:01")
          ]
        },
        {
          id: "r-ixp", name: "Gateway Quốc tế", type: "router", x: 685, y: 200, gateway: "", asn: 65300,
          ports: [
            port("g0/0", 103, "203.0.113.6", 30, "02:00:00:11:04:00"),
            port("g0/1", 104, "198.51.100.6", 30, "02:00:00:11:04:01"),
            port("g0/2", 20, "172.16.200.1", 24, "02:00:00:11:04:02")
          ]
        },
        pc("intl-srv", "Server Quốc tế", 825, 200, 20, "172.16.200.88", "02:00:00:11:00:88", "172.16.200.1", "server")
      ],
      links: [
        link("lan-hq", "hq-pc", "eth0", "r-ent", "g0/0", 1, { latency: 2, bandwidth: 10000, role: "lan" }),
        link("wan-ispa-1", "r-ent", "g0/1", "isp-a", "g0/0", 10, { latency: 18, bandwidth: 10000, role: "primary" }),
        link("wan-ispa-2", "isp-a", "g0/1", "r-ixp", "g0/0", 10, { latency: 17, bandwidth: 10000, role: "primary" }),
        link("wan-ispb-1", "r-ent", "g0/2", "isp-b", "g0/0", 50, { latency: 95, bandwidth: 1000, role: "backup" }),
        link("wan-ispb-2", "isp-b", "g0/1", "r-ixp", "g0/1", 50, { latency: 85, bandwidth: 1000, role: "backup" }),
        link("lan-intl", "r-ixp", "g0/2", "intl-srv", "eth0", 1, { latency: 2, bandwidth: 10000, role: "lan" })
      ],
      policy: { fromVlan: 0, toVlan: 0, blocked: false }
    },
    {
      id: "case12",
      number: "12",
      title: "Hai tuyến BGP đến cùng mạng nhưng chính sách khác nhau",
      description: "Mô hình gồm 5 AS. Hãy thay đổi Local Preference hoặc chính sách Permit/Deny ở bảng BGP bên dưới để xem vì sao đường có AS-PATH ngắn hơn chưa chắc được chọn.",
      source: "ent-client",
      target: "cloud-srv/eth0",
      devices: [
        pc("ent-client", "Trạm AS65001", 85, 200, 10, "10.1.0.10", "02:00:00:12:00:10", "10.1.0.1"),
        {
          id: "as65001", name: "AS65001 (DN)", type: "router", x: 230, y: 200, gateway: "", asn: 65001,
          ports: [
            port("g0/0", 10, "10.1.0.1", 24, "02:00:00:12:01:00"),
            port("g0/1", 201, "100.64.1.2", 30, "02:00:00:12:01:01"),
            port("g0/2", 202, "100.64.2.2", 30, "02:00:00:12:01:02")
          ]
        },
        {
          id: "as65002", name: "AS65002 (ISP-1)", type: "router", x: 455, y: 115, gateway: "", asn: 65002,
          ports: [
            port("g0/0", 201, "100.64.1.1", 30, "02:00:00:12:02:00"),
            port("g0/1", 203, "100.64.3.1", 30, "02:00:00:12:02:01")
          ]
        },
        {
          id: "as65003", name: "AS65003 (ISP-2)", type: "router", x: 375, y: 285, gateway: "", asn: 65003,
          ports: [
            port("g0/0", 202, "100.64.2.1", 30, "02:00:00:12:03:00"),
            port("g0/1", 204, "100.64.4.1", 30, "02:00:00:12:03:01")
          ]
        },
        {
          id: "as65004", name: "AS65004 (Transit)", type: "router", x: 550, y: 285, gateway: "", asn: 65004,
          ports: [
            port("g0/0", 204, "100.64.4.2", 30, "02:00:00:12:04:00"),
            port("g0/1", 205, "100.64.5.1", 30, "02:00:00:12:04:01")
          ]
        },
        {
          id: "as65005", name: "AS65005 (Đích)", type: "router", x: 700, y: 200, gateway: "", asn: 65005,
          ports: [
            port("g0/0", 203, "100.64.3.2", 30, "02:00:00:12:05:00"),
            port("g0/1", 205, "100.64.5.2", 30, "02:00:00:12:05:01"),
            port("g0/2", 20, "198.51.100.1", 24, "02:00:00:12:05:02")
          ]
        },
        pc("cloud-srv", "Server Đích", 830, 200, 20, "198.51.100.10", "02:00:00:12:00:99", "198.51.100.1", "server")
      ],
      links: [
        link("c12-lan-src", "ent-client", "eth0", "as65001", "g0/0", 1),
        link("ebgp-1-2", "as65001", "g0/1", "as65002", "g0/0", 10),
        link("ebgp-2-5", "as65002", "g0/1", "as65005", "g0/0", 10),
        link("ebgp-1-3", "as65001", "g0/2", "as65003", "g0/0", 10),
        link("ebgp-3-4", "as65003", "g0/1", "as65004", "g0/0", 10),
        link("ebgp-4-5", "as65004", "g0/1", "as65005", "g0/1", 10),
        link("c12-lan-dst", "as65005", "g0/2", "cloud-srv", "eth0", 1)
      ],
      policy: { fromVlan: 0, toVlan: 0, blocked: false }
    }
  ];

  const originalFind = scenarios.find.bind(scenarios);
  scenarios.find = function (predicate, thisArg) {
    return originalFind(predicate, thisArg) || originalFind(s => s.id === "case11");
  };

  globalThis.TV1TopologyData = Object.freeze({ scenarios });
})();