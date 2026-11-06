(function () {
  "use strict";
  const port = (id, vlan, ip = "", prefix = 24, mac = "") => ({ id, vlan, ip, prefix, mac });
  const host = (id, name, x, y, vlan, ip, mac, gateway = "", type = "pc") => ({ id, name, type, x, y, gateway, ports: [port("eth0", vlan, ip, 24, mac)] });
  const router = (id, name, x, y, ports) => ({ id, name, type: "router", x, y, gateway: "", ports });
  const link = (id, a, ap, b, bp, cost = 10) => ({ id, a: {device:a, port:ap}, b: {device:b, port:bp}, up:true, cost });
  const mac = (n, p = "00") => "02:00:00:" + n + ":" + p + ":01";

  const scenarios = [
    { id:"case1", number:"01", title:"Kết nối cùng mạng LAN", description:"Kiểm tra ARP và ping giữa laptop và máy in trong cùng VLAN.", source:"laptop", target:"printer/eth0",
      devices:[host("laptop","Laptop",150,195,10,"192.168.10.10",mac("01","10")), host("printer","Máy in",750,195,10,"192.168.10.50",mac("01","50"),"","printer"), {id:"sw1",name:"Switch văn phòng",type:"switch",x:450,y:195,gateway:"",ports:[port("p1",10),port("p2",10)]}],
      links:[link("c1-a","laptop","eth0","sw1","p1"),link("c1-b","sw1","p2","printer","eth0")] },
    { id:"case2", number:"02", title:"Theo dõi ARP gateway", description:"Phát hiện ánh xạ ARP gateway bất thường và xác minh trước khi kết luận.", source:"pc-c2", target:"srv-c2/eth0", arpAnomaly:{active:true,gatewayIp:"192.168.20.1",expectedMac:"02:00:00:02:01:01",suspiciousMac:"02:00:00:02:99:99",suspectDeviceId:"unknown"},
      devices:[host("pc-c2","Máy trạm",110,195,20,"192.168.20.10",mac("02","10"),"192.168.20.1"),router("gw-c2","Gateway",350,195,[port("g0/0",20,"192.168.20.1",24,"02:00:00:02:01:01"),port("g0/1",21,"10.20.0.1",24,"02:00:00:02:01:02")]),host("srv-c2","Máy chủ dịch vụ",760,195,21,"10.20.0.10",mac("02","50"),"10.20.0.1","server")],
      links:[link("c2-lan","pc-c2","eth0","gw-c2","g0/0"),link("c2-wan","gw-c2","g0/1","srv-c2","eth0")] },
    { id:"case3", number:"03", title:"Wi-Fi khách và VLAN nội bộ", description:"Quan sát ARP dừng tại gateway, sau đó router chuyển tiếp giữa hai VLAN hợp lệ.", source:"guest", target:"internal/eth0",
      devices:[host("guest","Wi-Fi khách",100,195,30,"192.168.30.10",mac("03","10"),"192.168.30.1"),router("gw-c3","Router gateway",450,195,[port("g0/0",30,"192.168.30.1",24,"02:00:00:03:00:01"),port("g0/1",10,"192.168.10.1",24,"02:00:00:03:01:01")]),host("internal","Máy nội bộ",800,195,10,"192.168.10.20",mac("03","20"),"192.168.10.1","server")],
      links:[link("c3-guest","guest","eth0","gw-c3","g0/0"),link("c3-internal","gw-c3","g0/1","internal","eth0")],policy:{blocked:false} },
    { id:"case4", number:"04", title:"Default gateway cho mạng khác subnet", description:"Kiểm tra gateway hợp lệ và quá trình chuyển tiếp gói tin ra khỏi subnet.", source:"pc-c4", target:"srv-c4/eth0",
      devices:[host("pc-c4","PC kế toán",100,195,40,"172.16.40.10",mac("04","10"),"172.16.40.1"),router("gw-c4","Router chi nhánh",450,195,[port("g0/0",40,"172.16.40.1",24,"02:00:00:04:01:01"),port("g0/1",41,"172.16.41.1",24,"02:00:00:04:01:02")]),host("srv-c4","Server trung tâm",800,195,41,"172.16.41.10",mac("04","50"),"172.16.41.1","server")],links:[link("c4-a","pc-c4","eth0","gw-c4","g0/0"),link("c4-b","gw-c4","g0/1","srv-c4","eth0")] },
    { id:"case5", number:"05", title:"Longest Prefix Match", description:"Router ưu tiên route có prefix dài nhất trước default route.", source:"r5-src", target:"srv-c5/eth0",
      devices:[router("r5-src","Router Main",130,195,[port("eth0",50,"10.0.0.1",24,"02:00:00:05:01:01"),port("eth1",51,"192.168.1.1",24,"02:00:00:05:01:02")]),router("r5-dst","Router mạng 192.168.1.0/24",500,195,[port("g0/0",51,"192.168.1.2",24,"02:00:00:05:02:01"),port("g0/1",52,"192.168.2.1",24,"02:00:00:05:02:02")]),host("srv-c5","Máy chủ đích",800,195,52,"192.168.2.10",mac("05","50"),"192.168.2.1","server")],links:[link("c5-a","r5-src","eth1","r5-dst","g0/0"),link("c5-b","r5-dst","g0/1","srv-c5","eth0")] },
    { id:"case6", number:"06", title:"Kiểm tra tuyến hồi đáp", description:"Kiểm tra đường đi và đường về để ping hoàn tất hai chiều.", source:"pc-c6", target:"srv-c6/eth0",
      devices:[host("pc-c6","PC nguồn",100,195,60,"10.0.10.10",mac("06","10"),"10.0.10.1"),router("r6","Router liên kết",450,195,[port("g0/0",60,"10.0.10.1",24,"02:00:00:06:01:01"),port("g0/1",61,"10.0.20.1",24,"02:00:00:06:01:02")]),host("srv-c6","Server đích",800,195,61,"10.0.20.10",mac("06","50"),"10.0.20.1","server")],links:[link("c6-a","pc-c6","eth0","r6","g0/0"),link("c6-b","r6","g0/1","srv-c6","eth0")] },
    { id:"case7", number:"07", title:"Phòng tránh routing loop", description:"Quan sát TTL giảm tại router và chọn tuyến hợp lệ để tránh vòng lặp.", source:"pc-c7", target:"srv-c7/eth0",
      devices:[host("pc-c7","PC nguồn",100,195,70,"172.16.7.10",mac("07","10"),"172.16.7.1"),router("r7a","Router A",350,195,[port("g0/0",70,"172.16.7.1",24,"02:00:00:07:01:01"),port("g0/1",71,"10.7.0.1",24,"02:00:00:07:01:02")]),router("r7b","Router B",600,195,[port("g0/0",71,"10.7.0.2",24,"02:00:00:07:02:01"),port("g0/1",72,"172.16.5.1",24,"02:00:00:07:02:02")]),host("srv-c7","Máy chủ đích",840,195,72,"172.16.5.10",mac("07","50"),"172.16.5.1","server")],links:[link("c7-a","pc-c7","eth0","r7a","g0/0"),link("c7-b","r7a","g0/1","r7b","g0/0"),link("c7-c","r7b","g0/1","srv-c7","eth0")] }
  ];
  const all = globalThis.TV1TopologyData?.scenarios;
  if (Array.isArray(all)) all.unshift(...scenarios);
})();
