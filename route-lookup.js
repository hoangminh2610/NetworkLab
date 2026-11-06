(function () {
    "use strict";
    function ipToUnsignedInt(ip) {
        return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
    }
    function isMatch(destIp, prefixStr) {
        if (prefixStr === "0.0.0.0/0") return true;
        const [networkIp, maskStr] = prefixStr.split('/');
        const maskBits = parseInt(maskStr, 10);
        const maskInt = ~((1 << (32 - maskBits)) - 1) >>> 0;
        return (ipToUnsignedInt(destIp) & maskInt) === (ipToUnsignedInt(networkIp) & maskInt);
    }
    function longestPrefixMatch(destIp, routingTable) {
        let bestMatch = null;
        let maxMask = -1;
        for (const route of routingTable) {
            if (isMatch(destIp, route.prefix)) {
                const maskBits = route.prefix === "0.0.0.0/0" ? 0 : parseInt(route.prefix.split('/')[1], 10);
                if (maskBits > maxMask) {
                    maxMask = maskBits;
                    bestMatch = route;
                }
            }
        }
        return bestMatch;
    }
    // Đưa hàm ra toàn cục
    globalThis.TV3RouteLookup = { longestPrefixMatch };
})();
