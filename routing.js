(function () {
    "use strict";

    class Packet {
        constructor(src, dest, ttl = 64) {
            this.src = src;
            this.dest = dest;
            this.ttl = ttl;
            this.history = [];
        }
    }

    function processPacketAtRouter(packet, routerName, table) {
const longestPrefixMatch = globalThis.TV3RouteLookup ? globalThis.TV3RouteLookup.longestPrefixMatch : null;
        
        if (!longestPrefixMatch) {
            return { success: false, reason: "DROP: RouteLookup Module Not Loaded" };
        }

        if (packet.ttl <= 1) {
            packet.history.push({ event: "DROP", reason: "TTL Expired", router: routerName });
            return { success: false, reason: "DROP: TTL Expired (Phát hiện Routing Loop)" };
        }

        const route = longestPrefixMatch(packet.dest, table);
        if (!route || route.nextHop === "Null0") {
            packet.history.push({ event: "DROP", reason: "Destination Unreachable", router: routerName });
            return { success: false, reason: "DROP: Destination Unreachable (Không có tuyến về)" };
        }

        packet.ttl -= 1;
        packet.history.push({
            event: "FORWARD",
            router: routerName,
            nextHop: route.nextHop,
            ttlAfter: packet.ttl
        });

        return { success: true, nextHop: route.nextHop, routeUsed: route };
    }

    // Đưa các lớp và hàm cần thiết ra toàn cục
    globalThis.TV3Routing = { Packet, processPacketAtRouter };
})();
