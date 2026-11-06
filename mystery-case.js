/* Mô hình tham chiếu nhỏ cho TV06. Không thay thế bộ mô phỏng của TV1–TV5. */
(function (root) {
  'use strict';
  const clone = x => JSON.parse(JSON.stringify(x));
  function ipv4(ip) {
    if (typeof ip !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error('IPv4 không hợp lệ');
    const a = ip.split('.').map(Number);
    if (a.some(n => n > 255)) throw new Error('IPv4 không hợp lệ');
    return a.reduce((v, n) => v * 256 + n, 0);
  }
  function matches(ip, cidr) {
    const parts = cidr.split('/');
    if (parts.length !== 2 || !/^\d+$/.test(parts[1])) throw new Error('CIDR không hợp lệ');
    const bits = Number(parts[1]);
    if (bits < 0 || bits > 32) throw new Error('Prefix phải từ 0 đến 32');
    const divisor = 2 ** (32 - bits);
    return Math.floor(ipv4(ip) / divisor) === Math.floor(ipv4(parts[0]) / divisor);
  }
  function lookup(ip, routes) {
    ipv4(ip);
    return routes.filter(r => matches(ip, r.prefix)).sort((a,b) =>
      Number(b.prefix.split('/')[1]) - Number(a.prefix.split('/')[1]) ||
      (a.metric || 0) - (b.metric || 0) || a.nextHop.localeCompare(b.nextHop)
    )[0] || null;
  }
  const TESTS = [
    ['config','Xem cấu hình IP và gateway'], ['lan','Ping máy cùng LAN'],
    ['gateway','Ping gateway đang cấu hình'], ['arp','Đọc ARP cache'],
    ['inventory','Đối chiếu hồ sơ quản trị'], ['links','Xem trạng thái liên kết'],
    ['routes-r1','Xem bảng định tuyến R1'], ['routes-r2','Xem bảng định tuyến R2'],
    ['ping','Ping máy chủ hai chiều'], ['trace','Theo dõi chiều đi và chiều về']
  ].map(([id,label]) => ({id,label}));
  const SOLUTIONS = {
    'wrong-gateway': { cause:'wrong-gateway', evidence:['config','gateway'], remedy:'set-gateway',
      explanation:'PC cấu hình gateway 192.168.10.254 nhưng gateway hợp lệ là 192.168.10.1. Không có thiết bị trả lời ARP cho .254. Sửa gateway thành .1 rồi ping lại.',
      reject:'Ping LAN thành công chỉ xác nhận kết nối nội bộ, chưa xác nhận gateway đúng.' },
    'mac-change': { cause:'mac-change', evidence:['arp','inventory'], remedy:'verify-mac',
      explanation:'MAC gateway trong cache khác hồ sơ cũ. Nhật ký bảo trì xác nhận đã thay R1 và MAC mới là hợp lệ. Trong bài này nguyên nhân mất kết nối là cache còn MAC cũ; làm mới cache sau khi xác minh. Một khác biệt MAC riêng lẻ chỉ là dấu hiệu nghi vấn, không chứng minh ARP spoofing.',
      reject:'Cần đối chiếu cache với cấu hình và nhật ký bảo trì trước khi gắn nhãn tấn công.' },
    'missing-return': { cause:'missing-return', evidence:['routes-r2','trace'], remedy:'add-return-route',
      explanation:'Echo Request tới server nhưng R2 không có tuyến về 192.168.10.0/24 và cũng không có default route. Thêm tuyến về qua 10.0.12.1. Kiểm tra cả Echo Request và Echo Reply sau khi sửa.',
      reject:'Gói đến server không đồng nghĩa ping thành công; cần có đường quay về.' },
    'link-down': { cause:'link-down', evidence:['links','trace'], remedy:'restore-link',
      explanation:'Liên kết R1–R2 đang down. Gateway và LAN vẫn hoạt động nhưng gói bị dừng ở liên kết WAN. Phục hồi liên kết rồi kiểm tra lại đường đi hai chiều.',
      reject:'Chưa có bằng chứng về sai gateway hay giả mạo ARP khi cấu hình và MAC đều đúng.' }
  };
  const base = () => ({
    host:{ip:'192.168.10.10',prefix:24,gateway:'192.168.10.1'},
    server:{ip:'192.168.20.10',gateway:'192.168.20.1'},
    gatewayMAC:'02:00:00:00:10:01', cacheMAC:'02:00:00:00:10:01',wanUp:true,
    r1:[{prefix:'192.168.10.0/24',nextHop:'connected',interface:'LAN'},
        {prefix:'10.0.12.0/30',nextHop:'connected',interface:'WAN'},
        {prefix:'192.168.20.0/24',nextHop:'10.0.12.2',interface:'WAN'}],
    r2:[{prefix:'192.168.20.0/24',nextHop:'connected',interface:'LAN'},
        {prefix:'10.0.12.0/30',nextHop:'connected',interface:'WAN'},
        {prefix:'192.168.10.0/24',nextHop:'10.0.12.1',interface:'WAN'}]
  });
  class MysteryNetwork {
    #state; #fault;
    constructor(fault = 'missing-return') {
      if (fault !== 'none' && !SOLUTIONS[fault]) throw new Error('Biến thể không được hỗ trợ');
      this.#fault = fault; this.#state = base();
      if (fault === 'wrong-gateway') this.#state.host.gateway = '192.168.10.254';
      if (fault === 'mac-change') this.#state.gatewayMAC = '02:00:00:00:10:99';
      if (fault === 'missing-return') this.#state.r2 = this.#state.r2.filter(r=>r.prefix !== '192.168.10.0/24');
      if (fault === 'link-down') this.#state.wanUp = false;
    }
    get state() { return clone(this.#state); }
    setLink(up) { this.#state.wanUp = Boolean(up); }
    setGateway(ip) { ipv4(ip); this.#state.host.gateway = ip; }
    setRoutes(router, routes) {
      if (!['r1','r2'].includes(router)) throw new Error('Router không hợp lệ');
      routes.forEach(r=>matches('0.0.0.0',r.prefix)); this.#state[router] = clone(routes);
    }
    ping(ttl = 64) {
      if (!Number.isInteger(ttl) || ttl < 1 || ttl > 255) throw new Error('TTL phải là số nguyên 1–255');
      const s = this.#state, forward=['PC'], reverse=[];
      const failed = (reason, at) => ({success:false,reason,at,forward,reverse,ttl});
      if (s.host.gateway !== '192.168.10.1') return failed('ARP_GATEWAY_UNRESOLVED','PC');
      if (s.cacheMAC !== s.gatewayMAC) return failed('STALE_ARP_CACHE','LAN');
      forward.push('R1');
      if (ttl <= 1) return failed('TTL_EXPIRED','R1'); ttl--;
      const r1out=lookup(s.server.ip,s.r1);
      if (!r1out) return failed('NO_FORWARD_ROUTE','R1');
      if (r1out.nextHop!=='10.0.12.2' || r1out.interface!=='WAN') return failed('INVALID_NEXT_HOP','R1');
      if (!s.wanUp) return failed('LINK_DOWN','R1–R2');
      forward.push('R2');
      if (ttl <= 1) return failed('TTL_EXPIRED','R2'); ttl--;
      const r2out=lookup(s.server.ip,s.r2);
      if (!r2out) return failed('NO_FORWARD_ROUTE','R2');
      if (r2out.nextHop!=='connected' || r2out.interface!=='LAN') return failed('INVALID_NEXT_HOP','R2');
      forward.push('Server'); reverse.push('Server','R2');
      const r2back=lookup(s.host.ip,s.r2);
      if (!r2back) return failed('NO_RETURN_ROUTE','R2');
      if (r2back.nextHop!=='10.0.12.1' || r2back.interface!=='WAN') return failed('INVALID_NEXT_HOP','R2');
      reverse.push('R1');
      const r1back=lookup(s.host.ip,s.r1);
      if (!r1back) return failed('NO_RETURN_ROUTE','R1');
      if (r1back.nextHop!=='connected' || r1back.interface!=='LAN') return failed('INVALID_NEXT_HOP','R1');
      reverse.push('PC');
      return {success:true,reason:'ECHO_REPLY_RECEIVED',forward,reverse,ttl};
    }
    observe(id) {
      const s = this.#state;
      const values = {
        config:()=>({PC:s.host,server:s.server}),
        lan:()=>({target:'192.168.10.20',success:true,description:'Cùng LAN /24; liên kết LAN luôn up trong mô hình này.'}),
        gateway:()=>({target:s.host.gateway,success:s.host.gateway==='192.168.10.1' && s.cacheMAC===s.gatewayMAC,arpResolved:s.host.gateway==='192.168.10.1'}),
        arp:()=>({device:'PC',entries:[{ip:s.host.gateway,mac:s.host.gateway==='192.168.10.1'?s.cacheMAC:null,status:s.host.gateway==='192.168.10.1'?'cached':'incomplete'}]}),
        inventory:()=>({gatewayIP:'192.168.10.1',recordedMAC:'02:00:00:00:10:01',currentMAC:s.gatewayMAC,maintenance:s.gatewayMAC.endsWith('99')?'Đã thay R1; MAC 02:00:00:00:10:99 được quản trị xác nhận hợp lệ.':'Không có thay đổi thiết bị.'}),
        links:()=>({PC_R1:'up',R1_R2:s.wanUp?'up':'down',R2_Server:'up'}),
        'routes-r1':()=>({device:'R1',routes:s.r1}),
        'routes-r2':()=>({device:'R2',routes:s.r2}),
        ping:()=>this.ping(), trace:()=>this.ping()
      };
      if (!values[id]) throw new Error('Phép kiểm tra không hợp lệ');
      return clone(values[id]());
    }
    repair(remedy) {
      const s = this.#state;
      if (remedy === 'set-gateway') s.host.gateway='192.168.10.1';
      else if (remedy === 'verify-mac') s.cacheMAC=s.gatewayMAC;
      else if (remedy === 'add-return-route') {
        if (!lookup(s.host.ip,s.r2)) s.r2.push({prefix:'192.168.10.0/24',nextHop:'10.0.12.1',interface:'WAN'});
      } else if (remedy === 'restore-link') s.wanUp=true;
      else throw new Error('Biện pháp không hợp lệ');
      return this.ping();
    }
    assessment() {
      if (this.#fault==='none') throw new Error('Baseline không phải bài thử thách');
      return clone(SOLUTIONS[this.#fault]);
    }
  }
  const api = {MysteryNetwork, TESTS, ipv4, matches, lookup};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.TV06Network=api;
})(typeof window !== 'undefined' ? window : globalThis);
