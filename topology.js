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
    return {...structuredClone(template), cache: Object.create(null), nextId: 1};
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

  function probeInterdomain(net, sourceId, targetKey, mode) {
    const source = device(net, sourceId), dest = endpoint(net, targetKey);
    const steps = [], pathInfo = interdomainPath(net, sourceId, targetKey);
    const outcome = (ok, title, faultNode = "") => ({ok, title, steps, path: pathInfo.path, backup: pathInfo.backup, faults: pathInfo.faults, faultNode});
    if (!source?.ports[0]?.ip || !dest.iface?.ip) return outcome(false, "Chọn nguồn và đích hợp lệ");
    const sourceIsRouter = source.type === "router";
    const gateway = sourceIsRouter ? source : net.devices.find(d => d.type === "router" && d.ports.some(p => p.ip === source.gateway));
    if (!gateway) return outcome(false, "Không tìm thấy gateway", source.id);
    if (!sourceIsRouter) {
      steps.push({title: "Chọn next hop", note: "Nguồn gửi frame đầu tiên tới default gateway " + source.gateway + "."});
      steps.push({title: "ARP Request", note: source.name + " phân giải MAC của gateway trong mạng LAN."});
      steps.push({title: "ARP Reply", note: gateway.name + " trả lời MAC của cổng gateway."});
    } else {
      steps.push({title: "Khởi tạo định tuyến", note: source.name + " tra cứu bảng định tuyến và chọn next hop phù hợp."});
    }
    if (mode === "arp") return outcome(true, "Đã phân giải MAC của gateway");
    if (!pathInfo.path.length) {
      steps.push({title: "Không có tuyến liên miền", note: pathInfo.reason});
      return outcome(false, "Không đến được đích", gateway.id);
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
      const routeFlows = (route, reverse = false, kind = "icmp-request") => {
        const ids = reverse ? [...route].reverse() : route;
        let current = reverse ? dest.node.id : source.id;
        return ids.map((id, index) => {
          const link = network.links.find(item => item.id === id);
          const next = link.a.device === current ? link.b.device : link.a.device;
          const flow = {from: current, to: next, linkId: id, delay: index * 560, kind};
          current = next;
          return flow;
        });
      };
      const gateway = network.devices.find(d => d.type === "router" && d.ports.some(p => p.ip === source?.gateway));
      const gatewayPort = gateway?.ports.find(p => p.ip === source?.gateway);
      const packet = (kind, reverse = false) => ({
        kind, srcIP: reverse ? dest.iface.ip : source.ports[0].ip, dstIP: reverse ? source.ports[0].ip : dest.iface.ip,
        srcMAC: reverse ? dest.iface.mac : source.ports[0].mac,
        dstMAC: reverse ? source.ports[0].mac : (gatewayPort?.mac || "Chưa phân giải"),
        nextHop: reverse ? source.ports[0].ip : (gatewayPort?.ip || "—"),
        iface: reverse ? dest.node.name + " / " + dest.iface.id : source.name + " / " + source.ports[0].id,
        ttl: 64
      });
      const frames = [];
      const add = (title, note, flows = [], data = null, error = false, focus = source?.id) => frames.push({
        title, note, flows, data, error, focus, cache: structuredClone(network.cache),
        marks: {path: result.path, backup: result.backup, faults: result.faults, faultNode: error ? (result.faultNode || focus) : ""}
      });
      for (const step of result.steps) {
        if (step.title === "ARP Request") add(step.title, step.note, routeFlows(result.path.slice(0, 1), false, "arp-request"), {...packet("arp-request"), dstMAC: "ff:ff:ff:ff:ff:ff"});
        else if (step.title === "ARP Reply") add(step.title, step.note, routeFlows(result.path.slice(0, 1), true, "arp-reply"), packet("arp-reply", true));
        else if (step.title === "ICMP") {
          add("ICMP Echo Request", step.note, routeFlows(result.path), packet("icmp-request"));
          add("ICMP Echo Reply", "Đích phản hồi qua tuyến hợp lệ.", routeFlows(result.path, true, "icmp-reply"), packet("icmp-reply", true));
        } else {
          const error = step.title.includes("Không có tuyến");
          add(step.title, step.note, [], packet("decision"), error, error ? (result.faultNode || gateway?.id) : source?.id);
        }
      }
      add(result.ok ? "Hoàn tất phép kiểm tra" : "Dừng tại điểm lỗi", result.title, [], frames.at(-1)?.packet, !result.ok, result.faultNode || dest.node.id);
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
      {label: "ROUTER LIÊN KẾT", tone: "amber", match: ["r6"]},
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
    host.innerHTML = '<div class="object-title"><strong>' + esc(node.name) + '</strong><span class="state ' +
      (state === "Up" ? "yes" : "no") + '">' + state + '</span></div><p class="port-desc">' + typeNames[node.type] +
      (node.gateway ? " · GW " + esc(node.gateway) : "") + '</p><div class="ports">' + ports + '</div>' +
      (editable ? '<details class="inline-details"><summary>Sửa interface / IP</summary><form id="device-form"><label>Interface<select name="iface">' +
        node.ports.map(iface => option(iface.id, iface.id)).join("") + '</select></label><div class="two"><label>IPv4<input name="ip" inputmode="decimal" value="' +
        esc(p.ip) + '" placeholder="192.168.10.10"></label><label>Prefix<input name="prefix" type="number" min="0" max="32" required value="' +
        p.prefix + '"></label></div><label>VLAN<input name="vlan" type="number" min="1" max="4094" required value="' +
        p.vlan + '"></label>' + (node.type === "router" ? "" : '<label>Default gateway<input name="gateway" inputmode="decimal" value="' +
        esc(node.gateway) + '"></label>') + '<button class="primary">Lưu cấu hình</button></form></details>' : "") +
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
    const entries = src ? Object.entries(net.cache[key(src, src.ports[0])] ?? {}) : [];
    byId("clear-cache").disabled = !src;
    byId("cache").innerHTML = entries.length ? '<table><thead><tr><th scope="col">IP</th><th scope="col">MAC</th></tr></thead><tbody>' +
      entries.map(([ip, mac]) => '<tr><td>' + esc(ip) + '</td><td>' + esc(mac) + '</td></tr>').join("") +
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
    delete net.cache[key(source, source.ports[0])];
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