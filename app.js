/* Không dùng innerHTML với dữ liệu quan sát hoặc dữ liệu do người học nhập. */
(()=>{
  const $=id=>document.getElementById(id);
  const faults=['wrong-gateway','mac-change','missing-return','link-down'];
  let round=0,challenge,variant;
  const originalCauses=Array.from($('cause').options).map(o=>[o.value,o.text]);
  const originalRemedies=Array.from($('remedy').options).map(o=>[o.value,o.text]);
  function options(id,entries){$(id).replaceChildren();entries.forEach(([value,text])=>{const o=document.createElement('option');o.value=value;o.textContent=text;$(id).append(o);});}
  function engines(){return {get tv1(){try{return $('tv1-engine').contentWindow.TV1Topology;}catch(e){throw Error('Case 1 và 3 cần máy chủ cục bộ. Xem README để mở http://localhost:8766.');}},
    tv3lookup:TV3RouteLookup,tv3routing:TV3Routing,static:TV4Static,rip:TV4RIP,ospf:TV4OSPF,isp:TV5ISP,bgp:TV5BGP,
    network:id=>['case5','case6','case7'].includes(id)?structuredClone(TV3RouteData.routeData[id]):{...structuredClone(TV1TopologyData.scenarios.find(s=>s.id===id)),cache:{},nextId:1}};}
  function newRound(){
    variant=faults[Math.floor(Math.random()*faults.length)];round++;
    const mode=$('scenario').value;
    const adapter=mode==='mystery'?TV06Challenge.mysteryAdapter(new TV06Network.MysteryNetwork(variant)):TV06ScenarioAdapters.create(mode,engines());
    challenge=new TV06Challenge.Challenge(adapter);
    options('cause',mode==='mystery'?originalCauses:[['','Chọn giả thuyết'],...adapter.choices]);
    options('remedy',mode==='mystery'?originalRemedies:[['','Chọn biện pháp'],...adapter.remedies]);
    document.querySelector('.network').hidden=mode!=='mystery';
    $('diagnosis').reset();$('diagnosis').querySelectorAll('input,select,textarea,button').forEach(e=>e.disabled=false);
    $('history').replaceChildren();$('evidence').replaceChildren();$('tests').replaceChildren();
    $('message').textContent='';$('retest').textContent='';$('result').hidden=true;$('empty').hidden=false;
    $('phase').textContent='01 / ĐIỀU TRA';$('round').textContent='Lượt '+round;
    const state=challenge.publicState();$('title').textContent=state.title;$('symptom').textContent=state.symptom;
    state.tests.forEach(test=>{
      const b=document.createElement('button');b.textContent=test.label;b.type='button';
      b.onclick=()=>{try{addEvidence(challenge.runTest(test.id),test.label);}catch(e){$('message').textContent=e.message;}};
      $('tests').append(b);
    });$('count').textContent='0 bằng chứng';
  }
  function addEvidence(entry,label){
    const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');
    summary.textContent=entry.id+' · '+label;pre.textContent=JSON.stringify(entry.data,null,2);
    details.append(summary,pre);details.open=true;$('history').prepend(details);$('empty').hidden=true;
    const lab=document.createElement('label'),input=document.createElement('input');
    input.type='checkbox';input.name='evidence';input.value=entry.id;lab.append(input,document.createTextNode(entry.id+' · '+label));$('evidence').append(lab);
    $('count').textContent=challenge.publicState().history.length+' bằng chứng';
  }
  $('diagnosis').onsubmit=e=>{
    e.preventDefault();try{
      const evidenceIds=Array.from(document.querySelectorAll('input[name=evidence]:checked')).map(e=>e.value);
      const result=challenge.submit({cause:$('cause').value,hypothesis:$('hypothesis').value,remedy:$('remedy').value,evidenceIds});
      $('phase').textContent='02 / ĐÃ NỘP';$('result').hidden=false;
      $('score').textContent=result.score+'/100 · '+(result.passed?'Đủ căn cứ':'Cần xem lại');
      $('feedback').textContent='Nguyên nhân: '+(result.causeOK?'đúng':'chưa đúng')+' · Bằng chứng: '+(result.evidenceOK?'đủ theo rubric':'thiếu phép đo quyết định')+' · Biện pháp: '+(result.remedyOK?'phù hợp':'chưa phù hợp');
      $('solution').textContent=challenge.solution().explanation;$('caution').textContent=challenge.solution().reject;
      $('message').textContent='Đã ghi nhận kết luận. Lập luận tự do được lưu để giảng viên/nhóm đánh giá, không chấm bằng từ khóa.';
      document.querySelectorAll('#tests button,#diagnosis input,#diagnosis textarea,#diagnosis select,#diagnosis button').forEach(el=>el.disabled=true);
    }catch(err){$('message').textContent=err.message;}
  };
  $('repair').onclick=()=>{try{$('retest').textContent=JSON.stringify(challenge.repair(),null,2);}catch(e){$('retest').textContent=e.message;}};
  $('export').onclick=()=>{
    const state=challenge.publicState();const blob=new Blob([JSON.stringify({scope:'TV06 challenge with original-engine adapters',scenario:$('scenario').value,variant:$('scenario').value==='mystery'?variant:undefined,...state},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='TV06-bien-ban-luot-'+round+'.json';a.click();URL.revokeObjectURL(url);
  };
  $('new').onclick=newRound;$('scenario').onchange=newRound;newRound();
})();
