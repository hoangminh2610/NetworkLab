(function () {
    "use strict";
    const routeData = {
        case5: {
          router_main: [
     	    { prefix: "192.168.1.0/24", nextHop: "10.0.0.2", interface: "eth1" },
                { prefix: "192.168.0.0/16", nextHop: "10.0.0.3", interface: "eth2" },
                { prefix: "0.0.0.0/0", nextHop: "172.16.0.1", interface: "eth0" }
            ]
        },
        case6: {
            router_source: [{ prefix: "10.0.20.0/24", nextHop: "192.168.100.2" }],
            router_dest: [
                { prefix: "10.0.20.0/24", nextHop: "Direct" },
                { prefix: "0.0.0.0/0", nextHop: "Null0" }
            ]
        },
        case7: {
         router_A: [{ prefix: "172.16.5.0/24", nextHop: "10.0.0.2" }],
         router_B: [{ prefix: "172.16.5.0/24", nextHop: "10.0.0.1" }]
        }
    };
    // Đưa routeData ra toàn cục
    globalThis.TV3RouteData = routeData;
})();
