(function () {
  "use strict";
  const scenarios = [
  {
    "id": "case1",
    "number": "01",
    "title": "Laptop không truy cập máy in",
    "description": "Hai thiết bị cắm cùng switch. Hãy ping máy in, rồi đối chiếu IP, subnet và bảng ARP của laptop.",
    "source": "laptop",
    "target": "printer/eth0",
    "devices": [
      {
        "id": "laptop",
        "name": "Laptop",
        "type": "pc",
        "x": 160,
        "y": 195,
        "gateway": "",
        "ports": [
          {
            "id": "eth0",
            "vlan": 10,
            "ip": "192.168.20.10",
            "prefix": 24,
            "mac": "02:00:00:01:00:10"
          }
        ]
      },
      {
        "id": "office-switch",
        "name": "Switch văn phòng",
        "type": "switch",
        "x": 450,
        "y": 195,
        "gateway": "",
        "ports": [
          {
            "id": "p1",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p2",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p3",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p4",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p5",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p6",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          }
        ]
      },
      {
        "id": "printer",
        "name": "Máy in",
        "type": "printer",
        "x": 740,
        "y": 195,
        "gateway": "",
        "ports": [
          {
            "id": "eth0",
            "vlan": 10,
            "ip": "192.168.10.50",
            "prefix": 24,
            "mac": "02:00:00:01:00:50"
          }
        ]
      }
    ],
    "links": [
      {
        "id": "office-laptop",
        "a": {
          "device": "laptop",
          "port": "eth0"
        },
        "b": {
          "device": "office-switch",
          "port": "p1"
        },
        "up": true,
        "cost": 10
      },
      {
        "id": "office-printer",
        "a": {
          "device": "office-switch",
          "port": "p2"
        },
        "b": {
          "device": "printer",
          "port": "eth0"
        },
        "up": true,
        "cost": 10
      }
    ],
    "policy": null
  },
  {
    "id": "case2",
    "number": "02",
    "title": "Gateway có ánh xạ MAC bất thường",
    "description": "Máy khách xuất hiện ánh xạ IP gateway 192.168.10.1 sang MAC khác với thông tin quản trị đã ghi nhận. Hãy chuyển đổi trạng thái bình thường / nghi vấn, quan sát đường đi và các bước xác minh.",
    "source": "client",
    "target": "server/eth0",
    "devices": [
      {
        "id": "client",
        "name": "Máy Khách",
        "type": "pc",
        "x": 90,
        "y": 195,
        "gateway": "192.168.10.1",
        "ports": [
          {
            "id": "eth0",
            "vlan": 10,
            "ip": "192.168.10.10",
            "prefix": 24,
            "mac": "02:00:00:02:00:10"
          }
        ]
      },
      {
        "id": "lan-switch",
        "name": "Switch văn phòng",
        "type": "switch",
        "x": 250,
        "y": 195,
        "gateway": "",
        "ports": [
          {
            "id": "p1",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p2",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p3",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p4",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p5",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p6",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          }
        ]
      },
      {
        "id": "gateway",
        "name": "Router gateway",
        "type": "router",
        "x": 410,
        "y": 195,
        "gateway": "",
        "ports": [
          {
            "id": "g0/0",
            "vlan": 10,
            "ip": "192.168.10.1",
            "prefix": 24,
            "mac": "02:00:00:02:00:01"
          },
          {
            "id": "g0/1",
            "vlan": 20,
            "ip": "10.0.20.1",
            "prefix": 24,
            "mac": "02:00:00:02:01:01"
          }
        ]
      },
      {
        "id": "suspect",
        "name": "Thiết bị MAC lạ",
        "type": "pc",
        "x": 570,
        "y": 195,
        "gateway": "192.168.10.1",
        "ports": [
          {
            "id": "eth0",
            "vlan": 10,
            "ip": "192.168.10.95",
            "prefix": 24,
            "mac": "02:00:00:02:99:99"
          }
        ]
      },
      {
        "id": "server",
        "name": "Máy chủ",
        "type": "server",
        "x": 750,
        "y": 195,
        "gateway": "10.0.20.1",
        "ports": [
          {
            "id": "eth0",
            "vlan": 20,
            "ip": "10.0.20.100",
            "prefix": 24,
            "mac": "02:00:00:02:01:99"
          }
        ]
      }
    ],
    "links": [
      {
        "id": "c2-client-sw",
        "a": {
          "device": "client",
          "port": "eth0"
        },
        "b": {
          "device": "lan-switch",
          "port": "p1"
        },
        "up": true,
        "cost": 10
      },
      {
        "id": "c2-sw-gw",
        "a": {
          "device": "lan-switch",
          "port": "p2"
        },
        "b": {
          "device": "gateway",
          "port": "g0/0"
        },
        "up": true,
        "cost": 10
      },
      {
        "id": "c2-gw-suspect",
        "a": {
          "device": "gateway",
          "port": "g0/1"
        },
        "b": {
          "device": "suspect",
          "port": "eth0"
        },
        "up": true,
        "cost": 10
      },
      {
        "id": "c2-suspect-srv",
        "a": {
          "device": "suspect",
          "port": "eth0"
        },
        "b": {
          "device": "server",
          "port": "eth0"
        },
        "up": true,
        "cost": 10
      }
    ],
    "policy": null,
    "arpAnomaly": {
      "active": true,
      "gatewayIp": "192.168.10.1",
      "expectedMac": "02:00:00:02:00:01",
      "suspiciousMac": "02:00:00:02:99:99",
      "suspectDeviceId": "suspect"
    }
  },
  {
    "id": "case3",
    "number": "03",
    "title": "Wi-Fi khách và VLAN nội bộ",
    "description": "Máy khách 192.168.30.10/24 thuộc VLAN 30 ping được gateway 192.168.30.1. Khi ping máy nội bộ 192.168.10.20/24 thuộc VLAN 10, router nhận gói nhưng chặn chuyển tiếp theo chính sách. ARP broadcast của máy khách chỉ nằm trong VLAN 30. Tắt chính sách để đối chứng: router thực hiện ARP riêng trong VLAN 10 và ping thành công.",
    "source": "guest",
    "target": "internal/eth0",
    "devices": [
      {
        "id": "guest",
        "name": "Wi-Fi khách",
        "type": "pc",
        "x": 105,
        "y": 195,
        "gateway": "192.168.30.1",
        "ports": [
          {
            "id": "eth0",
            "vlan": 30,
            "ip": "192.168.30.10",
            "prefix": 24,
            "mac": "02:00:00:03:00:10"
          }
        ]
      },
      {
        "id": "guest-switch",
        "name": "Switch khách",
        "type": "switch",
        "x": 275,
        "y": 195,
        "gateway": "",
        "ports": [
          {
            "id": "p1",
            "vlan": 30,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p2",
            "vlan": 30,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p3",
            "vlan": 30,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p4",
            "vlan": 30,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p5",
            "vlan": 30,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p6",
            "vlan": 30,
            "ip": "",
            "prefix": 24,
            "mac": ""
          }
        ]
      },
      {
        "id": "gateway",
        "name": "Router gateway",
        "type": "router",
        "x": 450,
        "y": 195,
        "gateway": "",
        "ports": [
          {
            "id": "g0/0",
            "vlan": 30,
            "ip": "192.168.30.1",
            "prefix": 24,
            "mac": "02:00:00:03:00:01"
          },
          {
            "id": "g0/1",
            "vlan": 10,
            "ip": "192.168.10.1",
            "prefix": 24,
            "mac": "02:00:00:03:01:01"
          }
        ]
      },
      {
        "id": "internal-switch",
        "name": "Switch nội bộ",
        "type": "switch",
        "x": 625,
        "y": 195,
        "gateway": "",
        "ports": [
          {
            "id": "p1",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p2",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p3",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p4",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p5",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p6",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          }
        ]
      },
      {
        "id": "internal",
        "name": "Máy nội bộ",
        "type": "server",
        "x": 795,
        "y": 195,
        "gateway": "192.168.10.1",
        "ports": [
          {
            "id": "eth0",
            "vlan": 10,
            "ip": "192.168.10.20",
            "prefix": 24,
            "mac": "02:00:00:03:01:20"
          }
        ]
      }
    ],
    "links": [
      {
        "id": "guest-pc",
        "a": {
          "device": "guest",
          "port": "eth0"
        },
        "b": {
          "device": "guest-switch",
          "port": "p1"
        },
        "up": true,
        "cost": 10
      },
      {
        "id": "guest-gw",
        "a": {
          "device": "guest-switch",
          "port": "p2"
        },
        "b": {
          "device": "gateway",
          "port": "g0/0"
        },
        "up": true,
        "cost": 10
      },
      {
        "id": "internal-gw",
        "a": {
          "device": "gateway",
          "port": "g0/1"
        },
        "b": {
          "device": "internal-switch",
          "port": "p1"
        },
        "up": true,
        "cost": 10
      },
      {
        "id": "internal-pc",
        "a": {
          "device": "internal-switch",
          "port": "p2"
        },
        "b": {
          "device": "internal",
          "port": "eth0"
        },
        "up": true,
        "cost": 10
      }
    ],
    "policy": {
      "fromVlan": 30,
      "toVlan": 10,
      "blocked": true
    }
  },
  {
    "id": "case4",
    "number": "04",
    "title": "Đơn hàng bị mất kết nối sau khi thay đổi default gateway",
    "description": "Máy khách truy cập được máy in trong LAN nhưng không đến được máy chủ đơn hàng bên ngoài. Hãy đối chiếu sự khác biệt giữa lỗi cấu hình máy trạm, lỗi ARP và lỗi định tuyến.",
    "source": "order-pc",
    "target": "order-srv/eth0",
    "devices": [
      {
        "id": "order-pc",
        "name": "PC Đơn hàng",
        "type": "pc",
        "x": 90,
        "y": 195,
        "gateway": "192.168.10.254",
        "ports": [
          {
            "id": "eth0",
            "vlan": 10,
            "ip": "192.168.10.20",
            "prefix": 24,
            "mac": "02:00:00:04:00:20"
          }
        ]
      },
      {
        "id": "office-sw",
        "name": "Switch văn phòng",
        "type": "switch",
        "x": 250,
        "y": 195,
        "gateway": "",
        "ports": [
          {
            "id": "p1",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p2",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p3",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p4",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p5",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          },
          {
            "id": "p6",
            "vlan": 10,
            "ip": "",
            "prefix": 24,
            "mac": ""
          }
        ]
      },
      {
        "id": "office-prn",
        "name": "Máy in LAN",
        "type": "printer",
        "x": 410,
        "y": 195,
        "gateway": "192.168.10.1",
        "ports": [
          {
            "id": "eth0",
            "vlan": 10,
            "ip": "192.168.10.50",
            "prefix": 24,
            "mac": "02:00:00:04:00:50"
          }
        ]
      },
      {
        "id": "gateway",
        "name": "Router gateway",
        "type": "router",
        "x": 570,
        "y": 195,
        "gateway": "",
        "ports": [
          {
            "id": "g0/0",
            "vlan": 10,
            "ip": "192.168.10.1",
            "prefix": 24,
            "mac": "02:00:00:04:00:01"
          },
          {
            "id": "g0/1",
            "vlan": 20,
            "ip": "10.0.20.1",
            "prefix": 24,
            "mac": "02:00:00:04:01:01"
          }
        ]
      },
      {
        "id": "order-srv",
        "name": "Server Đơn hàng",
        "type": "server",
        "x": 750,
        "y": 195,
        "gateway": "10.0.20.1",
        "ports": [
          {
            "id": "eth0",
            "vlan": 20,
            "ip": "10.0.20.100",
            "prefix": 24,
            "mac": "02:00:00:04:01:99"
          }
        ]
      }
    ],
    "links": [
      {
        "id": "c4-pc-sw",
        "a": {
          "device": "order-pc",
          "port": "eth0"
        },
        "b": {
          "device": "office-sw",
          "port": "p1"
        },
        "up": true,
        "cost": 10
      },
      {
        "id": "c4-sw-prn",
        "a": {
          "device": "office-sw",
          "port": "p2"
        },
        "b": {
          "device": "office-prn",
          "port": "eth0"
        },
        "up": true,
        "cost": 10
      },
      {
        "id": "c4-prn-gw",
        "a": {
          "device": "office-prn",
          "port": "eth0"
        },
        "b": {
          "device": "gateway",
          "port": "g0/0"
        },
        "up": true,
        "cost": 10
      },
      {
        "id": "c4-gw-srv",
        "a": {
          "device": "gateway",
          "port": "g0/1"
        },
        "b": {
          "device": "order-srv",
          "port": "eth0"
        },
        "up": true,
        "cost": 10
      }
    ],
    "policy": null,
    "routeDisabled": false
  },
  {
    "id": "case5",
    "number": "05",
    "title": "Longest Prefix Match",
    "description": "Router ưu tiên route có prefix dài nhất trước default route.",
    "source": "r5-src",
    "target": "srv-c5/eth0",
    "devices": [
      {
        "id": "r5-src",
        "name": "Router Main",
        "type": "router",
        "x": 130,
        "y": 195,
        "gateway": "",
        "ports": [
          {
            "id": "eth0",
            "vlan": 50,
            "ip": "10.0.0.1",
            "prefix": 24,
            "mac": "02:00:00:05:01:01"
          },
          {
            "id": "eth1",
            "vlan": 51,
            "ip": "192.168.1.1",
            "prefix": 24,
            "mac": "02:00:00:05:01:02"
          }
        ]
      },
      {
        "id": "r5-dst",
        "name": "Router mạng 192.168.1.0/24",
        "type": "router",
        "x": 500,
        "y": 195,
        "gateway": "",
        "ports": [
          {
            "id": "g0/0",
            "vlan": 51,
            "ip": "192.168.1.2",
            "prefix": 24,
            "mac": "02:00:00:05:02:01"
          },
          {
            "id": "g0/1",
            "vlan": 52,
            "ip": "192.168.2.1",
            "prefix": 24,
            "mac": "02:00:00:05:02:02"
          }
        ]
      },
      {
        "id": "srv-c5",
        "name": "Máy chủ đích",
        "type": "server",
        "x": 800,
        "y": 195,
        "gateway": "192.168.2.1",
        "ports": [
          {
            "id": "eth0",
            "vlan": 52,
            "ip": "192.168.2.10",
            "prefix": 24,
            "mac": "02:00:00:05:50:01"
          }
        ]
      }
    ],
    "links": [
      {
        "id": "c5-a",
        "a": {
          "device": "r5-src",
          "port": "eth1"
        },
        "b": {
          "device": "r5-dst",
          "port": "g0/0"
        },
        "up": true,
        "cost": 10
      },
      {
        "id": "c5-b",
        "a": {
          "device": "r5-dst",
          "port": "g0/1"
        },
        "b": {
          "device": "srv-c5",
          "port": "eth0"
        },
        "up": true,
        "cost": 10
      }
    ]
  },
  {
    "id": "case6",
    "number": "06",
    "title": "Kiểm tra tuyến hồi đáp",
    "description": "Echo Request đi tới server qua hai router. Router đích ban đầu thiếu tuyến về mạng nguồn; hãy thêm static route trên Router đích rồi chạy ping lại để xác nhận cả hai chiều.",
    "source": "pc-c6",
    "target": "srv-c6/eth0",
    "devices": [
      {
        "id": "pc-c6",
        "name": "PC nguồn",
        "type": "pc",
        "x": 90,
        "y": 195,
        "gateway": "10.0.10.1",
        "ports": [
          {
            "id": "eth0",
            "vlan": 60,
            "ip": "10.0.10.10",
            "prefix": 24,
            "mac": "02:00:00:06:10:01"
          }
        ]
      },
      {
        "id": "r6-src",
        "name": "Router nguồn",
        "type": "router",
        "x": 340,
        "y": 195,
        "gateway": "",
        "ports": [
          {
            "id": "g0/0",
            "vlan": 60,
            "ip": "10.0.10.1",
            "prefix": 24,
            "mac": "02:00:00:06:01:01"
          },
          {
            "id": "g0/1",
            "vlan": 62,
            "ip": "192.168.100.1",
            "prefix": 30,
            "mac": "02:00:00:06:01:02"
          }
        ],
        "routes": [
          {
            "prefix": "10.0.20.0/24",
            "nextHop": "192.168.100.2",
            "interface": "g0/1"
          }
        ]
      },
      {
        "id": "r6-dst",
        "name": "Router đích",
        "type": "router",
        "x": 625,
        "y": 195,
        "gateway": "",
        "ports": [
          {
            "id": "g0/0",
            "vlan": 62,
            "ip": "192.168.100.2",
            "prefix": 30,
            "mac": "02:00:00:06:02:01"
          },
          {
            "id": "g0/1",
            "vlan": 61,
            "ip": "10.0.20.1",
            "prefix": 24,
            "mac": "02:00:00:06:02:02"
          }
        ],
        "routes": []
      },
      {
        "id": "srv-c6",
        "name": "Server đích",
        "type": "server",
        "x": 850,
        "y": 195,
        "gateway": "10.0.20.1",
        "ports": [
          {
            "id": "eth0",
            "vlan": 61,
            "ip": "10.0.20.10",
            "prefix": 24,
            "mac": "02:00:00:06:50:01"
          }
        ]
      }
    ],
    "links": [
      {
        "id": "c6-a",
        "a": {
          "device": "pc-c6",
          "port": "eth0"
        },
        "b": {
          "device": "r6-src",
          "port": "g0/0"
        },
        "up": true,
        "cost": 10
      },
      {
        "id": "c6-transit",
        "a": {
          "device": "r6-src",
          "port": "g0/1"
        },
        "b": {
          "device": "r6-dst",
          "port": "g0/0"
        },
        "up": true,
        "cost": 10
      },
      {
        "id": "c6-b",
        "a": {
          "device": "r6-dst",
          "port": "g0/1"
        },
        "b": {
          "device": "srv-c6",
          "port": "eth0"
        },
        "up": true,
        "cost": 10
      }
    ]
  },
  {
    "id": "case7",
    "number": "07",
    "title": "Phòng tránh routing loop",
    "description": "Quan sát TTL giảm tại router và chọn tuyến hợp lệ để tránh vòng lặp.",
    "source": "pc-c7",
    "target": "srv-c7/eth0",
    "devices": [
      {
        "id": "pc-c7",
        "name": "PC nguồn",
        "type": "pc",
        "x": 100,
        "y": 195,
        "gateway": "172.16.7.1",
        "ports": [
          {
            "id": "eth0",
            "vlan": 70,
            "ip": "172.16.7.10",
            "prefix": 24,
            "mac": "02:00:00:07:10:01"
          }
        ]
      },
      {
        "id": "r7a",
        "name": "Router A",
        "type": "router",
        "x": 350,
        "y": 195,
        "gateway": "",
        "ports": [
          {
            "id": "g0/0",
            "vlan": 70,
            "ip": "172.16.7.1",
            "prefix": 24,
            "mac": "02:00:00:07:01:01"
          },
          {
            "id": "g0/1",
            "vlan": 71,
            "ip": "10.7.0.1",
            "prefix": 24,
            "mac": "02:00:00:07:01:02"
          }
        ]
      },
      {
        "id": "r7b",
        "name": "Router B",
        "type": "router",
        "x": 600,
        "y": 195,
        "gateway": "",
        "ports": [
          {
            "id": "g0/0",
            "vlan": 71,
            "ip": "10.7.0.2",
            "prefix": 24,
            "mac": "02:00:00:07:02:01"
          },
          {
            "id": "g0/1",
            "vlan": 72,
            "ip": "172.16.5.1",
            "prefix": 24,
            "mac": "02:00:00:07:02:02"
          }
        ]
      },
      {
        "id": "srv-c7",
        "name": "Máy chủ đích",
        "type": "server",
        "x": 840,
        "y": 195,
        "gateway": "172.16.5.1",
        "ports": [
          {
            "id": "eth0",
            "vlan": 72,
            "ip": "172.16.5.10",
            "prefix": 24,
            "mac": "02:00:00:07:50:01"
          }
        ]
      }
    ],
    "links": [
      {
        "id": "c7-a",
        "a": {
          "device": "pc-c7",
          "port": "eth0"
        },
        "b": {
          "device": "r7a",
          "port": "g0/0"
        },
        "up": true,
        "cost": 10
      },
      {
        "id": "c7-b",
        "a": {
          "device": "r7a",
          "port": "g0/1"
        },
        "b": {
          "device": "r7b",
          "port": "g0/0"
        },
        "up": true,
        "cost": 10
      },
      {
        "id": "c7-c",
        "a": {
          "device": "r7b",
          "port": "g0/1"
        },
        "b": {
          "device": "srv-c7",
          "port": "eth0"
        },
        "up": true,
        "cost": 10
      }
    ]
  }
];
  const all = globalThis.TV1TopologyData?.scenarios;
  if (Array.isArray(all)) all.unshift(...scenarios);
})();
