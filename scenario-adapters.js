/* Chỉ mã TV06. Các engine được truyền vào là bản sao nguồn, không chỉnh sửa nguồn TV1–TV5. */
(function(root){
  const copy=x=>structuredClone(x);
  const INFO={
    case1:['Laptop không ping được máy in','wrong-subnet','fix-subnet','Đối chiếu hai địa chỉ /24: laptop 192.168.20.10 và máy in 192.168.10.50 khác subnet. Khi không có gateway, nguồn không thể gửi tới đích như một máy cùng mạng.'],
    case3:['Wi-Fi khách tới gateway được nhưng không tới máy nội bộ','vlan-policy','allow-policy','ARP broadcast chỉ ở VLAN nguồn. Trong dữ liệu TV1, policy chặn định tuyến VLAN 30 sang VLAN 10. Tắt policy chỉ để đối chứng trong phòng lab.'],
    case5:['Có nhiều prefix cùng khớp đích 192.168.1.50','longest-prefix','keep-lpm','Tuyến 192.168.1.0/24 cụ thể hơn /16 và /0 nên được chọn trong forwarding. Đây không phải so sánh metric giữa các giao thức.'],
    case6:['Echo Request đến server nhưng ping không nhận phản hồi','missing-return','add-return-route','Bảng router_dest có default route tới Null0. Đó là tuyến loại bỏ, không phải đường về có thể chuyển tiếp tới nguồn.'],
    case7:['Gói lặp qua Router A và B rồi hết TTL','routing-loop','fix-loop','Đối chiếu next hop hai router và lịch sử gói đi A–B–A–B. TTL hết hạn riêng lẻ không đủ chứng minh loop; ở đây có thêm vết đường lặp.'],
    case8:['Tuyến chính doanh nghiệp ngắt và static không dự phòng mất kết nối','main-down','enable-backup','Ngắt link_main_1, static không dự phòng thất bại. Với dự phòng, đường qua Hà Nội hoạt động theo mô hình TV4. Không suy ra thời gian hội tụ thực.'],
    case9:['Tuyến được chọn ít hop nhưng trễ cao hơn tuyến khác','hop-metric','keep-hop','Tuyến A có 1 hop, độ trễ 100 ms; tuyến B có 3 hop, tổng 30 ms. RIP dùng hop count, không tối ưu độ trễ minh họa.'],
    case10:['OSPF đổi đường khi cost một liên kết tăng','cost-change','restore-cost','Đường trên ban đầu cost 15; tăng l_r1_r2 từ 5 lên 100 thì đường dưới cost 40 được chọn. Dijkstra ở đây là mô hình đơn giản, không mô phỏng đầy đủ các bản tin OSPF.'],
    case11:['Dịch vụ quốc tế vẫn tới được nhưng chậm hơn sau sự cố ISP','isp-down','restore-isp','Đường ISP-A bị ngắt, ISP-B còn thông. Tuyến dự phòng duy trì kết nối nhưng không bảo đảm giữ nguyên hiệu năng.'],
    case12:['Tuyến BGP có AS-PATH dài hơn lại được chọn','local-pref','keep-policy','Trong mô hình TV5, ISP-B có Local Preference 200 lớn hơn ISP-A 100. Chính sách này được xét trước độ dài AS-PATH.']
  };
  const choices=[['wrong-subnet','Sai subnet'],['vlan-policy','Chính sách giữa VLAN'],['longest-prefix','Longest Prefix Match'],['missing-return','Thiếu tuyến về'],['routing-loop','Vòng lặp định tuyến'],['main-down','Tuyến chính bị ngắt'],['hop-metric','Ưu tiên hop count'],['cost-change','Cost thay đổi'],['isp-down','Tuyến ISP bị ngắt'],['local-pref','Local Preference cao hơn']];
  const remedies=[['fix-subnet','Sửa subnet laptop'],['allow-policy','Cho phép policy để đối chứng'],['keep-lpm','Giữ quy tắc LPM'],['add-return-route','Bổ sung tuyến về'],['fix-loop','Sửa next hop tạo loop'],['enable-backup','Cấu hình tuyến dự phòng'],['keep-hop','Giữ hop count theo mô hình RIP'],['restore-cost','Khôi phục cost ban đầu'],['restore-isp','Phục hồi tuyến ISP chính'],['keep-policy','Giữ chính sách BGP đã xác minh']];
  function create(id,e){
    if(!INFO[id])throw Error('Case chưa có adapter TV06');
    const [symptom,cause,remedy,explanation]=INFO[id];
    let net=e.network(id),fixed=false;
    if(id==='case8')net.links.find(l=>l.id==='link_main_1').up=false;
    if(id==='case10')net.links.find(l=>l.id==='l_r1_r2').cost=100;
    if(id==='case11')net.links.find(l=>l.id==='wan-ispa-1').up=false;
    function probe(){
      if(id==='case1'||id==='case3')return e.tv1.probe(net,net.source,net.target,'ping');
      if(id==='case5')return e.tv3lookup.longestPrefixMatch('192.168.1.50',net.router_main);
      if(id==='case6'){
        const request=new e.tv3routing.Packet('192.168.10.5','10.0.20.50');
        const out=e.tv3routing.processPacketAtRouter(request,'router_source',net.router_source);
        const reply=new e.tv3routing.Packet('10.0.20.50','192.168.10.5');
        const back=e.tv3routing.processPacketAtRouter(reply,'router_dest',net.router_dest);
        return {forward:out,reverse:back,success:out.success&&back.success};
      }
      if(id==='case7'){
        const p=new e.tv3routing.Packet('10.0.0.100','172.16.5.10',5);
        let r;for(let i=0;i<8;i++){const k=i%2?'router_B':'router_A';r=e.tv3routing.processPacketAtRouter(p,k,net[k]);if(!r.success)break;}
        return {last:r,history:p.history,ttl:p.ttl,note:'TTL Expired là nhãn engine TV3; không tự suy ra loop nếu chưa xem history.'};
      }
      if(id==='case8')return e.static.findRoute(net,net.source,fixed?'has_backup':'no_backup');
      if(id==='case9')return e.rip.findShortestHopPath(net,net.source,net.target.split('/')[0]);
      if(id==='case10')return e.ospf.computeDijkstra(net,net.source,net.target.split('/')[0]);
      if(id==='case11')return e.isp.evaluateCase11(net);
      return e.bgp.selectBestBgpRoute(net);
    }
    return {title:'Điều tra '+id.toUpperCase(),symptom,choices,remedies,
      tests:[{id:'config',label:'Xem cấu hình và các tuyến đầu vào'},{id:'probe',label:'Chạy kiểm tra bằng engine gốc'}],
      observe:test=>test==='config'?copy(net):probe(),
      assessment:()=>({cause,remedy,evidence:['config','probe'],explanation,reject:'Kết luận cần cấu hình và kết quả quan sát cùng lượt. Các engine gốc được giữ nguyên; kết quả kiểm thử giới hạn được ghi riêng.'}),
      repair:action=>{
        if(action!==remedy)return {success:false,message:'Biện pháp không phù hợp với case này.'};
        if(id==='case1')net.devices.find(d=>d.id==='laptop').ports[0].ip='192.168.10.10';
        if(id==='case3')net.policy.blocked=false;
        if(id==='case6')net.router_dest.unshift({prefix:'192.168.10.0/24',nextHop:'192.168.100.1'});
        if(id==='case7')return {success:false,message:'Đã xác định cấu hình cần sửa; engine TV3 không mô phỏng đầy đủ topology sau sửa. Cần TV3 cung cấp đường next hop tới đích để retest.'};
        if(id==='case8')fixed=true;
        if(id==='case10')net.links.find(l=>l.id==='l_r1_r2').cost=5;
        if(id==='case11')net.links.find(l=>l.id==='wan-ispa-1').up=true;
        return probe();
      }
    };
  }
  root.TV06ScenarioAdapters={create,ids:Object.keys(INFO),choices,remedies};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.TV06ScenarioAdapters;
})(globalThis);
