(function(root) {
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x));
  /* Adapter contract: {title,symptom,tests:[{id,label}],observe(id),assessment(),repair(id)}.
     observe chỉ trả kết quả phép đo, không trả đáp án. assessment chỉ được engine gọi sau nộp. */
  class Challenge {
    #adapter; #history=[]; #submitted=false; #result=null;
    constructor(adapter) {
      if (!adapter || !['observe','assessment','repair'].every(k=>typeof adapter[k]==='function') || !Array.isArray(adapter.tests)) throw new Error('Adapter chưa đủ hợp đồng TV06');
      this.#adapter=adapter;
    }
    publicState() {
      return clone({title:this.#adapter.title,symptom:this.#adapter.symptom,tests:this.#adapter.tests,
        history:this.#history,submitted:this.#submitted,result:this.#result});
    }
    runTest(id) {
      if (this.#submitted) throw new Error('Bài đã nộp; tạo lượt mới để điều tra lại');
      if (!this.#adapter.tests.some(t=>t.id===id)) throw new Error('Phép kiểm tra không hợp lệ');
      const entry={id:'E'+(this.#history.length+1),testId:id,time:this.#history.length+1,data:clone(this.#adapter.observe(id))};
      this.#history.push(entry); return clone(entry);
    }
    solution() {
      if (!this.#submitted) throw new Error('Nộp kết luận trước khi xem lời giải');
      return clone(this.#result.solution);
    }
    submit({cause,hypothesis,evidenceIds,remedy}) {
      if (this.#submitted) throw new Error('Kết luận đã được nộp');
      if (typeof hypothesis!=='string' || hypothesis.trim().length<10) throw new Error('Ghi lập luận ít nhất 10 ký tự');
      if (!cause || !remedy || !Array.isArray(evidenceIds) || evidenceIds.length<2) throw new Error('Chọn nguyên nhân, biện pháp và ít nhất hai bằng chứng');
      if (new Set(evidenceIds).size!==evidenceIds.length || evidenceIds.some(id=>!this.#history.some(e=>e.id===id))) throw new Error('Mã bằng chứng không thuộc lượt điều tra này hoặc bị trùng');
      const answer=this.#adapter.assessment();
      const tests=new Set(this.#history.filter(e=>evidenceIds.includes(e.id)).map(e=>e.testId));
      const causeOK=cause===answer.cause, evidenceOK=answer.evidence.every(id=>tests.has(id)),remedyOK=remedy===answer.remedy;
      const score=(causeOK?40:0)+(evidenceOK?40:0)+(remedyOK?20:0);
      this.#result={score,passed:causeOK&&evidenceOK&&remedyOK,causeOK,evidenceOK,remedyOK,
        submission:{cause,hypothesis:hypothesis.trim(),evidenceIds:[...evidenceIds],remedy},solution:answer};
      this.#submitted=true; return clone(this.#result);
    }
    repair() {
      if (!this.#submitted) throw new Error('Chỉ thử sửa sau khi nộp');
      return clone(this.#adapter.repair(this.#result.submission.remedy));
    }
  }
  function mysteryAdapter(network) {
    const lib=typeof module!=='undefined'&&module.exports?require('./mystery-case.js'):root.TV06Network;
    return {title:'Mất kết nối tới máy chủ đơn hàng',
      symptom:'PC 192.168.10.10 ping máy cùng LAN được, nhưng không nhận Echo Reply từ máy chủ 192.168.20.10. Hãy tìm nguyên nhân và biện pháp xử lý.',
      tests:lib.TESTS,observe:id=>network.observe(id),assessment:()=>network.assessment(),repair:id=>network.repair(id)};
  }
  const api={Challenge,mysteryAdapter};
  if(typeof module!=='undefined'&&module.exports) module.exports=api; else root.TV06Challenge=api;
})(typeof window!=='undefined'?window:globalThis);
