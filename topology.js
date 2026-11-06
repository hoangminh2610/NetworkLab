(function () {
  "use strict";
  const {scenarios} = globalThis.TV1TopologyData;
  const device = (net, id) => net.devices.find(item => item.id === id);
  const port = (dev, id) => dev?.ports.find(item => item.id === id);
  const endpoint = (net, value) => {
    const separator = value.indexOf("/");
    const node = device(net, value.slice(0, separator));
    return {node, iface: port(node, value.slice(separator + 1))};
  };
  const key = (dev, iface) => dev.id + "/" + iface.id;
  const ipv4 = ip => {
    if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(ip)) return null;
    const bytes = ip.split(".").map(Number);
    return bytes.every(n => n < 256) ? bytes.reduce((n, b) => n * 256 + b, 0) : null;
  };
  const ipText = n => [24, 16, 8, 0].map(shift => (n >>> shift) & 255).join(".");
  const mask = prefix => prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const inSubnet = (address, iface) => {
    const a = ipv4(address), b = ipv4(iface.ip);
    return a !== null && b !== null && (a & mask(iface.prefix)) === (b & mask(iface.prefix));
  };
  const subnet = iface => ipv4(iface.ip) === null ? "—" :
    ipText((ipv4(iface.ip) & mask(iface.prefix)) >>> 0) + "/" + iface.prefix;
  const createNetwork = id => {
    const template = scenarios.find(s => s.id === id);
    if (!template) throw new Error("Kịch bản không tồn tại");
    const network = {...structuredClone(template), cache: Object.create(null), nextId: 1};
    // Một số topology OSPF cũ chưa khai báo MAC cho các cổng router.
    // Sinh MAC mô phỏng ổn định để Packet Inspector và ARP cache không bị trống.
    const hex = value => value.toString(16).padStart(2, "0").toUpperCase();
    network.devices.forEach((node, deviceIndex) => node.ports.forEach((iface, portIndex) => {
      if (node.type !== "switch" && !iface.mac) {
        iface.mac = "02:FE:" + hex(deviceIndex) + ":" + hex(portIndex) + ":00:01";
      }
    }));
    return network;
  };

  // The intermediate vertices of a LAN path must be switches in the same VLAN.
  function findPath(net, a, b, {includeDown = false, skip = ""} = {}) {
    if (!a.node || !a.iface || !b.node || !b.iface || a.iface.vlan !== b.iface.vlan) return null;
    if (a.node.id === b.node.id) return [];
    const vlan = a.iface.vlan;
    const frontier = [{id: a.node.id, total: 0, links: []}];
    const best = new Map([[a.node.id, 0]]);
    while (frontier.length) {
      frontier.sort((left, right) => left.total - right.total);
      const current = frontier.shift();
      if (current.total !== best.get(current.id)) continue;
      if (current.id === b.node.id) return current.links;
      for (const link of net.links) {
        if ((!link.up && !includeDown) || link.id === skip) continue;
        const from = link.a.device === current.id ? link.a : link.b.device === current.id ? link.b : null;
        if (!from) continue;
        const to = from === link.a ? link.b : link.a;
        const next = device(net, to.device);
        if (!next || (next.id !== b.node.id && next.type !== "switch")) continue;
        if (current.id === a.node.id && from.port !== a.iface.id) continue;
        if (next.id === b.node.id && to.port !== b.iface.id) continue;
        if (port(device(net, from.device), from.port)?.vlan !== vlan || port(next, to.port)?.vlan !== vlan) continue;
        const total = current.total + link.cost;
        if (total >= (best.get(next.id) ?? Infinity)) continue;
        best.set(next.id, total);
        frontier.push({id: next.id, total, links: [...current.links, link.id]});
      }
    }
    return null;
  }

  function backupPath(net, a, b, primary) {
    const costs = new Map(net.links.map(link => [link.id, link.cost]));
    const total = route => route.reduce((sum, id) => sum + costs.get(id), 0);
    return primary.map(skip => findPath(net, a, b, {skip})).filter(Boolean)
      .sort((left, right) => total(left) - total(right))[0] ?? [];
  }

  // TV5 mô phỏng mạng liên miền: router có thể chuyển tiếp qua nhiều ASN,
  // vì vậy không thể dùng bộ dò L2/VLAN đơn giản của TV1 cho toàn bộ hành trình.
  function interdomainPath(net, sourceId, targetKey) {
    if (net.id === "case12" && globalThis.TV5BGP?.selectBestBgpRoute) {
      const decision = globalThis.TV5BGP.selectBestBgpRoute(net);
      return {
        path: decision.best?.linkIds ?? [],
        backup: decision.backup?.linkIds ?? [],
        reason: decision.reason,
        faults: decision.downLinks ?? []
      };
    }
    const start = sourceId || net.source, target = (targetKey || net.target).split("/")[0];
    const queue = [{id: start, cost: 0, links: []}], best = new Map([[start, 0]]);
    while (queue.length) {
      queue.sort((a, b) => a.cost - b.cost);
      const current = queue.shift();
      if (current.cost !== best.get(current.id)) continue;
      if (current.id === target) return {path: current.links, backup: [], reason: "Chọn tuyến có tổng cost thấp nhất còn hoạt động.", faults: net.links.filter(l => !l.up).map(l => l.id)};
      for (const link of net.links) {
        if (!link.up) continue;
        const next = link.a.device === current.id ? link.b.device : link.b.device === current.id ? link.a.device : "";
        if (!next) continue;
        const cost = current.cost + (Number(link.cost) || 10);
        if (cost >= (best.get(next) ?? Infinity)) continue;
        best.set(next, cost);
        queue.push({id: next, cost, links: [...current.links, link.id]});
      }
    }
    return {path: [], backup: [], reason: "Không còn tuyến liên miền hoạt động từ nguồn tới đích.", faults: net.links.filter(l => !l.up).map(l => l.id)};
  }

  function ipMatchesPrefix(ip, cidr) {
    const [network, rawPrefix] = String(cidr || "").split("/");
    const address = ipv4(ip), networkAddress = ipv4(network);
    const prefix = Number(rawPrefix);
    if (address === null || networkAddress === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
    const bits = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (address & bits) === (networkAddress & bits);
  }

  function linkedPeer(net, node, iface) {
    const link = net.links.find(item =>
      (item.a.device === node.id && item.a.port === iface.id) ||
      (item.b.device === node.id && item.b.port === iface.id));
    if (!link || !link.up) return null;
    const localIsA = link.a.device === node.id && link.a.port === iface.id;
    const remote = localIsA ? link.b : link.a;
    const peerNode = device(net, remote.device);
    const peerIface = port(peerNode, remote.port);
    return peerNode && peerIface ? {link, node: peerNode, iface: peerIface} : null;
  }

  // Tra cứu tuyến theo từng router cho Case 6. Tuyến connected được ưu tiên;
  // nếu không có, router phải có static route với next hop/interface hợp lệ.
  function routeFromRouterToEndpoint(net, currentRouter, targetNode, targetIface, visited = []) {
    if (!currentRouter || currentRouter.type !== "router") {
      return {ok: false, path: [], faultNode: currentRouter?.id || "", reason: "Next hop không phải router hợp lệ."};
    }
    if (visited.includes(currentRouter.id)) {
      return {ok: false, path: [], faultNode: currentRouter.id, loop: true,
        reason: "Phát hiện routing loop tại " + currentRouter.name + "."};
    }
    const chain = [...visited, currentRouter.id];
    const connected = currentRouter.ports
      .filter(iface => iface.ip && inSubnet(targetIface.ip, iface))
      .sort((a, b) => b.prefix - a.prefix);
    for (const iface of connected) {
      const path = findPath(net, {node: currentRouter, iface}, {node: targetNode, iface: targetIface});
      if (path) return {ok: true, path, routers: chain, routeNotes: [currentRouter.name + ": mạng đích kết nối trực tiếp qua " + iface.id + "."]};
    }

    const route = (currentRouter.routes || [])
      .filter(item => ipMatchesPrefix(targetIface.ip, item.prefix))
      .sort((a, b) => Number(b.prefix.split("/")[1]) - Number(a.prefix.split("/")[1]))[0];
    if (!route) {
      return {ok: false, path: [], faultNode: currentRouter.id,
        reason: currentRouter.name + " không có tuyến khớp với mạng đích " + subnet(targetIface) + "."};
    }
    const outIface = port(currentRouter, route.interface);
    if (!outIface || !route.nextHop || !inSubnet(route.nextHop, outIface)) {
      return {ok: false, path: [], faultNode: currentRouter.id,
        reason: "Static route trên " + currentRouter.name + " có next hop hoặc interface không hợp lệ."};
    }
    const peer = linkedPeer(net, currentRouter, outIface);
    if (!peer || peer.iface.ip !== route.nextHop) {
      return {ok: false, path: [], faultNode: currentRouter.id,
        reason: "Không thể phân giải next hop " + route.nextHop + " qua interface " + outIface.id + " trên " + currentRouter.name + "."};
    }
    const segmentPath = findPath(net, {node: currentRouter, iface: outIface}, {node: peer.node, iface: peer.iface});
    if (!segmentPath) {
      return {ok: false, path: [], faultNode: currentRouter.id,
        reason: "Liên kết tới next hop " + route.nextHop + " đang không khả dụng."};
    }
    if (peer.node.id === targetNode.id) {
      return {ok: true, path: segmentPath, routers: chain,
        routeNotes: [currentRouter.name + " chọn " + route.prefix + " via " + route.nextHop + " qua " + outIface.id + "."]};
    }
    const rest = routeFromRouterToEndpoint(net, peer.node, targetNode, targetIface, chain);
    return {
      ...rest,
      path: [...segmentPath, ...(rest.path || [])],
      routeNotes: [currentRouter.name + " chọn " + route.prefix + " via " + route.nextHop + " qua " + outIface.id + ".", ...(rest.routeNotes || [])]
    };
  }

  function probeCase6(net, sourceId, targetKey, mode) {
    const source = device(net, sourceId), dest = endpoint(net, targetKey);
    const sourcePort = source?.ports[0];
    const steps = [];
    const outcome = (ok, title, extra = {}) => ({ok, title, steps, path: [], returnPath: [], backup: [], faults: [], faultNode: "", ...extra});
    if (!source || !sourcePort?.ip || !dest.node || !dest.iface?.ip) {
      return outcome(false, "Chọn nguồn và đích có địa chỉ IPv4 hợp lệ.");
    }
    const sourceRouter = net.devices.find(node => node.type === "router" &&
      node.ports.some(iface => iface.ip === source.gateway && iface.vlan === sourcePort.vlan));
    const sourceRouterPort = sourceRouter?.ports.find(iface => iface.ip === source.gateway && iface.vlan === sourcePort.vlan);
    if (!sourceRouter || !sourceRouterPort) {
      return outcome(false, "Không tìm thấy default gateway của máy nguồn.", {faultNode: source.id});
    }
    const sourceLan = findPath(net, {node: source, iface: sourcePort}, {node: sourceRouter, iface: sourceRouterPort});
    if (!sourceLan) {
      return outcome(false, "Không thể phân giải gateway vì đường LAN nguồn đang gián đoạn.", {faultNode: sourceRouter.id});
    }
    const arp = {a: {node: source, iface: sourcePort}, b: {node: sourceRouter, iface: sourceRouterPort}};
    steps.push({title: "Chọn next hop", note: source.name + " gửi gói đến default gateway " + source.gateway + "."});
    steps.push({title: "ARP Request", note: source.name + " hỏi MAC của gateway " + source.gateway + " trong VLAN " + sourcePort.vlan + "."});
    steps.push({title: "ARP Reply", note: sourceRouter.name + " trả lời bằng MAC " + sourceRouterPort.mac + "."});
    if (mode === "arp") return outcome(true, "Đã phân giải MAC của gateway", {path: sourceLan, arp});

    const forward = routeFromRouterToEndpoint(net, sourceRouter, dest.node, dest.iface);
    const forwardPath = [...sourceLan, ...(forward.path || [])];
    if (!forward.ok) {
      steps.push({title: "Tra cứu tuyến chiều đi", note: forward.reason});
      return outcome(false, "Gói tin không tới được đích", {path: forwardPath, arp, faultNode: forward.faultNode, faults: []});
    }
    steps.push({title: "Tra cứu tuyến chiều đi", note: (forward.routeNotes || []).join(" ") || "Router nguồn tìm được tuyến hợp lệ tới mạng đích."});
    steps.push({title: "ICMP Echo Request", note: "Echo Request đi qua " + forwardPath.length + " liên kết và đã tới " + dest.node.name + "."});

    const destRouter = net.devices.find(node => node.type === "router" &&
      node.ports.some(iface => iface.ip === dest.node.gateway && iface.vlan === dest.iface.vlan));
    const destRouterPort = destRouter?.ports.find(iface => iface.ip === dest.node.gateway && iface.vlan === dest.iface.vlan);
    if (!destRouter || !destRouterPort) {
      steps.push({title: "Thiếu tuyến hồi đáp", note: "Máy chủ đích không có default gateway hợp lệ để gửi Echo Reply."});
      return outcome(false, "Echo Request tới đích nhưng không có đường hồi đáp", {path: forwardPath, arp, faultNode: dest.node.id});
    }
    const destLan = findPath(net, {node: dest.node, iface: dest.iface}, {node: destRouter, iface: destRouterPort});
    if (!destLan) {
      steps.push({title: "Thiếu tuyến hồi đáp", note: "Server không thể chuyển Echo Reply tới gateway " + dest.node.gateway + "."});
      return outcome(false, "Echo Request tới đích nhưng LAN hồi đáp bị gián đoạn", {path: forwardPath, arp, faultNode: destRouter.id});
    }
    const reverse = routeFromRouterToEndpoint(net, destRouter, source, sourcePort);
    const returnPath = [...destLan, ...(reverse.path || [])];
    if (!reverse.ok) {
      steps.push({title: "ICMP Echo Reply", note: "Server tạo Echo Reply và chuyển gói tới gateway " + dest.node.gateway + "."});
      steps.push({title: "Thiếu tuyến hồi đáp", note: reverse.reason + " Gói Echo Reply dừng tại " + (device(net, reverse.faultNode)?.name || "router đích") + ". Thêm route tới mạng nguồn " + subnet(sourcePort) + " qua next hop " + sourceRouterPort.ip + " trên interface liên kết hai router."});
      return outcome(false, "Echo Request tới đích nhưng thiếu tuyến hồi đáp", {
        path: forwardPath, returnPath, arp, faultNode: reverse.faultNode || destRouter.id,
        returnFailure: reverse.reason
      });
    }
    steps.push({title: "ICMP Echo Reply", note: "Echo Reply quay về theo tuyến hợp lệ: " + (reverse.routeNotes || []).join(" ")});
    return outcome(true, "Hoàn tất phép kiểm tra: Echo Request và Echo Reply đều tới nơi.", {
      path: forwardPath, returnPath, arp, faultNode: ""
    });
  }

  function probeInterdomain(net, sourceId, targetKey, mode) {
    if (net.id === "case6") return probeCase6(net, sourceId, targetKey, mode);
    const source = device(net, sourceId), dest = endpoint(net, targetKey);
    const pathInfo = interdomainPath(net, sourceId, targetKey);
    const steps = [];
    const sourcePort = source?.ports[0];
    const sourceIsRouter = source?.type === "router";
    const gateway = sourceIsRouter ? source : net.devices.find(d => d.type === "router" &&
      d.ports.some(p => p.ip === source?.gateway));
    let arp = null;
    if (source && sourcePort) {
      if (sourceIsRouter && pathInfo.path.length) {
        const firstLink = net.links.find(link => link.id === pathInfo.path[0]);
        const other = firstLink && (firstLink.a.device === source.id ? firstLink.b : firstLink.b.device === source.id ? firstLink.a : null);
        const peer = other && device(net, other.device);
        const peerIface = other && port(peer, other.port);
        if (peer && peerIface) arp = {a: {node: source, iface: port(source, firstLink.a.device === source.id ? firstLink.a.port : firstLink.b.port)}, b: {node: peer, iface: peerIface}};
      } else if (!sourceIsRouter && gateway) {
        const gatewayPort = gateway.ports.find(p => p.ip === source.gateway && p.vlan === sourcePort.vlan);
        if (gatewayPort) arp = {a: {node: source, iface: sourcePort}, b: {node: gateway, iface: gatewayPort}};
      }
    }
    const outcome = (ok, title, faultNode = "") => ({ok, title, steps, path: pathInfo.path, returnPath: [...pathInfo.path].reverse(), backup: pathInfo.backup, faults: pathInfo.faults, faultNode, arp});
    if (!source?.ports[0]?.ip || !dest.iface?.ip) return outcome(false, "Chọn nguồn và đích hợp lệ");
    if (!sourceIsRouter && !gateway) return outcome(false, "Không tìm thấy gateway", source.id);
    if (sourceIsRouter) steps.push({title: "Khởi tạo định tuyến", note: source.name + " tra cứu bảng định tuyến và chọn next hop phù hợp."});
    else steps.push({title: "Chọn next hop", note: "Nguồn gửi frame đầu tiên tới default gateway " + source.gateway + "."});
    if (arp) {
      steps.push({title: "ARP Request", note: arp.a.node.name + " phân giải MAC của next hop " + arp.b.iface.ip + " trong VLAN " + arp.a.iface.vlan + "."});
      steps.push({title: "ARP Reply", note: arp.b.node.name + " trả lời MAC " + arp.b.iface.mac + "."});
    }
    if (mode === "arp") return outcome(!!arp, arp ? "Đã phân giải MAC của next hop" : "Không xác định được next hop để ARP", source.id);
    if (!pathInfo.path.length) {
      steps.push({title: "Không có tuyến liên miền", note: pathInfo.reason});
      return outcome(false, "Không đến được đích", gateway?.id || source.id);
    }
    steps.push({title: net.id === "case12" ? "BGP Best Path" : "Chuyển tiếp Multi-ISP", note: pathInfo.reason});
    steps.push({title: "ICMP", note: "Gói tin đi qua " + pathInfo.path.length + " liên kết tới " + dest.node.name + ", sau đó Echo Reply quay về theo tuyến hợp lệ."});
    return outcome(true, "Ping thành công");
  }

  function probe(net, sourceId, targetKey, mode) {
    if (net.id !== "case1" && net.id !== "case3") return probeInterdomain(net, sourceId, targetKey, mode);
    const source = device(net, sourceId);
    const dest = endpoint(net, targetKey);
    const sourcePort = source?.ports[0];
    const src = {node: source, iface: sourcePort};
    const steps = [], path = [], backup = [], faults = [];
    const log = (title, note) => steps.push({title, note});
    const outcome = (ok, title, faultNode = "") => ({ok, title, steps, path, backup, faults, faultNode});
    if (!source || !sourcePort?.ip || !dest.node || !dest.iface?.ip || source.id === dest.node.id) {
      return outcome(false, "Chọn nguồn và đích khác nhau, có địa chỉ IPv4.");
    }

    function segment(a, b) {
      const route = findPath(net, a, b);
      if (!route) {
        const disabled = (findPath(net, a, b, {includeDown: true}) ?? [])
          .filter(id => !net.links.find(link => link.id === id).up);
        faults.push(...disabled);
        log("Không có đường lớp 2", disabled.length ?
          "Liên kết đang ngắt nên ARP Request không tới đích." :
          "Không tìm thấy đường qua các cổng hoạt động thuộc cùng VLAN.");
        return false;
      }
      path.push(...route);
      backup.push(...backupPath(net, a, b, route));
      const cacheKey = key(a.node, a.iface);
      const cache = net.cache[cacheKey] ??= Object.create(null);
      if (cache[b.iface.ip] === b.iface.mac) {
        log("ARP cache hit", b.iface.ip + " đã ánh xạ tới " + b.iface.mac + ".");
      } else {
        log("ARP Request", a.node.name + " phát broadcast hỏi MAC của " + b.iface.ip + " trong VLAN " + a.iface.vlan + ".");
        cache[b.iface.ip] = b.iface.mac;
        log("ARP Reply", b.node.name + " trả lời bằng MAC " + b.iface.mac + ".");
      }
      return true;
    }

    const onLink = inSubnet(dest.iface.ip, sourcePort);
    log("So sánh subnet", source.name + " thuộc " + subnet(sourcePort) + ". Đích " + dest.iface.ip +
      (onLink ? " nằm cùng subnet theo cấu hình nguồn." : " nằm ngoài subnet theo cấu hình nguồn."));
    if (onLink) {
      if (!segment(src, dest)) return outcome(false, "ARP trực tiếp thất bại", source.id);
      if (mode === "arp") return outcome(true, "Đã phân giải MAC của đích");
      if (!inSubnet(sourcePort.ip, dest.iface)) {
        log("Chiều về", "Đích xem nguồn nằm ngoài subnet của mình. Mô hình không có đường trả lời trực tiếp.");
        return outcome(false, "Ping không có phản hồi", dest.node.id);
      }
      log("ICMP", "Echo Request tới đích và Echo Reply quay lại qua cùng liên kết LAN.");
      return outcome(true, "Ping thành công");
    }

    log("Chọn next hop", "Nguồn không ARP trực tiếp IP đích. Với đích ngoài subnet, nguồn cần MAC của gateway.");
    if (!source.gateway || !inSubnet(source.gateway, sourcePort)) {
      log("Cấu hình gateway", "Gateway đang trống hoặc nằm ngoài subnet của nguồn.");
      return outcome(false, "Thiếu default gateway hợp lệ", source.id);
    }
    const router = net.devices.find(node => node.type === "router" &&
      node.ports.some(iface => iface.ip === source.gateway && iface.vlan === sourcePort.vlan));
    const ingress = router?.ports.find(iface => iface.ip === source.gateway && iface.vlan === sourcePort.vlan);
    if (!ingress) {
      log("Tìm gateway", "Không có interface router nào khớp IP gateway và VLAN của nguồn.");
      return outcome(false, "Không tìm thấy gateway", source.id);
    }
    if (!segment(src, {node: router, iface: ingress})) return outcome(false, "Không phân giải được MAC gateway", router.id);
    if (mode === "arp") return outcome(true, "Đã phân giải MAC của gateway");
    if (dest.node.id === router.id) {
      log("ICMP", "Router nhận gói gửi đến địa chỉ của chính nó và trả lời qua cổng vào.");
      return outcome(true, "Ping thành công");
    }
    const egress = router.ports.filter(iface => iface.vlan === dest.iface.vlan && inSubnet(dest.iface.ip, iface))
      .sort((a, b) => b.prefix - a.prefix)[0];
    if (!egress) {
      log("Tra mạng kết nối trực tiếp", "Router không có interface đi tới subnet và VLAN của đích.");
      return outcome(false, "Router không có tuyến tới đích", router.id);
    }
    log("Frame tới gateway", "MAC đích là " + ingress.mac + ". IP đích vẫn là " + dest.iface.ip + ".");
    if (net.policy?.blocked && ingress.vlan === net.policy.fromVlan && egress.vlan === net.policy.toVlan) {
      log("Chính sách tại router", "Chặn chuyển tiếp từ VLAN " + ingress.vlan + " sang VLAN " + egress.vlan +
        ". ARP broadcast từ nguồn không vượt qua ranh giới VLAN.");
      return outcome(false, "Ping bị chặn tại gateway", router.id);
    }
    log("Định tuyến giữa VLAN", "Router chuyển tiếp gói IP qua " + egress.id + " và thực hiện ARP mới trong VLAN " + egress.vlan + ".");
    if (!segment({node: router, iface: egress}, dest)) return outcome(false, "Không đến được thiết bị nội bộ", router.id);
    if (dest.node.gateway !== egress.ip || !inSubnet(egress.ip, dest.iface) || !inSubnet(sourcePort.ip, ingress)) {
      log("Chiều về", "Đích không có gateway hợp lệ để trả lời về mạng nguồn.");
      return outcome(false, "Ping không có phản hồi", dest.node.id);
    }
    log("ICMP", "Echo Reply quay lại qua router. ARP của mỗi chặng chỉ nằm trong VLAN tương ứng.");
    return outcome(true, "Ping thành công");
  }

  function buildPlayback(network, sourceId, targetKey, mode = "ping") {
    if (network.id !== "case1" && network.id !== "case3") {
      const trial = structuredClone(network);
      const result = probe(trial, sourceId, targetKey, mode);
      const source = device(network, sourceId), dest = endpoint(network, targetKey);
      const frames = [];
      const cache = structuredClone(network.cache || Object.create(null));
      const allPath = [...new Set([...(result.path || []), ...(result.returnPath || [])])];
      const marks = {path: allPath, backup: result.backup || [], faults: result.faults || [], faultNode: result.faultNode || ""};
      const add = (title, note, flows = [], packetData = null, error = false, focus = source?.id) => frames.push({
        title, note, flows, packet: packetData, error, focus, cache: structuredClone(cache), marks
      });
      const edge = (linkId, currentId) => {
        const link = network.links.find(item => item.id === linkId);
        if (!link) return null;
        const from = link.a.device === currentId ? link.a : link.b.device === currentId ? link.b : null;
        if (!from) return null;
        const to = from === link.a ? link.b : link.a;
        const fromNode = device(network, from.device), toNode = device(network, to.device);
        const fromIface = port(fromNode, from.port), toIface = port(toNode, to.port);
        return fromNode && toNode && fromIface && toIface ? {link, fromNode, toNode, fromIface, toIface} : null;
      };
      const flowsForRoute = (route, startId, kind) => {
        let current = startId;
        return (route || []).map((id, index) => {
          const item = edge(id, current);
          if (!item) return null;
          const flow = {from: item.fromNode.id, to: item.toNode.id, linkId: id, delay: index * 560, kind};
          current = item.toNode.id;
          return flow;
        }).filter(Boolean);
      };
      const makeArpPacket = (kind, from, to) => ({
        kind, srcIP: from.iface.ip, dstIP: to.iface.ip,
        srcMAC: from.iface.mac,
        dstMAC: kind === "arp-request" ? "ff:ff:ff:ff:ff:ff" : to.iface.mac,
        nextHop: to.iface.ip, iface: from.node.name + " / " + from.iface.id, ttl: null
      });
      let arpPair = result.arp || null;
      if (!arpPair && source && source.type !== "router") {
        const router = network.devices.find(node => node.type === "router" && node.ports.some(iface => iface.ip === source.gateway));
        const iface = router?.ports.find(item => item.ip === source.gateway);
        if (iface) arpPair = {a: {node: source, iface: source.ports[0]}, b: {node: router, iface}};
      }
      if (!arpPair && source?.type === "router" && result.path?.length) {
        const first = edge(result.path[0], source.id);
        if (first) arpPair = {a: {node: first.fromNode, iface: first.fromIface}, b: {node: first.toNode, iface: first.toIface}};
      }
      const routePackets = (route, startId, reverse = false) => {
        let current = startId, ttl = 64;
        for (const linkId of route || []) {
          const item = edge(linkId, current);
          if (!item) break;
          if (item.fromNode.type === "router") ttl = Math.max(1, ttl - 1);
          const data = {
            kind: reverse ? "icmp-reply" : "icmp-request",
            srcIP: reverse ? dest.iface.ip : source.ports[0].ip,
            dstIP: reverse ? source.ports[0].ip : dest.iface.ip,
            srcMAC: item.fromIface.mac, dstMAC: item.toIface.mac,
            nextHop: item.toIface.ip || item.toNode.name,
            iface: item.fromNode.name + " / " + item.fromIface.id,
            ttl
          };
          const title = (reverse ? "ICMP Echo Reply" : "ICMP Echo Request") + " · " + item.fromNode.name + " → " + item.toNode.name;
          add(title, reverse ? "Echo Reply được chuyển tiếp qua liên kết này; IP nguồn/đích đảo chiều, MAC thay đổi theo next hop." :
            "Echo Request được chuyển tiếp qua liên kết này; IP nguồn/đích được giữ nguyên, MAC thuộc frame của chặng hiện tại.",
            [{from: item.fromNode.id, to: item.toNode.id, linkId, delay: 0, kind: reverse ? "icmp-reply" : "icmp-request"}],
            data, false, item.toNode.id);
          current = item.toNode.id;
        }
      };

      for (const step of result.steps || []) {
        if (step.title === "ARP Request" && arpPair) {
          const route = findPath(network, arpPair.a, arpPair.b) || [];
          add(step.title, step.note, flowsForRoute(route, arpPair.a.node.id, "arp-request"),
            makeArpPacket("arp-request", arpPair.a, arpPair.b), false, arpPair.a.node.id);
        } else if (step.title === "ARP Reply" && arpPair) {
          if (arpPair.a.node.id === source?.id) {
            const cacheKey = key(arpPair.a.node, arpPair.a.iface);
            (cache[cacheKey] ??= Object.create(null))[arpPair.b.iface.ip] = arpPair.b.iface.mac;
          }
          const route = findPath(network, arpPair.b, arpPair.a) || [];
          add(step.title, step.note, flowsForRoute(route, arpPair.b.node.id, "arp-reply"),
            makeArpPacket("arp-reply", arpPair.b, arpPair.a), false, arpPair.a.node.id);
        } else if (step.title === "ICMP" || step.title === "ICMP Echo Request") {
          routePackets(result.path, source.id, false);
        } else if (step.title === "ICMP Echo Reply") {
          routePackets(result.returnPath, dest.node.id, true);
        } else if (step.title === "Thiếu tuyến hồi đáp") {
          add(step.title, step.note, [], {
            kind: "decision", srcIP: dest.iface.ip, dstIP: source.ports[0].ip,
            srcMAC: dest.iface.mac, dstMAC: "Chưa có next hop hợp lệ",
            nextHop: "Không tìm thấy tuyến", iface: (device(network, result.faultNode)?.name || "Router đích"), ttl: 62
          }, true, result.faultNode || dest.node.id);
        } else {
          const isFailure = !result.ok && (step.title.includes("Không có tuyến") || step.title.includes("Không đến được") || step.title.includes("Thiếu") || step.title.includes("Không thể"));
          add(step.title, step.note, [], {
            kind: "decision", srcIP: source?.ports[0]?.ip, dstIP: dest.iface?.ip,
            srcMAC: source?.ports[0]?.mac, dstMAC: "—", nextHop: "—",
            iface: source?.name || "—", ttl: null
          }, isFailure, result.faultNode || source?.id);
        }
      }
      add(result.ok ? "Hoàn tất phép kiểm tra" : "Dừng tại điểm lỗi", result.title,
        [], frames.at(-1)?.packet || null, !result.ok, result.faultNode || dest.node.id);
      return {result, frames};
    }
    const trial = structuredClone(network);
    const result = probe(trial, sourceId, targetKey, mode);
    const frames = [];
    const source = device(network, sourceId);
    const dest = endpoint(network, targetKey);
    if (!source?.ports[0] || !dest.iface) return {result, frames: []};
    const src = {node: source, iface: source.ports[0]};
    const onLink = inSubnet(dest.iface.ip, src.iface);
    const router = network.devices.find(node => node.type === "router" &&
      node.ports.some(iface => iface.ip === source.gateway && iface.vlan === src.iface.vlan));
    const gateway = {node: router, iface: router?.ports.find(p => p.ip === source.gateway && p.vlan === src.iface.vlan)};
    const outPort = router?.ports.filter(p => p.vlan === dest.iface.vlan && inSubnet(dest.iface.ip, p))
      .sort((a, b) => b.prefix - a.prefix)[0];
    const segments = [{a: src, b: onLink ? dest : gateway}];
    if (!onLink && outPort && dest.node.id !== router.id) {
      segments.push({a: {node: router, iface: outPort}, b: dest});
    }
    const cache = structuredClone(network.cache);
    let segmentIndex = 0;

    function flowsForRoute(a, route, kind) {
      let current = a.node.id;
      return (route ?? []).map((id, index) => {
        const link = network.links.find(item => item.id === id);
        const next = link.a.device === current ? link.b.device : link.a.device;
        const flow = {from: current, to: next, linkId: id, delay: index * 560, kind};
        current = next;
        return flow;
      });
    }
    function broadcast(a) {
      const queue = [{id: a.node.id, depth: 0}], seen = new Set([a.node.id]), flows = [];
      while (queue.length) {
        const current = queue.shift();
        for (const link of network.links.filter(item => item.up)) {
          const from = link.a.device === current.id ? link.a : link.b.device === current.id ? link.b : null;
          if (!from || (current.id === a.node.id && from.port !== a.iface.id)) continue;
          const to = from === link.a ? link.b : link.a;
          if (seen.has(to.device)) continue;
          const next = device(network, to.device);
          if (port(device(network, from.device), from.port)?.vlan !== a.iface.vlan ||
            port(next, to.port)?.vlan !== a.iface.vlan) continue;
          seen.add(to.device);
          flows.push({from: current.id, to: next.id, linkId: link.id, delay: current.depth * 560, kind: "arp-request"});
          if (next.type === "switch") queue.push({id: next.id, depth: current.depth + 1});
        }
      }
      return flows;
    }
    const packet = (kind, a, b, reverse = false, ttl = null) => ({
      kind, srcIP: reverse ? dest.iface.ip : src.iface.ip, dstIP: reverse ? src.iface.ip : dest.iface.ip,
      srcMAC: a?.iface?.mac || "Chưa tạo frame", dstMAC: b?.iface?.mac || "Chưa phân giải",
      nextHop: b?.iface?.ip || "—", iface: a ? a.node.name + " / " + a.iface.id : "—", ttl
    });
    function add(title, note, {flows = [], focus = source.id, data = null, error = false, marks = null} = {}) {
      frames.push({
        title, note, flows, focus, packet: data, error, cache: structuredClone(cache),
        marks: marks ?? {path: flows.map(f => f.linkId), backup: [], faults: [], faultNode: error ? focus : ""}
      });
    }
    function icmp(a, b, reverse = false, ttl = 64) {
      if (!a?.iface || !b?.iface) return;
      const route = findPath(network, a, b);
      if (!route) return;
      const kind = reverse ? "icmp-reply" : "icmp-request";
      add(reverse ? "ICMP Echo Reply" : "ICMP Echo Request",
        a.node.name + " gửi " + (reverse ? "phản hồi" : "yêu cầu ping") + " tới " + b.node.name + ".",
        {flows: flowsForRoute(a, route, kind), focus: b.node.id, data: packet(kind, a, b, reverse, ttl)});
    }

    for (const step of result.steps) {
      const seg = segments[segmentIndex] ?? segments.at(-1);
      if (step.title === "ARP Request" && seg?.b.iface) {
        const data = packet("arp-request", seg.a, seg.b);
        Object.assign(data, {srcIP: seg.a.iface.ip, dstIP: seg.b.iface.ip, dstMAC: "ff:ff:ff:ff:ff:ff"});
        add(step.title, step.note, {flows: broadcast(seg.a), data, focus: seg.a.node.id});
      } else if (step.title === "ARP Reply" && seg?.b.iface) {
        const cacheKey = key(seg.a.node, seg.a.iface);
        (cache[cacheKey] ??= Object.create(null))[seg.b.iface.ip] = seg.b.iface.mac;
        const data = packet("arp-reply", seg.b, seg.a);
        Object.assign(data, {srcIP: seg.b.iface.ip, dstIP: seg.a.iface.ip});
        add(step.title, step.note, {
          flows: flowsForRoute(seg.b, findPath(network, seg.b, seg.a), "arp-reply"),
          focus: seg.a.node.id, data
        });
        segmentIndex++;
      } else if (step.title === "ARP cache hit" && seg?.b.iface) {
        add(step.title, step.note, {data: packet("cache", seg.a, seg.b), focus: seg.a.node.id});
        segmentIndex++;
      } else if (step.title === "Frame tới gateway") {
        add(step.title, step.note, {
          flows: flowsForRoute(src, findPath(network, src, gateway), "icmp-request"),
          focus: router.id, data: packet("icmp-request", src, gateway, false, 64)
        });
      } else if (step.title === "ICMP") {
        if (onLink) {
          icmp(src, dest);
          icmp(dest, src, true);
        } else if (dest.node.id === router?.id) {
          icmp(src, gateway);
          icmp(gateway, src, true);
        } else {
          const second = segments[1];
          icmp(second.a, dest, false, 63);
          icmp(dest, second.a, true, 64);
          icmp(gateway, src, true, 63);
        }
      } else if (step.title === "Chiều về") {
        const forward = onLink ? segments[0] : segments[1];
        if (forward) icmp(forward.a, dest, false, onLink ? 64 : 63);
        add(step.title, step.note, {error: true, focus: dest.node.id});
      } else if (step.title === "Không có đường lớp 2") {
        if (seg?.a.iface) {
          const data = packet("arp-request", seg.a, seg.b);
          Object.assign(data, {srcIP: seg.a.iface.ip, dstIP: seg.b.iface?.ip || "—", dstMAC: "ff:ff:ff:ff:ff:ff"});
          add("Thử phân giải ARP", "Broadcast chỉ đi qua các cổng cùng VLAN và liên kết còn hoạt động.",
            {flows: broadcast(seg.a), data});
        }
        add(step.title, step.note, {error: true, marks: {path: [], backup: [], faults: result.faults, faultNode: result.faultNode}});
      } else if (step.title === "Chính sách tại router") {
        add(step.title, step.note, {error: true, focus: router.id,
          data: packet("blocked", src, gateway, false, 64),
          marks: {path: findPath(network, src, gateway) ?? [], backup: [], faults: [], faultNode: router.id}});
      } else {
        add(step.title, step.note, {
          focus: step.title === "Định tuyến giữa VLAN" ? router.id : source.id,
          data: packet("decision", src, onLink ? dest : gateway, false, 64),
          error: ["Cấu hình gateway", "Tìm gateway", "Tra mạng kết nối trực tiếp"].includes(step.title)
        });
      }
    }
    add(result.ok ? "Hoàn tất phép kiểm tra" : "Dừng tại điểm lỗi", result.title, {
      error: !result.ok, focus: result.faultNode || dest.node.id,
      data: frames.at(-1)?.packet ?? null,
      marks: {path: result.path, backup: result.backup, faults: result.faults, faultNode: result.faultNode}
    });
    return {result, frames};
  }

  globalThis.TV1Topology = Object.freeze({createNetwork, findPath, probe, inSubnet, subnet, buildPlayback});
  if (typeof document === "undefined") return;

  const byId = id => document.getElementById(id);
  const esc = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const typeNames = {pc: "PC", switch: "Switch", router: "Router", server: "Server", printer: "Máy in"};
  const icons = {
    pc: '<rect x="-13" y="-10" width="26" height="17" rx="2"/><path d="M-7 12h14M0 7v5"/>',
    switch: '<rect x="-15" y="-8" width="30" height="16" rx="3"/><path d="M-9 0h2m4 0h2m4 0h2m4 0h2"/>',
    router: '<rect x="-13" y="-13" width="26" height="26" rx="6"/><path d="M-8 0H8M-8 0l4-4m-4 4 4 4M8 0L4-4m4 4-4 4M0-8V8"/>',
    server: '<rect x="-10" y="-13" width="20" height="26" rx="3"/><path d="M-10-4h20M-10 4h20m-5-13h2m-2 9h2m-2 9h2"/>',
    printer: '<path d="M-9-5v-8H9v8M-9 7h-5V-5h28V7H9"/><rect x="-9" y="1" width="18" height="11" rx="1"/>'
  };
  let net = createNetwork("case1");
  let selected = {type: "device", id: net.source};
  let srcId = net.source, dstKey = net.target, result = null, overlay = null;
  const map = byId("map");
  const option = (value, text, isSelected = false) => '<option value="' + esc(value) + '"' + (isSelected ? " selected" : "") + ">" + esc(text) + "</option>";

  let playback = null, cursor = -1, autoPlay = false, motionPaused = false;
  let elapsed = 0, lastTick = null, rafId = null, playbackSpeed = 1;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function stopMotion() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    lastTick = null;
  }
  function clearPlayback() {
    stopMotion();
    playback = null; cursor = -1; autoPlay = false; motionPaused = false; elapsed = 0;
  }
  function currentFrame() {
    return playback?.frames[cursor] ?? null;
  }
  function frameDuration() {
    return Math.max(2300, ...((currentFrame()?.flows ?? []).map(flow => flow.delay + 1100)));
  }
  function drawMotion() {
    const layer = map.querySelector("#packet-layer");
    const frame = currentFrame();
    if (!layer || !frame || overlay) return;
    const nodes = new Map(net.devices.map(node => [node.id, node]));
    const chips = frame.flows.map(flow => {
      const a = nodes.get(flow.from), b = nodes.get(flow.to);
      if (!a || !b || elapsed < flow.delay) return "";
      const continuing = frame.flows.some(next => next.from === flow.to && next.delay >= flow.delay + 560);
      if (elapsed >= flow.delay + 560 && continuing && !reducedMotion) return "";
      const fraction = reducedMotion ? 0.5 : Math.min(1, (elapsed - flow.delay) / 560);
      const x = a.x + (b.x - a.x) * fraction, y = a.y + (b.y - a.y) * fraction;
      const label = flow.kind === "arp-request" ? "ARP?" : flow.kind === "arp-reply" ? "ARP✓" : flow.kind === "icmp-reply" ? "REPLY" : "PING";
      return '<g class="packet-token ' + flow.kind + '" transform="translate(' + x + ' ' + y + ')"><circle class="packet-halo" r="24"/><rect x="-23" y="-12" width="46" height="24" rx="12"/><text y="4">' + label + '</text></g>';
    }).join("");
    layer.innerHTML = chips;
  }
  function tick(time) {
    rafId = null;
    if (!playback) return;
    const delta = lastTick === null ? 0 : Math.min(time - lastTick, 80);
    lastTick = time;
    if (!motionPaused) elapsed += delta * playbackSpeed;
    drawMotion();
    if (autoPlay && elapsed >= frameDuration()) {
      if (cursor < playback.frames.length - 1) {
        showFrame(cursor + 1);
        return;
      }
      autoPlay = false;
      renderPlayback();
    }
    if (!motionPaused && (autoPlay || elapsed < frameDuration())) rafId = requestAnimationFrame(tick);
  }
  function startMotion() {
    stopMotion();
    rafId = requestAnimationFrame(tick);
  }
  function showFrame(index) {
    if (!playback) return;
    cursor = Math.max(0, Math.min(index, playback.frames.length - 1));
    if (cursor === playback.frames.length - 1) autoPlay = false;
    elapsed = 0;
    overlay = null;
    net.cache = structuredClone(currentFrame().cache);
    renderMap(); renderPlayback(); renderResult();
    startMotion();
  }
  function beginPlayback(mode, shouldAutoPlay = true) {
    stopMotion();
    playback = buildPlayback(net, srcId, dstKey, mode);
    result = playback.result;
    if (!playback.frames.length) {
      clearPlayback();
      renderResult();
      return;
    }
    autoPlay = shouldAutoPlay;
    motionPaused = false;
    showFrame(0);
    announce("");
  }

  function renderPlayback() {
    const frame = currentFrame();
    byId("prev").disabled = !frame || cursor === 0;
    byId("next").disabled = !frame || cursor === playback.frames.length - 1;
    byId("play").disabled = !srcId || !dstKey;
    byId("play").textContent = autoPlay ? "Ⅱ Tạm dừng" : "▶ Tự chạy";
    byId("step-counter").textContent = frame ? "Bước " + (cursor + 1) + " / " + playback.frames.length : "Sẵn sàng";
    byId("progress-count").textContent = frame ? (cursor + 1) + " / " + playback.frames.length : "0 bước";
    byId("progress-fill").style.width = frame ? ((cursor + 1) / playback.frames.length * 100) + "%" : "0%";
    byId("stage-title").textContent = frame?.title ?? "Một thay đổi nhỏ. Một hành trình khác.";
    byId("stage-note").textContent = frame?.note ?? "Chọn nguồn, đích rồi chạy ping hoặc kiểm tra ARP. Bạn có thể tự chạy, tạm dừng hoặc xem lại từng bước.";
    byId("stage-number").textContent = frame ? String(cursor + 1).padStart(2, "0") : "00";
    byId("stage-kind").textContent = frame?.error ? "ĐIỂM CẦN KIỂM TRA" : frame?.packet?.kind?.startsWith("arp") ? "PHÂN GIẢI ĐỊA CHỈ MAC" : "QUAN SÁT TỪNG BƯỚC";
    document.querySelector(".stage-card").classList.toggle("stage-error", !!frame?.error);
    byId("step-list").innerHTML = playback ? playback.frames.map((step, index) =>
      '<button class="step-item ' + (index === cursor ? "current" : index < cursor ? "done" : "") +
      '" data-step="' + index + '" aria-current="' + (index === cursor ? "step" : "false") + '"><span class="step-index">' +
      (index < cursor ? "✓" : index + 1) + '</span><span>' + esc(step.title) + '</span>' +
      (step.error ? '<span class="step-error-dot" aria-label="Có lỗi">!</span>' : "") + '</button>').join("") :
      '<p class="muted">Các bước sẽ xuất hiện khi bạn bắt đầu.</p>';
    byId("step-list").querySelector(".current")?.scrollIntoView({block: "nearest", behavior: "instant", container: "nearest"});
    const info = frame?.packet;
    const packetNames = {"arp-request": "ARP Request", "arp-reply": "ARP Reply", "icmp-request": "ICMP Request",
      "icmp-reply": "ICMP Reply", blocked: "Bị chặn", cache: "ARP cache", decision: "IPv4"};
    byId("packet-badge").textContent = info ? packetNames[info.kind] : "—";
    const fields = [
      ["IP nguồn", info?.srcIP ?? "—"], ["IP đích / IP cần hỏi ARP", info?.dstIP ?? "—"],
      ["MAC nguồn", info?.srcMAC ?? "—"], ["MAC đích", info?.dstMAC ?? "—"],
      ["Interface đang gửi", info?.iface ?? "—"], ["Next hop", info?.nextHop ?? "—"],
      ["TTL trên chặng", info?.ttl === null || info?.ttl === undefined ? "Không áp dụng" : info.ttl]
    ];
    byId("packet-fields").innerHTML = '<dl>' + fields.map(([label,value]) => '<div><dt>' + label + '</dt><dd>' +
      esc(value) + '</dd></div>').join("") + '</dl><p class="packet-hint">' +
      (info?.kind.startsWith("arp") ? "ARP hoạt động trong broadcast domain. Bản tin ARP không có TTL của IP." :
      "IP đích giữ nguyên qua router. MAC đích thay đổi theo next hop của mỗi liên kết.") + '</p>';
  }

  function portStatus(dev, iface) {
    const cable = net.links.find(link => [link.a, link.b].some(end => end.device === dev.id && end.port === iface.id));
    return cable ? cable.up ? "Up" : "Down" : "Trống";
  }
  const status = dev => dev.ports.some(iface => portStatus(dev, iface) === "Up") ? "Up" : "Isolated";


  // Khung vùng (zone) cho từng kịch bản. "match" khớp theo id hoặc tên thiết bị.
  // Kịch bản có thể tự khai báo thuộc tính `zones` trong file dữ liệu để ghi đè bảng này.
  const CASE_ZONES = {
    case2: [
      {label: "MẠNG NGƯỜI DÙNG", tone: "blue", match: ["Máy trạm"]},
      {label: "GATEWAY", tone: "amber", match: ["Gateway"]},
      {label: "MẠNG MÁY CHỦ", tone: "teal", match: ["Máy chủ dịch vụ"]}
    ],
    case4: [
      {label: "LAN KẾ TOÁN", tone: "blue", match: ["pc-c4"]},
      {label: "ROUTER CHI NHÁNH", tone: "amber", match: ["gw-c4"]},
      {label: "MẠNG TRUNG TÂM", tone: "teal", match: ["srv-c4"]}
    ],
    case5: [
      {label: "ROUTER MAIN", tone: "blue", match: ["r5-src"]},
      {label: "ROUTER 192.168.1.0/24", tone: "amber", match: ["r5-dst"]},
      {label: "MẠNG ĐÍCH", tone: "teal", match: ["srv-c5"]}
    ],
    case6: [
      {label: "MẠNG NGUỒN", tone: "blue", match: ["pc-c6"]},
      {label: "ROUTER NGUỒN", tone: "amber", match: ["r6-src"]},
      {label: "ROUTER ĐÍCH", tone: "violet", match: ["r6-dst"]},
      {label: "MẠNG ĐÍCH", tone: "teal", match: ["srv-c6"]}
    ],
    case7: [
      {label: "MẠNG NGUỒN", tone: "blue", match: ["pc-c7"]},
      {label: "ROUTER A", tone: "amber", match: ["r7a"]},
      {label: "ROUTER B", tone: "violet", match: ["r7b"]},
      {label: "MẠNG ĐÍCH", tone: "teal", match: ["srv-c7"]}
    ],
    case8: [
      {label: "TRỤ SỞ TP.HCM", tone: "blue", match: ["router_hcm"]},
      {label: "TUYẾN CHÍNH", tone: "teal", match: ["router_bd"]},
      {label: "TUYẾN DỰ PHÒNG", tone: "violet", match: ["router_hn"]},
      {label: "TRUNG TÂM DỮ LIỆU", tone: "amber", match: ["router_dc", "dc_server"]}
    ],
    case9: [
      {label: "MẠNG NGUỒN", tone: "blue", match: ["r1_c9"]},
      {label: "TUYẾN B · 3 HOP", tone: "violet", match: ["r2_c9", "r3_c9"]},
      {label: "MẠNG ĐÍCH", tone: "amber", match: ["r_dest_c9"]}
    ],
    case10: [
      {label: "NGUỒN R1", tone: "blue", match: ["r1_c10"]},
      {label: "NHÁNH TRÊN", tone: "teal", match: ["r2_c10", "r4_c10"]},
      {label: "NHÁNH DƯỚI", tone: "violet", match: ["r3_c10", "r5_c10"]},
      {label: "ĐÍCH R6", tone: "amber", match: ["r6_c10"]}
    ],
    case12: [
      {label: "AS65001 · DOANH NGHIỆP", tone: "blue", pad: 70, match: ["ent-client", "as65001"]},
      {label: "AS65002 · ISP-1", tone: "teal", match: ["as65002"]},
      {label: "ISP-2 · TRANSIT", tone: "violet", pad: 60, match: ["as65003", "as65004"]},
      {label: "AS65005 · ĐÍCH", tone: "amber", pad: 60, match: ["as65005", "cloud-srv"]}
    ],
    case11: [
      {label: "MẠNG DOANH NGHIỆP", tone: "blue", match: ["PC Doanh nghiệp", "Router Biên DN"]},
      {label: "ISP-A · CÁP BIỂN", tone: "teal", match: ["ISP-A (Cáp biển)"]},
      {label: "ISP-B · DỰ PHÒNG", tone: "violet", match: ["ISP-B (Dự phòng)"]},
      {label: "HẠ TẦNG QUỐC TẾ", tone: "amber", match: ["Gateway Quốc tế", "Server Quốc tế"]}
    ]
  };
  function zoneMarkup(net) {
    const defs = net.zones ?? CASE_ZONES[net.id] ?? [];
    return defs.map(def => {
      const nodes = net.devices.filter(n => def.match.includes(n.id) || def.match.includes(n.name));
      if (!nodes.length) return "";
      const cx = (Math.min(...nodes.map(n => n.x)) + Math.max(...nodes.map(n => n.x))) / 2;
      let x1 = Math.min(...nodes.map(n => n.x)) - (def.pad ?? 85), x2 = Math.max(...nodes.map(n => n.x)) + (def.pad ?? 85);
      const need = def.label.length * 11 + 36;
      if (x2 - x1 < need) { x1 = cx - need / 2; x2 = cx + need / 2; }
      x1 = Math.max(8, x1); x2 = Math.min(892, x2);
      const y1 = Math.min(...nodes.map(n => n.y)) - 64, y2 = Math.max(...nodes.map(n => n.y)) + 80;
      return '<rect class="zone zone-' + def.tone + '" x="' + x1 + '" y="' + y1 + '" width="' + (x2 - x1) + '" height="' + (y2 - y1) +
        '" rx="18"/><text class="zone-text" x="' + (x1 + 18) + '" y="' + (y1 + 26) + '">' + esc(def.label) + '</text>';
    }).join("");
  }

  function renderMap() {
    const marks = overlay ?? currentFrame()?.marks ?? result;
    const yMax = Math.max(380, ...net.devices.map(node => node.y + 96));
    map.setAttribute("viewBox", "0 0 900 " + yMax);
    const vlanLabels = (net.id !== "case1" && net.id !== "case3") ? zoneMarkup(net) : net.id === "case3" ?
      '<rect class="zone zone-guest" x="26" y="62" width="370" height="228" rx="18"/><rect class="zone zone-office" x="504" y="62" width="370" height="228" rx="18"/><text class="zone-text" x="46" y="90">VLAN 30 · KHÁCH</text><text class="zone-text" x="524" y="90">VLAN 10 · NỘI BỘ</text>' :
      '<rect class="zone zone-office" x="30" y="62" width="840" height="228" rx="18"/><text class="zone-text" x="50" y="90">VLAN 10 · VĂN PHÒNG</text>';
    const wires = net.links.map(link => {
      const a = device(net, link.a.device), b = device(net, link.b.device);
      const isSelected = selected.type === "link" && selected.id === link.id;
      const style = !link.up || marks?.faults.includes(link.id) ? "down" :
        marks?.path.includes(link.id) ? "active" : marks?.backup.includes(link.id) ? "backup" : "up";
      const coords = 'x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"';
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      return '<g class="wire ' + style + (isSelected ? ' selected' : '') + '" role="button" tabindex="0" aria-pressed="' + isSelected + '" aria-label="' +
        esc("Liên kết " + a.name + " – " + b.name + ", cost " + link.cost + (link.up ? ", up" : ", down")) +
        '" data-link="' + esc(link.id) + '"><line class="wire-hit" ' + coords + '/><line class="wire-line" ' + coords +
        '/><g transform="translate(' + x + ' ' + y + ')"><rect class="wire-tag" x="-24" y="-27" width="48" height="21" rx="6"/><text class="wire-text" y="-12">' +
        (link.up ? link.cost : 'Down') + '</text></g></g>';
    }).join("");
    const nodes = net.devices.map(node => {
      const isSelected = selected.type === "device" && selected.id === node.id;
      const ip = node.ports.length === 1 && node.ports[0].ip ? node.ports[0].ip + "/" + node.ports[0].prefix : typeNames[node.type];
      const activePort = status(node) === "Up";
      const fault = marks?.faultNode === node.id;
      const focused = currentFrame()?.focus === node.id && !overlay;
      return '<g class="node' + (isSelected ? ' selected' : '') + (fault ? ' fault' : '') + (focused ? ' focused' : '') + '" role="button" tabindex="0" aria-pressed="' +
        isSelected + '" aria-label="' + esc(node.name + " " + ip + " " + status(node)) + '" data-device="' + esc(node.id) +
        '" transform="translate(' + node.x + ' ' + node.y + ')"><rect class="node-box" x="-33" y="-29" width="66" height="58" rx="15"/><g class="icon">' +
        icons[node.type] + '</g><circle class="node-dot ' + (activePort ? "online" : "offline") +
        '" cx="25" cy="-23" r="5"/><text class="node-name" y="50">' + esc(node.name) + '</text><text class="node-meta" y="69">' +
        esc(ip) + '</text></g>';
    }).join("");
    map.innerHTML = vlanLabels + wires + nodes + '<g id="packet-layer" aria-hidden="true" style="pointer-events:none"></g>';
    drawMotion();
  }

  function renderInspector() {
    const host = byId("inspector");
    if (selected.type === "link") {
      const link = net.links.find(item => item.id === selected.id);
      if (link) {
        const a = device(net, link.a.device), b = device(net, link.b.device);
        const sameVlan = port(a, link.a.port).vlan === port(b, link.b.port).vlan;
        host.innerHTML = '<div class="object-title"><strong>Liên kết</strong><span class="state ' + (link.up ? "yes" : "no") + '">' +
          (link.up ? "Up" : "Down") + '</span></div><p class="port-desc">' + esc(a.name + " · " + link.a.port + " ↔ " + b.name + " · " + link.b.port) +
          '</p>' + (sameVlan ? "" : '<p class="error-note">VLAN hai đầu không khớp.</p>') +
          '<form id="link-form"><label>Cost<input name="cost" type="number" min="1" max="9999" required value="' + link.cost +
          '"></label><div class="two"><button class="primary">Lưu cost</button><button type="button" class="secondary" data-action="toggle-link">' +
          (link.up ? "Ngắt liên kết" : "Khôi phục") + '</button></div></form><button type="button" class="text-danger" data-action="delete-link">Xóa liên kết</button>';
        return;
      }
    }
    const node = selected.type === "device" ? device(net, selected.id) : null;
    if (!node) {
      host.innerHTML = '<p class="muted">Chọn một thiết bị hoặc liên kết trên sơ đồ để xem chi tiết.</p>';
      return;
    }
    const state = status(node);
    const ports = node.ports.map(iface => '<div class="port-row"><div><b>' + esc(iface.id) + '</b> <span>VLAN ' +
      iface.vlan + '</span></div><span>' + esc(portStatus(node, iface)) + '</span><div class="address">' +
      (iface.ip ? esc(iface.ip + "/" + iface.prefix + " · subnet " + subnet(iface)) : "Không có IP") +
      (iface.mac ? '<br>' + esc(iface.mac) : '') + '</div></div>').join("");
    const p = node.ports[0];
    const editable = node.type !== "switch";
    const routePanel = net.id === "case6" && node.type === "router" ?
      '<details class="inline-details route-editor" open><summary>Bảng định tuyến tĩnh</summary>' +
      '<p class="muted">Thêm tuyến đến mạng cần truy cập. Với Router đích, cần route về <b>10.0.10.0/24</b> qua <b>192.168.100.1</b> trên <b>g0/0</b>.</p>' +
      ((node.routes || []).length ? '<div class="route-list">' + node.routes.map((route, index) =>
        '<div class="route-row"><span><b>' + esc(route.prefix) + '</b><small>via ' + esc(route.nextHop) + ' · ' + esc(route.interface) + '</small></span>' +
        '<button type="button" class="small secondary" data-action="delete-route" data-route-index="' + index + '">Xóa</button></div>').join("") + '</div>' :
        '<p class="empty-route">Chưa có static route. Router chỉ biết các mạng kết nối trực tiếp.</p>') +
      '<form id="route-form"><label>Mạng đích / Prefix<input name="prefix" required value="' + (node.id === "r6-dst" ? "10.0.10.0/24" : "10.0.20.0/24") + '" placeholder="10.0.10.0/24"></label>' +
      '<div class="two"><label>Next hop<input name="nextHop" required inputmode="decimal" value="' + (node.id === "r6-dst" ? "192.168.100.1" : "192.168.100.2") + '"></label>' +
      '<label>Interface<select name="interface">' + node.ports.map(iface => option(iface.id, iface.id, iface.id === (node.id === "r6-dst" ? "g0/0" : "g0/1"))).join("") + '</select></label></div>' +
      '<button class="primary">Lưu static route</button></form></details>' : "";
    host.innerHTML = '<div class="object-title"><strong>' + esc(node.name) + '</strong><span class="state ' +
      (state === "Up" ? "yes" : "no") + '">' + state + '</span></div><p class="port-desc">' + typeNames[node.type] +
      (node.gateway ? " · GW " + esc(node.gateway) : "") + '</p><div class="ports">' + ports + '</div>' +
      (editable ? '<details class="inline-details"><summary>Sửa interface / IP</summary><form id="device-form"><label>Interface<select name="iface">' +
        node.ports.map(iface => option(iface.id, iface.id)).join("") + '</select></label><div class="two"><label>IPv4<input name="ip" inputmode="decimal" value="' +
        esc(p.ip) + '" placeholder="192.168.10.10"></label><label>Prefix<input name="prefix" type="number" min="0" max="32" required value="' +
        p.prefix + '"></label></div><label>VLAN<input name="vlan" type="number" min="1" max="4094" required value="' +
        p.vlan + '"></label>' + (node.type === "router" ? "" : '<label>Default gateway<input name="gateway" inputmode="decimal" value="' +
        esc(node.gateway) + '"></label>') + '<button class="primary">Lưu cấu hình</button></form></details>' : "") + routePanel +
      '<button type="button" class="text-danger" data-action="delete-device">Xóa thiết bị</button>';
  }

  function renderPickers() {
    const l2Case = net.id === "case1" || net.id === "case3";
    const sources = net.devices.filter(node => (l2Case ? node.type !== "router" : node.type !== "switch") && node.ports[0]?.ip);
    if (!sources.some(node => node.id === srcId)) srcId = sources[0]?.id ?? "";
    const targets = net.devices.filter(node => node.id !== srcId).flatMap(node =>
      node.ports.filter(iface => iface.ip).map(iface => ({node, iface})));
    if (!targets.some(({node, iface}) => key(node, iface) === dstKey)) dstKey = targets[0] ? key(targets[0].node, targets[0].iface) : "";
    byId("source").innerHTML = sources.map(node => option(node.id, node.name + " · " + node.ports[0].ip, node.id === srcId)).join("");
    byId("target").innerHTML = targets.map(({node, iface}) => option(key(node, iface), node.name + " · " + iface.ip, key(node, iface) === dstKey)).join("");
    for (const id of ["ping", "arp"]) byId(id).disabled = !srcId || !dstKey;
    const ports = net.devices.flatMap(node => node.ports.filter(iface => portStatus(node, iface) === "Trống")
      .map(iface => option(key(node, iface), node.name + " · " + iface.id + " · VLAN " + iface.vlan)));
    for (const id of ["port-a", "port-b"]) byId(id).innerHTML = option("", "Chọn cổng trống") + ports.join("");
  }

  function renderResult() {
    const complete = playback && cursor === playback.frames.length - 1;
    const visibleSteps = playback ? playback.frames.slice(0, cursor + 1) : [];
    byId("result").innerHTML = result ?
      '<span class="state ' + (complete ? result.ok ? 'yes' : 'no' : 'neutral') + '">' +
      (complete ? result.ok ? 'THÀNH CÔNG' : 'THẤT BẠI' : 'ĐANG QUAN SÁT') + '</span><h3>' +
      esc(complete ? result.title : currentFrame()?.title ?? result.title) +
      '</h3><details class="trace"><summary>Các bước đã quan sát (' + visibleSteps.length +
      ')</summary><ol class="steps">' + visibleSteps.map(step =>
      '<li><strong>' + esc(step.title) + '</strong><span>' + esc(step.note) + '</span></li>').join("") + '</ol></details>' :
      '<h3>Chưa chạy phép kiểm tra</h3><p class="muted">Bắt đầu một lượt để xem kết quả và đối chiếu với cấu hình.</p>';
    const src = device(net, srcId);
    const entries = src ? src.ports.flatMap(iface => Object.entries(net.cache[key(src, iface)] ?? {})
      .map(([ip, mac]) => ({ip, mac, iface: iface.id}))) : [];
    byId("clear-cache").disabled = !src;
    byId("cache").innerHTML = entries.length ? '<table><thead><tr><th scope="col">Interface</th><th scope="col">IP</th><th scope="col">MAC</th></tr></thead><tbody>' +
      entries.map(entry => '<tr><td>' + esc(entry.iface) + '</td><td>' + esc(entry.ip) + '</td><td>' + esc(entry.mac) + '</td></tr>').join("") +
      '</tbody></table>' : '<p class="muted">Chưa có ánh xạ IP–MAC ở bước này.</p>';
  }

  function renderPreset() {
    if (net.id !== "case1" && net.id !== "case3") { byId("preset").innerHTML = ""; return; }
    byId("preset").innerHTML = net.id === "case1" ?
      '<span>Cấu hình nhanh</span><button class="small secondary" data-preset="fix">Sửa IP laptop</button><button class="small secondary" data-preset="break">Đặt lại IP sai</button>' :
      '<span>Chính sách VLAN khách</span><button class="small secondary" data-preset="policy" aria-pressed="' + net.policy.blocked + '">' +
      (net.policy.blocked ? "Đang chặn · cho phép thử" : "Đang cho phép · bật chặn") +
      '</button><button class="small secondary" data-preset="gateway">Chọn đích gateway</button>';
  }
  function announce(message, isError = false) {
    const notice = byId("notice");
    notice.hidden = !message;
    notice.textContent = message;
    notice.classList.toggle("error", isError);
  }
  function renderAll() {
    renderMap();
    renderInspector();
    renderPickers();
    renderPreset();
    renderResult();
    renderPlayback();
  }
  function changed(message) {
    clearPlayback();
    net.cache = Object.create(null);
    result = null;
    overlay = null;
    renderAll();
    announce(message);
    document.dispatchEvent(new CustomEvent("tv1:topologychange", {detail: {scenarioId: net.id}}));
  }
  function loadScenario(id) {
    net = createNetwork(id);
    selected = {type: "device", id: net.source};
    srcId = net.source;
    dstKey = net.target;
    byId("scenario").value = id;
    byId("case-number").textContent = "CASE " + net.number;
    byId("map-title").textContent = net.title;
    byId("case-desc").textContent = net.description;
    byId("add-device").reset();
    byId("add-device").elements.vlan.value = id === "case3" ? 30 : 10;
    document.dispatchEvent(new CustomEvent("tv1:scenarioload", {detail: {scenarioId: id}}));
    changed("");
  }

  byId("scenario").innerHTML = scenarios.map(s => option(s.id, "Case " + Number(s.number) + " · " + s.title)).join("");
  byId("scenario").addEventListener("change", e => loadScenario(e.target.value));
  byId("reset").addEventListener("click", () => { loadScenario(net.id); announce("Đã đặt lại kịch bản."); });
  function choose(event, focus = false) {
    const target = event.target.closest("[data-device], [data-link]");
    if (!target) return;
    selected = target.dataset.device ? {type: "device", id: target.dataset.device} : {type: "link", id: target.dataset.link};
    renderMap();
    renderInspector();
    byId("config-panel").open = true;
    if (focus) [...map.querySelectorAll("[data-device], [data-link]")].find(el =>
      (el.dataset.device ?? el.dataset.link) === selected.id)?.focus();
  }
  map.addEventListener("click", event => choose(event));
  map.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(event, true); }
  });
  byId("inspector").addEventListener("click", event => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "delete-route") {
      const node = device(net, selected.id);
      const index = Number(event.target.closest("[data-route-index]")?.dataset.routeIndex);
      if (!node || !Array.isArray(node.routes) || !Number.isInteger(index) || index < 0 || index >= node.routes.length) return;
      node.routes.splice(index, 1);
      changed("Đã xóa static route trên " + node.name + ".");
      return;
    }
    if (action === "delete-device") {
      const name = device(net, selected.id).name;
      net.devices = net.devices.filter(node => node.id !== selected.id);
      net.links = net.links.filter(link => link.a.device !== selected.id && link.b.device !== selected.id);
      selected = {};
      changed("Đã xóa " + name + " và các liên kết của thiết bị.");
      return;
    }
    const link = net.links.find(item => item.id === selected.id);
    if (action === "toggle-link") {
      link.up = !link.up;
      changed(link.up ? "Đã khôi phục liên kết." : "Đã ngắt liên kết.");
    }
    if (action === "delete-link") {
      net.links = net.links.filter(item => item !== link);
      selected = {};
      changed("Đã xóa liên kết.");
    }
  });
  byId("inspector").addEventListener("change", event => {
    if (event.target.name !== "iface") return;
    const form = event.target.form;
    const iface = port(device(net, selected.id), event.target.value);
    for (const field of ["ip", "prefix", "vlan"]) form.elements[field].value = iface[field];
  });
  byId("inspector").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.target;
    const values = new FormData(form);
    if (form.id === "route-form") {
      const node = device(net, selected.id);
      if (!node || node.type !== "router" || net.id !== "case6") return;
      const prefixInput = String(values.get("prefix") || "").trim();
      const nextHop = String(values.get("nextHop") || "").trim();
      const ifaceId = String(values.get("interface") || "").trim();
      const parts = prefixInput.split("/");
      const networkAddress = ipv4(parts[0]);
      const prefix = Number(parts[1]);
      if (networkAddress === null || parts.length !== 2 || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
        return announce("Mạng đích phải có dạng IPv4/Prefix hợp lệ, ví dụ 10.0.10.0/24.", true);
      }
      if (nextHop === "" || ipv4(nextHop) === null) return announce("Next hop phải là địa chỉ IPv4 hợp lệ.", true);
      const iface = port(node, ifaceId);
      if (!iface || !inSubnet(nextHop, iface)) return announce("Next hop không thuộc subnet của interface đã chọn.", true);
      const bits = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      const canonicalPrefix = ipText((networkAddress & bits) >>> 0) + "/" + prefix;
      node.routes ||= [];
      const existing = node.routes.find(route => route.prefix === canonicalPrefix);
      const route = {prefix: canonicalPrefix, nextHop, interface: ifaceId};
      if (existing) Object.assign(existing, route);
      else node.routes.push(route);
      changed("Đã lưu tuyến " + canonicalPrefix + " qua " + nextHop + " trên " + node.name + ".");
      return;
    }
    if (form.id === "link-form") {
      const cost = Number(values.get("cost"));
      if (!Number.isInteger(cost) || cost < 1 || cost > 9999) return announce("Cost phải là số nguyên từ 1 đến 9999.", true);
      net.links.find(link => link.id === selected.id).cost = cost;
      changed("Đã cập nhật cost.");
      return;
    }
    const node = device(net, selected.id);
    const iface = port(node, values.get("iface"));
    const ip = values.get("ip").trim(), gateway = (values.get("gateway") ?? "").trim();
    if ((ip && ipv4(ip) === null) || (gateway && ipv4(gateway) === null)) return announce("IPv4 hoặc gateway không hợp lệ.", true);
    const vlan = Number(values.get("vlan")), prefix = Number(values.get("prefix"));
    if (ip && net.devices.some(other => other.ports.some(p => p !== iface && p.ip === ip && p.vlan === vlan))) {
      return announce("Địa chỉ IP đã được sử dụng trong VLAN này.", true);
    }
    Object.assign(iface, {ip, vlan, prefix});
    node.gateway = gateway;
    changed("Đã lưu cấu hình " + node.name + ".");
  });

  byId("add-device").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const name = data.get("name").trim(), vlan = Number(data.get("vlan")), type = data.get("type");
    if (!name) return announce("Nhập tên thiết bị.", true);
    if (net.devices.length >= 18) return announce("Sơ đồ hỗ trợ tối đa 18 thiết bị.", true);
    const cells = Array.from({length: 18}, (_, i) => ({x: 90 + (i % 6) * 144, y: 345 + Math.floor(i / 6) * 122}));
    const position = cells.find(c => !net.devices.some(node => node.x === c.x && node.y === c.y));
    const number = net.nextId++;
    const count = {pc: 1, switch: 6, router: 3, server: 1}[type];
    const hex = value => value.toString(16).padStart(2, "0");
    const ports = Array.from({length: count}, (_, i) => ({
      id: type === "switch" ? "p" + (i + 1) : type === "router" ? "g0/" + i : "eth0",
      vlan, ip: "", prefix: 24, mac: type === "switch" ? "" : "02:10:00:" + hex((number >> 8) & 255) + ":" + hex(number & 255) + ":" + hex(i)
    }));
    const id = "node-" + number;
    net.devices.push({id, name, type, ...position, ports, gateway: ""});
    form.elements.name.value = "";
    selected = {type: "device", id};
    changed("Đã thêm " + name + ". Dùng “Nối hai cổng” để kết nối thiết bị.");
  });
  byId("add-link").addEventListener("submit", event => {
    event.preventDefault();
    const form = new FormData(event.target);
    const a = endpoint(net, form.get("a")), b = endpoint(net, form.get("b"));
    if (!a.iface || !b.iface || a.node.id === b.node.id) return announce("Chọn hai cổng thuộc hai thiết bị khác nhau.", true);
    if (portStatus(a.node, a.iface) !== "Trống" || portStatus(b.node, b.iface) !== "Trống") return announce("Hai cổng phải còn trống.", true);
    if (a.iface.vlan !== b.iface.vlan) return announce("Chọn hai cổng cùng VLAN.", true);
    const id = "link-" + net.nextId++;
    net.links.push({id, a: {device: a.node.id, port: a.iface.id}, b: {device: b.node.id, port: b.iface.id}, up: true, cost: 10});
    selected = {type: "link", id};
    changed("Đã tạo liên kết.");
  });

  byId("source").addEventListener("change", event => {
    clearPlayback();
    srcId = event.target.value;
    result = null;
    overlay = null;
    renderPickers(); renderMap(); renderResult(); renderPlayback();
  });
  byId("target").addEventListener("change", event => {
    clearPlayback();
    dstKey = event.target.value;
    result = null;
    overlay = null;
    renderMap(); renderResult(); renderPlayback();
  });
  for (const mode of ["ping", "arp"]) {
    byId(mode).addEventListener("click", () => {
      beginPlayback(mode, true);
    });
  }
  byId("clear-cache").addEventListener("click", () => {
    const source = device(net, srcId);
    if (!source) return;
    clearPlayback();
    source.ports.forEach(iface => delete net.cache[key(source, iface)]);
    result = null;
    overlay = null;
    renderMap(); renderResult();
    renderPlayback();
    announce("Đã xóa ARP cache của nguồn.");
  });
  byId("preset").addEventListener("click", event => {
    const action = event.target.closest("[data-preset]")?.dataset.preset;
    if (!action) return;
    if (action === "gateway") {
      if (!device(net, "gateway") || !device(net, "guest")) return announce("Đặt lại kịch bản để khôi phục thiết bị mẫu.", true);
      clearPlayback();
      srcId = "guest";
      dstKey = "gateway/g0/0";
      result = null;
      overlay = null;
      renderAll();
      return;
    }
    if (action === "policy") {
      net.policy.blocked = !net.policy.blocked;
      changed(net.policy.blocked ? "Đã bật chặn từ VLAN khách vào VLAN nội bộ." : "Đã tắt chặn để kiểm tra inter-VLAN routing.");
      return;
    }
    const laptop = device(net, "laptop");
    if (!laptop) return announce("Đặt lại kịch bản để khôi phục laptop mẫu.", true);
    const ip = action === "fix" ? "192.168.10.10" : "192.168.20.10";
    if (net.devices.some(node => node !== laptop && node.ports.some(p => p.ip === ip && p.vlan === 10))) {
      return announce("Địa chỉ IP mẫu đã được sử dụng trong VLAN 10.", true);
    }
    Object.assign(laptop.ports[0], {ip, prefix: 24, vlan: 10});
    laptop.gateway = "";
    changed("Laptop hiện dùng " + ip + "/24.");
  });
  byId("prev").addEventListener("click", () => {
    autoPlay = false; motionPaused = false; showFrame(cursor - 1);
  });
  byId("next").addEventListener("click", () => {
    autoPlay = false; motionPaused = false; showFrame(cursor + 1);
  });
  byId("play").addEventListener("click", () => {
    if (!playback) return beginPlayback("ping", true);
    if (autoPlay) {
      autoPlay = false; motionPaused = true; stopMotion(); renderPlayback(); return;
    }
    autoPlay = true; motionPaused = false;
    if (cursor === playback.frames.length - 1) showFrame(0);
    else { renderPlayback(); startMotion(); }
  });
  byId("speed").addEventListener("change", event => { playbackSpeed = Number(event.target.value); });
  byId("step-list").addEventListener("click", event => {
    const button = event.target.closest("[data-step]");
    if (!button) return;
    autoPlay = false; motionPaused = false; showFrame(Number(button.dataset.step));
  });
  globalThis.TV1TopologyUI = Object.freeze({
    getNetwork: () => structuredClone(net),
    highlight: ({path = [], backup = [], faults = [], faultNode = ""} = {}) => {
      stopMotion();
      autoPlay = false;
      renderPlayback();
      overlay = {path: [...path], backup: [...backup], faults: [...faults], faultNode};
      renderMap();
    },
    clearHighlight: () => { overlay = null; renderMap(); }
  });
  loadScenario("case1");
})();