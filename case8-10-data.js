(function () {
  "use strict";

  const port = (id, vlan, ip = "", prefix = 24, mac = "") => ({ id, vlan, ip, prefix, mac });
  const routerNode = (id, name, x, y, ports) => ({ id, name, type: "router", x, y, gateway: "", ports });
  const serverNode = (id, name, x, y, vlan, ip, mac, gateway = "") => ({
    id, name, type: "server", x, y, gateway, ports: [port("eth0", vlan, ip, 24, mac)]
  });
  const link = (id, a, aPort, b, bPort, cost = 10, latency = 10) => ({
    id, a: { device: a, port: aPort }, b: { device: b, port: bPort }, up: true, cost, latency
  });

  const scenarios = [
    {
      id: "case8",
      number: "08",
      title: "Tuyến chính gặp lỗi tại doanh nghiệp thương mại điện tử",
      description: "Mạng kết nối Trụ sở TP.HCM đến Trung tâm dữ liệu (DC). Ngắt liên kết chính để so sánh: Static không dự phòng, Static có dự phòng và Dynamic Routing.",
      source: "router_hcm",
      target: "dc_server/eth0",
      devices: [
        routerNode("router_hcm", "Router TP.HCM", 110, 195, [
          port("g0/0", 1, "10.1.1.1", 24, "02:00:00:08:01:01"),
          port("g0/1", 2, "10.1.2.1", 24, "02:00:00:08:01:02")
        ]),
        routerNode("router_bd", "Router Bình Dương", 380, 120, [
          port("g0/0", 1, "10.1.1.2", 24, "02:00:00:08:02:01"),
          port("g0/1", 3, "10.1.3.1", 24, "02:00:00:08:02:02")
        ]),
        routerNode("router_hn", "Router Hà Nội (Dự phòng)", 380, 280, [
          port("g0/0", 2, "10.1.2.2", 24, "02:00:00:08:03:01"),
          port("g0/1", 4, "10.1.4.1", 24, "02:00:00:08:03:02")
        ]),
        routerNode("router_dc", "Router Datacenter", 640, 195, [
          port("g0/0", 3, "10.1.3.2", 24, "02:00:00:08:04:01"),
          port("g0/1", 4, "10.1.4.2", 24, "02:00:00:08:04:02"),
          port("g0/2", 10, "10.2.0.1", 24, "02:00:00:08:04:03")
        ]),
        serverNode("dc_server", "Máy chủ DC", 800, 195, 10, "10.2.0.100", "02:00:00:08:00:99", "10.2.0.1")
      ],
      links: [
        link("link_main_1", "router_hcm", "g0/0", "router_bd", "g0/0", 10),
        link("link_main_2", "router_bd", "g0/1", "router_dc", "g0/0", 10),
        link("link_bk_1", "router_hcm", "g0/1", "router_hn", "g0/0", 50),
        link("link_bk_2", "router_hn", "g0/1", "router_dc", "g0/1", 50),
        link("link_dc_srv", "router_dc", "g0/2", "dc_server", "eth0", 1)
      ],
      policy: null
    },
    {
      id: "case9",
      number: "09",
      title: "RIP chọn đường ít hop dù độ trễ cao",
      description: "So sánh Tuyến A (1 hop, trễ 100ms) và Tuyến B (3 hops, trễ 10ms). RIP luôn ưu tiên Hop Count.",
      source: "r1_c9",
      target: "r_dest_c9/g0/0",
      devices: [
        routerNode("r1_c9", "Router Nguồn R1", 120, 195, [
          port("g0/0", 1, "172.16.1.1", 24, "02:00:00:09:01:01"),
          port("g0/1", 2, "172.16.2.1", 24, "02:00:00:09:01:02")
        ]),
        routerNode("r2_c9", "Router R2 (B1)", 400, 290, [
          port("g0/0", 2, "172.16.2.2", 24, "02:00:00:09:02:01"),
          port("g0/1", 3, "172.16.3.1", 24, "02:00:00:09:02:02")
        ]),
        routerNode("r3_c9", "Router R3 (B2)", 560, 290, [
          port("g0/0", 3, "172.16.3.2", 24, "02:00:00:09:03:01"),
          port("g0/1", 4, "172.16.4.1", 24, "02:00:00:09:03:02")
        ]),
        routerNode("r_dest_c9", "Router Đích", 780, 195, [
          port("g0/0", 1, "172.16.1.2", 24, "02:00:00:09:04:01"),
          port("g0/1", 4, "172.16.4.2", 24, "02:00:00:09:04:02")
        ])
      ],
      links: [
        link("path_a", "r1_c9", "g0/0", "r_dest_c9", "g0/0", 10, 100),
        link("path_b1", "r1_c9", "g0/1", "r2_c9", "g0/0", 10, 10),
        link("path_b2", "r2_c9", "g0/1", "r3_c9", "g0/0", 10, 10),
        link("path_b3", "r3_c9", "g0/1", "r_dest_c9", "g0/1", 10, 10)
      ],
      policy: null
    },
    {
      id: "case10",
      number: "10",
      title: "OSPF thay đổi tuyến khi cost liên kết tăng",
      description: "Mạng 6 Router. Chạy Dijkstra chọn đường có tổng cost nhỏ nhất khi điều chỉnh cost hoặc ngắt link.",
      source: "r1_c10",
      target: "r6_c10/g0/0",
      devices: [
        routerNode("r1_c10", "Router R1", 100, 195, [port("g0/0", 1, "10.0.1.1"), port("g0/1", 2, "10.0.2.1")]),
        routerNode("r2_c10", "Router R2", 320, 100, [port("g0/0", 1, "10.0.1.2"), port("g0/1", 3, "10.0.3.1")]),
        routerNode("r3_c10", "Router R3", 320, 290, [port("g0/0", 2, "10.0.2.2"), port("g0/1", 4, "10.0.4.1")]),
        routerNode("r4_c10", "Router R4", 580, 100, [port("g0/0", 3, "10.0.3.2"), port("g0/1", 5, "10.0.5.1")]),
        routerNode("r5_c10", "Router R5", 580, 290, [port("g0/0", 4, "10.0.4.2"), port("g0/1", 6, "10.0.6.1")]),
        routerNode("r6_c10", "Router R6", 800, 195, [port("g0/0", 5, "10.0.5.2"), port("g0/1", 6, "10.0.6.2")])
      ],
      links: [
        link("l_r1_r2", "r1_c10", "g0/0", "r2_c10", "g0/0", 5),
        link("l_r2_r4", "r2_c10", "g0/1", "r4_c10", "g0/0", 5),
        link("l_r4_r6", "r4_c10", "g0/1", "r6_c10", "g0/0", 5),
        link("l_r1_r3", "r1_c10", "g0/1", "r3_c10", "g0/0", 20),
        link("l_r3_r5", "r3_c10", "g0/1", "r5_c10", "g0/0", 10),
        link("l_r5_r6", "r5_c10", "g0/1", "r6_c10", "g0/1", 10)
      ],
      policy: null
    }
  ];

  if (globalThis.TV1TopologyData && Array.isArray(globalThis.TV1TopologyData.scenarios)) {
    globalThis.TV1TopologyData.scenarios.push(...scenarios);
  } else {
    globalThis.TV4TopologyData = Object.freeze({ scenarios });
  }
})();