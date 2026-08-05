/**
 * auditVehicleRegistry — قسم المركبات: النظرة الشاملة، الانتهاءات، والتجديد.
 *
 *   node src/scripts/auditVehicleRegistry.js
 *   node src/scripts/auditVehicleRegistry.js --base http://127.0.0.1:5001
 *
 * أهم حاجة بيتأكد منها: فلتر «هينتهي خلال كام يوم» بيرجّع **بالظبط** اللي جوّه
 * المدة — لو رجّع صف برّه المدة، الرقم اللي صاحب الشركة بيخطّط عليه بيبقى كذب.
 * وكمان إن «غير مطلوب» ما بتظهرش كأنها نقص، وإن التجديد بيتقيّد بالقديم والجديد.
 *
 * بيرجّع أي بيانات غيّرها لأصلها وبيمسح مستخدميه (zz-vh-*).
 */
require('dotenv').config();
const mongoose=require('mongoose');
const argv=process.argv.slice(2);
const iB=argv.indexOf('--base');
const BASE=(iB>=0&&argv[iB+1]?argv[iB+1]:process.env.BASE||'http://localhost:5599').replace(/\/$/,'');
let pass=0,fail=0;
const ok=(l,c,x='')=>{console.log(`  ${c?'✓':'✗ FAIL'}  ${l}${x?'  — '+x:''}`);c?pass++:fail++;};
async function req(m,p,ck,b){const r=await fetch(`${BASE}${p}`,{method:m,headers:{'Content-Type':'application/json',...(ck?{Cookie:ck}:{})},body:b?JSON.stringify(b):undefined});let j=null;try{j=await r.json();}catch(e){}return{status:r.status,body:j};}
async function login(e){const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e,password:'Test@12345'})});if(r.status===429){console.error('RATE LIMITED');process.exit(2);}return (r.headers.getSetCookie?.()||[]).map(c=>c.split(';')[0]).join('; ');}
(async()=>{
  await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:20000});
  const User=require('../models/User');
  const {VehicleMaster}=require('../models/VehicleMaster');
  await User.deleteMany({email:{$regex:'^zz-vh'}});
  const u=await User.create({email:'zz-vh@example.invalid',password:'Test@12345',firstName:'م',lastName:'ت',role:'vehicles_manager'});
  const ck=await login(u.email);

  console.log('── نظرة شاملة: كارت لكل عمود ──');
  const o=await req('GET','/api/vehicle-registry/overview',ck);
  ok('الرد 200',o.status===200,`http ${o.status}`);
  ok('إجمالي المركبات',o.body?.totals?.vehicles>300,`${o.body?.totals?.vehicles}`);
  ok('بطاقات التصنيف موجودة',(o.body?.breakdowns||[]).length>=16,`${o.body?.breakdowns?.length} كارت`);
  ok('كل كارت معاه فلتر جاهز',(o.body?.breakdowns||[]).every(b=>b.items.every(i=>i.filter)));
  ok('بطاقة لكل مستند',(o.body?.documents||[]).length===5,(o.body?.documents||[]).map(d=>d.key).join(', '));
  const ins=(o.body?.documents||[]).find(d=>d.key==='insurance');
  ok('التأمين فيه الحالات المحسوبة',ins&&typeof ins.states.valid==='number',JSON.stringify(ins?.states));
  ok('وفيه «مطلوب/غير مطلوب/لا يوجد» بالاسم',(ins?.statuses||[]).some(s=>s.ar==='لا يوجد')&&(ins?.statuses||[]).some(s=>s.ar==='غير مطلوب'),(ins?.statuses||[]).map(s=>s.ar+':'+s.count).join(' · '));
  ok('وثائق الشركة ظاهرة',(o.body?.corporate||[]).length===2,(o.body?.corporate||[]).map(c=>c.scopeAr+' ('+c.days+'d)').join(' · '));
  ok('ملخّص الحوادث',o.body?.claims?.total===23,`${o.body?.claims?.total} حادث · مقدَّر ${o.body?.claims?.estimatedSar}`);

  console.log('\n── الانتهاءات بفلتر مرن ──');
  const all=await req('GET','/api/vehicle-registry/expiring',ck);
  ok('كل الانتهاءات',all.status===200&&all.body?.rows?.length>0,`${all.body?.summary?.total} صف`);
  for (const days of [7,30,45,60,90]) {
    const r=await req('GET',`/api/vehicle-registry/expiring?withinDays=${days}&includeExpired=0`,ck);
    const bad=(r.body?.rows||[]).filter(x=>x.daysRemaining>days||x.daysRemaining<0);
    ok(`خلال ${days} يوم: كل الصفوف داخل المدة`,bad.length===0,`${r.body?.summary?.total} صف`);
  }
  const one=await req('GET','/api/vehicle-registry/expiring?doc=insurance&withinDays=90&includeExpired=0',ck);
  ok('فلتر مستند واحد',(one.body?.rows||[]).every(r=>r.docKey==='insurance'),`${one.body?.summary?.total} تأمين`);
  ok('«غير مطلوب» مش بتظهر في الانتهاءات',(all.body?.rows||[]).every(r=>r.state!=='not_applicable'&&r.state!=='missing'));
  const m1=await req('GET','/api/vehicle-registry/expiring?withinDays=30&includeExpired=0',ck);
  const m2=await req('GET','/api/vehicle-registry/expiring?withinDays=60&includeExpired=0',ck);
  ok('المدة الأكبر بترجّع أكتر أو يساوي',(m2.body?.summary?.total||0)>=(m1.body?.summary?.total||0),`30d=${m1.body?.summary?.total} · 60d=${m2.body?.summary?.total}`);

  console.log('\n── التجديد ──');
  const veh=await VehicleMaster.findOne({'insurance.expiryDate':{$ne:null}}).lean();
  const before=veh.insurance.expiryDate;
  const future=new Date(Date.now()+400*864e5).toISOString().slice(0,10);
  const rn=await req('POST',`/api/vehicle-registry/${veh._id}/renew`,ck,{document:'insurance',newExpiry:future,cost:1500,reference:'POL-ZZ-1',note:'تجربة'});
  ok('التجديد نجح',rn.status===200,`http ${rn.status} ${rn.body?.message||''}`);
  const after=await VehicleMaster.findById(veh._id).lean();
  ok('التاريخ اتحدّث',after.insurance.expiryDate.toISOString().slice(0,10)===future,after.insurance.expiryDate?.toISOString().slice(0,10));
  ok('اتقيّد في السجل بالقديم والجديد',after.renewals.length===1&&String(after.renewals[0].previousExpiry)===String(before),`${after.renewals.length} سجل`);
  ok('واتسجّل مين عمله',!!after.renewals[0].byName,after.renewals[0].byName);
  const past=await req('POST',`/api/vehicle-registry/${veh._id}/renew`,ck,{document:'insurance',newExpiry:'2020-01-01'});
  ok('تجديد لتاريخ فات مرفوض',past.status===400,past.body?.message);
  const badDoc=await req('POST',`/api/vehicle-registry/${veh._id}/renew`,ck,{document:'nope',newExpiry:future});
  ok('مستند غير معروف مرفوض',badDoc.status===400,badDoc.body?.message);
  // رجّع البيانات زي ما كانت
  await VehicleMaster.updateOne({_id:veh._id},{$set:{'insurance.expiryDate':before},$pull:{renewals:{reference:'POL-ZZ-1'}}});

  console.log('\n── الحوادث ووثائق الشركة ──');
  const cl=await req('GET','/api/vehicle-registry/claims',ck);
  ok('الحوادث راجعة',cl.status===200&&cl.body?.claims?.length===23,`${cl.body?.claims?.length} حادث`);
  ok('إجمالي المبالغ محسوب',cl.body?.totals?.estimatedSar>0,`مقدَّر ${cl.body?.totals?.estimatedSar} · متوقع استرداد ${cl.body?.totals?.expectedRecoverySar}`);
  const cp=await req('GET','/api/vehicle-registry/corporate-policies',ck);
  ok('وثائق الشركة راجعة',cp.status===200&&cp.body?.policies?.length===2,(cp.body?.policies||[]).map(p=>p.scopeAr).join(' · '));
  const dt=await req('GET','/api/vehicle-registry/document-types',ck);
  ok('تعريف المستندات للواجهة',dt.status===200&&dt.body?.documents?.length===5);

  await User.deleteMany({email:{$regex:'^zz-vh'}});
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
